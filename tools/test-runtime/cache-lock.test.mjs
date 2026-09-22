import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withCacheLock } from './cache-lock.mjs';

test('앞 다운로드가 잠금을 놓은 뒤에만 다음 다운로드를 시작한다', /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'codocs-lock-'));
  const lock = path.join(temporary, 'version.lock');
  const acquired = Promise.withResolvers();
  const release = Promise.withResolvers();
  const order = [];
  try {
    const first = withCacheLock(
      lock,
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
        order.push('first');
        acquired.resolve();
        await release.promise;
        order.push('released');
      },
    );
    await acquired.promise;
    const second = withCacheLock(lock, async () => {
      order.push('second');
    });
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first', 'released', 'second']);
    await assert.rejects(access(lock), { code: 'ENOENT' });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
test('죽은 프로세스의 잠금은 회수하고 실패한 다운로드도 잠금을 해제한다', /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'codocs-lock-'));
  const lock = path.join(temporary, 'version.lock');
  try {
    await mkdir(lock);
    await writeFile(
      path.join(lock, 'owner.json'),
      JSON.stringify({ pid: 2147483647, nonce: 'dead' }),
    );
    await assert.rejects(
      withCacheLock(lock, async () => {
        throw new Error('download failure');
      }),
      /download failure/u,
    );
    await assert.rejects(access(lock), { code: 'ENOENT' });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
