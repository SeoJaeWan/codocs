import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** worker 내부 명령줄 인자를 파싱한다. */
function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value === undefined)
      throw new Error('Worker arguments must be --name value pairs.');
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

/** 숫자 worker 설정을 반환하고 잘못된 입력이면 오류를 던진다. */
function numberSetting(settings, key) {
  const value = Number(settings[key]);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`Invalid --${key} value.`);
  return value;
}

/** 보존할 실패 근거를 위해 공개 get 응답을 요약한다. */
function responseSummary(response) {
  if (!response || typeof response !== 'object')
    return { type: typeof response };
  if (!response.success)
    return {
      success: false,
      scanStatus: response.scanStatus,
      errorCode: response.error?.code,
      errorMessage: response.error?.message,
    };
  return {
    success: true,
    scanStatus: response.scanStatus,
    resultCount: Array.isArray(response.results)
      ? response.results.length
      : undefined,
    results: Array.isArray(response.results)
      ? response.results.map(
          /** 공개 응답 결과에서 실패 근거로 남길 필드를 추출한다. */
          (result) => ({
            id: result?.id,
            found: result?.found,
            conflict: result?.conflict,
            revision: result?.revision,
            definition: result?.document?.definition,
          }),
        )
      : undefined,
  };
}

/** 공개 get 응답이 요청한 문서와 정확히 일치하는지 확인한다. */
function exactResponse(response, documents) {
  if (!response?.success || response.results?.length !== documents.length)
    return false;
  return documents.every(
    /** 요청 문서 하나와 공개 응답 결과 하나를 비교한다. */
    (document, index) => {
      const result = response.results[index];
      return (
        result?.id === document.id &&
        result.found === true &&
        result.conflict === false &&
        result.document?.id === document.id &&
        result.document?.name === document.name &&
        result.document?.definition === document.definition &&
        JSON.stringify(result.document?.domains) ===
          JSON.stringify(document.domains) &&
        result.document?.kind === document.kind &&
        result.document?.status === document.status
      );
    },
  );
}

/** watcher 동기화 중 반환되는 공개 임시 상태인지 판별한다. */
function isRebuilding(response) {
  return (
    response?.success === false &&
    response.error?.code === 'index_not_ready' &&
    response.error?.message ===
      '문서 색인을 구성하는 중입니다. 완료 후 다시 조회하세요.'
  );
}

/** 개별 공개 get 호출 시간에 지연을 포함하지 않고 대기한다. */
function delay(milliseconds) {
  return new Promise(
    /** 지정한 시간 뒤 대기를 완료한다. */
    (resolve) => setTimeout(resolve, milliseconds),
  );
}

/** 반영 관측의 외부 전체 쓰기에 사용할 YAML을 만든다. */
function changedYaml(document, definition) {
  return [
    `id: ${JSON.stringify(document.id)}`,
    `name: ${JSON.stringify(document.name)}`,
    `definition: ${JSON.stringify(definition)}`,
    'domains:',
    `  - ${JSON.stringify(document.domains[0])}`,
    `kind: ${document.kind}`,
    `status: ${document.status}`,
    '',
  ].join('\n');
}

