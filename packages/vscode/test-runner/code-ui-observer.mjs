import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const profile = process.argv[3];
let socket;
let sequence = 0;
const pending = new Map();
/** runner가 소유한 renderer CDP에 한 요청을 연결한다. */
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise(
    /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ (
      resolve,
      reject,
    ) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    },
  );
}
/** renderer 예외를 숨기지 않고 실제 DOM 값을 읽는다. */
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails)
    throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
/** 준비 상태를 실제 관측으로 기다리며 제한 시간이 지나면 실패한다. */
async function until(probe) {
  const deadline = Date.now() + 15000;
  let error;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (caught) {
      error = caught;
    }
    await delay(50);
  }
  throw error ?? new Error('renderer 관측 제한 시간 초과');
}
/** runner의 private 프로필이 공개한 debugging port만 사용한다. */
async function connect() {
  const port = await until(
    /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
      const text = await readFile(
        path.join(profile, 'DevToolsActivePort'),
        'utf8',
      );
      return Number(text.split('\n')[0]);
    },
  );
  const target = await until(
    /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return pages.find(
        (item) => item.type === 'page' && item.url.includes('workbench'),
      );
    },
  );
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(
    /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ (
      resolve,
      reject,
    ) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    },
  );
  socket.addEventListener(
    'message',
    /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ (event) => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error)
        request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    },
  );
}
/** 실제 첫 행의 화면에 보이는 Inlay label만 찾는다. */
function inspect(expected) {
  return `(() => {const expected=${JSON.stringify(expected)}; const text=node=>node.textContent.replace(/\\u00a0/g,' '); const nodes=[...document.querySelectorAll('.monaco-editor .view-line span')].filter(node=>text(node).includes(expected)&&node.getClientRects().length&&![...node.children].some(child=>text(child).includes(expected)));return nodes.map(node=>{const rect=node.getBoundingClientRect();return {text:text(node),className:node.className,x:rect.x+rect.width/2,y:rect.y+rect.height/2,width:rect.width,height:rect.height};}).filter(node=>node.width>0&&node.height>0);})()`;
}
/** 화면의 실제 Inlay label에서 IDE 기본 이동 제스처를 보낸다. */
async function click(point, gesture) {
  const modifiers = gesture ? (process.platform === 'darwin' ? 4 : 2) : 0;
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    modifiers,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
    modifiers,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
    modifiers,
  });
}
let last;
try {
  await connect();
  for (;;) {
    let request;
    try {
      request = JSON.parse(
        await readFile(
          path.join(config.output, 'code-ui-request.json'),
          'utf8',
        ),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (request && request.id !== last) {
      last = request.id;
      let result = {
        id: request.id,
        action: request.action,
        platform: process.platform,
        passed: false,
      };
      try {
        const nodes = await until(
          /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ async () => {
            const values = await evaluate(inspect(request.expected));
            return request.action === 'hidden'
              ? values.length === 0
                ? { hidden: true }
                : undefined
              : values.length
                ? values
                : undefined;
          },
        );
        result.nodes = nodes;
        if (request.action === 'plain-click' || request.action === 'gesture')
          await click(nodes[0], request.action === 'gesture');
        const capture = await command('Page.captureScreenshot', {
          format: 'png',
        });
        const screenshot = path.join(
          config.output,
          `code-ui-${request.id}.png`,
        );
        await writeFile(screenshot, Buffer.from(capture.data, 'base64'));
        result.screenshot = screenshot;
        result.passed = true;
      } catch (error) {
        result.error = error.stack ?? String(error);
        result.visibleLines = await evaluate(
          `([...document.querySelectorAll('.monaco-editor .view-line')].filter(node=>node.getClientRects().length).map(node=>node.textContent))`,
        );
        const capture = await command('Page.captureScreenshot', {
          format: 'png',
        });
        result.screenshot = path.join(
          config.output,
          `code-ui-${request.id}-failed.png`,
        );
        await writeFile(result.screenshot, Buffer.from(capture.data, 'base64'));
      }
      await writeFile(
        path.join(config.output, 'code-ui-result.tmp'),
        JSON.stringify(result, null, 2),
      );
      await rename(
        path.join(config.output, 'code-ui-result.tmp'),
        path.join(config.output, 'code-ui-result.json'),
      );
      await writeFile(
        path.join(config.output, `code-ui-${request.id}.json`),
        JSON.stringify(result, null, 2),
      );
    }
    await delay(50);
  }
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  socket?.close();
}
