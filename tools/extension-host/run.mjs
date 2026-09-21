import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream, writeFileSync } from 'node:fs';
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
import {
  describeProgress,
  readProgress,
  summarizeOutcomes,
} from './progress.mjs';

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
const renderExisting = optionValue('--render-existing-performance');
const requestedCodeVersion = optionValue('--code-version');
const outputPrefix = optionValue('--output');
const reportPath = optionValue('--report');
const hoverPerformance = process.argv.includes('--hover-performance');
const evidenceRunId =
  process.env.COD16_EVIDENCE_RUN_ID ?? `${Date.now()}-${process.pid}`;
const performanceDocuments = positiveIntegerOption('--documents', 1_000);
const performanceOptions = {
  documents: performanceDocuments,
  warmupRuns: positiveIntegerOption('--warmup-runs', 100),
  queryRuns: positiveIntegerOption('--query-runs', 1_000),
  seed: performanceSeed,
  targetMilliseconds:
    performanceDocuments === 1_000 ? performanceTargetMilliseconds : null,
};
if (!vsixPath && !renderExisting)
  throw new Error('--vsix requires an archive path');
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
    const timeoutMilliseconds =
      options.timeoutMilliseconds === null
        ? null
        : (options.timeoutMilliseconds ?? 120_000);
    /** 제한 시간이 지나면 자식 프로세스를 종료한다. */
    const terminateAfterTimeout = () => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `${options.description ?? executable} timed out after ${String(timeoutMilliseconds)} milliseconds\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    };
    const timer =
      timeoutMilliseconds === null
        ? null
        : setTimeout(terminateAfterTimeout, timeoutMilliseconds);
    /** 사용자의 중단 신호는 이 호출에서 시작한 자식에만 전달한다. */
    let interruptedSignal;
    /** 신호를 실행 중인 자식에 전달한다. */
    const interrupt = (signal) => {
      interruptedSignal = signal;
      try {
        options.onInterrupt?.(signal);
      } catch (error) {
        process.stderr.write(
          `중단 기록 오류: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      child.kill(signal);
    };
    /** 중단 신호를 현재 자식에 전달한다. */
    const onInterrupt = () => interrupt('SIGINT');
    /** 종료 신호를 현재 자식에 전달한다. */
    const onTerminate = () => interrupt('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    /** 설치된 신호 수신기를 해제한다. */
    const cleanListeners = () => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once(
      'error',
      /** 자식 시작 오류를 전달한다. */
      (error) => {
        clearTimeout(timer);
        cleanListeners();
        reject(error);
      },
    );
    child.once(
      'exit',
      /** 자식 종료 상태를 전달한다. */
      (code, signal) => {
        clearTimeout(timer);
        cleanListeners();
        if (interruptedSignal)
          reject(new Error(`Interrupted by ${interruptedSignal}`));
        else resolve({ code, signal, stdout, stderr });
      },
    );
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

/** 성공한 완료 표본만으로 보간 percentile을 계산한다. */
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** 완료·부분·오류 상태에 공통인 한국어 성능 보고서를 기록한다. */
async function writePerformanceReport(prefix, report) {
  const resolved = path.resolve(repositoryRoot, prefix);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(
    `${resolved}.json.partial`,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  await rename(`${resolved}.json.partial`, `${resolved}.json`);
  const p = report.evidence?.performance ?? report.performance;
  const fixture = report.fixture ?? {};
  const samples = p.samples ?? [];
  const warmups = p.warmups ?? [];
  const pending = p.pending;
  /** nullable 지연 시간을 표 형식으로 변환한다. */
  const number = (value) => (value == null ? '미측정' : value.toFixed(3));
  const firstReadiness = p.readiness?.[0]?.durationMilliseconds;
  const warmupDurations = warmups
    .filter((sample) => sample.success)
    .map((sample) => sample.durationMilliseconds);
  const firstWarmup = warmups[0]?.durationMilliseconds;
  const warmupMedian = percentile(warmupDurations, 0.5);
  const warmupMaximum = warmupDurations.length
    ? Math.max(...warmupDurations)
    : null;
  const eventLoopPhases = p.eventLoopDelay?.phases ?? {};
  const resourcePhaseLabels = {
    'before-readiness': '준비 전',
    'after-readiness': '준비 후',
    'after-warmup': '워밍업 후',
    'after-measured': '본 측정 후',
  };
  const requestPhaseLabels = {
    'performance:readiness-request-start': '첫 준비 확인',
    'performance:warmup-request-start': '워밍업',
    'performance:measured-request-start': '본 측정',
  };
  const pendingRun =
    pending?.run == null
      ? '미확인'
      : pending.phase === 'performance:readiness-request-start'
        ? pending.run
        : pending.run + 1;
  const pendingDescription = pending
    ? `${requestPhaseLabels[pending.phase] ?? '현재 요청'} ${pendingRun}회차, 문서 위치 ${pending.index ?? '미확인'}, 대기 ${number(pending.elapsedWaitingMs)} ms`
    : '없음';
  /** 원본 로그를 JSON에 남기고 사람용 문장에는 짧은 한국어 이유를 쓴다. */
  function describeFailure() {
    if (!p.failure) return '없음';
    const signal = /^(?:Interrupted by )?(SIGINT|SIGTERM)(?:$|\s)/u.exec(
      p.failure,
    )?.[1];
    if (signal) return `사용자 ${signal} 신호로 측정을 중단했습니다.`;
    const exit = /^VS Code exited with ([^\n]+)/u.exec(p.failure)?.[1];
    if (exit) {
      const exitSignal = /\((SIG[A-Z]+)\)/u.exec(exit)?.[1];
      return `VS Code 자식 프로세스가 ${exitSignal ? `${exitSignal} 신호로` : `${exit} 상태로`} 비정상 종료되어 현재 요청이 완료되지 않았습니다. 원본 로그는 JSON과 실행 기록에 보존했습니다.`;
    }
    return p.failure.includes('\n')
      ? `측정 중 오류가 발생했습니다: ${p.failure.split('\n', 1)[0]}. 원본 로그는 JSON과 실행 기록에 보존했습니다.`
      : p.failure;
  }
  const failureDescription = describeFailure();
  const markdown = [
    '# COD-16 실제 VS Code Hover 성능 관찰 보고서',
    '',
    `- 실행 상태: ${report.status === 'completed' ? '완료' : report.status === 'interrupted' ? '중단됨' : '부분 완료'}`,
    `- 정확성: ${p.passed ? '통과' : p.accuracyFailureCount ? '실패' : '미확인'}`,
    `- VS Code: ${report.vscode?.version ?? '미확인'}; 실행기 Node: ${report.environment?.runnerNode ?? process.version}`,
    `- 소스 커밋: ${report.artifacts?.sourceCommit ?? '미확인'}; VSIX SHA-256: ${report.artifacts?.vsixSha256 ?? '미확인'}`,
    `- 확장 번들 SHA-256: ${report.artifacts?.extensionBundleSha256 ?? '미확인'}; 서버 번들 SHA-256: ${report.artifacts?.serverBundleSha256 ?? '미확인'}`,
    `- 운영체제: ${report.environment?.platform ?? process.platform} ${report.environment?.release ?? os.release()} ${report.environment?.architecture ?? process.arch}`,
    `- 데이터: seed ${fixture.seed ?? performanceSeed}, 문서 ${fixture.projectDocumentCount ?? performanceOptions.documents}개, 정상 조회 가능 ${fixture.queryableDocumentCount ?? '미확인'}개, 무효 ${fixture.invalidDocumentCount ?? '미확인'}개, 충돌 ${fixture.collisionDocumentCount ?? '미확인'}개`,
    `- 실행 회차: 준비 확인 시도 ${p.attemptedReadiness ?? p.readinessAttempts ?? '미확인'}회/완료 ${p.completedReadiness ?? p.readiness?.length ?? '미확인'}회; 워밍업 요청 ${p.warmupRuns}회/시도 ${p.attemptedWarmupRuns ?? warmups.length}회/완료 ${p.completedWarmupRuns ?? warmups.length}회; 측정 요청 ${p.queryRuns}회/시도 ${p.attemptedMeasuredRuns ?? samples.length}회/완료 ${p.completedMeasuredRuns ?? samples.length}회`,
    `- 정확성 실패: ${p.accuracyFailureCount ?? 0}개; 정확한 완료 측정 표본: ${p.successfulLatencySampleCount ?? samples.filter((sample) => sample.success).length}개`,
    `- 취소되어 완료된 요청: ${p.cancelledCount ?? [...warmups, ...samples].filter((sample) => sample.cancelled || sample.error === 'Canceled').length}개; 미완료 대기 요청: ${pending ? 1 : 0}개`,
    `- 현재 대기 요청: ${pendingDescription}`,
    `- 오류 이유: ${failureDescription}`,
    `- 진행 기록 무결성: ${(p.progressIntegrity ?? report.performanceProgressIntegrity) === 'corrupt' ? '손상된 중간 기록 있음' : '확인됨'}`,
    '',
    '## 실제 완료 지연 (ms)',
    '',
    `- 첫 준비 확인 요청: ${number(firstReadiness)} ms`,
    `- 첫 워밍업 요청: ${number(firstWarmup)} ms`,
    `- 정확한 워밍업 완료: ${warmupDurations.length}개; 중앙값 ${number(warmupMedian)} ms; 최대 ${number(warmupMaximum)} ms`,
    `- VS Code Extension Host 프로세스의 단계별 메모리 RSS: 준비 전 ${p.memory?.beforeReadiness?.rss ?? p.memory?.['before-readiness']?.rss ?? '미측정'} B; 준비 후 ${p.memory?.afterReadiness?.rss ?? p.memory?.['after-readiness']?.rss ?? '미측정'} B; 워밍업 후 ${p.memory?.afterWarmup?.rss ?? p.memory?.['after-warmup']?.rss ?? '미측정'} B; 측정 후 ${p.memory?.afterMeasured?.rss ?? p.memory?.['after-measured']?.rss ?? '미측정'} B`,
    ...Object.entries(eventLoopPhases).map(
      ([boundary, observation]) =>
        `- Extension Host ${resourcePhaseLabels[boundary] ?? boundary} 이벤트 루프 표본 ${observation.count ?? '미확인'}회·p95: ${number(observation.p95Milliseconds)} ms`,
    ),
    ...(Object.keys(eventLoopPhases).length
      ? []
      : [
          `- Extension Host 전체 관찰 이벤트 루프 p95: ${number(p.eventLoopDelay?.p95Milliseconds)} ms`,
        ]),
    '',
    '',
    '| 항목 | 값 |',
    '| --- | ---: |',
    `| 성공 표본 중앙값 | ${number(p.medianMilliseconds)} |`,
    `| 성공 표본 p95 | ${number(p.p95Milliseconds)} |`,
    `| 성공 표본 최댓값 | ${number(p.maximumMilliseconds)} |`,
    ...(p.targetMilliseconds == null
      ? []
      : [`| 1,000개 문서 참고 기준 | ${number(p.targetMilliseconds)} |`]),
    '',
    `Hover 요청은 실제 Promise 완료까지 기다렸습니다. p95에는 정확하게 완료된 측정 요청만 포함했습니다. 틀린 응답의 실제 완료 시간과 모든 워밍업·준비 확인 결과는 인접 JSON의 원시 기록에 남습니다. ${p.targetMilliseconds == null ? '이 문서 규모에는 시간 참고 기준을 적용하지 않습니다.' : '100ms 기준 초과만으로 실행이나 정확성 검사를 실패 처리하지 않습니다.'}`,
    '',
    '현재 범위는 설치된 VS Code의 Hover입니다. 목록/필터/커서, 변경 계획, MCP 통신 및 쓰기 전체는 이 명령에서 측정하지 않았습니다. 현재 제공 범위 밖인 자동완성은 성능 판정 대상에서 제외합니다.',
    '',
  ];
  await writeFile(`${resolved}.md.partial`, `${markdown.join('\n')}\n`, 'utf8');
  await rename(`${resolved}.md.partial`, `${resolved}.md`);
}

/** Host 오류 때 완료된 진행 기록을 복구하고 미완료 요청은 별도로 표시한다. */
async function writePerformanceFailureReport(prefix, details) {
  const progress = details.progress ?? [];
  /** 지정 단계의 시작 기록을 추출한다. */
  const starts = (phase) =>
    progress.filter(
      (item) => item.phase === `performance:${phase}-request-start`,
    );
  /** 지정 단계의 완료 기록을 추출한다. */
  const complete = (phase) =>
    progress.filter(
      (item) => item.phase === `performance:${phase}-request-complete`,
    );
  const warmups = complete('warmup').map(
    /** 진행 기록의 워밍업 완료 표본을 보존한다. */
    ({
      run,
      index,
      durationMilliseconds,
      success,
      cancelled,
      error,
      markdown,
    }) => ({
      run,
      index,
      durationMilliseconds,
      success,
      cancelled: cancelled ?? error === 'Canceled',
      error,
      markdown,
    }),
  );
  const samples = complete('measured').map(
    /** 진행 기록의 측정 완료 표본을 보존한다. */
    ({
      run,
      index,
      durationMilliseconds,
      success,
      cancelled,
      error,
      markdown,
    }) => ({
      run,
      index,
      durationMilliseconds,
      success,
      cancelled: cancelled ?? error === 'Canceled',
      error,
      markdown,
    }),
  );
  const readiness = complete('readiness');
  const corruptProgress = progress.filter(
    (item) => item.phase === 'progress:corrupt',
  );
  const memory = Object.fromEntries(
    progress
      .filter((item) => item.phase === 'performance:resources')
      .map((item) => [item.boundary, item.memory]),
  );
  const eventLoopPhases = Object.fromEntries(
    progress
      .filter(
        (item) => item.phase === 'performance:resources' && item.eventLoop,
      )
      .map((item) => [item.boundary, item.eventLoop]),
  );
  const allStarts = progress.filter((item) =>
    item.phase?.endsWith('-request-start'),
  );
  const lastStart = allStarts.at(-1);
  const subsequent = lastStart
    ? progress.slice(progress.lastIndexOf(lastStart) + 1)
    : [];
  const pending =
    lastStart &&
    !subsequent.some(
      (item) =>
        item.phase === lastStart.phase.replace('-start', '-complete') &&
        item.run === lastStart.run,
    )
      ? {
          phase: lastStart.phase,
          run: lastStart.run,
          index: lastStart.index,
          elapsedWaitingMs:
            Date.now() - Date.parse(lastStart.startedAt ?? lastStart.at),
        }
      : null;
  const durations = samples
    .filter((sample) => sample.success)
    .map((sample) => sample.durationMilliseconds);
  const { accuracyFailureCount, cancelledCount } = summarizeOutcomes(
    readiness,
    warmups,
    samples,
  );
  const report = {
    kind: 'actual-vscode-hover-performance',
    packageKind: 'installed-vsix',
    status: details.interrupted ? 'interrupted' : 'partial',
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
      targetMilliseconds: performanceOptions.targetMilliseconds,
      warmupRuns: performanceOptions.warmupRuns,
      queryRuns: performanceOptions.queryRuns,
      readinessAttempts: readiness.length,
      attemptedReadiness: starts('readiness').length,
      completedReadiness: readiness.length,
      readiness,
      memory,
      eventLoopDelay: { phases: eventLoopPhases },
      progressIntegrity: corruptProgress.length ? 'corrupt' : 'recovered',
      attemptedWarmupRuns: starts('warmup').length,
      completedWarmupRuns: warmups.length,
      attemptedMeasuredRuns: starts('measured').length,
      completedMeasuredRuns: samples.length,
      warmups,
      samples,
      pending,
      successfulLatencySampleCount: durations.length,
      medianMilliseconds: percentile(durations, 0.5),
      p95Milliseconds: percentile(durations, 0.95),
      maximumMilliseconds: durations.length ? Math.max(...durations) : null,
      accuracyFailureCount,
      cancelledCount,
      passed: false,
      failure: [
        details.failureIdentity,
        ...corruptProgress.map((item) => item.error),
      ].join('; '),
      progress,
    },
  };
  await writePerformanceReport(prefix, report);
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

if (renderExisting) {
  const resolved = path.resolve(repositoryRoot, renderExisting);
  if (!resolved.endsWith('.json'))
    throw new Error('--render-existing-performance requires a JSON report');
  await writePerformanceReport(
    resolved.slice(0, -'.json'.length),
    JSON.parse(await readFile(resolved, 'utf8')),
  );
} else {
  await mkdir(path.join(repositoryRoot, '.workbench/fixtures'), {
    recursive: true,
  });
  const temporaryRoot = await mkdtemp(
    path.join(repositoryRoot, '.workbench/fixtures/cod16-host-'),
  );
  let runtimeTemporaryRoot;
  let performanceProgressPath;
  let performanceReportWritten = false;
  try {
    const runtime = await resolveCodeRuntime();
    const versionResult = await runProcess(runtime.cli, ['--version'], {
      description: 'VS Code version query',
    });
    assert.equal(versionResult.code, 0, versionResult.stderr);
    const [actualCodeVersion, , architecture = process.arch] =
      versionResult.stdout.trim().split(/\r?\n/u);
    if (requestedCodeVersion)
      assert.equal(
        actualCodeVersion,
        requestedCodeVersion,
        versionResult.stdout,
      );

    const fixture = await createFixture(temporaryRoot);
    const evidencePath = path.join(
      temporaryRoot,
      'extension-host-evidence.json',
    );
    const progressPath =
      hoverPerformance && outputPrefix
        ? path.resolve(repositoryRoot, `${outputPrefix}.progress.jsonl`)
        : path.join(temporaryRoot, 'extension-host-progress.jsonl');
    const cancelPath = path.join(temporaryRoot, 'extension-host-cancelled');
    performanceProgressPath = progressPath;
    await mkdir(path.dirname(progressPath), { recursive: true });
    await writeFile(progressPath, '');
    runtimeTemporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), 'c16-runtime-'),
    );
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
    let progressTimer;
    if (hoverPerformance) {
      progressTimer = setInterval(
        /** 설치된 VS Code의 현재 요청과 완료 수를 알린다. */
        () => {
          void readProgress(progressPath)
            .then(
              /** 완료한 원시 진행 기록을 한국어로 출력한다. */
              (events) => {
                process.stderr.write(
                  `${describeProgress(events, performanceOptions.warmupRuns, performanceOptions.queryRuns)}\n`,
                );
              },
            )
            .catch(
              /** 진행 파일 확인 실패를 출력한다. */
              (error) => {
                process.stderr.write(
                  `진행 기록 확인 오류: ${error instanceof Error ? error.message : String(error)}\n`,
                );
              },
            );
        },
        30_000,
      );
      progressTimer.unref();
    }
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
          timeoutMilliseconds: hoverPerformance ? null : 240_000,
          onInterrupt: hoverPerformance
            ? /** 사용자가 중단하면 다음 Hover 호출 전에 읽을 표시를 남긴다. */
              (signal) => writeFileSync(cancelPath, signal, 'utf8')
            : undefined,
          environment: {
            ...process.env,
            COD16_FIXTURE_ROOT: temporaryRoot,
            COD16_EXTENSION_ROOT: extensionRoot,
            COD16_EVIDENCE_PATH: evidencePath,
            COD16_PROGRESS_PATH: progressPath,
            COD16_CANCEL_PATH: hoverPerformance ? cancelPath : '',
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
        const progress = await readProgress(progressPath);
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
            progress.findLast((item) => item.phase.endsWith('-failure'))
              ?.error ??
            (error instanceof Error ? error.message : String(error)),
          interrupted:
            error instanceof Error &&
            error.message.startsWith('Interrupted by'),
          error: error instanceof Error ? error.message : String(error),
          fixtureMetadata: fixture.metadata,
          progress,
          sourceCommit,
          vsixSha256: await fileSha256(vsixPath),
          extensionBundleSha256: await fileSha256(extensionBundle),
          serverBundleSha256: await fileSha256(serverBundle),
        });
        performanceReportWritten = true;
      }
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nPreserved failure evidence: ${destination}`,
        { cause: error },
      );
    } finally {
      if (progressTimer) clearInterval(progressTimer);
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
        profileIsolation:
          'new user-data and extensions directories for this run',
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
    if (hoverPerformance) report.status = 'completed';
    if (hoverPerformance) {
      const progress = await readProgress(progressPath);
      report.performanceProgressIntegrity = progress.some(
        (item) => item.phase === 'progress:corrupt',
      )
        ? 'corrupt'
        : 'complete';
    }
    if (hoverPerformance && outputPrefix)
      await writePerformanceReport(outputPrefix, report);
    if (hoverPerformance && outputPrefix) performanceReportWritten = true;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (reportPath)
      await writeFile(
        path.resolve(repositoryRoot, reportPath),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
    if (hoverPerformance) assert.equal(evidence.performance.passed, true);
  } catch (error) {
    if (hoverPerformance && outputPrefix && !performanceReportWritten) {
      await writePerformanceFailureReport(outputPrefix, {
        actualCodeVersion: requestedCodeVersion ?? '미확인',
        failureIdentity: error instanceof Error ? error.message : String(error),
        interrupted:
          error instanceof Error && error.message.startsWith('Interrupted by'),
        fixtureMetadata: null,
        progress: performanceProgressPath
          ? await readProgress(performanceProgressPath)
          : [],
        sourceCommit: (
          await runProcess('git', ['rev-parse', 'HEAD']).catch(() => ({
            stdout: 'unknown',
          }))
        ).stdout.trim(),
        vsixSha256: await fileSha256(vsixPath).catch(() => null),
        extensionBundleSha256: null,
        serverBundleSha256: null,
      });
    }
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    if (runtimeTemporaryRoot)
      await rm(runtimeTemporaryRoot, { recursive: true, force: true });
  }
}
