import { mkdir, rename, writeFile } from 'node:fs/promises';
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
  return value === null || value === undefined ? '미측정' : value.toFixed(3);
}

/** 자원 관찰 경계의 기계 식별자를 사람용 한국어로 표시한다. */
function resourceBoundaryLabel(boundary) {
  const fixed = {
    beforeReadiness: '준비 전',
    startup: '준비 후',
    queries: '워밍업·조회 후',
    propagation: '변경 반영 후',
    'before-readiness': '준비 전',
    'after-startup': '준비 후',
    'after-warmups-and-queries': '워밍업·조회 후',
    'after-propagation': '변경 반영 후',
  };
  if (fixed[boundary]) return fixed[boundary];
  const warmup = /^(?:after-)?warmup-(\d+)$/u.exec(boundary);
  if (warmup) return `${warmup[1]}개 워밍업 후`;
  const query = /^(?:after-)?query-(\d+)$/u.exec(boundary);
  if (query) return `${query[1]}개 조회 후`;
  return boundary;
}

/** 미완료 요청의 단계·회차·대기 시간을 한국어로 설명한다. */
function pendingDescription(pending) {
  const phaseLabels = {
    warmup: '워밍업',
    measured: '본 조회',
    invalid: '잘못된 21개 요청 회귀',
  };
  const eventLabels = {
    'startup:start': '첫 준비',
    'propagation:prepare-start': '변경 전 상태 확인',
    'propagation:start': '외부 변경 반영 확인',
  };
  const label =
    pending.event === 'request:start'
      ? (phaseLabels[pending.phase] ?? '조회')
      : (eventLabels[pending.event] ?? '요청');
  return `${label}, 요청 문서 ${pending.requestedCount ?? '미확인'}개, 회차 ${pending.sample ?? '미확인'}, 현재 대기 ${format(pending.elapsedWaitingMs)} ms`;
}

/** 원본 오류는 JSON에 남기고 Markdown에는 짧은 한국어 설명을 표시한다. */
function failureDescription(reason, status) {
  if (status === 'interrupted')
    return '사용자 중단 신호로 독립 측정 worker가 종료되어 현재 요청이 완료되지 않았습니다. 원본 이유는 JSON과 진행 기록에 있습니다.';
  if (/^Performance worker exited/u.test(reason))
    return '독립 측정 worker가 비정상 종료되어 현재 요청이 완료되지 않았습니다. 원본 이유는 JSON과 진행 기록에 있습니다.';
  return reason.includes('\n')
    ? `실행 오류: ${reason.split('\n', 1)[0]}. 원본 로그는 JSON에 있습니다.`
    : reason;
}

