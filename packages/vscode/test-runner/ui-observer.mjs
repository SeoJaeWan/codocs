import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyHoverState, observedLoading } from './ui-state.mjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const rawFile = path.join(
  config.output,
  `ui-transitions-${config.scenario}-${config.iteration}.jsonl`,
);
const partialFile = path.join(
  config.output,
  `ui-observation-${config.scenario}-${config.iteration}.json`,
);
const cancelFile = path.join(config.output, 'cancel-scenarios.json');
const binding = 'codocsHoverObservation';
let socket;
let nextId = 0;
const pending = new Map();
const transitions = [];
const completions = new Map();
let failure;
let persistence = Promise.resolve();

/** 선택한 시나리오의 내구성 취소 요청을 확인한다. */
async function cancelled() {
  try {
    const selected = JSON.parse(await readFile(cancelFile, 'utf8')).scenarios;
    return selected?.includes(config.scenario) ?? false;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/** 원시 DOM 전환과 현재 부분 상태를 즉시 저장한다. */
function persist(event) {
  transitions.push(event);
  persistence = persistence.then(
    /** 발생한 순서로 원시 이벤트와 부분 상태를 남긴다. */ async () => {
      await appendFile(rawFile, `${JSON.stringify(event)}\n`);
      await writeFile(
        partialFile,
        JSON.stringify({ status: 'running', transitions }, null, 2),
      );
    },
  );
  return persistence;
}

/** CDP 명령의 응답을 요청 ID에 연결한다. */
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise(
    /** CDP 응답을 기다리는 요청을 등록한다. */ (resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    },
  );
}

/** 대상 renderer에서 식을 평가하고 예외를 전달한다. */
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

/** 제품 대기 제한 없이 취소와 명시적 실패만 확인한다. */
async function until(probe) {
  for (;;) {
    if (await cancelled()) {
      const error = new Error(`취소된 시나리오: ${config.scenario}`);
      error.name = 'ScenarioCancelled';
      throw error;
    }
    if (failure) throw failure;
    const result = await probe();
    if (result) return result;
    await delay(25);
  }
}

/** 동일 renderer에서 포인터와 DOM 전환을 관측할 함수를 설치한다. */
function installObserver(options) {
  const old = window.__codocsHoverObserver;
  old?.observer.disconnect();
  old?.editor.removeEventListener('mousemove', old.onMouse, true);
  const editor = [...document.querySelectorAll('.monaco-editor')].find(
    /** 대상 코드 줄을 실제로 표시한 편집기를 찾는다. */ (node) =>
      node.getClientRects().length &&
      [...node.querySelectorAll('.view-line')].some(
        /** 대상 코드가 보이는 줄 중 하나인지 확인한다. */ (line) =>
          line.textContent.includes(options.target),
      ),
  );
  if (!editor)
    return {
      supported: false,
      reason: 'target editor is not visible',
      editors: [...document.querySelectorAll('.monaco-editor')].map(
        /** 실패 시 화면에 표시된 줄만 짧게 기록한다. */ (node) => ({
          visible: node.getClientRects().length > 0,
          lines: [...node.querySelectorAll('.view-line')]
            .slice(0, 3)
            .map(
              /** 실패 진단용 코드 줄을 제한한다. */ (line) =>
                line.textContent.slice(0, 120),
            ),
        }),
      ),
    };
  const resolution = [];
  let previous = performance.now();
  for (let i = 0; i < 1000; i++) {
    const current = performance.now();
    if (current > previous) resolution.push(current - previous);
    previous = current;
  }
  let generation = 0;
  let armed = false;
  let entered = false;
  let targetPoint;
  let lastState = '';
  /** renderer 단조 시계와 요청 식별자를 묶어 전송한다. */
  const emit = (event) =>
    window.codocsHoverObservation(
      JSON.stringify({
        ...event,
        windowId: options.windowId,
        target: options.target,
        generation,
        monotonicMs: performance.now(),
        timeOrigin: performance.timeOrigin,
      }),
    );
  /** 화면에 열린 팝업만 후보로 취한다. */
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(node).visibility !== 'hidden'
    );
  };
  /** 행 구조에서 Loading을 정확히 분리해 본문을 읽는다. */
  const inspect = () => {
    const popup = [...editor.querySelectorAll('.monaco-hover')].find(visible);
    const rows = popup ? [...popup.querySelectorAll('.hover-row')] : [];
    const rowEvidence = rows.map(
      /** 실제 행과 hover-contents의 구조 및 문자를 함께 보존한다. */ (row) => {
        const contents = row.querySelector('.hover-contents');
        return {
          hasContents: Boolean(contents),
          contentsText: contents?.textContent ?? '',
          body: row.innerText,
        };
      },
    );
    const loading = rows.some(
      /** 정확한 Loading 행만 진행 상태로 본다. */ (row) => {
        const contents = row.querySelector('.hover-contents');
        return contents?.textContent.trim() === 'Loading...';
      },
    );
    const body = rows
      .filter(
        /** Loading 행은 본문에서 제외한다. */ (row) => {
          const contents = row.querySelector('.hover-contents');
          return contents?.textContent.trim() !== 'Loading...';
        },
      )
      .map((row) => row.innerText)
      .join('\n');
    return {
      open: Boolean(popup),
      loading,
      body,
      rows: rowEvidence,
      rowCount: rows.length,
      target: options.target,
      structureSupported:
        !popup ||
        (!popup.textContent.trim() && rows.length === 0) ||
        (rows.length > 0 &&
          rowEvidence.every(
            /** 각 행의 지원되는 내용 요소를 확인한다. */ (row) =>
              row.hasContents,
          )),
    };
  };
  /** 대상 편집기 상태가 변할 때 원시 전환을 전송한다. */
  const observe = () => {
    const started = performance.now();
    const popup = inspect();
    const key = JSON.stringify(popup);
    if (key !== lastState) {
      lastState = key;
      emit({
        kind: 'dom',
        armed,
        entered,
        popup,
        observationOverheadMs: performance.now() - started,
      });
    }
  };
  /** 실제 포인터 진입의 renderer 시각을 최초 한 번 기록한다. */
  const onMouse = (event) => {
    if (!armed || entered || !targetPoint) return;
    if (
      Math.hypot(
        event.clientX - targetPoint.x,
        event.clientY - targetPoint.y,
      ) <= 2
    ) {
      entered = true;
      emit({ kind: 'entry', x: event.clientX, y: event.clientY });
      observe();
    }
  };
  const observer = new MutationObserver(observe);
  observer.observe(editor, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  editor.addEventListener('mousemove', onMouse, true);
  window.__codocsHoverObserver = {
    editor,
    observer,
    onMouse,
    state: inspect,
    /** 닫힌 상태에서 새 요청 세대와 목표 좌표를 설정한다. */
    arm(point) {
      if (inspect().open)
        throw new Error('stale popup is open before pointer entry');
      generation++;
      armed = true;
      entered = false;
      targetPoint = point;
      lastState = '';
      emit({ kind: 'armed', popup: inspect() });
      return generation;
    },
    /** 완료한 세대의 추가 진입을 막는다. */
    disarm() {
      armed = false;
      targetPoint = undefined;
    },
    /** 관측기를 해제한다. */
    close() {
      observer.disconnect();
      editor.removeEventListener('mousemove', onMouse, true);
    },
  };
  return {
    supported: true,
    timeResolutionMs: resolution.length ? Math.min(...resolution) : null,
    observerScope: 'target Monaco editor subtree',
    loadingSelector: '.hover-row > .hover-contents exact Loading...',
    requestedLocale: 'en',
    documentLanguage: document.documentElement.lang,
  };
}

