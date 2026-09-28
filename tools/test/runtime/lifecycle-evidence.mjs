import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** macOS의 103바이트 IPC 한계와 작업 트리 길이를 분리한 전용 프로필을 만든다. */
export async function createLifecycleProfile() {
  return mkdtemp(
    path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'cdl-'),
  );
}

/** 임의의 부팅 오류가 아니라 지정한 미존재 suite 로딩 실패인지 검사한다. */
export function assertMissingSuiteFailure(log, missingSuite) {
  const normalized = log.replaceAll('\\', '/').toLowerCase();
  const target = missingSuite.replaceAll('\\', '/').toLowerCase();
  assert.ok(
    normalized.includes("cannot find module '" + target + "'") ||
      normalized.includes('cannot find module "' + target + '"'),
    '의도한 absent-suite 모듈 로딩 실패가 없습니다',
  );
  assert.doesNotMatch(
    log,
    /(?:listen|connect)\s+(?:EINVAL|ENOTSOCK|EACCES|EADDRINUSE)\b/u,
    'IPC 부팅 오류를 의도한 suite 실패로 인정하지 않습니다',
  );
}
