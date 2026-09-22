import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import {
  assertBackground,
  backgroundState,
  ensureBackground,
  installBackground,
  readBackground,
} from './background.mjs';

const installed = {
  phase: 'installed',
  listenerStarts: 1,
  listenerCopies: 1,
  timerStarts: 1,
  timerPresent: true,
  metrics: {
    samples: 1,
    visible: 0,
    presented: 0,
    focused: 0,
    focusEvents: 0,
    rehides: 0,
  },
  errors: [],
  windows: [],
};
const collectedMessage =
  'electronApplication.evaluate: Resulting promise was garbage collected.';

/** 실제 Electron 호출 함수의 직렬화·독립 실행을 관찰할 격리 런타임을 준비한다. */
function runtime() {
  const app = new EventEmitter();
  const windows = [];
  const timers = [];
  const context = vm.createContext({
    /** 입력 조건과 관측 결과의 계약을 검증한다. */ setInterval: (callback) => {
      timers.push(callback);
      return { /** 입력 조건과 관측 결과의 계약을 검증한다. */ unref() {} };
    },
  });
  return {
    app,
    windows,
    timers,
    electron: {
      app,
      BrowserWindow: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ getAllWindows: () =>
          windows,
      },
    },
    install: vm.runInContext(`(${installBackground.toString()})`, context),
    read: vm.runInContext(`(${readBackground.toString()})`, context),
  };
}

/** 창 API의 상태 변화와 등록된 이벤트만 노출한다. */
class Window extends EventEmitter {
  visible = true;
  focused = false;
  opacity = 1;
  focusable = true;
  ignoreMouse = false;
  /** 생성 직후 사용할 수 있는 창을 나타낸다. */
  isDestroyed() {
    return false;
  }
  /** 네이티브 visible 상태를 반환한다. */
  isVisible() {
    return this.visible;
  }
  /** 네이티브 포커스를 반환한다. */
  isFocused() {
    return this.focused;
  }
  /** 투명도를 반환한다. */
  getOpacity() {
    return this.opacity;
  }
  /** 포커스 허용 여부를 기록한다. */
  setFocusable(value) {
    this.focusable = value;
  }
  /** 투명도 적용을 기록한다. */
  setOpacity(value) {
    this.opacity = value;
  }
  /** 마우스 통과 설정을 기록한다. */
  setIgnoreMouseEvents(value) {
    this.ignoreMouse = value;
  }
  /** 네이티브 표시 상태를 숨긴다. */
  hide() {
    this.visible = false;
  }
}

describe('백그라운드 설치의 중복 방지와 후속 창 차단', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
  test('같은 설치를 반복하면 listener와 timer를 하나씩 유지한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
    const r = runtime();
    r.install(r.electron);
    r.install(r.electron);
    const result = r.read(r.electron);
    assert.equal(result.listenerCopies, 1);
    assert.equal(result.listenerStarts, 1);
    assert.equal(result.timerStarts, 1);
    assert.equal(r.timers.length, 1);
  });
  test('설치 후 생성된 창도 투명화하고 포커스와 마우스 입력을 차단한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
    const r = runtime();
    r.install(r.electron);
    const window = new Window();
    r.windows.push(window);
    r.app.emit('browser-window-created', {}, window);
    assert.equal(window.opacity, 0);
    assert.equal(window.focusable, false);
    assert.equal(window.ignoreMouse, true);
    window.show();
    window.showInactive();
    window.focus();
    assert.equal(window.visible, false);
    assert.equal(window.focused, false);
  });
  test('이미 있는 창의 설정을 반복해도 show와 focus 감시를 중복 등록하지 않는다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
    const r = runtime();
    const window = new Window();
    r.windows.push(window);
    r.install(r.electron);
    r.install(r.electron);
    assert.equal(window.listenerCount('show'), 1);
    assert.equal(window.listenerCount('focus'), 1);
  });
  test('생성 후 네이티브 visible 상태가 남으면 재숨김하고 불투명 노출과 구분한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
    const r = runtime();
    const window = new Window();
    r.windows.push(window);
    r.install(r.electron);
    window.visible = true;
    r.timers[0]();
    const result = r.read(r.electron);
    assert.equal(window.visible, false);
    assert.equal(result.metrics.visible, 1);
    assert.equal(result.metrics.presented, 0);
    assert.equal(result.metrics.rehides, 1);
    assertBackground(result);
  });
  test('나중에 생성된 창의 차단이 실패하면 상태에 원래 오류를 보존한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
    const r = runtime();
    r.install(r.electron);
    const window = new Window();
    window.setOpacity = /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
      throw new Error('opacity failure');
    };
    r.windows.push(window);
    r.app.emit('browser-window-created', {}, window);
    const result = r.read(r.electron);
    assert.equal(result.errors[0].message, 'opacity failure');
    assert.throws(() => assertBackground(result), /opacity failure/);
  });
});

