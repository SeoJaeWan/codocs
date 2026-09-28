import { execFile, spawn, spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { packageVSIX } from '../../../tools/build/release.mjs';
import { installMcp } from '../../../tools/build/verify-release.mjs';
import {
  prepareVSCodeApplication,
  vscodeVersion,
} from '../../../tools/test/runtime/vscode.mjs';
import { createWorkspaceFixture } from '../src/integration/test-support/workspace-fixture.mjs';
import { withCacheLock } from '../../../tools/test/runtime/cache-lock.mjs';
import readDenial from '../../../tools/test/runtime/read-denial.cjs';
import {
  clockSnapshot,
  scenarioNames,
} from '../../../tools/test/runtime/performance-contract.mjs';
import {
  corpusSettings,
  createCorpus,
  writeCorpus,
} from '../src/integration/test-support/performance/corpus.mjs';
import {
  persistPerformanceReport,
  recordPerformanceSample,
} from '../../../tools/test/runtime/performance-report.mjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = config.output;
const archive = path.join(output, 'codocs.vsix');
const log = createWriteStream(path.join(output, 'process.log'));
let phase = 'build';
let releaseUnreadable;
/** 현재 단계와 성공 여부를 디스크에 즉시 남겨 비정상 종료도 구분한다. */
async function progress(extra = {}) {
  await writeFile(
    path.join(output, 'execution.json'),
    JSON.stringify({ phase, version: config.version, ...extra }, null, 2),
  );
}

/** 관측 자식이 함께 종료되어도 마지막 DOM 증거를 미완료 결과로 확정한다. */
async function finalizeUiObservation(scenario, status, error) {
  if (scenario !== 'first-ui' && scenario !== 'reentry-ui') return;
  const prefix = `ui-transitions-${scenario}-`;
  for (const name of await readdir(output)) {
    if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) continue;
    const suffix = name.slice(prefix.length, -'.jsonl'.length);
    const file = path.join(output, `ui-observation-${scenario}-${suffix}.json`);
    let observation;
    try {
      observation = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      const raw = await readFile(path.join(output, name), 'utf8');
      const transitions = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          transitions.push(JSON.parse(line));
        } catch {
          break;
        }
      }
      observation = { status: 'running', transitions, recoveredFromRaw: true };
    }
    if (observation.status !== 'running') continue;
    await writeFile(
      file,
      JSON.stringify({ ...observation, status, error }, null, 2),
    );
  }
}

