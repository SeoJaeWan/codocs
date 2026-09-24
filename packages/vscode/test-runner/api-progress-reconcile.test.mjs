import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createPerformanceReport,
  recordPerformanceSample,
} from '../../../tools/test/runtime/performance-report.mjs';
import { reconcileApiEvidence } from './api-progress-reconcile.mjs';

test('중단된 API 실행은 완료 표본과 진행 중 요청을 구분해 복구한다', /** 부분 표본을 검사한다. */ async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'codocs-api-reconcile-'));
  try {
    const settings = { targets: { api: 4 } };
    const report = createPerformanceReport({
      runId: 'test',
      version: '1.100.0',
      settings,
    });
    recordPerformanceSample(report, 'api', {
      status: 'completed',
      durationMs: 12,
      request: { id: 'a', line: 0, category: 'normal' },
    });
    await writeFile(
      path.join(output, 'scenario-samples-api-0-main.jsonl'),
      `${JSON.stringify({ status: 'completed', durationMs: 12, request: { id: 'a', line: 0, category: 'normal' } })}\n`,
    );
    await writeFile(
      path.join(output, 'api-request-progress-0.jsonl'),
      [
        {
          event: 'started',
          phase: 'warmup',
          iteration: 0,
          request: { id: 'a', line: 0, category: 'normal' },
          start: { wallTime: 'start' },
        },
        {
          event: 'returned',
          status: 'returned',
          phase: 'warmup',
          iteration: 0,
          end: { wallTime: 'end' },
        },
        {
          event: 'started',
          phase: 'measured',
          iteration: 0,
          request: { id: 'a', line: 0, category: 'normal' },
          start: { wallTime: 'start' },
        },
        {
          event: 'returned',
          status: 'returned',
          phase: 'measured',
          iteration: 0,
          end: { wallTime: 'end' },
        },
        {
          event: 'started',
          phase: 'measured',
          iteration: 1,
          request: { id: 'b', line: 1, category: 'normal' },
          start: { wallTime: 'start' },
        },
      ]
        .map(JSON.stringify)
        .join('\n') + '\n',
    );
    await reconcileApiEvidence(
      report,
      output,
      { scenario: 'api', state: 'running' },
      true,
    );
    assert.equal(report.scenarios.api.completed, 1);
    assert.equal(report.scenarios.api.cancelled, 1);
    assert.equal(report.scenarios.api.attempted, 2);
    assert.equal(report.scenarios.api.samples[1].durationMs, undefined);
    assert.deepEqual(report.progress.apiRequest, {
      id: 'b',
      line: 1,
      category: 'normal',
    });
    assert.equal(report.progress.apiRequestState, 'in-flight');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('warmup 중 취소에는 측정 성공이나 측정 시도가 생기지 않는다', /** 준비 요청을 검사한다. */ async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'codocs-api-reconcile-'));
  try {
    const report = createPerformanceReport({
      runId: 'test',
      version: '1.100.0',
      settings: { targets: { api: 4 } },
    });
    await writeFile(
      path.join(output, 'api-request-progress-0.jsonl'),
      `${JSON.stringify({ event: 'started', phase: 'warmup', iteration: 2, request: { id: 'c', line: 2, category: 'normal' }, start: { wallTime: 'start' } })}\n`,
    );
    await reconcileApiEvidence(
      report,
      output,
      { scenario: 'api', state: 'running' },
      true,
    );
    assert.equal(report.scenarios.api.attempted, 0);
    assert.equal(report.progress.apiPhase, 'warmup');
    assert.equal(report.progress.apiRequestState, 'in-flight');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
