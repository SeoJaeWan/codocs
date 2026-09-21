import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const extensionTestPath = path.join(
  repositoryRoot,
  'tools/extension-host/extension-test.cjs',
);
const defaultCodeExecutable =
  process.platform === 'darwin'
    ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
    : process.platform === 'win32'
      ? 'code.cmd'
      : 'code';
const defaultCodeCli =
  process.platform === 'darwin'
    ? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    : defaultCodeExecutable;
const performanceSeed = 16_018;
const performanceTargetMilliseconds = 100;

/** 이름 있는 CLI 옵션의 다음 값을 반환한다. */
function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

/** 양의 정수 CLI 옵션을 읽고 기본값을 적용한다. */
function positiveIntegerOption(name, fallback) {
  const raw = optionValue(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

const vsixPath = optionValue('--vsix');
const requestedCodeVersion = optionValue('--code-version');
const outputPrefix = optionValue('--output');
const reportPath = optionValue('--report');
const hoverPerformance = process.argv.includes('--hover-performance');
const evidenceRunId =
  process.env.COD16_EVIDENCE_RUN_ID ?? `${Date.now()}-${process.pid}`;
const performanceOptions = {
  documents: positiveIntegerOption('--documents', 1_000),
  warmupRuns: positiveIntegerOption('--warmup-runs', 100),
  queryRuns: positiveIntegerOption('--query-runs', 1_000),
  seed: performanceSeed,
  targetMilliseconds: performanceTargetMilliseconds,
};
if (!vsixPath) throw new Error('--vsix requires an archive path');
if (outputPrefix && !hoverPerformance)
  throw new Error('--output requires --hover-performance');

/** 실행에 필요한 파일이 존재하는지 확인한다. */
async function requireFile(target, description) {
  try {
    await access(target);
  } catch {
    throw new Error(`${description} is unavailable: ${target}`);
  }
}

/** 파일의 SHA-256을 계산한다. */
async function fileSha256(target) {
  return createHash('sha256')
    .update(await readFile(target))
    .digest('hex');
}

/** 프로세스를 실행하고 출력·종료 상태를 수집한다. */
function runProcess(executable, arguments_, options = {}) {
  /** 자식 프로세스 결과를 Promise에 연결한다. */
  const execute = (resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.environment ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeoutMilliseconds = options.timeoutMilliseconds ?? 120_000;
    /** 제한 시간이 지나면 자식 프로세스를 종료한다. */
    const terminateAfterTimeout = () => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `${options.description ?? executable} timed out after ${String(timeoutMilliseconds)} milliseconds\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    };
    const timer = setTimeout(terminateAfterTimeout, timeoutMilliseconds);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  };
  return new Promise(execute);
}

/** URL 응답을 임시 파일에 받은 뒤 원자적으로 배치한다. */
async function downloadFile(url, destination) {
  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body)
    throw new Error(`VS Code download failed: ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  await rename(temporary, destination);
}

/** macOS application Info.plist에서 실제 GUI executable과 CLI 경로를 찾는다. */
async function macApplicationRuntime(application) {
  const info = path.join(application, 'Contents/Info.plist');
  const resolved = await runProcess(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', info],
    { description: 'VS Code application executable lookup' },
  );
  assert.equal(resolved.code, 0, resolved.stdout + resolved.stderr);
  const executable = path.join(
    application,
    'Contents/MacOS',
    resolved.stdout.trim(),
  );
  const cli = path.join(application, 'Contents/Resources/app/bin/code');
  await Promise.all([
    requireFile(executable, 'VS Code application executable'),
    requireFile(cli, 'VS Code application CLI'),
  ]);
  return { executable, cli };
}

/** 요청한 macOS VS Code 정식 버전을 task 전용 .workbench에 확보한다. */
async function ensurePinnedCode(version) {
  if (process.platform !== 'darwin')
    throw new Error('--code-version currently requires macOS verification');
  const platform = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin';
  const runtimeRoot = path.join(repositoryRoot, '.workbench/vscode', version);
  const application = path.join(runtimeRoot, 'Visual Studio Code.app');
  try {
    await access(application);
    return {
      ...(await macApplicationRuntime(application)),
      runtimeRoot,
      downloaded: false,
    };
  } catch {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
  const downloadRoot = path.join(repositoryRoot, '.workbench/downloads');
  await mkdir(downloadRoot, { recursive: true });
  const archive = path.join(downloadRoot, `vscode-${version}-${platform}.zip`);
  try {
    await access(archive);
  } catch {
    await downloadFile(
      `https://update.code.visualstudio.com/${version}/${platform}/stable`,
      archive,
    );
  }
  const extractionRoot = `${runtimeRoot}.extracting`;
  await rm(extractionRoot, { recursive: true, force: true });
  await mkdir(extractionRoot, { recursive: true });
  const extracted = await runProcess(
    '/usr/bin/ditto',
    ['-x', '-k', archive, extractionRoot],
    { description: `VS Code ${version} extraction` },
  );
  assert.equal(extracted.code, 0, extracted.stdout + extracted.stderr);
  await mkdir(path.dirname(runtimeRoot), { recursive: true });
  await rename(extractionRoot, runtimeRoot);
  await runProcess('/usr/bin/xattr', [
    '-dr',
    'com.apple.quarantine',
    application,
  ]);
  return {
    ...(await macApplicationRuntime(application)),
    runtimeRoot,
    downloaded: true,
  };
}

/** 현재 설치 또는 버전 고정 VS Code 실행 경로를 결정한다. */
async function resolveCodeRuntime() {
  if (requestedCodeVersion) return ensurePinnedCode(requestedCodeVersion);
  const executable = process.env.COD16_CODE_EXECUTABLE ?? defaultCodeExecutable;
  const cli = process.env.COD16_CODE_CLI ?? defaultCodeCli;
  await Promise.all([
    requireFile(executable, 'Visual Studio Code executable'),
    requireFile(cli, 'Visual Studio Code CLI'),
  ]);
  return {
    executable,
    cli,
    runtimeRoot: path.dirname(executable),
    downloaded: false,
  };
}

/** fixture용 knowledge 파일을 지정한 상대 경로에 만든다. */
async function writeKnowledge(root, relative, source) {
  const target = path.join(root, '.codocs', relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, 'utf8');
  return {
    target,
    bytes: Buffer.byteLength(source),
    characters: source.length,
  };
}

/** 기능 Extension Host 검증용 workspace와 원문을 만든다. */
async function createFunctionalFixture(temporaryRoot) {
  const parent = path.join(temporaryRoot, 'parent');
  const nested = path.join(parent, 'nested');
  const sibling = path.join(temporaryRoot, 'sibling');
  const missing = path.join(temporaryRoot, 'missing');
  await Promise.all([
    mkdir(nested, { recursive: true }),
    mkdir(sibling),
    mkdir(missing),
  ]);
  await Promise.all([
    writeKnowledge(
      parent,
      'parent-zone.yaml',
      'id: parent-zone\nname: Parent Zone\ndefinition: parent workspace only\ndomains: [test]\n',
    ),
    writeKnowledge(
      nested,
      'nested-zone.yaml',
      'id: nested-zone\nname: Nested Zone\ndefinition: nested workspace\ndomains: [test]\n',
    ),
    writeKnowledge(
      nested,
      '예약.yaml',
      'id: reservation\nname: 예약\ndefinition: 예약 본문에서 [[반납 구역]]을 참조합니다.\ndomains: [운영]\n',
    ),
    writeKnowledge(
      nested,
      '한글 원문/반납 구역.yaml',
      'id: return-zone\r\nname: 반납 구역\r\ndefinition: 반납 본문\r\ndomains: [운영]\r\n',
    ),
    writeKnowledge(
      sibling,
      'sibling-zone.yaml',
      'id: sibling-zone\nname: Sibling Zone\ndefinition: sibling\ndomains: [test]\n',
    ),
  ]);
  await Promise.all([
    writeFile(
      path.join(nested, 'source.java'),
      'class Saved {\n  reservationReturnZones();\n  nestedZone();\n  parentZone();\n}\n',
      'utf8',
    ),
    writeFile(
      path.join(nested, 'definition.js'),
      'function preservedDefinition() { return 1; }\npreservedDefinition();\n',
      'utf8',
    ),
  ]);
  return { parent, nested, sibling, missing, metadata: undefined };
}

/** 정렬된 숫자 목록의 중앙값을 계산한다. */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 성능 측정용 고정 구성 문서와 코드 식별자를 만든다. */
async function createPerformanceFixture(temporaryRoot) {
  const parent = path.join(temporaryRoot, 'parent');
  const nested = path.join(parent, 'nested');
  const sibling = path.join(temporaryRoot, 'sibling');
  const missing = path.join(temporaryRoot, 'missing');
  await Promise.all([
    mkdir(nested, { recursive: true }),
    mkdir(sibling),
    mkdir(missing),
  ]);
  const documentCount = performanceOptions.documents;
  const invalidCount =
    documentCount >= 20 ? Math.max(1, Math.floor(documentCount * 0.01)) : 0;
  const desiredCollisionCount =
    documentCount >= 20 ? Math.max(2, Math.floor(documentCount * 0.01)) : 0;
  const collisionCount = desiredCollisionCount - (desiredCollisionCount % 2);
  const validCount = documentCount - invalidCount - collisionCount;
  if (validCount <= 0)
    throw new Error('performance fixture needs a valid document');
  const width = Math.max(4, String(documentCount - 1).length);
  const sources = [];
  let referenceCount = 0;
  let longDefinitionCount = 0;
  for (let index = 0; index < validCount; index += 1) {
    const serial = String(index).padStart(width, '0');
    const name = `Performance Term ${serial}`;
    const hasReference = index < Math.min(10, Math.floor(validCount / 10));
    const isLong = index >= 10 && index < Math.min(20, validCount);
    if (hasReference) referenceCount += 1;
    if (isLong) longDefinitionCount += 1;
    const next = String((index + 1) % validCount).padStart(width, '0');
    const definition = isLong
      ? `${'긴 성능 본문 '.repeat(80)}${hasReference ? `[[Performance Term ${next}]]` : ''}`
      : `성능 본문 ${serial}${hasReference ? ` [[Performance Term ${next}]]` : ''}`;
    sources.push(
      await writeKnowledge(
        nested,
        `performance/term-${serial}.yaml`,
        `id: perf-term-${serial}\nname: ${name}\ndefinition: ${definition}\ndomains: [performance]\n`,
      ),
    );
  }
  for (let index = 0; index < invalidCount; index += 1) {
    const serial = String(validCount + index).padStart(width, '0');
    sources.push(
      await writeKnowledge(
        nested,
        `performance/invalid-${serial}.yaml`,
        `name: Invalid Performance ${serial}\ndefinition: missing id\ndomains: [performance]\n`,
      ),
    );
  }
  for (let index = 0; index < collisionCount; index += 1) {
    const serial = String(Math.floor(index / 2)).padStart(width, '0');
    sources.push(
      await writeKnowledge(
        nested,
        `performance/collision-${serial}-${String(index % 2)}.yaml`,
        `id: perf-collision-${serial}\nname: Collision ${serial} ${String(index % 2)}\ndefinition: collision\ndomains: [performance]\n`,
      ),
    );
  }
  const lines = Array.from(
    { length: validCount },
    (_, index) => `perfTerm${String(index).padStart(width, '0')}`,
  );
  const code = `${lines.join('\n')}\n`;
  await writeFile(path.join(nested, 'performance.txt'), code, 'utf8');
  const byteLengths = sources.map((source) => source.bytes);
  const characterLengths = sources.map((source) => source.characters);
  const metadata = {
    seed: performanceOptions.seed,
    projectDocumentCount: documentCount,
    queryableDocumentCount: validCount,
    invalidDocumentCount: invalidCount,
    collisionDocumentCount: collisionCount,
    collisionIdCount: collisionCount / 2,
    referenceCount,
    longDefinitionCount,
    documentBytes: {
      total: byteLengths.reduce((total, value) => total + value, 0),
      minimum: Math.min(...byteLengths),
      median: median(byteLengths),
      maximum: Math.max(...byteLengths),
    },
    documentCharacters: {
      total: characterLengths.reduce((total, value) => total + value, 0),
      minimum: Math.min(...characterLengths),
      median: median(characterLengths),
      maximum: Math.max(...characterLengths),
    },
    codeInput: {
      utf8Bytes: Buffer.byteLength(code),
      utf16CodeUnits: code.length,
      lines: lines.length,
      identifiers: lines.length,
      identifierPattern: `perfTerm${'0'.repeat(width)}`,
      requestPositionSelection:
        '32-bit LCG(seed=16018), state % queryableDocumentCount, line index at character 5',
    },
  };
  return { parent, nested, sibling, missing, metadata };
}

/** workspace 파일과 성능 또는 기능 fixture를 만든다. */
async function createFixture(temporaryRoot) {
  const fixture = hoverPerformance
    ? await createPerformanceFixture(temporaryRoot)
    : await createFunctionalFixture(temporaryRoot);
  const workspacePath = path.join(temporaryRoot, 'cod16.code-workspace');
  await writeFile(
    workspacePath,
    `${JSON.stringify(
      {
        folders: hoverPerformance
          ? [{ path: fixture.nested }]
          : [
              { path: fixture.parent },
              { path: fixture.nested },
              { path: fixture.sibling },
              { path: fixture.missing },
            ],
        settings: {
          'files.autoSave': 'off',
          'security.workspace.trust.enabled': false,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { ...fixture, workspacePath };
}

/** JSON과 사람이 읽는 Markdown 성능 보고서를 함께 기록한다. */
async function writePerformanceReport(prefix, report) {
  const resolved = path.resolve(repositoryRoot, prefix);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(
    `${resolved}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  const performance = report.evidence.performance;
  const fixture = report.fixture;
  const markdown = `# COD-16 actual VS Code Hover performance\n\n- Result: **${performance.passed ? 'PASS' : 'FAIL'}**\n- VS Code: \`${report.vscode.version}\` (${report.vscode.architecture})\n- Source commit: \`${report.artifacts.sourceCommit}\`\n- VSIX SHA-256: \`${report.artifacts.vsixSha256}\`\n- Extension bundle SHA-256: \`${report.artifacts.extensionBundleSha256}\`\n- Server bundle SHA-256: \`${report.artifacts.serverBundleSha256}\`\n- OS: \`${report.environment.platform} ${report.environment.release} ${report.environment.architecture}\`\n- CPU: \`${report.environment.cpu}\`\n- Node (runner / Extension Host): \`${report.environment.runnerNode}\` / \`${report.evidence.extensionHost.node}\`\n- File cache: ${report.environment.fileCache}\n- Measurement boundary: ${performance.measurementBoundary}\n\n## Dataset and requests\n\n- Seed: \`${fixture.seed}\`\n- Project documents: ${fixture.projectDocumentCount} (${fixture.queryableDocumentCount} queryable, ${fixture.invalidDocumentCount} invalid, ${fixture.collisionDocumentCount} collision documents / ${fixture.collisionIdCount} collision IDs)\n- References: ${fixture.referenceCount}; long definitions: ${fixture.longDefinitionCount}\n- Document bytes total/min/median/max: ${fixture.documentBytes.total} / ${fixture.documentBytes.minimum} / ${fixture.documentBytes.median} / ${fixture.documentBytes.maximum}\n- Code input bytes / UTF-16 units / lines / identifiers: ${fixture.codeInput.utf8Bytes} / ${fixture.codeInput.utf16CodeUnits} / ${fixture.codeInput.lines} / ${fixture.codeInput.identifiers}\n- Request positions: ${fixture.codeInput.requestPositionSelection}\n- Warmup / measured requests: ${performance.warmupRuns} / ${performance.queryRuns}\n\n## Latency\n\n| Metric | Milliseconds |\n| --- | ---: |\n| median | ${performance.medianMilliseconds.toFixed(3)} |\n| p95 | ${performance.p95Milliseconds.toFixed(3)} |\n| maximum | ${performance.maximumMilliseconds.toFixed(3)} |\n| target | ${performance.targetMilliseconds.toFixed(3)} |\n\nAccuracy failures: ${performance.accuracyFailureCount}. Event-loop delay p95: ${performance.eventLoopDelay.p95Milliseconds.toFixed(3)} ms. Raw request samples and failure details are in the adjacent JSON report.\n`;
  await writeFile(`${resolved}.md`, markdown, 'utf8');
}

/** 성능 실행이 Hover 요청 단계에서 실패해도 계획된 workload와 미측정 상태를 기록한다. */
async function writePerformanceFailureReport(prefix, details) {
  const resolved = path.resolve(repositoryRoot, prefix);
  await mkdir(path.dirname(resolved), { recursive: true });
  const progress = details.progress ?? [];
  const warmupStarts = progress.filter(
    (item) => item.phase === 'performance:warmup-request-start',
  );
  const warmupCompletions = progress.filter(
    (item) => item.phase === 'performance:warmup-request-complete',
  );
  const warmupFailures = progress.filter(
    (item) => item.phase === 'performance:warmup-request-failure',
  );
  const measuredStarts = progress.filter(
    (item) => item.phase === 'performance:measured-request-start',
  );
  const measuredFailures = progress.filter(
    (item) => item.phase === 'performance:measured-request-failure',
  );
  const completedWarmupRuns = warmupCompletions.length;
  const completedMeasuredRuns = progress.some(
    (item) => item.phase === 'performance:measured-complete',
  )
    ? performanceOptions.queryRuns
    : measuredStarts.length - measuredFailures.length;
  const attemptedWarmupRuns = warmupStarts.length;
  const attemptedMeasuredRuns = measuredStarts.length;
  const failureSamples = [...warmupFailures, ...measuredFailures];
  const report = {
    kind: 'actual-vscode-hover-performance',
    packageKind: 'installed-vsix',
    status: 'FAIL',
    result: 'p95 NOT_MEASURED',
    runId: evidenceRunId,
    vscode: {
      requestedVersion: requestedCodeVersion ?? null,
      version: details.actualCodeVersion,
    },
    environment: {
      platform: process.platform,
      release: os.release(),
      architecture: process.arch,
      runnerNode: process.version,
      profileIsolation: 'new user-data and extensions directories for this run',
    },
    fixture: details.fixtureMetadata,
    artifacts: {
      sourceCommit: details.sourceCommit,
      vsixPath: path.resolve(vsixPath),
      vsixSha256: details.vsixSha256,
      extensionBundleSha256: details.extensionBundleSha256,
      serverBundleSha256: details.serverBundleSha256,
    },
    performance: {
      targetMilliseconds: performanceTargetMilliseconds,
      warmupRuns: performanceOptions.warmupRuns,
      queryRuns: performanceOptions.queryRuns,
      completedWarmupRuns,
      completedMeasuredRuns,
      attemptedWarmupRuns,
      attemptedMeasuredRuns,
      p95Milliseconds: null,
      p95Status: 'NOT_MEASURED',
      failure: details.failureIdentity,
      failureSamples,
      progress,
    },
  };
  await writeFile(
    `${resolved}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  const fixture = details.fixtureMetadata;
  const firstFailure = failureSamples[0];
  const markdown = `# COD-16 actual VS Code Hover performance\n\n- Result: **FAIL**; p95: **NOT_MEASURED**.\n- VS Code: \`${details.actualCodeVersion}\`; runner Node: \`${process.version}\`\n- Source commit: \`${details.sourceCommit}\`\n- VSIX SHA-256: \`${details.vsixSha256}\`\n- Extension bundle SHA-256: \`${details.extensionBundleSha256}\`\n- Server bundle SHA-256: \`${details.serverBundleSha256}\`\n- Seed: \`${fixture?.seed ?? performanceSeed}\`; workload: ${fixture?.projectDocumentCount ?? performanceOptions.documents} documents, ${fixture?.queryableDocumentCount ?? 'NOT_RECORDED'} queryable\n- Warmup / measured requests planned: ${performanceOptions.warmupRuns} / ${performanceOptions.queryRuns}; attempted: ${attemptedWarmupRuns} / ${attemptedMeasuredRuns}; completed: ${completedWarmupRuns} / ${completedMeasuredRuns}\n- Bounded request timeout: 10,000 ms\n- Failure: \`${String(details.failureIdentity).replaceAll('`', "'")}\`\n- Failure sample: ${firstFailure ? `phase \`${firstFailure.phase}\`, run ${firstFailure.run}, line ${firstFailure.position?.line}, character ${firstFailure.position?.character}` : 'NOT_RECORDED'}\n\nThe adjacent JSON preserves progress checkpoints, failure identity, artifact hashes, and workload metadata. The full workload was retained; no reduced run is acceptance evidence.\n`;
  await writeFile(`${resolved}.md`, markdown, 'utf8');
}

/** 실패한 Host의 단계 기록과 VS Code 로그를 task evidence 디렉터리에 보존한다. */
async function preserveHostFailure({
  actualCodeVersion,
  mode,
  evidencePath,
  error,
  progressPath,
  userData,
}) {
  const destination = path.join(
    repositoryRoot,
    '.workbench/evidence',
    `host-${actualCodeVersion}-${mode}-${evidenceRunId}`,
  );
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const [source, relative] of [
    [progressPath, 'progress.json'],
    [evidencePath, 'extension-host-evidence.json'],
    [path.join(userData, 'logs'), 'vscode-logs'],
  ]) {
    try {
      await cp(source, path.join(destination, relative), { recursive: true });
    } catch {
      // 실패 지점에 아직 생성되지 않은 선택 evidence는 생략한다.
    }
  }
  await writeFile(
    path.join(destination, 'failure.json'),
    `${JSON.stringify(
      {
        vscodeVersion: actualCodeVersion,
        error: error instanceof Error ? error.stack : String(error),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return destination;
}

await mkdir(path.join(repositoryRoot, '.workbench/fixtures'), {
  recursive: true,
});
const temporaryRoot = await mkdtemp(
  path.join(repositoryRoot, '.workbench/fixtures/cod16-host-'),
);
let runtimeTemporaryRoot;
try {
  const runtime = await resolveCodeRuntime();
  const versionResult = await runProcess(runtime.cli, ['--version'], {
    description: 'VS Code version query',
  });
  assert.equal(versionResult.code, 0, versionResult.stderr);
  const [actualCodeVersion, , architecture = process.arch] =
    versionResult.stdout.trim().split(/\r?\n/u);
  if (requestedCodeVersion)
    assert.equal(actualCodeVersion, requestedCodeVersion, versionResult.stdout);

  const fixture = await createFixture(temporaryRoot);
  const evidencePath = path.join(temporaryRoot, 'extension-host-evidence.json');
  const progressPath = path.join(temporaryRoot, 'extension-host-progress.json');
  runtimeTemporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'c16-runtime-'));
  const userData = path.join(runtimeTemporaryRoot, 'user-data');
  const extensions = path.join(runtimeTemporaryRoot, 'extensions');
  await Promise.all([mkdir(userData), mkdir(extensions)]);

  await requireFile(vsixPath, 'VSIX archive');
  const installResult = await runProcess(
    runtime.cli,
    [
      '--install-extension',
      path.resolve(vsixPath),
      '--force',
      '--user-data-dir',
      userData,
      '--extensions-dir',
      extensions,
    ],
    { description: 'VSIX installation' },
  );
  assert.equal(
    installResult.code,
    0,
    `VSIX installation failed: ${installResult.stdout}${installResult.stderr}`,
  );
  const installed = (await readdir(extensions)).find((entry) =>
    entry.startsWith('codocs.codocs-'),
  );
  assert.ok(installed, 'Installed codocs extension directory was not found');
  const extensionRoot = path.join(extensions, installed);
  const extensionBundle = path.join(extensionRoot, 'dist/index.cjs');
  const serverBundle = path.join(extensionRoot, 'dist/server/index.cjs');
  await Promise.all([
    requireFile(extensionBundle, 'built extension bundle'),
    requireFile(serverBundle, 'bundled language server'),
  ]);

  let result;
  try {
    result = await runProcess(
      runtime.executable,
      [
        '--extensionDevelopmentPath',
        extensionRoot,
        '--extensionTestsPath',
        extensionTestPath,
        '--user-data-dir',
        userData,
        '--extensions-dir',
        extensions,
        '--disable-extensions',
        '--disable-gpu',
        '--disable-workspace-trust',
        '--logExtensionHostCommunication',
        '--skip-welcome',
        '--skip-release-notes',
        fixture.workspacePath,
      ],
      {
        description: 'VS Code Extension Host',
        timeoutMilliseconds: hoverPerformance ? 300_000 : 240_000,
        environment: {
          ...process.env,
          COD16_FIXTURE_ROOT: temporaryRoot,
          COD16_EXTENSION_ROOT: extensionRoot,
          COD16_EVIDENCE_PATH: evidencePath,
          COD16_PROGRESS_PATH: progressPath,
          COD16_HOVER_PERFORMANCE: hoverPerformance ? '1' : '0',
          COD16_PERFORMANCE_OPTIONS: JSON.stringify(performanceOptions),
          COD16_FIXTURE_METADATA: JSON.stringify(fixture.metadata ?? null),
        },
      },
    );
    assert.equal(
      result.code,
      0,
      `VS Code exited with ${String(result.code)} (${String(result.signal)})\n${result.stdout}\n${result.stderr}`,
    );
  } catch (error) {
    const destination = await preserveHostFailure({
      actualCodeVersion,
      mode: hoverPerformance ? 'performance' : 'functional',
      evidencePath,
      error,
      progressPath,
      userData,
    });
    if (hoverPerformance && outputPrefix) {
      let progress;
      try {
        progress = JSON.parse(await readFile(progressPath, 'utf8'));
      } catch {
        progress = [];
      }
      let sourceCommit;
      try {
        sourceCommit = (
          await runProcess('git', ['rev-parse', 'HEAD'])
        ).stdout.trim();
      } catch {
        sourceCommit = 'unknown';
      }
      await writePerformanceFailureReport(outputPrefix, {
        actualCodeVersion,
        failureIdentity:
          progress.findLast((item) => item.phase.endsWith('-failure'))?.error ??
          'executeHoverProvider timed out',
        error: error instanceof Error ? error.message : String(error),
        fixtureMetadata: fixture.metadata,
        progress,
        sourceCommit,
        vsixSha256: await fileSha256(vsixPath),
        extensionBundleSha256: await fileSha256(extensionBundle),
        serverBundleSha256: await fileSha256(serverBundle),
      });
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nPreserved failure evidence: ${destination}`,
      { cause: error },
    );
  }
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const sourceCommitResult = await runProcess('git', ['rev-parse', 'HEAD']);
  assert.equal(sourceCommitResult.code, 0, sourceCommitResult.stderr);
  const report = {
    kind: hoverPerformance
      ? 'actual-vscode-hover-performance'
      : 'actual-vscode-extension-host',
    packageKind: 'installed-vsix',
    vscode: {
      requestedVersion: requestedCodeVersion ?? null,
      version: actualCodeVersion,
      architecture,
      executable: runtime.executable,
      runtimeRoot: runtime.runtimeRoot,
      downloadedThisRun: runtime.downloaded,
    },
    environment: {
      platform: process.platform,
      release: os.release(),
      architecture: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      runnerNode: process.version,
      fileCache: 'OS file cache was not forcibly cleared',
      profileIsolation: 'new user-data and extensions directories for this run',
    },
    fixture: fixture.metadata ?? null,
    artifacts: {
      sourceCommit: sourceCommitResult.stdout.trim(),
      vsixPath: path.resolve(vsixPath),
      vsixBytes: (await stat(vsixPath)).size,
      vsixSha256: await fileSha256(vsixPath),
      extensionBundleSha256: await fileSha256(extensionBundle),
      serverBundleSha256: await fileSha256(serverBundle),
      vscodeSourceSha256: await fileSha256(
        path.join(repositoryRoot, 'packages/vscode/src/index.ts'),
      ),
      languageServerSourceSha256: await fileSha256(
        path.join(repositoryRoot, 'packages/language-server/src/index.ts'),
      ),
    },
    install: {
      extensionRoot,
      stdout: installResult.stdout,
      stderr: installResult.stderr,
    },
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    evidence,
  };
  if (hoverPerformance && outputPrefix)
    await writePerformanceReport(outputPrefix, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (reportPath)
    await writeFile(
      path.resolve(repositoryRoot, reportPath),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
  if (hoverPerformance) assert.equal(evidence.performance.passed, true);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  if (runtimeTemporaryRoot)
    await rm(runtimeTemporaryRoot, { recursive: true, force: true });
}
