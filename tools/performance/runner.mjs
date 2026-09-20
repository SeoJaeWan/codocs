import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { generateFixture, supportedDocumentCounts } from './generator.mjs';
import { summarize, writeReports } from './reporter.mjs';

const repository = path.resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
);
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));

const defaults = {
  seed: 'cod14-fixed-seed-v1',
  documents: supportedDocumentCounts.join(','),
  'startup-runs': '3',
  'warmup-runs': '100',
  'query-runs': '1000',
  'propagation-runs': '10',
  'propagation-timeout-ms': '500',
  output: '.github/workplans/COD-14-results',
  'fixture-root': '.workbench/fixtures/task-002',
};

/** 명령 사용법을 출력한다. */
function usage() {
  return [
    'Usage: pnpm performance:cod14 -- [options]',
    '',
    `  --documents <${supportedDocumentCounts.join('|')}|comma-list>`,
    '  --seed <value>',
    '  --startup-runs <count>',
    '  --warmup-runs <count>',
    '  --query-runs <count>',
    '  --propagation-runs <count>',
    '  --propagation-timeout-ms <milliseconds>',
    '  --output <directory>',
    '  --fixture-root <directory>',
  ].join('\n');
}

/** 공개 명령줄 설정을 파싱한다. */
function parseArguments(values) {
  if (values.includes('--help')) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const settings = { ...defaults };
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value === undefined)
      throw new Error(`Invalid arguments.\n${usage()}`);
    const name = key.slice(2);
    if (!(name in settings)) throw new Error(`Unknown option: ${key}`);
    settings[name] = value;
  }
  const documentCounts = settings.documents
    .split(/[\s,]+/u)
    .filter(Boolean)
    .map((value) => Number(value));
  if (
    documentCounts.length === 0 ||
    documentCounts.some((value) => !supportedDocumentCounts.includes(value))
  )
    throw new Error(
      `--documents must contain only ${supportedDocumentCounts.join(', ')}`,
    );
  /** 설정 이름의 정수값을 최소값과 함께 검증한다. */
  const integer = (name, minimum) => {
    const value = Number(settings[name]);
    if (!Number.isSafeInteger(value) || value < minimum)
      throw new Error(`--${name} must be an integer >= ${minimum}`);
    return value;
  };
  return {
    seed: settings.seed,
    documentCounts: [...new Set(documentCounts)],
    startupRuns: integer('startup-runs', 1),
    warmupRuns: integer('warmup-runs', 0),
    queryRuns: integer('query-runs', 1),
    propagationRuns: integer('propagation-runs', 0),
    propagationTimeoutMs: integer('propagation-timeout-ms', 1),
    output: path.resolve(repository, settings.output),
    fixtureRoot: path.resolve(repository, settings['fixture-root']),
  };
}

