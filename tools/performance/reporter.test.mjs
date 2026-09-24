import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown, summarize } from './reporter.mjs';

/** 완료 시간이 길어도 정확한 표본을 통계에 포함한다. */
function verifySlowCompletion() {
  const observations = [
    { classification: 'success', correctness: 'passed', latencyMs: 12_000 },
    { classification: 'incorrect', correctness: 'failed', latencyMs: 20_000 },
    { classification: 'error', correctness: 'unconfirmed', latencyMs: 15_000 },
    { classification: 'success', correctness: 'passed', latencyMs: null },
  ];
  const summary = summarize(observations);
  assert.equal(summary.observationCount, 4);
  assert.equal(summary.successfulLatencySampleCount, 1);
  assert.equal(summary.p95, 12_000);
  assert.deepEqual(summary.classifications, {
    success: 2,
    incorrect: 1,
    error: 1,
  });
}

test(
  '느리지만 정확하게 완료된 요청을 p95 표본에 보존한다',
  verifySlowCompletion,
);

/** 부분 보고서에 첫 워밍업 시간과 대기 요청 및 실패 이유를 한국어로 표시한다. */
function verifyPartialReport() {
  const warmup = {
    observations: [{ latencyMs: 11_617.75 }],
    summary: summarize([
      {
        classification: 'success',
        correctness: 'passed',
        latencyMs: 11_617.75,
      },
    ]),
  };
  const empty = { observations: [], summary: summarize([]) };
  const scale = {
    documentCount: 1_000,
    fixture: { manifestDigest: 'abcdef123456' },
    progress: {
      requestedProcessRuns: 10,
      attemptedProcessRuns: 1,
      completedProcessRuns: 0,
      pending: { phase: 'warmup', elapsedWaitingMs: 5_000 },
      failure: 'worker 종료',
    },
    startup: warmup,
    queries: {
      warmups: { 1: warmup, 10: empty, 20: empty },
      valid: { 1: empty, 10: empty, 20: empty },
      invalid: empty,
    },
    propagation: empty,
    processMetrics: [
      {
        processRun: 1,
        phases: {
          startup: { memory: { rss: 100 }, eventLoop: { p99Ms: 5 } },
          'warmup-1': { memory: { rss: 120 }, eventLoop: { p99Ms: 4 } },
        },
      },
    ],
  };
  const report = {
    generatedAt: '2026-09-21T00:00:00Z',
    status: 'partial',
    correctness: { status: 'unconfirmed', failureCount: 1 },
    errors: [],
    environment: { nodeVersion: 'v24.21.0', platform: 'darwin', arch: 'arm64' },
    configuration: {
      seed: 'seed',
      documentCounts: [1_000],
      startupRuns: 10,
      warmupRuns: 100,
      queryRuns: 1_000,
      propagationRuns: 100,
      fixtureRoot: '/tmp/fixture',
      output: '/tmp/output',
    },
    scales: [scale],
  };
  const markdown = renderMarkdown(report);
  assert.match(markdown, /부분 완료/u);
  assert.match(markdown, /첫 워밍업 완료 시간: 11617\.750 ms/u);
  assert.match(markdown, /진행 중 요청/u);
  assert.match(markdown, /중단 이유: worker 종료/u);
  assert.match(markdown, /RSS 100 B/u);
  assert.match(markdown, /1개 워밍업 후: RSS 120 B/u);
  report.scales[0].progress.failure =
    'Performance worker exited SIGKILL: RAW LOG';
  const crashed = renderMarkdown(report);
  assert.match(crashed, /독립 측정 worker가 비정상 종료/u);
  assert.doesNotMatch(crashed, /RAW LOG/u);
  report.status = 'interrupted';
  const interrupted = renderMarkdown(report);
  assert.match(interrupted, /사용자 중단 신호로 독립 측정 worker가 종료/u);
}

test(
  '부분 보고서에 첫 워밍업 시간과 대기 요청 및 실패 이유를 한국어로 표시한다',
  verifyPartialReport,
);
