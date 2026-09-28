const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');

/** 직접 소유한 stdio 자식의 요청·응답·EOF·실제 종료를 기록한다. */
exports.startMcp =
  /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ async function startMcp({
    node,
    entry,
    project,
    args = [],
    record = /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {},
  }) {
    const child = spawn(
      node,
      [
        '--require',
        path.join(__dirname, 'storage-io-observer.cjs'),
        entry,
        ...args,
      ],
      {
        cwd: project,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const pending = new Map();
    let sequence = 0;
    let ended;
    let stderr = '';
    const identity = { pid: child.pid, project, entry };
    record({ kind: 'spawn', ...identity, node });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise(
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
        resolve,
      ) => {
        child.once('error', (error) => {
          for (const request of pending.values()) request.reject(error);
        });
        child.once(
          'exit',
          /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
            code,
            signal,
          ) => {
            ended = { code, signal };
            record({ kind: 'exit', ...identity, ...ended, stderr });
            for (const request of pending.values())
              request.reject(new Error('MCP 종료: ' + JSON.stringify(ended)));
            pending.clear();
            resolve(ended);
          },
        );
      },
    );
    const lines = createInterface({ input: child.stdout });
    lines.on(
      'line',
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (line) => {
        try {
          const message = JSON.parse(line);
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          if (message.error)
            request.reject(new Error(JSON.stringify(message.error)));
          else request.resolve(message.result);
        } catch (error) {
          for (const request of pending.values()) request.reject(error);
        }
      },
    );
    /** 요청 제한은 제품 지연 목표가 아니라 멈춘 시험의 종료 한계다. */
    function request(method, params) {
      const id = ++sequence;
      record({ kind: 'request', ...identity, id, method, params });
      return new Promise(
        /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
          resolve,
          reject,
        ) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('MCP 요청 시간 초과: ' + method));
          }, 20000);
          pending.set(id, {
            /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ resolve(
              value,
            ) {
              clearTimeout(timer);
              record({ kind: 'response', ...identity, id, value });
              resolve(value);
            },
            /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ reject(
              error,
            ) {
              clearTimeout(timer);
              reject(error);
            },
          });
          child.stdin.write(
            JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
          );
        },
      );
    }
    /** 자연 종료와 강제 종료를 별도로 요청하고 실제 exit까지 기다린다. */
    async function close(mode = 'eof') {
      if (ended) return ended;
      record({ kind: 'shutdown', ...identity, mode });
      if (mode === 'eof') child.stdin.end();
      else child.kill('SIGKILL');
      let timer;
      try {
        return await Promise.race([
          exited,
          new Promise(
            /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
              _,
              reject,
            ) => {
              timer = setTimeout(
                () => reject(new Error('MCP 종료 시간 초과: ' + child.pid)),
                10000,
              );
            },
          ),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'cod27-owned-stdio', version: '1' },
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }) + '\n',
      );
    } catch (error) {
      await close('kill');
      throw error;
    }
    return {
      ...identity,
      close,
      /** 공개 도구의 JSON 포장을 그대로 남기고 구조 결과를 반환한다. */
      async call(name, args) {
        const response = await request('tools/call', { name, arguments: args });
        const value = response.structuredContent;
        if (
          JSON.stringify(JSON.parse(response.content[0].text)) !==
          JSON.stringify(value)
        )
          throw new Error('MCP 구조 결과와 본문 불일치');
        return value;
      },
    };
  };
