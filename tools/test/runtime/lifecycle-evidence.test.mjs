import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rm } from 'node:fs/promises';
import {
  assertMissingSuiteFailure,
  createLifecycleProfile,
} from './lifecycle-evidence.mjs';

test('지정한 미존재 suite의 실제 모듈 로딩 오류를 인정한다', /** 입력 조건의 성공 또는 실패 원인을 확인한다. */ () => {
  assertMissingSuiteFailure(
    "Error: Cannot find module '/long/evidence/absent-suite.cjs'",
    '/long/evidence/absent-suite.cjs',
  );
  assertMissingSuiteFailure(
    "Error: Cannot find module 'd:\\evidence\\absent-suite.cjs'",
    'D:\\evidence\\absent-suite.cjs',
  );
});

for (const code of ['EINVAL', 'ENOTSOCK'])
  test(`${code} IPC 시작 실패를 suite 실패로 인정하지 않는다`, /** 입력 조건의 성공 또는 실패 원인을 확인한다. */ () => {
    assert.throws(
      /** 입력 조건의 성공 또는 실패 원인을 확인한다. */ () =>
        assertMissingSuiteFailure(
          `Error: listen ${code}: invalid socket`,
          '/fixture/absent-suite.cjs',
        ),
    );
    assert.throws(
      /** 입력 조건의 성공 또는 실패 원인을 확인한다. */ () =>
        assertMissingSuiteFailure(
          `Cannot find module '/fixture/absent-suite.cjs'\nError: connect ${code}`,
          '/fixture/absent-suite.cjs',
        ),
    );
  });

test('다른 모듈 누락과 일반 종료 오류를 의도한 suite 실패로 인정하지 않는다', /** 입력 조건의 성공 또는 실패 원인을 확인한다. */ () => {
  assert.throws(
    /** 입력 조건의 성공 또는 실패 원인을 확인한다. */ () =>
      assertMissingSuiteFailure(
        "Cannot find module '/fixture/other.cjs'",
        '/fixture/absent-suite.cjs',
      ),
  );
  assert.throws(
    /** 입력 조건의 성공 또는 실패 원인을 확인한다. */ () =>
      assertMissingSuiteFailure(
        'TestRunFailedError: Test run failed with code 1',
        '/fixture/absent-suite.cjs',
      ),
  );
});

test('실제 프로필을 실행별로 분리하고 macOS 소켓 바이트 한계 안에 둔다', /** 실제 격리 자원을 준비하고 관측 뒤 정리한다. */ async () => {
  const first = await createLifecycleProfile();
  const second = await createLifecycleProfile();
  try {
    assert.notEqual(first, second);
    if (process.platform === 'darwin')
      assert.ok(Buffer.byteLength(first + '/1.13-main.sock') <= 103);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
