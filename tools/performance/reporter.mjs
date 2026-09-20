import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/** 정렬한 값에 선형 보간을 적용해 percentile을 계산한다. */
function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** 정확히 성공한 지연 관측값만 요약한다. */
export function summarize(observations, successClassification = 'success') {
  const successful = observations.filter(
    (observation) =>
      observation.correctness === 'passed' &&
      observation.classification === successClassification &&
      Number.isFinite(observation.latencyMs),
  );
  const latencies = successful.map((observation) => observation.latencyMs);
  const classifications = {};
  for (const observation of observations)
    classifications[observation.classification] =
      (classifications[observation.classification] ?? 0) + 1;
  return {
    unit: 'milliseconds',
    observationCount: observations.length,
    successfulLatencySampleCount: latencies.length,
    classifications,
    min: latencies.length ? Math.min(...latencies) : null,
    median: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    max: latencies.length ? Math.max(...latencies) : null,
    mean: latencies.length
      ? latencies.reduce((total, value) => total + value, 0) / latencies.length
      : null,
  };
}

/** nullable 측정값을 Markdown 형식으로 변환한다. */
function format(value) {
  return value === null || value === undefined ? 'n/a' : value.toFixed(3);
}

/** 원시 JSON 구조에서 사람이 읽는 보고서를 렌더링한다. */
export function renderMarkdown(report) {
  const lines = [
    '# COD-14 Performance Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Configuration',
    '',
    `- Seed: \`${report.configuration.seed}\``,
    `- Documents: ${report.configuration.documentCounts.join(', ')}`,
    `- Startup runs: ${report.configuration.startupRuns}`,
    `- Query warmups/samples: ${report.configuration.warmupRuns}/${report.configuration.queryRuns}`,
    `- Propagation runs/timeout: ${report.configuration.propagationRuns}/${report.configuration.propagationTimeoutMs} ms`,
    `- Output: \`${report.configuration.output}\``,
    `- Node: ${report.environment.nodeVersion} (${report.environment.platform} ${report.environment.arch})`,
    '',
    'All latency values are milliseconds. Memory values are bytes. Incorrect, timeout, and event-only observations are retained in JSON and excluded from successful latency summaries.',
    '',
    '## Scale observations',
    '',
    '| Documents | Fixture manifest | Startup p95 | Query 1 p95 | Query 10 p95 | Query 20 p95 | Propagation p95 | Propagation <= 500 ms |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const scale of report.scales)
    lines.push(
      `| ${scale.documentCount} | \`${scale.fixture.manifestDigest.slice(0, 12)}…\` | ${format(scale.startup.summary.p95)} | ${format(scale.queries.valid['1'].summary.p95)} | ${format(scale.queries.valid['10'].summary.p95)} | ${format(scale.queries.valid['20'].summary.p95)} | ${format(scale.propagation.summary.p95)} | ${scale.propagation.within500Ms ? 'yes' : 'no'} |`,
    );
  lines.push('', '## Correctness and failures', '');
  lines.push(
    '| Documents | Category | Observations | Successful latency samples | Classifications |',
    '| ---: | --- | ---: | ---: | --- |',
  );
  for (const scale of report.scales) {
    const rows = [
      ['startup', scale.startup.summary],
      ['get 1', scale.queries.valid['1'].summary],
      ['get 10', scale.queries.valid['10'].summary],
      ['get 20', scale.queries.valid['20'].summary],
      ['get 21+ invalid request', scale.queries.invalid.summary],
      ['external propagation', scale.propagation.summary],
    ];
    for (const [category, summary] of rows)
      lines.push(
        `| ${scale.documentCount} | ${category} | ${summary.observationCount} | ${summary.successfulLatencySampleCount} | ${Object.entries(
          summary.classifications,
        )
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')} |`,
      );
  }
  lines.push(
    '',
    `Overall correctness: ${report.correctness.passed ? 'PASS' : 'FAIL'}`,
    '',
    `Failures retained: ${report.correctness.failures.length}`,
    '',
  );
  return `${lines.join('\n')}\n`;
}

/** 원시 JSON·Markdown 보고서를 쓰고 직렬화 비용을 기록한다. */
export async function writeReports(report, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const jsonStartedAt = performance.now();
  JSON.stringify(report);
  const jsonSerializationMs = performance.now() - jsonStartedAt;
  const markdownStartedAt = performance.now();
  renderMarkdown(report);
  const markdownSerializationMs = performance.now() - markdownStartedAt;
  report.reporting = {
    unit: 'milliseconds',
    jsonSerializationMs,
    markdownSerializationMs,
    excludedFromQueryTiming: true,
  };
  const jsonPath = path.join(outputDirectory, 'cod14-performance.json');
  const markdownPath = path.join(outputDirectory, 'cod14-performance.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}
