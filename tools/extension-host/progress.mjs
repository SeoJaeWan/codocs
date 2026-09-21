import { readFile } from 'node:fs/promises';

/** 배열 snapshot 또는 완료된 JSONL 줄에서 진행 이벤트를 복원한다. */
export async function readProgress(target) {
  const raw = await readFile(target, 'utf8').catch(() => '');
  if (raw.trimStart().startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      return [
        {
          phase: 'progress:corrupt',
          error: '배열형 진행 기록을 읽을 수 없습니다.',
        },
      ];
    }
  }
  const lines = raw.split('\n');
  const lastContentIndex = lines.findLastIndex(
    (line) => line.trim().length > 0,
  );
  return lines.flatMap(
    /** 진행 줄을 복원하거나 중간 손상을 명시한다. */
    (line, index) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line)];
      } catch {
        if (index === lastContentIndex && !raw.endsWith('\n')) return [];
        return [
          {
            phase: 'progress:corrupt',
            line: index + 1,
            error: `진행 기록 ${index + 1}번째 줄이 손상됐습니다.`,
          },
        ];
      }
    },
  );
}

/** 완료 표본과 현재 요청을 짧은 한국어 진행 줄로 요약한다. */
export function describeProgress(events, requestedWarmups, requestedMeasured) {
  /** 지정한 단계에서 끝난 요청 수를 센다. */
  const count = (phase) =>
    events.filter(
      (event) => event.phase === `performance:${phase}-request-complete`,
    ).length;
  const readiness = count('readiness');
  const warmups = count('warmup');
  const measured = count('measured');
  const starts = events.filter((event) =>
    event.phase?.endsWith('-request-start'),
  );
  const latest = starts.at(-1);
  const later = latest ? events.slice(events.lastIndexOf(latest) + 1) : [];
  const pending =
    latest &&
    !later.some(
      (event) =>
        event.phase === latest.phase.replace('-start', '-complete') &&
        event.run === latest.run,
    )
      ? latest
      : null;
  const labels = {
    'performance:readiness-request-start': '준비 확인',
    'performance:warmup-request-start': '워밍업',
    'performance:measured-request-start': '본 요청',
  };
  const waiting = pending
    ? `${labels[pending.phase] ?? '요청'} ${pending.run}회차 대기 ${((Date.now() - Date.parse(pending.startedAt ?? pending.at)) / 1000).toFixed(1)}초`
    : '대기 요청 없음';
  const corrupt = events.some((event) => event.phase === 'progress:corrupt')
    ? '; 진행 기록 손상 있음'
    : '';
  return `준비 ${readiness}회, 워밍업 ${warmups}/${requestedWarmups}회, 본 요청 ${measured}/${requestedMeasured}회 완료; ${waiting}${corrupt}`;
}

/** 취소된 요청을 기능 불일치와 구분하고 이미 발생한 실패는 보존한다. */
export function summarizeOutcomes(readiness, warmups, samples) {
  const completed = [...warmups, ...samples];
  return {
    accuracyFailureCount:
      completed.filter((sample) => !sample.success && !sample.cancelled)
        .length +
      readiness.filter(
        (sample) => sample.success === false && sample.hoverCount > 0,
      ).length,
    cancelledCount: completed.filter((sample) => sample.cancelled).length,
  };
}