/** 원시 JSON 구조에서 사람이 읽는 한국어 보고서를 렌더링한다. */
export function renderMarkdown(report) {
  const lines = [
    '# COD-14 코어 성능 관찰 보고서',
    '',
    `- 생성 시각: ${report.generatedAt}`,
    `- 실행 상태: ${report.status === 'completed' ? '완료' : report.status === 'interrupted' ? '중단됨' : '부분 완료'}`,
    `- 정확성: ${report.correctness.status === 'passed' ? '통과' : report.correctness.status === 'failed' ? '실패' : '미확인'}`,
    `- 실패 관측: ${report.correctness.failureCount}개; 실행 오류: ${report.errors.length}개`,
    `- Node: ${report.environment.nodeVersion}; 운영체제: ${report.environment.platform} ${report.environment.arch}`,
    `- 재현 설정: seed ${report.configuration.seed}, 문서 ${report.configuration.documentCounts.join(', ')}, 프로세스 ${report.configuration.startupRuns}회, 유형별 워밍업 ${report.configuration.warmupRuns}회, 측정 ${report.configuration.queryRuns}회, 외부 변경 ${report.configuration.propagationRuns}회`,
    `- 데이터 경로: ${report.configuration.fixtureRoot}; 결과 경로: ${report.configuration.output}`,
    '',
    '완료되고 예상 내용이 정확한 표본만 성공 지연 통계에 포함합니다. 잘못된 완료 응답의 실제 시간과 미완료 요청은 JSON 및 개별 진행 기록에 따로 남깁니다. 1,000개 문서에서 준비 2초, 조회 p95 100ms, 변경 반영 500ms는 참고 기준이며 합격 조건이나 요청 제한 시간이 아닙니다.',
    '',
    '## 규모별 완료 표본',
    '',
    '| 문서 수 | 프로세스 요청/시도/완료 | 준비 p95 (ms) | 조회 1개 p95 (ms) | 조회 10개 p95 (ms) | 조회 20개 p95 (ms) | 변경 반영 p95 (ms) |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const scale of report.scales) {
    const p = scale.progress;
    lines.push(
      `| ${scale.documentCount} | ${p.requestedProcessRuns}/${p.attemptedProcessRuns}/${p.completedProcessRuns} | ${format(scale.startup.summary.p95)} | ${format(scale.queries.valid['1'].summary.p95)} | ${format(scale.queries.valid['10'].summary.p95)} | ${format(scale.queries.valid['20'].summary.p95)} | ${format(scale.propagation.summary.p95)} |`,
    );
  }
  lines.push(
    '',
    '## 관측 개수와 정확성',
    '',
    '| 문서 수 | 단계 | 요청/시도/완료 | 정확한 완료 표본 | 결과 분류 |',
    '| ---: | --- | --- | ---: | --- |',
  );
  for (const scale of report.scales) {
    const rows = [
      ['첫 준비', 'startup', scale.startup.summary],
      [
        '준비 확인 요청',
        'readiness',
        scale.startup.readinessSummary ?? summarize([]),
      ],
      ['워밍업 1개', 'warmup-1', scale.queries.warmups['1'].summary],
      ['워밍업 10개', 'warmup-10', scale.queries.warmups['10'].summary],
      ['워밍업 20개', 'warmup-20', scale.queries.warmups['20'].summary],
      ['조회 1개', 'get-1', scale.queries.valid['1'].summary],
      ['조회 10개', 'get-10', scale.queries.valid['10'].summary],
      ['조회 20개', 'get-20', scale.queries.valid['20'].summary],
      ['잘못된 21개 요청 회귀', 'invalid', scale.queries.invalid.summary],
      ['외부 변경 반영', 'propagation', scale.propagation.summary],
    ];
    for (const [name, key, summary] of rows)
      lines.push(
        `| ${scale.documentCount} | ${name} | ${scale.progress.requestCounts?.[key] ? `${scale.progress.requestCounts[key].requested ?? '완료까지'}/${scale.progress.requestCounts[key].attempted}/${scale.progress.requestCounts[key].completed}` : `미확인/미확인/${summary.observationCount}`} | ${summary.successfulLatencySampleCount} | ${Object.entries(
          summary.classifications,
        )
          .map(
            ([key, value]) =>
              `${{ success: '성공', rebuilding: '색인 구성 중', incorrect: '내용 불일치', error: '호출 오류', invalid_request: '잘못된 요청 거부', event_only: '변경 이벤트만 관찰', timeout: '미완료' }[key] ?? key}: ${value}`,
          )
          .join(', ')} |`,
      );
    if (scale.progress.pending)
      lines.push(`
- ${scale.documentCount}개 문서 진행 중 요청: ${pendingDescription(scale.progress.pending)}
`);
    if (scale.progress.failure)
      lines.push(`
- ${scale.documentCount}개 문서 중단 이유: ${failureDescription(scale.progress.failure, report.status)}
`);
    lines.push(
      `\n- ${scale.documentCount}개 첫 준비 완료 시간: ${format(scale.startup.observations[0]?.latencyMs)} ms`,
      `- ${scale.documentCount}개 첫 준비 확인 요청: ${format(scale.startup.readinessObservations?.[0]?.latencyMs ?? scale.startup.observations[0]?.firstRequestMs)} ms; 실제 완료 ${scale.startup.readinessObservations?.length ?? 0}회`,
      `- ${scale.documentCount}개 첫 워밍업 완료 시간: ${format(scale.queries.warmups['1'].observations[0]?.latencyMs)} ms`,
    );
    for (const count of [1, 10, 20]) {
      const summary = scale.queries.warmups[String(count)].summary;
      lines.push(
        `- ${scale.documentCount}개 문서 워밍업 ${count}개: 완료 ${summary.observationCount}회, 정확한 완료 ${summary.successfulLatencySampleCount}회, 중앙값 ${format(summary.median)} ms, 최대 ${format(summary.max)} ms`,
      );
    }
    for (const processMetric of scale.processMetrics) {
      for (const [boundary, values] of Object.entries(
        processMetric.phases ?? {},
      ))
        lines.push(
          `- ${scale.documentCount}개 문서 독립 측정 worker 프로세스 ${processMetric.processRun} ${resourceBoundaryLabel(boundary)}: RSS ${values.memory?.rss ?? '미측정'} B, 이벤트 루프 표본 ${values.eventLoop?.count ?? '미확인'}회·누적 p99 ${format(values.eventLoop?.p99Ms)} ms`,
        );
    }
  }
  if (report.errors.length) {
    lines.push('', '## 실행 오류', '');
    for (const error of report.errors)
      lines.push(
        `- ${error.documentCount}개 문서: ${failureDescription(error.reason, report.status)}`,
      );
  }
  lines.push(
    '',
    '현재 측정 범위는 코어 상세 조회 1·10·20개, 잘못된 21개 요청, 외부 변경 반영 및 자원 관찰입니다. 목록/필터/커서, 변경 계획, MCP 통신, 쓰기 전체 및 다른 IDE 시나리오는 이 명령에서 측정하지 않았습니다. 현재 제공 범위 밖인 자동완성은 성능 판정 대상에서 제외합니다.',
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
  await writeFile(
    `${jsonPath}.partial`,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  await rename(`${jsonPath}.partial`, jsonPath);
  await writeFile(`${markdownPath}.partial`, renderMarkdown(report), 'utf8');
  await rename(`${markdownPath}.partial`, markdownPath);
  return { jsonPath, markdownPath };
}
