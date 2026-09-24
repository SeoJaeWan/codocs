import os from 'node:os';
import { performance } from 'node:perf_hooks';

/** IDE 측정 유형과 같은 환경 안에서 필요한 완료 표본의 초기 설정이다. */
export const scenarioTargets = Object.freeze({
  startup: 10,
  api: 1000,
  'first-ui': 10,
  'reentry-ui': 30,
  save: 30,
  external: 30,
  'edit-indexing': 30,
  'edit-ready': 30,
  multiwindow: 1,
});
export const scenarioNames = Object.freeze(Object.keys(scenarioTargets));
export const defaultPerformanceSettings = Object.freeze({
  seed: 20260924,
  apiWarmup: 100,
  propagationPollMs: 50,
  targets: scenarioTargets,
});

/** 다른 프로세스의 단조 시계를 임의로 서로 빼지 않도록 시계의 주인을 명시한다. */
export function clockSnapshot() {
  return {
    wallTime: new Date().toISOString(),
    monotonicMs: performance.now(),
    timeOrigin: performance.timeOrigin,
    pid: process.pid,
  };
}

/** 프로필과 변경 가능한 fixture는 한 시나리오/반복에만 속한다. */
export function sessionIdentity({
  runId,
  scenario,
  iteration,
  workspace,
  profile,
}) {
  if (!scenarioNames.includes(scenario))
    throw new Error(`알 수 없는 시나리오: ${scenario}`);
  return {
    id: `${runId}/${scenario}/${iteration}`,
    runId,
    scenario,
    iteration,
    workspace,
    profile,
    pid: process.pid,
    host: os.hostname(),
  };
}

/** 발생 시각과 수신 시각은 독립 필드이며 수신값으로 발생 시각을 대체하지 않는다. */
export function measurementEvent({
  session,
  kind,
  detail = {},
  occurred = clockSnapshot(),
  received = clockSnapshot(),
}) {
  if (!session?.id || !kind)
    throw new Error('측정 이벤트에는 세션과 종류가 필요합니다');
  return { sessionId: session.id, kind, occurred, received, detail };
}
