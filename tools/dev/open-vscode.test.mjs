import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createCodeInvocation } from './open-vscode.mjs';

const repository = path.resolve('repo-root');

/** 개발용 창 인자가 저장소 기준 절대 경로로 순서대로 구성되는지 확인한다. */
function verifyPosixInvocation() {
  const { command, args, shell } = createCodeInvocation(repository, 'linux');
  assert.equal(command, 'code');
  assert.equal(shell, false);
  assert.deepEqual(args, [
    '--new-window',
    `--user-data-dir=${path.join(repository, '.workbench/vscode-manual/user-data')}`,
    `--extensions-dir=${path.join(repository, '.workbench/vscode-manual/extensions')}`,
    `--extensionDevelopmentPath=${path.join(repository, 'packages/vscode')}`,
    repository,
  ]);
}

/** Windows에서 code.cmd 실행용 셸과 공백 경로 인용이 적용되는지 확인한다. */
function verifyWindowsInvocation() {
  const spaced = path.resolve('with space', 'repo');
  const { command, args, shell } = createCodeInvocation(spaced, 'win32');
  assert.equal(shell, true);
  assert.deepEqual(args, []);
  assert.ok(command.startsWith('code --new-window "--user-data-dir='));
  assert.ok(command.endsWith(` "${spaced}"`));
  assert.ok(!createCodeInvocation(repository, 'win32').command.includes('"'));
}

test('개발용 창 인자는 절대 경로로 순서대로 구성된다', verifyPosixInvocation);
test(
  'Windows에서는 셸로 code.cmd를 실행하고 공백 경로를 인용한다',
  verifyWindowsInvocation,
);
