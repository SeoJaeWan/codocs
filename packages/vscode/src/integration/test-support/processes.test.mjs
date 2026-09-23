import assert from 'node:assert/strict';
import { test } from 'node:test';
import processes from './processes.cjs';

test('Windows 조회에서 부모와 서버 경로가 일치하는 PID만 선택한다', /** Windows CIM 레코드에서 타 시험 부모를 배제한다. */ () => {
  const rows = processes.parseProcesses(
    JSON.stringify([
      {
        ProcessId: 4,
        ParentProcessId: 12,
        CommandLine: 'Code.exe C:\\fixture\\dist\\server\\index.cjs --node-ipc',
      },
      {
        ProcessId: 5,
        ParentProcessId: 13,
        CommandLine: 'Code.exe C:\\fixture\\dist\\server\\index.cjs --node-ipc',
      },
      {
        ProcessId: 6,
        ParentProcessId: 12,
        CommandLine:
          'Code.exe C:\\fixture\\dist\\server\\index.cjs.old --node-ipc',
      },
    ]),
    'win32',
  );
  assert.deepEqual(
    processes.matchingServers(
      rows,
      12,
      'C:/fixture/dist/server/index.cjs',
      'win32',
    ),
    [4],
  );
});

test('macOS 조회에서 부모와 서버 경로가 일치하는 PID만 선택한다', /** macOS ps 표에서 타 시험 부모를 배제한다. */ () => {
  const rows = processes.parseProcesses(
    ' 4 12 node /tmp/fixture/dist/server/index.cjs --node-ipc\n 5 13 node /tmp/fixture/dist/server/index.cjs --node-ipc\n 6 12 node /tmp/fixture/dist/server/index.cjs.old --node-ipc\n',
    'darwin',
  );
  assert.deepEqual(
    processes.matchingServers(
      rows,
      12,
      '/tmp/fixture/dist/server/index.cjs',
      'darwin',
    ),
    [4],
  );
});
