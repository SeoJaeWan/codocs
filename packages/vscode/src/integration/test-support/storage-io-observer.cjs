const fs = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');

// 시험용 MCP에서만 원래 파일 오류를 관찰하며 본문·자격 증명은 기록하지 않는다.
for (const operation of ['open', 'readFile', 'rename', 'link', 'unlink']) {
  const original = fs[operation];
  /** 실제 연산의 오류 필드와 호출 위치를 남기고 같은 예외를 다시 던진다. */
  fs[operation] =
    /** 원래 IO 오류의 증거를 기록하고 그대로 전달한다. */ async function observeStorageIo(
      ...args
    ) {
      try {
        return await original(...args);
      } catch (error) {
        if (String(args[0]).includes('.codocs'))
          console.error(
            'codocs-test-io ' +
              JSON.stringify({
                operation,
                code: error.code,
                syscall: error.syscall,
                path: error.path,
                dest: error.dest,
                stack: error.stack,
              }),
          );
        throw error;
      }
    };
}
syncBuiltinESMExports();