/** 독립된 초기화·조회·반영 측정 프로세스 하나를 실행한다. */
async function main() {
  const settings = parseArguments(process.argv.slice(2));
  const fixture = path.resolve(settings.fixture);
  const repository = path.resolve(settings.repository);
  const warmupRuns = numberSetting(settings, 'warmup-runs');
  const queryRuns = numberSetting(settings, 'query-runs');
  const propagationRuns = numberSetting(settings, 'propagation-runs');
  const progressPath = settings['progress-path'];
  /** 단계 기록은 개별 요청 시간 측정 경계 밖에 내구성 있게 추가한다. */
  const checkpoint = async (phase, detail = {}) => {
    if (progressPath)
      await appendFile(
        progressPath,
        `${JSON.stringify({ event: phase, at: new Date().toISOString(), ...detail })}\n`,
      );
  };
  const startupStartedAtMs = numberSetting(settings, 'startup-started-at-ms');
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  /** 표본이 없는 히스토그램의 sentinel을 측정값으로 내보내지 않는다. */
  const eventLoopObservation = () => {
    const count = eventLoop.count;
    return {
      count,
      minMs: count ? eventLoop.min / 1e6 : null,
      maxMs: count ? eventLoop.max / 1e6 : null,
      meanMs: count ? eventLoop.mean / 1e6 : null,
      p99Ms: count ? eventLoop.percentile(99) / 1e6 : null,
    };
  };
  /** 단계 경계에서 메모리와 누적 이벤트 루프 지연을 읽는다. */
  const resources = () => ({
    memory: process.memoryUsage(),
    eventLoop: eventLoopObservation(),
  });
  const beforeReadiness = resources();
  await checkpoint('startup:start', { startedAtMs: startupStartedAtMs });
  await checkpoint('resources', {
    boundary: 'before-readiness',
    ...beforeReadiness,
  });
  const expected = JSON.parse(
    await readFile(path.join(fixture, 'expected-values.json'), 'utf8'),
  );
  const moduleUrl = pathToFileURL(
    path.join(repository, 'packages/mcp/dist/index.js'),
  ).href;
  const { createCodocsQueryHandlers } = await import(moduleUrl);
  const { createWorkspaceQuerySession } = await import(
    pathToFileURL(path.join(repository, 'packages/workspace/dist/index.js'))
      .href
  );
  const handlerSession = createWorkspaceQuerySession({ project: fixture });
  const handlers = createCodocsQueryHandlers(handlerSession);
  const firstDocument = expected.documents[0];
  const readinessObservations = [];
  /** 준비 확인 호출의 실제 완료 시간과 내용 판정을 개별 표본으로 기록한다. */
  const recordReadiness = async (attempt, latencyMs, response, error) => {
    const rebuilding = !error && isRebuilding(response);
    const correct = !error && exactResponse(response, [firstDocument]);
    const observation = {
      attempt,
      latencyMs,
      classification: error
        ? 'error'
        : rebuilding
          ? 'rebuilding'
          : correct
            ? 'success'
            : 'incorrect',
      correctness:
        error || rebuilding ? 'unconfirmed' : correct ? 'passed' : 'failed',
      ...(error ? { error } : { response: responseSummary(response) }),
    };
    readinessObservations.push(observation);
    await checkpoint('readiness:attempt', { observation });
  };
  const firstStartedAt = performance.now();
  let firstResponse;
  let startupError;
  try {
    firstResponse = await handlers.codocsGet({ ids: [firstDocument.id] });
  } catch (caught) {
    startupError = caught instanceof Error ? caught.message : String(caught);
  }
  const firstRequestMs = performance.now() - firstStartedAt;
  await recordReadiness(1, firstRequestMs, firstResponse, startupError);
  let readinessAttempts = 1;
  while (!startupError && isRebuilding(firstResponse)) {
    await delay(5);
    const attemptStartedAt = performance.now();
    try {
      firstResponse = await handlers.codocsGet({ ids: [firstDocument.id] });
    } catch (caught) {
      startupError = caught instanceof Error ? caught.message : String(caught);
    }
    readinessAttempts += 1;
    await recordReadiness(
      readinessAttempts,
      performance.now() - attemptStartedAt,
      firstResponse,
      startupError,
    );
  }
  const startupEndedAtMs = performance.timeOrigin + performance.now();
  const startupCorrect =
    !startupError &&
    exactResponse(firstResponse, [firstDocument]) &&
    handlers.access.ready;
  const startup = {
    classification: startupError
      ? 'error'
      : startupCorrect
        ? 'success'
        : 'incorrect',
    correctness: startupError
      ? 'unconfirmed'
      : startupCorrect
        ? 'passed'
        : 'failed',
    latencyMs: startupEndedAtMs - startupStartedAtMs,
    firstRequestMs,
    readinessAttempts,
    readinessObservations,
    readiness: handlers.access,
    ...(startupError
      ? { error: startupError }
      : { response: responseSummary(firstResponse) }),
  };

  await checkpoint('startup:complete', { observation: startup });
  const phases = { beforeReadiness, startup: resources() };
  await checkpoint('resources', {
    boundary: 'after-startup',
    ...phases.startup,
  });
  const warmups = [];
  const queries = [];
  for (const requestedCount of [1, 10, 20]) {
    for (let run = 0; run < warmupRuns + queryRuns; run++) {
      if (run === warmupRuns) {
        phases[`warmup-${requestedCount}`] = resources();
        await checkpoint('resources', {
          boundary: `after-warmup-${requestedCount}`,
          ...phases[`warmup-${requestedCount}`],
        });
      }
      const offset = (run * 23 + requestedCount) % expected.documentCount;
      const documents = Array.from(
        { length: requestedCount },
        (_, index) =>
          expected.documents[(offset + index) % expected.documentCount],
      );
      const phase = run < warmupRuns ? 'warmup' : 'measured';
      const sample = phase === 'warmup' ? run + 1 : run - warmupRuns + 1;
      await checkpoint('request:start', {
        phase,
        requestedCount,
        sample,
        startedAt: new Date().toISOString(),
      });
      const startedAt = performance.now();
      let response;
      let error;
      try {
        response = await handlers.codocsGet({
          ids: documents.map((document) => document.id),
        });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const latencyMs = performance.now() - startedAt;
      const correct = !error && exactResponse(response, documents);
      const observation = {
        requestedCount,
        sample,
        phase,
        classification: error ? 'error' : correct ? 'success' : 'incorrect',
        correctness: error ? 'unconfirmed' : correct ? 'passed' : 'failed',
        latencyMs,
        ...(error
          ? { error }
          : correct
            ? {}
            : { response: responseSummary(response) }),
      };
      (phase === 'warmup' ? warmups : queries).push(observation);
      await checkpoint('request:complete', { observation });
    }
    phases[`query-${requestedCount}`] = resources();
    await checkpoint('resources', {
      boundary: `after-query-${requestedCount}`,
      ...phases[`query-${requestedCount}`],
    });
  }

  phases.queries = resources();
  await checkpoint('resources', {
    boundary: 'after-warmups-and-queries',
    ...phases.queries,
  });
  const invalidRequests = [];
  const invalidDocuments = expected.documents.slice(0, 21);
  for (let run = 0; run < queryRuns; run++) {
    await checkpoint('request:start', {
      phase: 'invalid',
      requestedCount: 21,
      sample: run + 1,
      startedAt: new Date().toISOString(),
    });
    const startedAt = performance.now();
    let response;
    let error;
    try {
      response = await handlers.codocsGet({
        ids: invalidDocuments.map((document) => document.id),
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const latencyMs = performance.now() - startedAt;
    const correct =
      !error &&
      response?.success === false &&
      response.error?.code === 'invalid_input';
    const observation = {
      requestedCount: 21,
      sample: run + 1,
      phase: 'invalid',
      classification: error
        ? 'error'
        : correct
          ? 'invalid_request'
          : 'incorrect',
      correctness: error ? 'unconfirmed' : correct ? 'passed' : 'failed',
      latencyMs,
      ...(error ? { error } : { response: responseSummary(response) }),
    };
    invalidRequests.push(observation);
    await checkpoint('request:complete', { observation });
  }

  const propagation = [];
  for (let run = 0; run < propagationRuns; run++) {
    const document = expected.documents[run % expected.documentCount];
    await checkpoint('propagation:prepare-start', {
      sample: run + 1,
      id: document.id,
      startedAt: new Date().toISOString(),
    });
    let before;
    let preparationError;
    const preparationStartedAt = performance.now();
    do {
      try {
        before = await handlers.codocsGet({ ids: [document.id] });
      } catch (caught) {
        preparationError =
          caught instanceof Error ? caught.message : String(caught);
        break;
      }
      if (exactResponse(before, [document])) break;
      if (!isRebuilding(before)) break;
      await delay(5);
    } while (true);
    const preparationMs = performance.now() - preparationStartedAt;
    await checkpoint('propagation:prepare-complete', {
      sample: run + 1,
      id: document.id,
      latencyMs: preparationMs,
      correctness: preparationError
        ? 'unconfirmed'
        : exactResponse(before, [document])
          ? 'passed'
          : 'failed',
      ...(preparationError
        ? { error: preparationError }
        : { response: responseSummary(before) }),
    });
    if (!exactResponse(before, [document])) {
      const observation = {
        sample: run + 1,
        id: document.id,
        writeCompletedBeforeMeasurement: false,
        usedRefresh: false,
        expectedDefinition: document.definition,
        classification: preparationError ? 'error' : 'incorrect',
        correctness: preparationError ? 'unconfirmed' : 'failed',
        latencyMs: preparationMs,
        ...(preparationError
          ? { error: preparationError }
          : { response: responseSummary(before) }),
      };
      propagation.push(observation);
      await checkpoint('propagation:complete', { observation });
      continue;
    }
    const previousResult = before?.success ? before.results?.[0] : undefined;
    const nextDefinition = `${document.definition} External change ${run + 1}.`;
    const changedDocument = { ...document, definition: nextDefinition };
    await checkpoint('propagation:start', { sample: run + 1, id: document.id });
    await writeFile(
      path.join(fixture, document.path),
      changedYaml(document, nextDefinition),
      'utf8',
    );
    const writeCompletedAt = performance.now();
    let lastResponse = before;
    let changedObservation = false;
    let incorrect = !exactResponse(before, [document]);
    let observationError;
    let latencyMs = null;
    while (!incorrect) {
      let response;
      try {
        response = await handlers.codocsGet({ ids: [document.id] });
      } catch (caught) {
        observationError =
          caught instanceof Error ? caught.message : String(caught);
        break;
      }
      lastResponse = response;
      if (exactResponse(response, [changedDocument])) {
        latencyMs = performance.now() - writeCompletedAt;
        break;
      }
      if (isRebuilding(response)) {
        await delay(2);
        continue;
      }
      if (!response?.success || response.results?.length !== 1) {
        incorrect = true;
        break;
      }
      const result = response.results[0];
      if (
        result?.revision !== previousResult?.revision ||
        result?.document?.definition !== document.definition
      )
        changedObservation = true;
      await delay(2);
    }
    const classification =
      latencyMs !== null
        ? 'success'
        : observationError
          ? 'error'
          : incorrect
            ? 'incorrect'
            : changedObservation
              ? 'event_only'
              : 'timeout';
    const observation = {
      sample: run + 1,
      id: document.id,
      writeCompletedBeforeMeasurement: true,
      usedRefresh: false,
      expectedDefinition: nextDefinition,
      preparationMs,
      classification,
      correctness:
        classification === 'success'
          ? 'passed'
          : classification === 'incorrect'
            ? 'failed'
            : 'unconfirmed',
      latencyMs: latencyMs ?? performance.now() - writeCompletedAt,
      ...(observationError
        ? { error: observationError }
        : { response: responseSummary(lastResponse) }),
    };
    propagation.push(observation);
    await checkpoint('propagation:complete', { observation });
    if (classification !== 'success') break;
    document.definition = nextDefinition;
  }

  phases.propagation = resources();
  await checkpoint('resources', {
    boundary: 'after-propagation',
    ...phases.propagation,
  });
  eventLoop.disable();
  const memory = process.memoryUsage();
  return {
    processId: process.pid,
    documentCount: expected.documentCount,
    startup,
    readinessObservations,
    warmups,
    queries,
    invalidRequests,
    propagation,
    phases,
    memory: {
      unit: 'bytes',
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    eventLoop: {
      unit: 'milliseconds',
      resolutionMs: 10,
      ...eventLoopObservation(),
    },
  };
}

try {
  const output = `${JSON.stringify(await main())}\n`;
  await new Promise(
    /** 표준 출력 쓰기가 끝나거나 실패하면 Promise를 완료한다. */
    (resolve, reject) => {
      process.stdout.write(output, (error) => {
        if (error) reject(error);
        else resolve();
      });
    },
  );
  process.exit(0);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
}
