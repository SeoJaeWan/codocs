import { rename, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Windows에서 방금 쓰거나 감시 중인 경로를 바꿀 때 백신·색인기·감시가 핸들을 잠시 잡아 생기는 일시 오류다.
 * 이 오류는 같은 조작을 잠시 뒤 다시 하면 성공하며 테스트 준비 단계의 실패로 보지 않는다.
 */
const transientCodes = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

/** 일시 오류이면 짧게 기다리며 반복하고, 그 밖의 오류나 마지막 시도의 오류는 그대로 던진다. */
async function retryTransient<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (
        attempt >= 20 ||
        typeof code !== 'string' ||
        !transientCodes.has(code)
      )
        throw error;
      await delay(50);
    }
  }
}

/** 테스트 준비용 이름 변경이며 Windows의 일시적 잠금이 풀릴 때까지 다시 시도한다. */
export function renameWithRetry(from: string, to: string): Promise<void> {
  return retryTransient(() => rename(from, to));
}

/** 테스트 준비·정리용 삭제이며 Windows의 일시적 잠금이 풀릴 때까지 다시 시도한다. */
export function rmWithRetry(
  target: string,
  options?: Parameters<typeof rm>[1],
): Promise<void> {
  return retryTransient(() => rm(target, options));
}
