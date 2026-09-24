import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { recordPerformanceSample } from '../../../tools/test/runtime/performance-report.mjs';

/** 없는 원시 파일은 빈 기록으로 읽되 손상된 기록은 실패시킨다. */
async function jsonLines(file) {
  try {
    return (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Host가 종료되기 전 기록한 API 표본과 요청 경계를 중복 없이 복구한다. */
export async function reconcileApiEvidence(
  report,
  output,
  progress,
  cancelled,
) {
  const iteration = 0;
  const samples = await jsonLines(
    path.join(output, `scenario-samples-api-${iteration}-main.jsonl`),
  );
  const existing = report.scenarios.api.samples.filter(
    (sample) => sample.request?.line !== undefined,
  ).length;
  for (const sample of samples.slice(existing))
    recordPerformanceSample(report, 'api', sample);

  const events = await jsonLines(
    path.join(output, `api-request-progress-${iteration}.jsonl`),
  );
  const attempts = new Map();
  for (const event of events) {
    const key = `${event.phase}/${event.iteration}`;
    if (event.event === 'started') attempts.set(key, { start: event });
    else if (attempts.has(key)) attempts.get(key).end = event;
  }
  const latest = [...attempts.values()].at(-1);
  if (latest) {
    report.progress = {
      ...progress,
      apiRequest: latest.start.request,
      apiPhase: latest.start.phase,
      apiIteration: latest.start.iteration,
      apiRequestState: latest.end?.status ?? 'in-flight',
    };
  } else report.progress = progress;

  if (progress.state !== 'running') return;
  for (const { start, end } of attempts.values()) {
    if (start.phase !== 'measured' || start.iteration < samples.length)
      continue;
    const status =
      end?.status === 'failed' || end?.status === 'cancelled'
        ? end.status
        : end?.status === 'returned'
          ? 'incomplete'
          : cancelled
            ? 'cancelled'
            : 'incomplete';
    recordPerformanceSample(report, 'api', {
      status,
      request: start.request,
      requestIteration: start.iteration,
      phase: 'api-request',
      startedAt: start.start,
      ...(end ? { lastObservedAt: end.end, error: end.error } : {}),
    });
  }
}
