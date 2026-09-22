/** Electron main 안에서 중복 없이 창 차단과 관측을 설치한다. 외부 클로저를 사용하지 않는다. */
export function installBackground({ app, BrowserWindow }) {
  const control = (globalThis.__codocsUiBackground =
    globalThis.__codocsUiBackground ?? {
      phase: 'new',
      guards: new WeakMap(),
      timer: null,
      listener: null,
      timerStarts: 0,
      listenerStarts: 0,
      metrics: {
        samples: 0,
        visible: 0,
        presented: 0,
        focused: 0,
        focusEvents: 0,
        rehides: 0,
      },
      errors: [],
    });
  control.phase = 'installing';
  /** 생성 중인 창과 이미 준비된 창 모두 같은 차단 규칙을 적용한다. */
  control.guard ??=
    /** 생성 중인 창과 이미 준비된 창을 같은 규칙으로 차단한다. */ (window) => {
      if (window.isDestroyed()) return;
      let handlers = control.guards.get(window);
      if (!handlers) {
        handlers = {
          /** 네이티브 표시 요청 뒤 다시 숨긴다. */
          show: () => {
            if (!window.isDestroyed()) window.hide();
          },
          /** 실제 OS 포커스 이벤트를 보존한다. */
          focus: () => {
            control.metrics.focusEvents++;
          },
          /** 애플리케이션의 JS 표시·포커스 요청을 차단한다. */
          block: () => {},
        };
        control.guards.set(window, handlers);
      }
      window.setFocusable(false);
      window.setOpacity(0);
      window.setIgnoreMouseEvents(true);
      window.hide();
      window.show = handlers.block;
      window.showInactive = handlers.block;
      window.focus = handlers.block;
      if (!window.listeners('show').includes(handlers.show))
        window.on('show', handlers.show);
      if (!window.listeners('focus').includes(handlers.focus))
        window.on('focus', handlers.focus);
    };
  /** 비동기 창 이벤트의 오류도 다음 상태 검사에서 실패시킨다. */
  control.listener ??= /** 새 창 차단 실패를 관측 상태에 보존한다. */ (
    _,
    window,
  ) => {
    try {
      control.guard(window);
    } catch (error) {
      control.errors.push({ message: error.message, stack: error.stack });
    }
  };
  if (!app.listeners('browser-window-created').includes(control.listener)) {
    app.on('browser-window-created', control.listener);
    control.listenerStarts++;
  }
  for (const window of BrowserWindow.getAllWindows()) control.guard(window);
  if (!control.timer) {
    control.timer = setInterval(
      /** 표시/포커스를 구분해 관측하고 생성 후 네이티브 표시도 다시 숨긴다. */ () => {
        try {
          const windows = BrowserWindow.getAllWindows();
          control.metrics.samples++;
          if (windows.some((w) => w.isVisible())) control.metrics.visible++;
          if (windows.some((w) => w.isVisible() && w.getOpacity() > 0))
            control.metrics.presented++;
          if (windows.some((w) => w.isFocused())) control.metrics.focused++;
          for (const window of windows) {
            if (window.isVisible()) {
              control.metrics.rehides++;
              control.guard(window);
            }
          }
        } catch (error) {
          control.errors.push({ message: error.message, stack: error.stack });
        }
      },
      100,
    );
    control.timer.unref();
    control.timerStarts++;
  }
  control.phase = 'installed';
  return {
    phase: control.phase,
    listenerStarts: control.listenerStarts,
    timerStarts: control.timerStarts,
  };
}

/** 순환 참조나 함수 없이 Electron의 실제 설정·창·관측 상태만 반환한다. */
export function readBackground({ app, BrowserWindow }) {
  const control = globalThis.__codocsUiBackground;
  return {
    phase: control?.phase ?? 'absent',
    listenerStarts: control?.listenerStarts ?? 0,
    listenerCopies: control
      ? app
          .listeners('browser-window-created')
          .filter((l) => l === control.listener).length
      : 0,
    timerStarts: control?.timerStarts ?? 0,
    timerPresent: Boolean(control?.timer),
    metrics: control?.metrics,
    errors: control?.errors ?? [],
    windows: BrowserWindow.getAllWindows().map(
      /** 현재 창의 차단과 표시 상태만 직렬화한다. */ (w) => ({
        id: w.id,
        visible: w.isVisible(),
        focused: w.isFocused(),
        opacity: w.getOpacity(),
        guarded: Boolean(control?.guards.has(w)),
      }),
    ),
  };
}

/** 해당 프로토콜 오류만 복구 대상으로 한정한다. */
function isCollected(error) {
  return /Resulting promise was garbage collected\.?$/.test(error.message);
}

/** 평가가 응답하지 않아도 초기화 전체의 제한 시간을 넘기지 않는다. */
async function evaluateBefore(app, callback, deadline) {
  let timer;
  try {
    return await Promise.race([
      app.evaluate(callback),
      new Promise(
        /** 응답 지연의 제한 시간을 관리한다. */ (_, reject) => {
          timer = setTimeout(
            () => reject(new Error('백그라운드 상태 확인 제한 시간 초과')),
            Math.max(0, deadline - Date.now()),
          );
        },
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 설치 응답이 실패해도 상태를 먼저 확인하고 미완료일 때만 재설정한다. */
export async function ensureBackground(app, records, { timeout = 5000 } = {}) {
  const deadline = Date.now() + timeout;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ack = await evaluateBefore(app, installBackground, deadline);
      records.push({ event: 'install-ack', attempt, ack });
    } catch (error) {
      records.push({ event: 'install-error', attempt, message: error.message });
      if (!isCollected(error)) throw error;
    }
    try {
      const state = await evaluateBefore(app, readBackground, deadline);
      records.push({ event: 'readback', attempt, state });
      if (state.errors.length)
        throw new Error(`창 차단 실패: ${JSON.stringify(state.errors)}`);
      if (
        state.phase === 'installed' &&
        state.listenerStarts === 1 &&
        state.listenerCopies === 1 &&
        state.timerStarts === 1 &&
        state.timerPresent &&
        state.windows.every((w) => w.guarded && !w.focused && w.opacity === 0)
      )
        return state;
    } catch (error) {
      records.push({
        event: 'readback-error',
        attempt,
        message: error.message,
      });
      if (!isCollected(error)) throw error;
    }
  }
  throw new Error('백그라운드 초기화를 3회 안에 확인하지 못했습니다.');
}

/** 읽기 전용 최종 관측도 같은 프로토콜 오류에 한해서 제한적으로 재조회한다. */
export async function backgroundState(app, records, { timeout = 5000 } = {}) {
  const deadline = Date.now() + timeout;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await evaluateBefore(app, readBackground, deadline);
    } catch (error) {
      records.push({
        event: 'final-read-error',
        attempt,
        message: error.message,
      });
      if (!isCollected(error) || attempt === 3) throw error;
    }
  }
}

/** 투명한 네이티브 visible 표본과 실제 화면 노출·포커스를 구분해 검증한다. */
export function assertBackground(state) {
  if (
    state.phase !== 'installed' ||
    state.listenerCopies !== 1 ||
    state.listenerStarts !== 1 ||
    state.timerStarts !== 1 ||
    !state.timerPresent ||
    state.errors.length ||
    state.metrics.presented ||
    state.metrics.focused ||
    state.metrics.focusEvents ||
    state.windows.some(
      (w) => !w.guarded || w.visible || w.focused || w.opacity !== 0,
    )
  ) {
    throw new Error(`백그라운드 창 격리 검증 실패: ${JSON.stringify(state)}`);
  }
}
