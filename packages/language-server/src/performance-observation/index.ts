import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/** 명시적 IDE 측정 실행에서만 실제 발생 경계를 별도 프로세스 파일에 기록한다. */
export function observePerformanceEvent(
  kind: string,
  detail: Record<string, unknown> = {},
): void {
  const directory = process.env.CODOCS_PERFORMANCE_EVENTS_DIR;
  if (!directory) return;
  const observationStarted = performance.now();
  const occurred = {
    wallTime: new Date().toISOString(),
    monotonicMs: performance.now(),
    timeOrigin: performance.timeOrigin,
    pid: process.pid,
  };
  try {
    appendFileSync(
      path.join(directory, `events-${process.pid}.jsonl`),
      `${JSON.stringify({
        kind,
        occurred,
        sessionId: process.env.CODOCS_PERFORMANCE_SESSION_ID,
        windowId: process.env.CODOCS_PERFORMANCE_WINDOW_ID,
        detail,
        rssBytes: process.memoryUsage().rss,
        observationMethod: 'opt-in synchronous JSONL at lifecycle boundary',
      })}\n`,
    );
    appendFileSync(
      path.join(directory, `observer-overhead-${process.pid}.jsonl`),
      `${JSON.stringify({
        kind,
        sessionId: process.env.CODOCS_PERFORMANCE_SESSION_ID,
        windowId: process.env.CODOCS_PERFORMANCE_WINDOW_ID,
        pid: process.pid,
        primaryRecordOverheadMs: performance.now() - observationStarted,
        method:
          'occurrence clock, JSON serialization, synchronous primary JSONL append',
      })}\n`,
    );
  } catch {
    // 측정 파일 오류는 언어 서버의 작업과 게시 순서를 바꾸지 않는다.
  }
}
