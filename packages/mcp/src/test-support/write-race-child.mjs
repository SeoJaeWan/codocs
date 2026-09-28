import { link, rename, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createWorkspaceQuerySession } from '@codocs/workspace';
import { createCodocsServer } from '../server/index.ts';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const gate = process.env.CODOCS_RACE_GATE;
const stage = process.env.CODOCS_RACE_STAGE;
const actor = process.env.CODOCS_RACE_ACTOR;
/** 실제 저장 경계 도달을 원자적으로 게시하고 명시적인 해제를 기다린다. */
async function barrier(boundary) {
  if (stage !== boundary) return;
  const arrival = path.join(gate, actor + '.arrived');
  await writeFile(
    arrival + '.tmp',
    JSON.stringify({
      actor,
      boundary,
      pid: process.pid,
      project: process.cwd(),
    }),
  );
  await rename(arrival + '.tmp', arrival);
  const end = Date.now() + 20000;
  while (true) {
    try {
      await access(path.join(gate, actor + '.release'));
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (Date.now() > end) throw new Error('저장 장벽 해제 시간 초과');
    await new Promise(
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (resolve) =>
        setTimeout(resolve, 10),
    );
  }
}
const session = createWorkspaceQuerySession({ cwd: process.cwd() }, undefined, {
  storage: {
    /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ beforeApply:
      () => barrier('beforeApply'),
    operations: {
      /** 최종 검사 뒤 실제 link를 한 번 실행하고 원래 성공·오류를 반환한다. */
      async link(source, target) {
        await barrier('link');
        await link(source, target);
      },
      /** 최종 검사 뒤 실제 rename을 한 번 실행하고 원래 성공·오류를 반환한다. */
      async rename(source, target) {
        await barrier('rename');
        await rename(source, target);
      },
    },
  },
});
const server = createCodocsServer(session);
let closing;
/** stdio EOF 뒤 서버와 실제 감시 세션을 함께 정리한다. */
function close() {
  closing ??= server.close().finally(() => session.close());
  closing.catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
process.stdin.once('end', close);
process.once('SIGTERM', close);
await server.connect(new StdioServerTransport());