/** 이번 실행 프로필의 CDP와 대상 창에 연결해 UI 표본을 만든다. */
async function main() {
  const port = await until(
    /** 이번 프로필의 디버그 포트가 생성될 때까지 기다린다. */ async () => {
      try {
        return (
          await readFile(
            path.join(config.profile, 'DevToolsActivePort'),
            'utf8',
          )
        ).split('\n')[0];
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
  );
  const endpoint = `http://127.0.0.1:${port}`;
  const target = await until(
    /** 연결된 프로필의 workbench 창을 찾는다. */ async () => {
      const response = await fetch(`${endpoint}/json/list`);
      const targets = await response.json();
      return targets.find(
        (candidate) =>
          candidate.type === 'page' && /workbench/u.test(candidate.url),
      );
    },
  );
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(
    /** CDP 소켓 연결 결과를 대기한다. */ (resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    },
  );
  socket.addEventListener(
    'close',
    /** 렌더러 손실을 대기 중인 명령에 전파한다. */ () => {
      failure = new Error('renderer CDP connection closed');
      for (const waiting of pending.values()) waiting.reject(failure);
      pending.clear();
    },
  );
  socket.addEventListener(
    'message',
    /** CDP 응답과 관측 binding 이벤트를 분리한다. */ (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiting = pending.get(message.id);
        pending.delete(message.id);
        if (waiting)
          message.error
            ? waiting.reject(new Error(JSON.stringify(message.error)))
            : waiting.resolve(message.result);
      } else if (
        message.method === 'Runtime.bindingCalled' &&
        message.params.name === binding
      ) {
        const observed = JSON.parse(message.params.payload);
        void persist(observed).catch(
          /** 기록 실패는 다음 대기 지점에서 보고한다. */ (error) => {
            failure = error;
          },
        );
        if (observed.kind === 'dom' && !observed.popup.structureSupported)
          failure = new Error(
            'unsupported DOM: visible popup has unknown row structure',
          );
        if (observed.kind === 'dom' && observed.entered) {
          const request = {
            windowId: config.windowId,
            generation: observed.generation,
            target: config.target,
            expectedBody: config.expectedBody,
          };
          if (
            classifyHoverState(observed, request).complete &&
            !completions.has(observed.generation)
          )
            completions.set(observed.generation, observed);
        }
      }
    },
  );
  await command('Runtime.enable');
  await command('Page.bringToFront');
  await command('Runtime.addBinding', { name: binding });
  const capability = await evaluate(
    `(${installObserver.toString()})(${JSON.stringify({ windowId: config.windowId, target: config.target })})`,
  );
  if (!capability.supported)
    throw new Error(`unsupported DOM: ${JSON.stringify(capability)}`);
  const point = await until(
    /** 현재 보이는 대상 토큰의 텍스트 범위 좌표를 읽는다. */ () =>
      evaluate(`(() => {
    const editor = window.__codocsHoverObserver?.editor;
    const line = [...editor.querySelectorAll('.view-line')].find((node) => node.textContent.includes(${JSON.stringify(config.target)}));
    if (!line) return null;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.textContent.indexOf(${JSON.stringify(config.target)});
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + ${config.target.length});
      const rect = range.getBoundingClientRect();
      if (rect.width && rect.height) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  })()`),
  );
  await persist({
    kind: 'capability',
    capability,
    targetId: target.id,
    targetUrl: target.url,
    point,
  });
  const attempts = config.scenario === 'reentry-ui' ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x + 400,
        y: point.y + 150,
      });
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await command('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await until(
        async () =>
          !(await evaluate('window.__codocsHoverObserver.state().open')),
      );
      await persist({ kind: 'closed-before-reentry', attempt });
    }
    const generation = await evaluate(
      `window.__codocsHoverObserver.arm(${JSON.stringify(point)})`,
    );
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    });
    const complete = await until(async () => completions.get(generation));
    const related = transitions.filter(
      (event) => event.generation === generation,
    );
    const entry = related.find((event) => event.kind === 'entry');
    const loading = observedLoading(related);
    if (!entry) throw new Error('pointer entry was not observed in renderer');
    const sample = {
      status: 'completed',
      scenario: config.scenario,
      iteration: config.iteration,
      attempt,
      durationMs: complete.monotonicMs - entry.monotonicMs,
      loadingObserved: loading.observed,
      loadingDurationMs: loading.durationMs,
      entry,
      loading: loading.first,
      complete,
      launchToRequestAgeMs:
        entry.timeOrigin +
        entry.monotonicMs -
        (config.launchStarted.timeOrigin + config.launchStarted.monotonicMs),
      clockUncertaintyMs: null,
      capability,
      readiness: config.readiness,
      windowId: config.windowId,
      targetId: target.id,
      target: config.target,
      expectedBody: config.expectedBody,
    };
    if (attempt === attempts - 1)
      await appendFile(config.sampleFile, `${JSON.stringify(sample)}\n`);
    else await persist({ kind: 'established-popup', sample });
    await evaluate('window.__codocsHoverObserver.disarm()');
  }
  await persistence;
  await writeFile(
    partialFile,
    JSON.stringify({ status: 'complete', transitions }, null, 2),
  );
}

try {
  await main();
} catch (error) {
  await persistence.catch(
    /** 원래 실패와 함께 남은 전환 기록을 보존한다. */ () => {},
  );
  await writeFile(
    partialFile,
    JSON.stringify(
      {
        status: error.name === 'ScenarioCancelled' ? 'cancelled' : 'failed',
        error: String(error.stack ?? error),
        transitions,
      },
      null,
      2,
    ),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await evaluate('window.__codocsHoverObserver?.close()').catch(
      /** 닫힌 렌더러의 해제 실패는 원래 결과를 덮지 않는다. */ () => {},
    );
    socket.close();
  }
}
