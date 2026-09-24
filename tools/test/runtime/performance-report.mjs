import { rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scenarioNames, scenarioTargets } from './performance-contract.mjs';

const statuses = new Set([
  'completed',
  'incorrect',
  'failed',
  'cancelled',
  'incomplete',
]);

/** 실행 중 완료된 표본과 중단된 표본을 같은 스키마로 보존한다. */
export function createPerformanceReport({
  runId,
  version,
  sourceHash,
  vsixHash,
  dataHash,
  settings,
  command,
}) {
  return {
    schema: 'codocs-ide-performance/v1',
    runId,
    status: 'running',
    environment: {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      cpus: os.cpus().map(({ model }) => model),
      totalMemoryBytes: os.totalmem(),
      node: process.version,
      vscodeVersion: version,
      process: { pid: process.pid, ppid: process.ppid },
    },
    hashes: {
      source: sourceHash ?? null,
      vsix: vsixHash ?? null,
      data: dataHash ?? null,
    },
    settings,
    command,
    startedAt: new Date().toISOString(),
    progress: null,
    events: [],
    scenarios: Object.fromEntries(
      scenarioNames.map(
        /** 각 시나리오의 표본 수를 독립적으로 관리한다. */
        (name) => [
          name,
          {
            target: settings?.targets?.[name] ?? scenarioTargets[name],
            attempted: 0,
            completed: 0,
            incorrect: 0,
            failed: 0,
            cancelled: 0,
            incomplete: 0,
            missing: settings?.targets?.[name] ?? scenarioTargets[name],
            samples: [],
          },
        ],
      ),
    ),
    errors: [],
  };
}

/** 단일 요청 결과를 집계하며 잘못된 성공 시간을 거부한다. */
export function recordPerformanceSample(report, scenario, sample) {
  const entry = report.scenarios[scenario];
  if (!entry) throw new Error(`알 수 없는 시나리오: ${scenario}`);
  if (!statuses.has(sample.status))
    throw new Error(`알 수 없는 표본 상태: ${sample.status}`);
  if (
    ['completed', 'incorrect'].includes(sample.status) &&
    !Number.isFinite(sample.durationMs)
  )
    throw new Error('완료 응답에는 실제 완료 시간이 필요합니다');
  if (
    sample.durationMs != null &&
    (!Number.isFinite(sample.durationMs) || sample.durationMs < 0)
  )
    throw new Error('완료 시간은 0 이상의 유한 숫자여야 합니다');
  if (
    !['completed', 'incorrect'].includes(sample.status) &&
    sample.durationMs != null
  )
    throw new Error('미완료 요청에 성공 완료 시간을 부여할 수 없습니다');
  entry.samples.push(sample);
  entry.attempted++;
  entry[sample.status]++;
  entry.missing = Math.max(0, entry.target - entry.completed);
}

/** 강제 종료된 자식의 마지막 대기 상태를 성공 시간 없이 남긴다. */
export function reconcileInterruptedScenario(
  report,
  progress,
  cancelled,
  reason,
) {
  report.progress = progress;
  if (progress.state !== 'running') return;
  recordPerformanceSample(report, progress.scenario, {
    status: cancelled ? 'cancelled' : 'incomplete',
    phase: progress.phase,
    startedAt: progress.startedAt,
    lastObservedAt: progress.observedAt,
    elapsedAtLastObservationMs: progress.elapsedMs,
    reason,
  });
}

/** 마지막 상태와 원래 오류를 보존한다. */
export function finishPerformanceReport(report, status, error) {
  report.status = status;
  report.finishedAt = new Date().toISOString();
  if (error) report.errors.push(String(error?.stack ?? error));
}

/** 완료 표본만의 통계를 구한다. */
function stats(values) {
  if (!values.length) return { medianMs: null, p95Ms: null, maxMs: null };
  const ordered = values.toSorted((a, b) => a - b);
  const median =
    (ordered[Math.floor((ordered.length - 1) / 2)] +
      ordered[Math.ceil((ordered.length - 1) / 2)]) /
    2;
  return {
    medianMs: median,
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
    maxMs: ordered.at(-1),
  };
}

/** 원본 오류와 원시 시간은 JSON에 보존하고 요약은 한국어로 제공한다. */
export function performanceMarkdown(report) {
  const rows = Object.entries(report.scenarios).map(
    /** 항목별 정확성과 완결성을 구분해 표시한다. */
    ([name, entry]) => {
      const timing = stats(
        entry.samples
          .filter((sample) => sample.status === 'completed')
          .map((sample) => sample.durationMs)
          .filter(Number.isFinite),
      );
      return `| ${name} | ${entry.attempted} | ${entry.completed} | ${entry.incorrect} | ${entry.failed} | ${entry.cancelled} | ${entry.incomplete} | ${entry.missing} | ${timing.medianMs ?? '-'} | ${timing.p95Ms ?? '-'} | ${timing.maxMs ?? '-'} |`;
    },
  );
  return [
    '# IDE 성능 측정 보고서',
    '',
    `상태: ${report.status}`,
    `VS Code: ${report.environment.vscodeVersion}`,
    `환경: ${report.environment.platform}/${report.environment.arch}, Node ${report.environment.node}, ${report.environment.hostname}`,
    `측정 명령: \`${report.command ?? '-'}\``,
    `원본 해시: 소스 ${report.hashes.source ?? '-'}, VSIX ${report.hashes.vsix ?? '-'}, 데이터 ${report.hashes.data ?? '-'}`,
    ...(report.progress
      ? [
          `마지막 진행: ${report.progress.scenario} / ${report.progress.state} / ${report.progress.phase} / ${report.progress.elapsedMs}ms 관측`,
        ]
      : []),
    '',
    '| 시나리오 | 시도 | 완료 | 오답 | 실패 | 취소 | 미완료 | 부족 | 중앙값(ms) | p95(ms) | 최댓값(ms) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    '시간 목표는 정보성 비교이며 정확성·표본 완결성과 별개입니다. 완료 표본이 없는 항목은 미측정입니다.',
    '',
    '## 오류',
    ...(report.errors.length
      ? report.errors.map((error) => `- ${error.replaceAll('\n', ' ')}`)
      : ['- 없음']),
    '',
  ].join('\n');
}

/** 임시 파일과 원자적 교체로 취소/프로세스 오류에도 마지막 완료 기록을 남긴다. */
export async function persistPerformanceReport(report, output) {
  const json = path.join(output, 'performance.json');
  const markdown = path.join(output, 'performance.md');
  const suffix = `.${process.pid}.tmp`;
  await writeFile(json + suffix, JSON.stringify(report, null, 2));
  await rename(json + suffix, json);
  await writeFile(markdown + suffix, performanceMarkdown(report));
  await rename(markdown + suffix, markdown);
}
