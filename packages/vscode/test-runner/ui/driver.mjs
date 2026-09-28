import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** 기대하는 실제 관측을 제한 시간 안에서 기다린다. */
export async function until(probe, label, timeout = 15_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await probe();
    if (last) return last;
    await delay(75);
  }
  throw new Error(`UI observation timed out: ${label}`);
}

/** 이번 사용자 프로필의 workbench renderer에만 CDP로 연결한다. */
export async function connectRenderer(profile, timeout = 5_000) {
  const port = await until(
    /** 현재 UI 입력·응답 관측을 연결한다. */ async () => {
      try {
        return (
          await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        ).split('\n')[0];
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
    'isolated DevTools port',
    timeout,
  );
  const target = await until(
    /** 현재 UI 입력·응답 관측을 연결한다. */ async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`CDP targets: ${response.status}`);
      const targets = (await response.json()).filter(
        (item) => item.type === 'page' && /workbench/u.test(item.url),
      );
      if (targets.length > 1)
        throw new Error('Multiple workbench renderers in isolated profile');
      return targets[0];
    },
    'isolated workbench renderer',
    timeout,
  );
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  await new Promise(
    /** 현재 UI 입력·응답 관측을 연결한다. */ (resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('CDP connection timeout'));
      }, timeout);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('CDP connection failed'));
        },
        { once: true },
      );
    },
  );
  socket.addEventListener(
    'message',
    /** 현재 UI 입력·응답 관측을 연결한다. */ (event) => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error)
        waiting.reject(new Error(JSON.stringify(message.error)));
      else waiting.resolve(message.result);
    },
  );
  socket.addEventListener(
    'close',
    /** 현재 UI 입력·응답 관측을 연결한다. */ () => {
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error('Renderer CDP connection closed'));
      }
      pending.clear();
    },
  );
  /** 요청별 제한 시간으로 CDP 응답을 연결한다. */
  const command = (method, params = {}) =>
    new Promise(
      /** 현재 UI 입력·응답 관측을 연결한다. */ (resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      },
    );
  const driver = new RendererDriver(
    command,
    process.platform,
    /** 현재 UI 입력·응답 관측을 연결한다. */ () => socket.close(),
  );
  await command('Runtime.enable');
  await command('Page.bringToFront');
  return driver;
}

/** 표시된 Monaco 문자 범위를 읽는다. 토큰이 여러 span으로 나뉘어도 전체 행에서 찾는다. */
function textPoint({ text, occurrence }) {
  let remaining = occurrence;
  for (const editor of document.querySelectorAll('.monaco-editor')) {
    if (!editor.getClientRects().length) continue;
    for (const line of editor.querySelectorAll('.view-line')) {
      const value = line.textContent.replaceAll('\u00a0', ' ');
      let start = -1;
      while ((start = value.indexOf(text, start + 1)) >= 0) {
        if (remaining-- > 0) continue;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        let offset = 0;
        while ((node = walker.nextNode())) {
          nodes.push({ node, start: offset });
          offset += node.textContent.length;
        }
        const first = nodes.find(
          (part) => part.start + part.node.textContent.length > start,
        );
        const end = start + text.length;
        const last = nodes.find(
          (part) => part.start + part.node.textContent.length >= end,
        );
        if (!first || !last) return null;
        const range = document.createRange();
        range.setStart(first.node, start - first.start);
        range.setEnd(last.node, end - last.start);
        const rect = range.getBoundingClientRect();
        if (rect.width && rect.height)
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
  }
  return null;
}

/** 실제 표시된 Hover의 본문과 앵커만 읽고 command 인수를 해석하지 않는다. */
function hoverState() {
  const popup = [...document.querySelectorAll('.monaco-hover')].find(
    /** 현재 UI 입력·응답 관측을 연결한다. */ (node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        getComputedStyle(node).visibility !== 'hidden'
      );
    },
  );
  if (!popup) return null;
  const rows = [...popup.querySelectorAll('.hover-row')];
  if (!rows.length) return null;
  const loading = rows.some(
    (row) =>
      row.querySelector('.hover-contents')?.textContent.trim() === 'Loading...',
  );
  const body = rows
    .filter(
      (row) =>
        row.querySelector('.hover-contents')?.textContent.trim() !==
        'Loading...',
    )
    .map((row) => row.innerText)
    .join('\n');
  const anchors = [...popup.querySelectorAll('a')].map(
    /** 현재 UI 입력·응답 관측을 연결한다. */ (node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.textContent,
        href: node.getAttribute('href'),
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0,
      };
    },
  );
  return { body, loading, anchors };
}

