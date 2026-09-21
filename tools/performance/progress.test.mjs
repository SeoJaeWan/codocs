import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeProgress, partialWorker } from './progress.mjs';

const fixtureParent = path.resolve(
  fileURLToPath(new URL('../../.workbench/fixtures', import.meta.url)),
);

/** 동일 번호의 오래된 완료 기록과 잘린 줄이 있어도 최신 대기 요청을 분리한다. */
async function verifyLatestPending() {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(
    path.join(fixtureParent, 'codocs-core-progress-'),
  );
  const target = path.join(directory, 'progress.jsonl');
  try {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    const events = [
      {
        event: 'readiness:attempt',
        observation: {
          attempt: 1,
          latencyMs: 12_000,
          classification: 'success',
          correctness: 'passed',
        },
      },
      {
        event: 'startup:complete',
        observation: {
          classification: 'success',
          correctness: 'passed',
          latencyMs: 3_000,
        },
      },
      {
        event: 'request:start',
        phase: 'warmup',
        requestedCount: 1,
        sample: 1,
        startedAt,
      },
      {
        event: 'request:complete',
        observation: {
          phase: 'warmup',
          requestedCount: 1,
          sample: 1,
          classification: 'success',
          correctness: 'passed',
          latencyMs: 12_000,
        },
      },
      {
        event: 'request:start',
        phase: 'warmup',
        requestedCount: 1,
        sample: 1,
        startedAt,
      },
    ];
    await writeFile(
      target,
      `${events.map((event) => JSON.stringify(event)).join('\n')}\n{"event":"request:complete","observation":`,
    );
    const result = await partialWorker(target, 'child crashed');
    assert.equal(result.partial, true);
    assert.equal(result.readinessObservations[0].latencyMs, 12_000);
    assert.equal(result.warmups.length, 1);
    assert.equal(result.warmups[0].latencyMs, 12_000);
    assert.equal(result.pending.event, 'request:start');
    assert.equal(result.pending.sample, 1);
    assert.ok(result.pending.elapsedWaitingMs >= 5_000);
    assert.equal(result.failure, 'child crashed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  '동일 번호의 오래된 완료 기록과 잘린 줄이 있어도 최신 대기 요청을 분리한다',
  verifyLatestPending,
);

/** 외부 변경 준비 중 중단되면 쓰기가 완료되지 않은 대기를 표시한다. */
async function verifyPropagationPreparation() {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(
    path.join(fixtureParent, 'codocs-core-progress-'),
  );
  const target = path.join(directory, 'progress.jsonl');
  try {
    await writeFile(
      target,
      `${JSON.stringify({ event: 'propagation:prepare-start', sample: 1, id: 'doc-1', startedAt: new Date(Date.now() - 100).toISOString() })}\n`,
    );
    const result = await partialWorker(target, 'SIGINT');
    assert.equal(result.propagation.length, 0);
    assert.equal(result.pending.event, 'propagation:prepare-start');
    assert.equal(result.pending.sample, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  '외부 변경 준비 중 중단되면 쓰기가 완료되지 않은 대기를 표시한다',
  verifyPropagationPreparation,
);

/** 중간 진행 기록이 손상되면 부분 결과에 복구 오류를 표시한다. */
async function verifyCorruptMiddle() {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(
    path.join(fixtureParent, 'codocs-core-progress-'),
  );
  const target = path.join(directory, 'progress.jsonl');
  try {
    await writeFile(
      target,
      `${JSON.stringify({ event: 'request:complete', observation: { phase: 'warmup', requestedCount: 1, sample: 1, classification: 'success', correctness: 'passed', latencyMs: 12_000 } })}\n{broken}\n${JSON.stringify({ event: 'request:start', phase: 'measured', requestedCount: 1, sample: 1, startedAt: new Date().toISOString() })}\n`,
    );
    const result = await partialWorker(target, 'child crashed');
    assert.equal(result.warmups.length, 1);
    assert.equal(result.progressIntegrity, 'corrupt');
    assert.match(result.failure, /2번째 줄이 손상/u);
    assert.equal(result.pending.phase, 'measured');
    assert.match(
      describeProgress(result, 100, 1_000, 100),
      /조회·워밍업 1\/4300회 완료/u,
    );
    assert.match(
      describeProgress(result, 100, 1_000, 100),
      /진행 기록 손상 있음/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  '중간 진행 기록이 손상되면 부분 결과에 복구 오류를 표시한다',
  verifyCorruptMiddle,
);
