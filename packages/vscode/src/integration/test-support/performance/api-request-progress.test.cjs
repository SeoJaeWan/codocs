const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordApiRequest } = require('./api-request-progress.cjs');

test('warmup 요청이 반환되지 않아도 원시 시작과 corpus 신원이 먼저 남는다', /** 진행 중 호출을 검사한다. */ async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'codocs-api-progress-'));
  try {
    const config = {
      output,
      performanceSession: { id: 'run/api/0', iteration: 0 },
    };
    let resolveHover;
    const pending = recordApiRequest(
      config,
      'warmup',
      3,
      { id: 'normal0004', line: 3, category: 'normal' },
      /** 실제 Hover가 반환되기 전까지 요청을 유지한다. */ () =>
        new Promise(
          /** 나중에 Hover를 반환한다. */ (resolve) => {
            resolveHover = resolve;
          },
        ),
    );
    const file = path.join(output, 'api-request-progress-0.jsonl');
    const before = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(before.length, 1);
    assert.deepEqual(before[0].request, {
      id: 'normal0004',
      line: 3,
      category: 'normal',
    });
    assert.equal(before[0].phase, 'warmup');
    assert.equal(before[0].iteration, 3);
    assert.equal(before[0].event, 'started');
    assert.ok(before[0].start.wallTime);
    resolveHover('returned');
    assert.equal(await pending, 'returned');
    const after = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(after[1].status, 'returned');
    assert.ok(after[1].end.wallTime);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('measured 요청이 거절되면 성공 반환 없이 오류가 남는다', /** 거절 기록을 검사한다. */ async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'codocs-api-progress-'));
  try {
    const config = {
      output,
      performanceSession: { id: 'run/api/0', iteration: 0 },
    };
    const failure = new Error('provider rejected');
    await assert.rejects(
      recordApiRequest(
        config,
        'measured',
        7,
        { id: 'nested0001', line: 807, category: 'nested' },
        () => Promise.reject(failure),
      ),
      failure,
    );
    const events = fs
      .readFileSync(path.join(output, 'api-request-progress-0.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(
      events.map(({ event }) => event),
      ['started', 'ended'],
    );
    assert.equal(events[0].phase, 'measured');
    assert.deepEqual(events[0].request, {
      id: 'nested0001',
      line: 807,
      category: 'nested',
    });
    assert.equal(events[1].status, 'failed');
    assert.match(events[1].error, /provider rejected/u);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('시나리오 취소는 완료 시각을 만들지 않고 취소 원인을 남긴다', /** 취소 기록을 검사한다. */ async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'codocs-api-progress-'));
  try {
    const error = new Error('cancelled');
    error.name = 'ScenarioCancelled';
    await assert.rejects(
      recordApiRequest(
        { output, performanceSession: { id: 'run/api/0', iteration: 0 } },
        'measured',
        0,
        { id: 'normal0001', line: 0, category: 'normal' },
        () => Promise.reject(error),
      ),
      error,
    );
    const events = fs
      .readFileSync(path.join(output, 'api-request-progress-0.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(events[1].status, 'cancelled');
    assert.equal(events[1].durationMs, undefined);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
