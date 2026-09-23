import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** 소유 프로세스가 사라진 다운로드 잠금만 원자적으로 회수한다. 살아 있는 잠금은 기다린다. */
export async function withCacheLock(lock, action, timeout = 180000) {
  const ownerPath = path.join(lock, 'owner.json');
  const nonce = randomUUID();
  const deadline = Date.now() + timeout;
  while (true) {
    try {
      await mkdir(lock);
      await writeFile(ownerPath, JSON.stringify({ pid: process.pid, nonce }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0)
          throw new Error('손상된 캐시 잠금');
        let dead = false;
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') dead = true;
          else if (error.code !== 'EPERM') throw error;
        }
        if (dead) {
          const recovery = `${lock}.recovery`;
          let acquired = false;
          try {
            await mkdir(recovery);
            acquired = true;
            const current = JSON.parse(await readFile(ownerPath, 'utf8'));
            if (current.nonce === owner.nonce && current.pid === owner.pid) {
              const retired = `${lock}.retired-${randomUUID()}`;
              await rename(lock, retired);
              await rm(retired, { recursive: true, force: true });
            }
          } catch (error) {
            if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error;
          } finally {
            if (acquired) await rm(recovery, { recursive: true, force: true });
          }
          if (acquired) continue;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (Date.now() > deadline)
        throw new Error(`VS Code 캐시 잠금 대기 초과: ${lock}`);
      await delay(100);
    }
  }
  try {
    return await action();
  } finally {
    const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
    if (owner.nonce !== nonce)
      throw new Error('다운로드 캐시 잠금 소유권 변경');
    await rm(lock, { recursive: true, force: true });
  }
}
