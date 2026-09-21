/* eslint-disable codocs/korean-jsdoc -- 실행 인수 판별 콜백은 공개 선언 함수가 아니다. */
export * from './document-sync/index.js';
export * from './server-session/index.js';
export * from './server/index.js';

import { runLanguageServer } from './server/index.js';

/**
 * 직접 실행일 때 SDK가 인식하는 프로토콜 전송 인수가 있는지 확인한다.
 * @param argv 프로세스에 전달된 실행 인수다.
 * @returns 지원하는 전송 인수가 하나라도 있으면 true다.
 */
function hasLanguageServerTransport(argv: readonly string[]): boolean {
  return argv.some(
    (argument) =>
      argument === '--stdio' ||
      argument === '--node-ipc' ||
      argument === '--socket' ||
      argument.startsWith('--socket=') ||
      argument === '--pipe' ||
      argument.startsWith('--pipe='),
  );
}

if (hasLanguageServerTransport(process.argv.slice(2))) runLanguageServer();
