import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeProgress,
  readProgress,
  summarizeOutcomes,
} from './progress.mjs';

const fixtureParent = path.resolve(
  fileURLToPath(new URL('../../.workbench/fixtures', import.meta.url)),
);

/** 마지막 JSONL 기록이 잘렸어도 앞서 완료한 요청을 복구한다. */
async function verifyTruncatedTail() {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(path.join(fixtureParent, 'codocs-progress-'));
  const target = path.join(directory, 'progress.jsonl');
  try {
    await writeFile(
      target,
      `${JSON.stringify({ phase: 'performance:warmup-request-complete', run: 0, durationMilliseconds: 12_000, success: true })}\n{"phase":"performance:measured-request-start","run":`,
    );
    const result = await readProgress(target);
    assert.deepEqual(result, [
      {
        phase: 'performance:warmup-request-complete',
        run: 0,
        durationMilliseconds: 12_000,
        success: true,
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  '마지막 JSONL 기록이 잘렸어도 앞서 완료한 요청을 복구한다',
  verifyTruncatedTail,
);

/** 중단 전 내용 불일치는 보존하고 취소된 요청은 정확성 실패에서 제외한다. */
function verifyCancellationOutcomes() {
  const outcome = summarizeOutcomes(
    [{ success: true, hoverCount: 1 }],
    [
      { success: true, durationMilliseconds: 12_000 },
      {
        success: false,
        durationMilliseconds: 13_000,
        error: 'incorrect content',
        cancelled: false,
      },
      {
        success: false,
        durationMilliseconds: 9_000,
        error: 'Canceled',
        cancelled: true,
      },
    ],
    [],
  );
  assert.equal(outcome.accuracyFailureCount, 1);
  assert.equal(outcome.cancelledCount, 1);
}

test(
  '중단 전 내용 불일치는 보존하고 취소된 요청은 정확성 실패에서 제외한다',
  verifyCancellationOutcomes,
);

/** 기존 배열형 진행 파일의 완료 기록을 읽는다. */
async function verifyLegacyProgress() {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(path.join(fixtureParent, 'codocs-progress-'));
  const target = path.join(directory, 'progress.json');
  try {
    await writeFile(
      target,
      '[{"phase":"performance:readiness-request-complete","run":1,"success":true}]\n',
    );
    const result = await readProgress(target);
    assert.deepEqual(result, [
      {
        phase: 'performance:readiness-request-complete',
        run: 1,
        success: true,
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('기존 배열형 진행 파일의 완료 기록을 읽는다', verifyLegacyProgress);

/** 중간 JSONL 줄이 손상되면 완료 기록을 보존하면서 손상을 드러낸다. */
async function verifyCorruptMiddle() {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(path.join(fixtureParent, 'codocs-progress-'));
  const target = path.join(directory, 'progress.jsonl');
  try {
    await writeFile(
      target,
      `${JSON.stringify({ phase: 'performance:warmup-request-complete', run: 0, durationMilliseconds: 12_000, success: true })}\n{broken}\n${JSON.stringify({ phase: 'performance:measured-request-start', run: 0 })}\n`,
    );
    const result = await readProgress(target);
    assert.equal(result.length, 3);
    assert.equal(result[0].durationMilliseconds, 12_000);
    assert.equal(result[1].phase, 'progress:corrupt');
    assert.match(result[1].error, /2번째 줄이 손상/u);
    assert.equal(result[2].phase, 'performance:measured-request-start');
    assert.match(
      describeProgress(result, 100, 1_000),
      /워밍업 1\/100회, 본 요청 0\/1000회 완료/u,
    );
    assert.match(describeProgress(result, 100, 1_000), /진행 기록 손상 있음/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  '중간 JSONL 줄이 손상되면 완료 기록을 보존하면서 손상을 드러낸다',
  verifyCorruptMiddle,
);