describe('초기화 응답 오류의 제한적 복구', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
  test('설치는 끝났지만 응답이 수거됐으면 다시 설치하지 않고 상태 확인으로 복구한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const calls = [];
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: async (
        callback,
      ) => {
        calls.push(callback);
        if (callback === installBackground) throw new Error(collectedMessage);
        return installed;
      },
    };
    const records = [];
    assert.equal(await ensureBackground(app, records), installed);
    assert.deepEqual(calls, [installBackground, readBackground]);
    assert.equal(records[0].message, collectedMessage);
  });
  test('응답 오류 뒤 설정이 없으면 다음 시도에서 설치하고 완료를 확인한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    let installs = 0;
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: async (
        callback,
      ) => {
        if (callback === installBackground && ++installs === 1)
          throw new Error(collectedMessage);
        return installs === 1 ? { ...installed, phase: 'absent' } : installed;
      },
    };
    assert.equal(await ensureBackground(app, []), installed);
    assert.equal(installs, 2);
  });
  test('프로토콜 오류가 계속되면 세 번 시도한 뒤 실패한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    let calls = 0;
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: async () => {
        calls++;
        throw new Error(collectedMessage);
      },
    };
    await assert.rejects(ensureBackground(app, []), /3회/);
    assert.equal(calls, 6);
  });
  test('다른 설치 오류는 무시하거나 재시도하지 않는다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    let calls = 0;
    const error = new Error('setOpacity failure');
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: async () => {
        calls++;
        throw error;
      },
    };
    await assert.rejects(ensureBackground(app, []), (e) => e === error);
    assert.equal(calls, 1);
  });
  test('응답이 오지 않으면 횟수 제한과 별개로 전체 제한 시간에 실패한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: () =>
        new Promise(
          /** 지정한 평가 응답 또는 오류를 반환하고 호출을 기록한다. */ () => {},
        ),
    };
    await assert.rejects(
      ensureBackground(app, [], { timeout: 20 }),
      /제한 시간/,
    );
  });
  test('등록된 listener가 중복이면 초기화 완료로 처리하지 않는다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: async () => ({
        ...installed,
        listenerCopies: 2,
      }),
    };
    await assert.rejects(ensureBackground(app, []), /3회/);
  });
  test('최종 관측의 같은 프로토콜 오류는 설치 없이 재조회한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const calls = [];
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: async (
        callback,
      ) => {
        calls.push(callback);
        if (calls.length === 1) throw new Error(collectedMessage);
        return installed;
      },
    };
    assert.equal(await backgroundState(app, []), installed);
    assert.deepEqual(calls, [readBackground, readBackground]);
  });
  test('최종 관측의 다른 오류는 즉시 실패한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    let calls = 0;
    const app = {
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ evaluate: async () => {
        calls++;
        throw new Error('closed');
      },
    };
    await assert.rejects(backgroundState(app, []), /closed/);
    assert.equal(calls, 1);
  });
});

describe('사용자 화면 노출과 포커스 검증', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
  for (const field of ['presented', 'focused', 'focusEvents']) {
    test(`${field} 위반이 기록되면 마지막 창이 숨겨져 있어도 실패한다`, /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
      assert.throws(
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ () =>
          assertBackground({
            ...installed,
            metrics: { ...installed.metrics, [field]: 1 },
          }),
        /격리 검증 실패/,
      );
    });
  }
  test('마지막 창이 투명하더라도 visible이면 숨김 계약 실패로 남긴다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
    assert.throws(
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ () =>
        assertBackground({
          ...installed,
          windows: [
            { guarded: true, visible: true, focused: false, opacity: 0 },
          ],
        }),
      /격리 검증 실패/,
    );
  });
});