/** 선택한 시나리오의 자기 프로필을 쓰는 VS Code 창만 중단한다. */
function cancelSession(profile, launchedAt) {
  if (process.platform !== 'win32') return false;
  const command =
    '$profilePath=$env:CODOCS_CANCEL_PROFILE; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "Code.exe" -and $_.CommandLine -and $_.CommandLine.Contains($profilePath) -and $_.CommandLine -notmatch "--type=" } | Select-Object ProcessId,@{Name="CreatedAt";Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString("o")}}} | ConvertTo-Json -Compress';
  const listing = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      env: { ...process.env, CODOCS_CANCEL_PROFILE: profile },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    },
  );
  if (listing.error || listing.status !== 0)
    throw listing.error ?? new Error(listing.stderr);
  const parsed = JSON.parse(listing.stdout.replace(/^\uFEFF/u, '') || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  let killed = false;
  for (const row of rows) {
    const createdAt = Date.parse(row.CreatedAt);
    if (!Number.isFinite(createdAt) || createdAt < launchedAt) continue;
    const result = spawnSync(
      'taskkill',
      ['/PID', String(row.ProcessId), '/T', '/F'],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (result.error || result.status !== 0)
      throw result.error ?? new Error(result.stderr);
    killed = true;
  }
  return killed;
}

/** 같은 설치 경로와 runTests launcher로 1창 기준, 같은 프로젝트 2창, 다른 프로젝트 2창을 잰다. */
async function runMultiwindow({ runtime, harness, extensions, report }) {
  const matrixStarted = clockSnapshot();
  const stageSamples = [];
  const phases = ['baseline', 'same', 'distinct'];
  for (const [iteration, currentPhase] of phases.entries()) {
    const root = path.join(
      config.temporary,
      'scenarios',
      'multiwindow',
      currentPhase,
    );
    const control = path.join(root, 'control');
    await mkdir(control, { recursive: true });
    const workspaceA = path.join(root, 'project-a');
    const corpusA = createCorpus(corpusSettings, 'project-multia');
    await writeCorpus(workspaceA, corpusA);
    const workspaceB =
      currentPhase === 'distinct' ? path.join(root, 'project-b') : workspaceA;
    const corpusB =
      currentPhase === 'distinct'
        ? createCorpus(corpusSettings, 'project-multib')
        : corpusA;
    if (currentPhase === 'distinct') await writeCorpus(workspaceB, corpusB);
    report.hashes.corpora ??= {};
    report.hashes.corpora[`multiwindow/${currentPhase}/a`] = corpusA.sha256;
    report.hashes.corpora[`multiwindow/${currentPhase}/b`] = corpusB.sha256;
    const roles = currentPhase === 'baseline' ? ['a'] : ['a', 'b'];
    const finished = new Set();
    const launches = [];
    for (const role of roles) {
      const profile = path.join(root, role, 'profile');
      const eventDirectory = path.join(root, role, 'events');
      await mkdir(path.join(profile, 'User'), { recursive: true });
      await mkdir(eventDirectory, { recursive: true });
      await writeFile(
        path.join(profile, 'User/settings.json'),
        JSON.stringify({
          'files.autoSave': 'off',
          'telemetry.telemetryLevel': 'off',
          'update.mode': 'none',
          'extensions.autoUpdate': false,
          'security.workspace.trust.enabled': false,
          'workbench.startupEditor': 'none',
          'window.restoreWindows': 'none',
        }),
      );
      const workspace = role === 'b' ? workspaceB : workspaceA;
      const corpus = role === 'b' ? corpusB : corpusA;
      const session = {
        id: `${path.basename(output)}/multiwindow/${currentPhase}/${role}`,
        scenario: 'multiwindow',
        iteration,
        phase: currentPhase,
        windowRole: role,
        isolated: currentPhase === 'distinct' && role === 'b',
        workspace,
        profile,
        eventsDirectory: eventDirectory,
        controlDirectory: control,
        corpusManifest: path.join(workspace, 'corpus-manifest.json'),
        corpusHash: corpus.sha256,
      };
      const windowConfig = path.join(root, `config-${role}.json`);
      await writeFile(
        windowConfig,
        JSON.stringify({ ...config, performanceSession: session }),
      );
      const started = clockSnapshot();
      const launched = runTests({
        vscodeExecutablePath: runtime.executable,
        extensionDevelopmentPath: harness,
        extensionTestsPath: path.join(
          config.root,
          'packages/vscode/src/integration/test-support/performance/index.cjs',
        ),
        extensionTestsEnv: {
          CODOCS_VSCODE_CONFIG: windowConfig,
          CODOCS_PERFORMANCE_EVENTS_DIR: eventDirectory,
          CODOCS_PERFORMANCE_SESSION_ID: session.id,
          CODOCS_PERFORMANCE_WINDOW_ID: `multiwindow/${currentPhase}/${role}`,
          CODOCS_PERFORMANCE_LAUNCH_STARTED: JSON.stringify(started),
        },
        stdout: log,
        stderr: log,
        launchArgs: [
          workspace,
          '--user-data-dir',
          profile,
          '--extensions-dir',
          extensions,
          '--disable-telemetry',
          '--disable-experiments',
          '--new-window',
        ],
      }).finally(() => finished.add(role));
      launches.push(launched);
    }
    /** 두 창의 실제 준비·전파 확인 파일을 완료까지 기다린다. */
    const waitForFiles = async (names) => {
      while (!names.every((name) => existsSync(path.join(control, name)))) {
        if (
          names.includes('done-a') &&
          finished.has('a') &&
          !existsSync(path.join(control, 'done-a'))
        )
          throw new Error(`multiwindow ${currentPhase}: A 창 전파 실패`);
        if (
          [...finished].some(
            (role) => !existsSync(path.join(control, `ready-${role}.json`)),
          )
        )
          throw new Error(`multiwindow ${currentPhase}: 창 준비 전에 종료됨`);
        await new Promise(
          /** 제어 파일을 확인하는 대기만 짧게 양보한다. */ (resolve) =>
            setTimeout(resolve, 25),
        );
      }
    };
    const launchesFinished = Promise.allSettled(launches);
    let coordinationError;
    try {
      await waitForFiles(roles.map((role) => `ready-${role}.json`));
      const token = `cod20-multiwindow-${currentPhase}-${Date.now()}`;
      const target = path.join(
        workspaceA,
        '.codocs/performance/normal-0001.yaml',
      );
      const source = await readFile(target, 'utf8');
      await writeFile(
        target,
        source.replace(/definition: .*/u, `definition: "${token}"`),
      );
      await writeFile(
        path.join(control, 'change.json'),
        JSON.stringify({ token, changedAt: clockSnapshot() }),
      );
      if (currentPhase === 'distinct') {
        await waitForFiles(['done-a']);
        await writeFile(path.join(control, 'verify-isolation'), '');
      }
    } catch (error) {
      coordinationError = error;
      await writeFile(path.join(control, 'abort'), String(error));
    }
    const outcomes = await launchesFinished;
    for (const role of roles) {
      const sampleFile = path.join(
        output,
        `scenario-samples-multiwindow-${iteration}-${role}.jsonl`,
      );
      try {
        const raw = await readFile(sampleFile, 'utf8');
        for (const line of raw.split('\n').filter(Boolean))
          stageSamples.push(JSON.parse(line));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const eventDirectory = path.join(root, role, 'events');
      for (const eventFile of await readdir(eventDirectory)) {
        const isEvent = /^events-\d+\.jsonl$/u.test(eventFile);
        const isOverhead = /^observer-overhead-\d+\.jsonl$/u.test(eventFile);
        if (!isEvent && !isOverhead) continue;
        const raw = await readFile(
          path.join(eventDirectory, eventFile),
          'utf8',
        );
        for (const line of raw.split('\n').filter(Boolean))
          if (isEvent)
            report.events.push({
              ...JSON.parse(line),
              received: clockSnapshot(),
            });
          else {
            report.observationOverhead ??= [];
            report.observationOverhead.push(JSON.parse(line));
          }
      }
    }
    const pids = new Set(
      report.events
        .filter((event) =>
          event.sessionId?.includes(`/multiwindow/${currentPhase}/`),
        )
        .map((event) => event.occurred.pid),
    );
    const latestMemory = new Map();
    for (const event of report.events)
      if (pids.has(event.occurred?.pid) && Number.isFinite(event.rssBytes))
        latestMemory.set(event.occurred.pid, event.rssBytes);
    report.events.push({
      kind: 'multiwindow-memory',
      phase: currentPhase,
      uniquePids: [...pids],
      rssByPid: Object.fromEntries(latestMemory),
      totalRssBytes: [...latestMemory.values()].reduce(
        (sum, value) => sum + value,
        0,
      ),
      method: 'last lifecycle RSS per unique Extension Host/server PID',
    });
    await persistPerformanceReport(report, output);
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
    if (coordinationError || failed.length)
      throw new Error(
        `multiwindow ${currentPhase}: ${coordinationError ?? failed.map((item) => item.reason).join('; ')}`,
      );
  }
  const matrixEnded = clockSnapshot();
  const valid =
    stageSamples.length === 5 &&
    stageSamples.every((sample) => sample.status === 'completed');
  recordPerformanceSample(report, 'multiwindow', {
    status: valid ? 'completed' : 'incorrect',
    durationMs: matrixEnded.monotonicMs - matrixStarted.monotonicMs,
    stages: stageSamples,
    begin: matrixStarted,
    end: matrixEnded,
    memoryAttribution:
      'latest RSS per unique Extension Host/server PID in each phase',
  });
  await persistPerformanceReport(report, output);
  if (!valid)
    throw new Error(
      'multiwindow 단계별 측정이 다섯 개 모두 완료되지 않았습니다',
    );
  return report;
}
try {
  await progress();
  if (config.vsix) {
    await cp(config.vsix, archive);
  } else
    await withCacheLock(
      path.join(config.root, '.workbench/vscode-build.lock'),
      /** 빌드와 패키징이 끝날 때까지 같은 작업 트리의 동시 빌드를 막는다. */ async () => {
        const built = spawnSync(
          process.execPath,
          ['tools/build/build.mjs', 'build'],
          { cwd: config.root, encoding: 'utf8', windowsHide: true },
        );
        log.write(built.stdout ?? '');
        log.write(built.stderr ?? '');
        if (built.error || built.status !== 0)
          throw (
            built.error ?? new Error(`현재 소스 빌드 실패: ${built.status}`)
          );
        phase = 'package';
        await progress();
        await packageVSIX(config.root, archive);
      },
    );
  phase = 'download';
  await progress();
  const runtime = await prepareVSCodeApplication({
    cacheRoot: config.cacheRoot,
    version: config.version ?? vscodeVersion,
  });
  phase = 'fixture';
  await progress();
  const workspace = path.join(config.temporary, 'workspace');
  await createWorkspaceFixture(workspace);
  releaseUnreadable = await readDenial.denyRead(
    path.join(workspace, 'partial/.codocs/unreadable.yaml'),
    path.join(config.temporary, 'file-denied'),
  );
  const profile = path.join(config.temporary, 'profile');
  await mkdir(path.join(profile, 'User'), { recursive: true });
  await writeFile(
    path.join(profile, 'User/settings.json'),
    JSON.stringify({
      'files.autoSave': 'off',
      'workbench.editor.enablePreview': false,
      'security.workspace.trust.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'workbench.startupEditor': 'none',
      'window.restoreWindows': 'none',
      'extensions.ignoreRecommendations': true,
      'codocs-0.trace.server': 'verbose',
    }),
  );
  phase = 'install';
  await progress();
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.VSCODE_IPC_HOOK_CLI;
  const extensions = path.join(config.temporary, 'extensions');
  await mkdir(extensions, { recursive: true });
  const installed = await promisify(execFile)(
    runtime.cli,
    [
      ...runtime.cliPrefix,
      '--install-extension',
      archive,
      '--force',
      '--user-data-dir',
      profile,
      '--extensions-dir',
      extensions,
    ],
    {
      env: runtime.cliAsNode
        ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        : process.env,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  log.write(installed.stdout);
  log.write(installed.stderr);
  const entries = (await readdir(extensions)).filter((entry) =>
    entry.startsWith('seojaewan.codocs-'),
  );
  if (entries.length !== 1)
    throw new Error(`설치된 Codocs 확장 경로가 하나여야 합니다: ${entries}`);
  config.extension = path.join(extensions, entries[0]);
  const installedManifest = JSON.parse(
    await readFile(path.join(config.extension, 'package.json'), 'utf8'),
  );
  if (
    installedManifest.publisher + '.' + installedManifest.name !==
      'seojaewan.codocs' ||
    installedManifest.version !== '0.0.1'
  )
    throw new Error('설치된 확장 ID/버전 불일치');
  config.mcpEntry = config.mcpTgz
    ? (
        await installMcp(
          config.mcpTgz,
          path.join(config.temporary, 'mcp-consumer'),
        )
      ).entry
    : path.join(config.root, 'packages/mcp/dist/cli.js');
  config.mcpSha256 = createHash('sha256')
    .update(await readFile(config.mcpEntry))
    .digest('hex');
  await writeFile(process.argv[2], JSON.stringify(config));
  await writeFile(
    path.join(output, 'installation.json'),
    JSON.stringify(
      {
        archive,
        sha256: createHash('sha256')
          .update(await readFile(archive))
          .digest('hex'),
        extension: config.extension,
        id: installedManifest.publisher + '.' + installedManifest.name,
        version: installedManifest.version,
        mcpTgz: config.mcpTgz,
        mcpTgzSha256: config.mcpTgz
          ? createHash('sha256')
              .update(await readFile(config.mcpTgz))
              .digest('hex')
          : null,
        ...installed,
      },
      null,
      2,
    ),
  );
  let performanceReport;
  if (config.mode === 'performance') {
    performanceReport = JSON.parse(
      await readFile(path.join(output, 'performance.json'), 'utf8'),
    );
    performanceReport.hashes.vsix = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    performanceReport.hashes.source = config.sourceHash;
    await persistPerformanceReport(performanceReport, output);
  }
  // 테스트 Host를 여는 빈 확장만 개발 모드로 등록한다. 제품은 설치된 VSIX에서 로드한다.
  const harness = path.join(config.temporary, 'test-harness');
  await mkdir(harness);
  await writeFile(
    path.join(harness, 'package.json'),
    JSON.stringify({
      name: 'codocs-test-harness',
      publisher: 'codocs-tests',
      version: '0.0.0',
      engines: { vscode: '^1.100.0' },
    }),
  );
  const workspaceFile = path.join(config.temporary, 'test.code-workspace');
  await writeFile(
    workspaceFile,
    JSON.stringify({
      folders: [
        { path: workspace },
        { path: path.join(workspace, 'nested') },
        { path: path.join(workspace, 'partial') },
      ],
    }),
  );
  if (config.mode === 'performance') {
    const selected =
      config.scenario === 'all' ? scenarioNames : [config.scenario];
    let failures = 0;
    for (const scenario of selected) {
      let heartbeat;
      let heartbeatWrites = Promise.resolve();
      let heartbeatError;
      let scenarioStarted;
      let scenarioStatus = 'complete';
      const progressFile = path.join(output, 'performance-progress.json');
      /** 보고서의 표본 기록과 충돌하지 않는 별도 진행 파일을 원자적으로 갱신한다. */
      const saveScenarioProgress = (state) => {
        heartbeatWrites = heartbeatWrites
          .then(
            /** 직전 기록과 순서가 뒤바뀌지 않게 저장한다. */ async () => {
              const temporaryProgress = `${progressFile}.${process.pid}.tmp`;
              await writeFile(
                temporaryProgress,
                JSON.stringify({
                  scenario,
                  state,
                  phase,
                  startedAt: new Date(scenarioStarted).toISOString(),
                  observedAt: new Date().toISOString(),
                  elapsedMs: Date.now() - scenarioStarted,
                  pid: process.pid,
                }),
              );
              await rename(temporaryProgress, progressFile);
            },
          )
          .catch((error) => {
            heartbeatError ??= error;
          });
      };
      try {
        performanceReport = JSON.parse(
          await readFile(path.join(output, 'performance.json'), 'utf8'),
        );
        phase = `performance-${scenario}`;
        await progress({ executable: runtime.executable, scenario });
        scenarioStarted = Date.now();
        saveScenarioProgress('running');
        heartbeat = setInterval(() => saveScenarioProgress('running'), 5000);
        if (scenario === 'multiwindow') {
          performanceReport = await runMultiwindow({
            runtime,
            harness,
            extensions,
            report: performanceReport,
          });
        } else {
          const repeats = ['startup', 'first-ui', 'reentry-ui'].includes(
            scenario,
          )
            ? config.settings.targets[scenario]
            : 1;
          for (let iteration = 0; iteration < repeats; iteration++) {
            const scenarioRoot = path.join(
              config.temporary,
              'scenarios',
              scenario,
              String(iteration),
            );
            const scenarioWorkspace = path.join(scenarioRoot, 'workspace');
            const scenarioProfile = path.join(scenarioRoot, 'profile');
            const eventsDirectory = path.join(scenarioRoot, 'events');
            await mkdir(eventsDirectory, { recursive: true });
            const corpus = createCorpus(
              { ...corpusSettings, seed: config.settings.seed },
              `project-${scenario.replaceAll('-', '')}`,
            );
            await writeCorpus(scenarioWorkspace, corpus);
            await mkdir(path.join(scenarioProfile, 'User'), {
              recursive: true,
            });
            await writeFile(
              path.join(scenarioProfile, 'User/settings.json'),
              JSON.stringify({
                'files.autoSave': 'off',
                'telemetry.telemetryLevel': 'off',
                'update.mode': 'none',
                'extensions.autoUpdate': false,
                'security.workspace.trust.enabled': false,
                'workbench.startupEditor': 'none',
                'window.restoreWindows': 'none',
              }),
            );
            config.performanceSession = {
              id: `${path.basename(output)}/${scenario}/${iteration}`,
              scenario,
              iteration,
              workspace: scenarioWorkspace,
              profile: scenarioProfile,
              eventsDirectory,
              corpusManifest: path.join(
                scenarioWorkspace,
                'corpus-manifest.json',
              ),
              corpusHash: corpus.sha256,
            };
            performanceReport.hashes.corpora ??= {};
            performanceReport.hashes.corpora[`${scenario}/${iteration}`] =
              corpus.sha256;
            performanceReport.hashes.data ??= corpus.sha256;
            performanceReport.events.push({
              kind: 'scenario-prepared',
              scenario,
              iteration,
              corpusHash: corpus.sha256,
              at: new Date().toISOString(),
            });
            await persistPerformanceReport(performanceReport, output);
            await writeFile(process.argv[2], JSON.stringify(config));
            const launchStarted = clockSnapshot();
            let cancellationMonitor;
            let hostCancelled = false;
            try {
              cancellationMonitor = setInterval(
                /** 제품 Promise와 별도로 이 시나리오의 취소를 감시한다. */ () => {
                  if (hostCancelled) return;
                  try {
                    const control = JSON.parse(
                      readFileSync(
                        path.join(output, 'cancel-scenarios.json'),
                        'utf8',
                      ),
                    );
                    if (control.scenarios?.includes(scenario)) {
                      hostCancelled = cancelSession(
                        scenarioProfile,
                        Date.parse(launchStarted.wallTime),
                      );
                    }
                  } catch (error) {
                    if (error.code !== 'ENOENT')
                      log.write(`scenario cancellation: ${error}\n`);
                  }
                },
                200,
              );
              await runTests({
                vscodeExecutablePath: runtime.executable,
                extensionDevelopmentPath: harness,
                extensionTestsPath: path.join(
                  config.root,
                  'packages/vscode/src/integration/test-support/performance/index.cjs',
                ),
                extensionTestsEnv: {
                  CODOCS_VSCODE_CONFIG: process.argv[2],
                  CODOCS_PERFORMANCE_EVENTS_DIR: eventsDirectory,
                  CODOCS_PERFORMANCE_SESSION_ID: config.performanceSession.id,
                  CODOCS_PERFORMANCE_WINDOW_ID: `${scenario}/${iteration}/window-1`,
                  CODOCS_PERFORMANCE_LAUNCH_STARTED:
                    JSON.stringify(launchStarted),
                  CODOCS_PERFORMANCE_OBSERVER_NODE: process.execPath,
                },
                stdout: log,
                stderr: log,
                launchArgs: [
                  scenarioWorkspace,
                  '--user-data-dir',
                  scenarioProfile,
                  '--extensions-dir',
                  extensions,
                  '--disable-telemetry',
                  '--disable-experiments',
                  '--new-window',
                  ...(scenario === 'first-ui' || scenario === 'reentry-ui'
                    ? ['--remote-debugging-port=0', '--locale=en']
                    : []),
                ],
              });
            } finally {
              clearInterval(cancellationMonitor);
              if (hostCancelled)
                await writeFile(
                  path.join(output, `scenario-cancelled-${scenario}.json`),
                  JSON.stringify({
                    scenario,
                    iteration,
                    profile: scenarioProfile,
                  }),
                );
              const samplePath = path.join(
                output,
                `scenario-samples-${scenario}-${iteration}-main.jsonl`,
              );
              let samples = '';
              try {
                samples = await readFile(samplePath, 'utf8');
              } catch (error) {
                if (error.code !== 'ENOENT') throw error;
              }
              performanceReport = JSON.parse(
                await readFile(path.join(output, 'performance.json'), 'utf8'),
              );
              for (const line of samples.split('\n').filter(Boolean))
                recordPerformanceSample(
                  performanceReport,
                  scenario,
                  JSON.parse(line),
                );
              for (const eventFile of await readdir(eventsDirectory)) {
                const isEvent = /^events-\d+\.jsonl$/u.test(eventFile);
                const isOverhead = /^observer-overhead-\d+\.jsonl$/u.test(
                  eventFile,
                );
                if (!isEvent && !isOverhead) continue;
                const raw = await readFile(
                  path.join(eventsDirectory, eventFile),
                  'utf8',
                );
                for (const line of raw.split('\n').filter(Boolean))
                  if (isEvent)
                    performanceReport.events.push({
                      ...JSON.parse(line),
                      received: clockSnapshot(),
                    });
                  else {
                    performanceReport.observationOverhead ??= [];
                    performanceReport.observationOverhead.push(
                      JSON.parse(line),
                    );
                  }
              }
              await persistPerformanceReport(performanceReport, output);
            }
            if (
              scenario !== 'edit-indexing' &&
              performanceReport.scenarios[scenario].completed <
                (['startup', 'first-ui', 'reentry-ui'].includes(scenario)
                  ? iteration + 1
                  : config.settings.targets[scenario])
            )
              throw new Error(`${scenario} 완료 표본이 목표보다 부족합니다`);
          }
        }
        if (heartbeatError) throw heartbeatError;
      } catch (error) {
        failures++;
        scenarioStatus = 'failed';
        let scenarioError = String(error?.stack ?? error);
        let cancelled = false;
        try {
          const detail = JSON.parse(
            await readFile(
              path.join(output, `scenario-error-${scenario}.json`),
              'utf8',
            ),
          );
          if (detail.scenario === scenario && detail.error)
            scenarioError = `${detail.error}\n${scenarioError}`;
          cancelled = detail.scenario === scenario && detail.cancelled === true;
        } catch (detailError) {
          if (detailError.code !== 'ENOENT') throw detailError;
        }
        if (
          existsSync(path.join(output, `scenario-cancelled-${scenario}.json`))
        )
          cancelled = true;
        if (scenario === 'first-ui' || scenario === 'reentry-ui') {
          const processOutput = await readFile(
            path.join(output, 'process.log'),
            'utf8',
          );
          if (/CodeWindow: renderer process gone/u.test(processOutput))
            scenarioError = `renderer process gone\n${scenarioError}`;
        }
        // 확장 Host가 먼저 저장한 원시 표본을 보존한다.
        performanceReport = JSON.parse(
          await readFile(path.join(output, 'performance.json'), 'utf8'),
        );
        scenarioStatus = cancelled ? 'cancelled' : 'failed';
        await finalizeUiObservation(scenario, scenarioStatus, scenarioError);
        recordPerformanceSample(performanceReport, scenario, {
          status: scenarioStatus,
          error: scenarioError,
        });
        performanceReport.errors.push(`${scenario}: ${scenarioError}`);
        await persistPerformanceReport(performanceReport, output);
      } finally {
        clearInterval(heartbeat);
        if (scenarioStarted) {
          await heartbeatWrites;
          saveScenarioProgress(scenarioStatus);
          await heartbeatWrites;
        }
      }
    }
    if (failures)
      throw new Error(`${failures}/${selected.length} IDE 성능 시나리오 실패`);
  } else {
    phase = 'extension-host';
    await progress({ executable: runtime.executable });
    const uiObserver = spawn(
      process.execPath,
      [
        path.join(
          config.root,
          'packages/vscode/test-runner/code-ui-observer.mjs',
        ),
        process.argv[2],
        profile,
      ],
      { stdio: ['ignore', log, log], windowsHide: true },
    );
    const uiExited = new Promise(
      /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ (
        resolve,
      ) => uiObserver.once('exit', resolve),
    );
    try {
      await runTests({
        vscodeExecutablePath: runtime.executable,
        extensionDevelopmentPath: harness,
        extensionTestsPath: path.join(
          config.root,
          'packages/vscode/src/integration/index.cjs',
        ),
        extensionTestsEnv: { CODOCS_VSCODE_CONFIG: process.argv[2] },
        stdout: log,
        stderr: log,
        launchArgs: [
          workspaceFile,
          '--user-data-dir',
          profile,
          '--extensions-dir',
          extensions,
          '--disable-telemetry',
          '--disable-experiments',
          '--new-window',
          '--remote-debugging-port=0',
        ],
      });
    } finally {
      uiObserver.kill('SIGTERM');
      await uiExited;
    }
  }
  phase = 'complete';
  await progress({ passed: true });
} catch (error) {
  await progress({ passed: false, error: error.stack ?? String(error) });
  process.exitCode = 1;
} finally {
  if (releaseUnreadable) {
    try {
      await releaseUnreadable();
    } catch (error) {
      process.exitCode = 1;
      log.write(`fixture cleanup: ${error}\n`);
    }
  }
  log.end();
  await finished(log);
}
