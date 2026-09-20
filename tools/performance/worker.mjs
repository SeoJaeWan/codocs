import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { readFile, writeFile } from 'node:fs/promises';
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
    response.error?.code === 'workspace_read_failed' &&
    response.error?.message ===
      '색인을 구성하는 중입니다. 완료 후 다시 조회하세요.'
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
  const propagationTimeoutMs = numberSetting(
    settings,
    'propagation-timeout-ms',
  );
  const startupStartedAtMs = numberSetting(settings, 'startup-started-at-ms');
  const expected = JSON.parse(
    await readFile(path.join(fixture, 'expected-values.json'), 'utf8'),
  );
  const moduleUrl = pathToFileURL(
    path.join(repository, 'packages/mcp/dist/index.js'),
  ).href;
  const { createCodocsQueryHandlers } = await import(moduleUrl);
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  const handlers = createCodocsQueryHandlers({ project: fixture });
  const firstDocument = expected.documents[0];
  const firstResponse = await handlers.codocsGet({ ids: [firstDocument.id] });
  const startupEndedAtMs = performance.timeOrigin + performance.now();
  const startupCorrect =
    exactResponse(firstResponse, [firstDocument]) && handlers.access.ready;
  const startup = {
    classification: startupCorrect ? 'success' : 'incorrect',
    correctness: startupCorrect ? 'passed' : 'failed',
    latencyMs: startupCorrect ? startupEndedAtMs - startupStartedAtMs : null,
    readiness: handlers.access,
    response: responseSummary(firstResponse),
  };

  const queries = [];
  for (const requestedCount of [1, 10, 20]) {
    for (let run = 0; run < warmupRuns + queryRuns; run++) {
      const offset = (run * 23 + requestedCount) % expected.documentCount;
      const documents = Array.from(
        { length: requestedCount },
        (_, index) =>
          expected.documents[(offset + index) % expected.documentCount],
      );
      const startedAt = performance.now();
      const response = await handlers.codocsGet({
        ids: documents.map((document) => document.id),
      });
      const latencyMs = performance.now() - startedAt;
      if (run < warmupRuns) continue;
      const correct = exactResponse(response, documents);
      queries.push({
        requestedCount,
        sample: run - warmupRuns + 1,
        classification: correct ? 'success' : 'incorrect',
        correctness: correct ? 'passed' : 'failed',
        latencyMs: correct ? latencyMs : null,
        ...(correct ? {} : { response: responseSummary(response) }),
      });
    }
  }

  const invalidRequests = [];
  const invalidDocuments = expected.documents.slice(0, 21);
  for (let run = 0; run < queryRuns; run++) {
    const startedAt = performance.now();
    const response = await handlers.codocsGet({
      ids: invalidDocuments.map((document) => document.id),
    });
    const latencyMs = performance.now() - startedAt;
    const correct =
      response?.success === false && response.error?.code === 'invalid_input';
    invalidRequests.push({
      requestedCount: 21,
      sample: run + 1,
      classification: correct ? 'invalid_request' : 'incorrect',
      correctness: correct ? 'passed' : 'failed',
      latencyMs: correct ? latencyMs : null,
      response: responseSummary(response),
    });
  }

  const propagation = [];
  for (let run = 0; run < propagationRuns; run++) {
    const document = expected.documents[run % expected.documentCount];
    let before;
    const preparationStartedAt = performance.now();
    do {
      before = await handlers.codocsGet({ ids: [document.id] });
      if (exactResponse(before, [document])) break;
      if (
        !isRebuilding(before) ||
        performance.now() - preparationStartedAt > 30_000
      )
        break;
      await delay(5);
    } while (true);
    if (!exactResponse(before, [document])) {
      propagation.push({
        sample: run + 1,
        id: document.id,
        writeCompletedBeforeMeasurement: false,
        usedRefresh: false,
        expectedDefinition: document.definition,
        classification: 'incorrect',
        correctness: 'failed',
        latencyMs: null,
        response: responseSummary(before),
      });
      continue;
    }
    const previousResult = before?.success ? before.results?.[0] : undefined;
    const nextDefinition = `${document.definition} External change ${run + 1}.`;
    const changedDocument = { ...document, definition: nextDefinition };
    await writeFile(
      path.join(fixture, document.path),
      changedYaml(document, nextDefinition),
      'utf8',
    );
    const writeCompletedAt = performance.now();
    let lastResponse = before;
    let changedObservation = false;
    let incorrect = !exactResponse(before, [document]);
    let latencyMs = null;
    while (
      !incorrect &&
      performance.now() - writeCompletedAt <= propagationTimeoutMs
    ) {
      const response = await handlers.codocsGet({ ids: [document.id] });
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
        : incorrect
          ? 'incorrect'
          : changedObservation
            ? 'event_only'
            : 'timeout';
    propagation.push({
      sample: run + 1,
      id: document.id,
      writeCompletedBeforeMeasurement: true,
      usedRefresh: false,
      expectedDefinition: nextDefinition,
      classification,
      correctness:
        classification === 'success'
          ? 'passed'
          : classification === 'incorrect'
            ? 'failed'
            : 'unconfirmed',
      latencyMs,
      response: responseSummary(lastResponse),
    });
    document.definition = nextDefinition;
  }

  eventLoop.disable();
  const memory = process.memoryUsage();
  return {
    processId: process.pid,
    documentCount: expected.documentCount,
    startup,
    queries,
    invalidRequests,
    propagation,
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
      minMs: eventLoop.min / 1e6,
      maxMs: eventLoop.max / 1e6,
      meanMs: eventLoop.mean / 1e6,
      p99Ms: eventLoop.percentile(99) / 1e6,
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
