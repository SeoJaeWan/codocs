import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vscodeApplicationPaths } from './vscode.mjs';

/** Windows에서 VS Code 실행 파일이 CLI 옵션도 받는 경로를 확인한다. */
function verifyWindowsPaths() {
  assert.deepEqual(vscodeApplicationPaths('C:\\cache\\Code.exe', 'win32'), {
    executable: 'C:\\cache\\Code.exe',
    cli: 'C:\\cache\\Code.exe',
    cliPrefix: ['C:\\cache\\resources\\app\\out\\cli.js'],
    cliAsNode: true,
    runtimeRoot: 'C:\\cache',
    packageJson: 'C:\\cache\\resources\\app\\package.json',
  });
}

test('Windows 공식 실행 파일을 CLI로도 사용한다', verifyWindowsPaths);

/** macOS 앱 번들 안의 CLI 경로를 확인한다. */
function verifyMacPaths() {
  const executable = '/cache/Visual Studio Code.app/Contents/MacOS/Code';
  assert.deepEqual(vscodeApplicationPaths(executable, 'darwin'), {
    executable,
    cli: '/cache/Visual Studio Code.app/Contents/Resources/app/bin/code',
    cliPrefix: [],
    cliAsNode: false,
    runtimeRoot: '/cache/Visual Studio Code.app',
    packageJson:
      '/cache/Visual Studio Code.app/Contents/Resources/app/package.json',
  });
}

test('macOS 공식 앱 실행 파일에서 번들 CLI를 찾는다', verifyMacPaths);
