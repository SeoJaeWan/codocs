import { readFile } from 'node:fs/promises';

/** 종료된 worker의 내구성 있는 완료 기록으로 부분 결과를 복원한다. */
export async function partialWorker(progressPath, failure) {
  const contents = await readFile(progressPath, 'utf8').catch(() => '');
  const lines = contents.split('\n');
  const lastContentIndex = lines.findLastIndex(
    (line) => line.trim().length > 0,
  );
  const events = lines.flatMap(
    /** 진행 줄을 복원하거나 중간 손상을 명시한다. */
    (line, index) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line)];
      } catch {
        if (index === lastContentIndex && !contents.endsWith('\n')) return [];
        return [
          {
            event: 'progress:corrupt',
            line: index + 1,
            error: `진행 기록 ${index + 1}번째 줄이 손상됐습니다.`,
          },
        ];
      }
    },
  );
  const corruption = events.filter(
    (event) => event.event === 'progress:corrupt',
  );
  const completed = events.filter(
    (event) => event.event === 'request:complete',
  );
  const lastStartIndex = events.findLastIndex(
    /** 실제 요청을 시작한 마지막 기록을 찾는다. */
    (event) =>
      [
        'request:start',
        'propagation:prepare-start',
        'propagation:start',
        'startup:start',
      ].includes(event.event),
  );
  const lastStart = events[lastStartIndex];
  const subsequent = events.slice(lastStartIndex + 1);
  const pending =
    lastStart &&
    !subsequent.some(
      /** 마지막 시작 이후 일치하는 완료 이벤트를 찾는다. */
      (event) =>
        (event.event === 'request:complete' &&
          event.observation.phase === lastStart.phase &&
          event.observation.sample === lastStart.sample &&
          event.observation.requestedCount === lastStart.requestedCount) ||
        (event.event === 'propagation:complete' &&
          lastStart.event === 'propagation:start' &&
          event.observation.sample === lastStart.sample) ||
        (event.event === 'propagation:prepare-complete' &&
          lastStart.event === 'propagation:prepare-start' &&
          event.sample === lastStart.sample) ||
        (event.event === 'startup:complete' &&
          lastStart.event === 'startup:start'),
    )
      ? {
          ...lastStart,
          elapsedWaitingMs:
            Date.now() - Date.parse(lastStart.startedAt ?? lastStart.at),
        }
      : null;
  return {
    processId: null,
    partial: true,
    failure: corruption.length
      ? `${failure}; ${corruption.map((event) => event.error).join(' ')}`
      : failure,
    progressIntegrity: corruption.length ? 'corrupt' : 'recovered',
    pending,
    startup:
      events.find((event) => event.event === 'startup:complete')?.observation ??
      null,
    readinessObservations: events
      .filter((event) => event.event === 'readiness:attempt')
      .map(
        /** 완료된 준비 확인 시도의 시간과 내용을 보존한다. */
        (event) =>
          event.observation ?? {
            attempt: event.attempt,
            latencyMs: event.latencyMs,
            classification: event.error ? 'error' : 'unconfirmed',
            correctness: 'unconfirmed',
            ...(event.error
              ? { error: event.error }
              : { response: event.response }),
          },
      ),
    warmups: completed
      .filter((event) => event.observation.phase === 'warmup')
      .map((event) => event.observation),
    queries: completed
      .filter((event) => event.observation.phase === 'measured')
      .map((event) => event.observation),
    invalidRequests: completed
      .filter((event) => event.observation.phase === 'invalid')
      .map((event) => event.observation),
    propagation: events
      .filter((event) => event.event === 'propagation:complete')
      .map((event) => event.observation),
    phases: Object.fromEntries(
      events
        .filter((event) => event.event === 'resources')
        .map((event) => [
          event.boundary,
          { memory: event.memory, eventLoop: event.eventLoop },
        ]),
    ),
    memory: null,
    eventLoop: null,
  };
}

/** worker 진행 파일의 완료 개수와 대기 요청을 한국어로 표시한다. */
export function describeProgress(
  snapshot,
  warmupRuns,
  queryRuns,
  propagationRuns,
) {
  const completed =
    snapshot.warmups.length +
    snapshot.queries.length +
    snapshot.invalidRequests.length;
  const requested = 3 * warmupRuns + 4 * queryRuns;
  const pending = snapshot.pending;
  const phaseLabels = {
    warmup: '워밍업',
    measured: '본 조회',
    invalid: '잘못된 21개 요청',
  };
  const eventLabels = {
    'startup:start': '첫 준비',
    'propagation:prepare-start': '변경 전 상태 확인',
    'propagation:start': '외부 변경 반영 확인',
  };
  const pendingLabel = pending
    ? ((pending.event === 'request:start'
        ? phaseLabels[pending.phase]
        : eventLabels[pending.event]) ?? '요청')
    : null;
  const waiting = pending
    ? `${pendingLabel} ${pending.sample ?? '미확인'}회차 대기 ${(pending.elapsedWaitingMs / 1000).toFixed(1)}초`
    : '대기 요청 없음';
  return `준비 ${snapshot.startup ? '완료' : '진행 중'}, 조회·워밍업 ${completed}/${requested}회 완료, 외부 변경 ${snapshot.propagation.length}/${propagationRuns}회 완료; ${waiting}${snapshot.progressIntegrity === 'corrupt' ? '; 진행 기록 손상 있음' : ''}`;
}