/** 독립 Node 프로세스에서 worker를 실행하고 결과를 파싱한다. */
async function runWorker(configuration, fixtureDirectory) {
  const startupStartedAtMs = performance.timeOrigin + performance.now();
  const arguments_ = [
    worker,
    '--fixture',
    fixtureDirectory,
    '--repository',
    repository,
    '--warmup-runs',
    String(configuration.warmupRuns),
    '--query-runs',
    String(configuration.queryRuns),
    '--propagation-runs',
    String(configuration.propagationRuns),
    '--propagation-timeout-ms',
    String(configuration.propagationTimeoutMs),
    '--startup-started-at-ms',
    String(startupStartedAtMs),
  ];
  return new Promise(
    /** 독립 worker 프로세스의 표준 출력과 종료 결과를 수집한다. */
    (resolve, reject) => {
      const child = spawn(process.execPath, arguments_, {
        cwd: repository,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.once('error', reject);
      child.once(
        'close',
        /** worker 종료 코드를 해석하고 결과 JSON을 반환한다. */
        (code) => {
          if (code !== 0)
            reject(new Error(`Performance worker exited ${code}: ${stderr}`));
          else {
            try {
              resolve(JSON.parse(stdout));
            } catch (error) {
              reject(
                new Error(
                  `Performance worker returned invalid JSON: ${error.message}\n${stdout}\n${stderr}`,
                ),
              );
            }
          }
        },
      );
    },
  );
}

/** 보존된 비성공 관측값을 규모와 범주와 함께 반환한다. */
function failuresFor(scale) {
  const failures = [];
  /** 한 측정 범주의 비성공 관측을 실패 목록에 추가한다. */
  const collect = (category, observations, expectedClassification) => {
    for (const observation of observations)
      if (
        observation.correctness !== 'passed' ||
        observation.classification !== expectedClassification
      )
        failures.push({
          documentCount: scale.documentCount,
          category,
          observation,
        });
  };
  collect('startup', scale.startup.observations, 'success');
  for (const count of [1, 10, 20])
    collect(
      `get-${count}`,
      scale.queries.valid[String(count)].observations,
      'success',
    );
  collect(
    'get-21-invalid-request',
    scale.queries.invalid.observations,
    'invalid_request',
  );
  collect('propagation', scale.propagation.observations, 'success');
  return failures;
}

/** 독립 worker 실행 결과에서 문서 규모 하나의 섹션을 만든다. */
async function runScale(configuration, documentCount) {
  const processRuns = [];
  let fixture;
  for (let run = 0; run < configuration.startupRuns; run++) {
    const fixtureDirectory = path.join(
      configuration.fixtureRoot,
      String(documentCount),
      `run-${run + 1}`,
    );
    const generated = await generateFixture({
      directory: fixtureDirectory,
      documentCount,
      seed: configuration.seed,
    });
    if (
      fixture &&
      (fixture.manifestDigest !== generated.manifestDigest ||
        fixture.expectedValuesDigest !== generated.expectedValuesDigest)
    )
      throw new Error(
        `Fixture determinism failed for ${documentCount} documents.`,
      );
    fixture = generated;
    processRuns.push(await runWorker(configuration, fixtureDirectory));
  }
  const startupObservations = processRuns.map(
    /** 프로세스별 초기화 관측에 실행 번호를 붙인다. */
    (run, index) => ({
      processRun: index + 1,
      processId: run.processId,
      ...run.startup,
    }),
  );
  const valid = {};
  for (const count of [1, 10, 20]) {
    const observations = processRuns.flatMap(
      /** 프로세스 하나의 유효 조회 관측에 실행 번호를 붙인다. */
      (run, index) =>
        run.queries
          .filter((observation) => observation.requestedCount === count)
          .map((observation) => ({ processRun: index + 1, ...observation })),
    );
    valid[String(count)] = {
      requestedCount: count,
      observations,
      summary: summarize(observations),
    };
  }
  const invalidObservations = processRuns.flatMap(
    /** 프로세스 하나의 invalid 조회 관측에 실행 번호를 붙인다. */
    (run, index) =>
      run.invalidRequests.map((observation) => ({
        processRun: index + 1,
        ...observation,
      })),
  );
  const propagationObservations = processRuns.flatMap(
    /** 프로세스 하나의 외부 변경 관측에 실행 번호를 붙인다. */
    (run, index) =>
      run.propagation.map((observation) => ({
        processRun: index + 1,
        ...observation,
      })),
  );
  return {
    documentCount,
    fixture: {
      manifestDigest: fixture.manifestDigest,
      expectedValuesDigest: fixture.expectedValuesDigest,
      manifest: fixture.manifest,
      expectedValues: fixture.expectedValues,
    },
    startup: {
      boundary:
        'after fixture generation and immediately before spawning a fresh Node process, through the first indexed, watcher-ready public codocs_get return',
      observations: startupObservations,
      summary: summarize(startupObservations),
    },
    queries: {
      timingBoundary: 'public codocs_get promise invocation through resolution',
      warmupRunsPerProcess: configuration.warmupRuns,
      sampleRunsPerProcess: configuration.queryRuns,
      valid,
      invalid: {
        requestedCount: 21,
        expectedBehavior: 'whole-request invalid_input rejection',
        observations: invalidObservations,
        summary: summarize(invalidObservations, 'invalid_request'),
      },
    },
    propagation: {
      timingBoundary:
        'completed external write through exact public codocs_get content visibility; refresh is never called',
      timeoutMs: configuration.propagationTimeoutMs,
      observations: propagationObservations,
      summary: summarize(propagationObservations),
      within500Ms:
        propagationObservations.length > 0 &&
        propagationObservations.every(
          (observation) =>
            observation.correctness === 'passed' &&
            observation.latencyMs <= 500,
        ),
    },
    processMetrics: processRuns.map(
      /** 프로세스별 메모리와 이벤트 루프 측정값에 실행 번호를 붙인다. */
      (run, index) => ({
        processRun: index + 1,
        processId: run.processId,
        memory: run.memory,
        eventLoop: run.eventLoop,
      }),
    ),
  };
}

/** 설정한 모든 문서 규모를 측정하고 두 보고서 형식을 출력한다. */
async function main() {
  const configuration = parseArguments(process.argv.slice(2));
  const scales = [];
  for (const documentCount of configuration.documentCounts) {
    process.stderr.write(`Measuring ${documentCount} documents...\n`);
    scales.push(await runScale(configuration, documentCount));
  }
  const failures = scales.flatMap(failuresFor);
  const failedCorrectnessCount = failures.filter(
    (failure) => failure.observation.correctness === 'failed',
  ).length;
  const unconfirmedCorrectnessCount = failures.filter(
    (failure) => failure.observation.correctness === 'unconfirmed',
  ).length;
  const report = {
    schemaVersion: 1,
    report: 'COD-14 deterministic performance harness',
    generatedAt: new Date().toISOString(),
    units: {
      latency: 'milliseconds',
      memory: 'bytes',
      eventLoopDelay: 'milliseconds',
    },
    configuration: {
      seed: configuration.seed,
      documentCounts: configuration.documentCounts,
      startupRuns: configuration.startupRuns,
      warmupRuns: configuration.warmupRuns,
      queryRuns: configuration.queryRuns,
      propagationRuns: configuration.propagationRuns,
      propagationTimeoutMs: configuration.propagationTimeoutMs,
      output: configuration.output,
      fixtureRoot: configuration.fixtureRoot,
      independentChildProcesses: true,
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    scales,
    correctness: {
      passed: failures.length === 0,
      status:
        failedCorrectnessCount > 0
          ? 'failed'
          : unconfirmedCorrectnessCount > 0
            ? 'unconfirmed'
            : 'passed',
      failedCount: failedCorrectnessCount,
      unconfirmedCount: unconfirmedCorrectnessCount,
      failureCount: failures.length,
      failures,
      latencyExclusionRule:
        'Only correct observations with the category expected success classification contribute to latency summaries.',
    },
  };
  const paths = await writeReports(report, configuration.output);
  process.stdout.write(
    `${JSON.stringify({ ...paths, correctness: report.correctness.passed })}\n`,
  );
  if (!report.correctness.passed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
}
