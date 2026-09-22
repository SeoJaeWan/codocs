import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIsolation, assertSupportedIsolation } from './isolation.mjs';

/** 외부 관측의 성공·노출·정리 실패를 구분한다. */
const good = {
  desktop: 'private',
  desktopClosed: true,
  residualProcesses: 0,
  windows: [{ handle: 42, pid: 5 }],
  samples: [
    { window: 7, inputDesktop: 'Default' },
    { window: 8, inputDesktop: 'Default' },
  ],
};
test('사용자가 다른 작업 창으로 이동해도 시험 창이 노출되지 않으면 관측을 승인한다', () => {
  assert.doesNotThrow(() => assertIsolation(good));
});
test('시험 창이 외부 전경으로 관측되면 실패한다', /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
  assert.throws(
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () =>
      assertIsolation({
        ...good,
        samples: [{ window: 42, inputDesktop: 'Default' }],
      }),
    /노출/u,
  );
});
test('입력 데스크톱이 시험 데스크톱이면 실패한다', /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
  assert.throws(
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () =>
      assertIsolation({
        ...good,
        samples: [{ window: 7, inputDesktop: 'private' }],
      }),
    /노출/u,
  );
});
test('시험 자식 프로세스가 남으면 실패한다', /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
  assert.throws(
    () => assertIsolation({ ...good, residualProcesses: 1 }),
    /정리/u,
  );
});
test('데스크톱 핸들을 닫지 못하면 실패한다', /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
  assert.throws(
    () => assertIsolation({ ...good, desktopClosed: false }),
    /정리/u,
  );
});
test('외부 관측이 없으면 기능 통과와 무관하게 실패한다', () => {
  assert.throws(() => assertIsolation({ ...good, samples: [] }), /관측/u);
});
test('Mac 격리 어댑터가 없으면 일반 창을 실행하지 않고 준비 실패로 알린다', () => {
  assert.throws(() => assertSupportedIsolation('darwin'), /macOS 준비 실패/u);
});