/** OS 기본 링크 열기 제스처에 필요한 CDP 수정 키를 반환한다. */
export function linkModifier(platform) {
  if (platform === 'win32')
    return {
      modifiers: 2,
      key: 'Control',
      code: 'ControlLeft',
      windowsVirtualKeyCode: 17,
    };
  if (platform === 'darwin')
    return {
      modifiers: 4,
      key: 'Meta',
      code: 'MetaLeft',
      windowsVirtualKeyCode: 91,
    };
  throw new Error(`Unsupported UI platform: ${platform}`);
}

/** 좁은 화면 관측과 실제 포인터·키 입력만 제공한다. */
export class RendererDriver {
  /** 제품 API 호출을 화면 입력으로 바꾸지 않고 CDP 전송만 주입한다. */
  constructor(
    command,
    platform,
    close = /** 현재 UI 입력·응답 관측을 연결한다. */ () => {},
  ) {
    this.command = command;
    this.platform = platform;
    this.close = close;
  }

  /** renderer에서 DOM 관측 함수를 실행한다. */
  async evaluate(fn, argument) {
    const result = await this.command('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  /** 실제 키 누름과 해제를 전달한다. */
  async key(key, code, windowsVirtualKeyCode) {
    await this.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode,
    });
    await this.command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
    });
  }

  /** 이전 Hover를 닫고 포인터를 편집기 밖으로 옮긴다. */
  async dismiss() {
    await this.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 1,
      y: 1,
    });
    await this.key('Escape', 'Escape', 27);
    await until(
      async () => !(await this.evaluate(hoverState)),
      'previous Hover dismissed',
    );
  }

  /** 화면의 실제 문자 범위에 포인터를 올려 표시된 본문을 기다린다. */
  async hover(text, expectedBody, occurrence = 0) {
    return until(
      /** 현재 UI 입력·응답 관측을 연결한다. */ async () => {
        await this.dismiss();
        const point = await until(
          () => this.evaluate(textPoint, { text, occurrence }),
          `visible token ${text}`,
        );
        await this.command('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          ...point,
        });
        const state = await until(async () => {
          const current = await this.evaluate(hoverState);
          return current && !current.loading && current.body && current;
        }, `visible Hover ${text}`);
        return state.body.includes(expectedBody) && state;
      },
      `rendered Hover ${expectedBody}`,
      30_000,
    );
  }

  /** 표시된 앵커에 실제 press/release를 전달한다. */
  async click(point, modifiers = 0) {
    await this.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      modifiers,
    });
    await this.command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      modifiers,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await this.command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      modifiers,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  }

  /** 현재 화면에 보이는 유일한 앵커를 클릭하며 오래된 링크의 href도 그대로 확인한다. */
  async clickAnchor(label, href) {
    const state = await this.evaluate(hoverState);
    const matches =
      state?.anchors.filter(
        (anchor) =>
          anchor.visible &&
          anchor.label.includes(label) &&
          (href === undefined || anchor.href === href),
      ) ?? [];
    if (matches.length !== 1)
      throw new Error(
        `Expected one rendered anchor ${label}, got ${matches.length}`,
      );
    await this.click(matches[0]);
    return matches[0];
  }

  /** YAML 본문 링크를 OS 기본 수정 키 클릭으로 연다. */
  async yamlLink(text, occurrence = 0) {
    await this.dismiss();
    const point = await until(
      () => this.evaluate(textPoint, { text, occurrence }),
      `visible YAML link ${text}`,
    );
    const { modifiers, ...key } = linkModifier(this.platform);
    await this.command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...key,
      modifiers,
    });
    try {
      await this.click(point, modifiers);
    } finally {
      await this.command('Input.dispatchKeyEvent', {
        type: 'keyUp',
        ...key,
        modifiers: 0,
      });
    }
  }

  /** 실패 시 renderer 화면을 그대로 저장한다. */
  async screenshot(file) {
    const result = await this.command('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(file, Buffer.from(result.data, 'base64'));
  }

  /** 클릭 실패가 팝업과 패널을 열지 않았는지 실제 DOM을 관측한다. */
  async workbenchState() {
    return this.evaluate(
      /** 현재 UI 입력·응답 관측을 연결한다. */ () => ({
        notifications: [...document.querySelectorAll('.notification-toast')]
          .filter((node) => node.getClientRects().length)
          .map((node) => node.textContent),
        panel: [...document.querySelectorAll('.part.panel')]
          .filter((node) => node.getClientRects().length)
          .map((node) => node.getAttribute('aria-label')),
      }),
    );
  }
}
