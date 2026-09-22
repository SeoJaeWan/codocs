import assert from 'node:assert/strict';
import { test } from 'node:test';
import processes from './processes.cjs';

/** 실제 명령행 조건과 PID 정렬을 확인한다. */
function verifyMatchingPids() {
  const target = '/tmp/확장/dist/server/index.cjs';
  assert.deepEqual(
    processes.matchingPids(
      [
        { pid: 30, command: `node "${target}" --node-ipc` },
        { pid: 10, command: `node "${target}" --node-ipc` },
        { pid: 20, command: `node "${target}"` },
        { pid: 40, command: 'node /tmp/other.js --node-ipc' },
      ],
      target,
    ),
    [10, 30],
  );
}

test(
  '경로와 IPC 인자가 같은 서버만 골라 PID 순서로 반환한다',
  verifyMatchingPids,
);

/** Windows의 경로 대소문자와 슬래시 차이를 유지한 실제 명령행을 확인한다. */
function verifyWindowsMatching() {
  assert.deepEqual(
    processes.matchingPids(
      [
        {
          pid: 42,
          command:
            'Code.exe c:\\Users\\Test\\e\\dist\\server\\index.cjs --node-ipc --clientProcessId=10',
        },
      ],
      'C:/Users/Test/e/dist/server/index.cjs',
      'win32',
    ),
    [42],
  );
}

test(
  'Windows 프로세스 경로 표기가 달라도 서버 PID를 찾는다',
  verifyWindowsMatching,
);
