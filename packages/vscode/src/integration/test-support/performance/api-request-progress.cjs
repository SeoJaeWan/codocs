const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

/** 요청 경계의 벽시계와 단조 시계를 함께 보존한다. */
const clock = () => ({
  wallTime: new Date().toISOString(),
  monotonicMs: performance.now(),
  timeOrigin: performance.timeOrigin,
  pid: process.pid,
});

/** 각 Hover 요청의 시작과 반환을 표본 시간 구간 밖에서 즉시 보존한다. */
async function recordApiRequest(config, phase, index, request, invoke) {
  const file = path.join(
    config.output,
    `api-request-progress-${config.performanceSession.iteration}.jsonl`,
  );
  const identity = {
    sessionId: config.performanceSession.id,
    phase,
    iteration: index,
    request: {
      id: request.id,
      line: request.line,
      category: request.category,
    },
  };
  fs.appendFileSync(
    file,
    `${JSON.stringify({ ...identity, event: 'started', start: clock() })}\n`,
  );
  try {
    const value = await invoke();
    fs.appendFileSync(
      file,
      `${JSON.stringify({ ...identity, event: 'returned', status: 'returned', end: clock() })}\n`,
    );
    return value;
  } catch (error) {
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        ...identity,
        event: 'ended',
        status: error?.name === 'ScenarioCancelled' ? 'cancelled' : 'failed',
        end: clock(),
        error: String(error?.stack ?? error),
      })}\n`,
    );
    throw error;
  }
}

module.exports = { recordApiRequest };
