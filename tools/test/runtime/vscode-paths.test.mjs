import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  resolveVSCodeApplicationPaths,
  resolveWindowsApplicationRoot,
  vscodeApplicationPaths,
} from './vscode.mjs';

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

test('Windows 중첩 레이아웃의 문자열 경로를 호스트 OS와 무관하게 조합한다', /** 실제 파일 탐색과 Windows 문자열 계산을 분리한다. */ () => {
  const paths = vscodeApplicationPaths(
    'C:\\cache\\Code.exe',
    'win32',
    'C:\\cache\\release',
  );
  assert.equal(
    paths.cliPrefix[0],
    'C:\\cache\\release\\resources\\app\\out\\cli.js',
  );
  assert.equal(
    paths.packageJson,
    'C:\\cache\\release\\resources\\app\\package.json',
  );
  assert.equal(paths.runtimeRoot, 'C:\\cache');
});

test('Windows 구형과 중첩된 공식 CLI 레이아웃을 실제 파일로 구별한다', /** 두 공식 설치 형태의 실제 파일을 검사한다. */ async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-vscode-path-'));
  try {
    const executable = path.join(root, 'Code.exe');
    await writeFile(executable, '');
    const old = path.join(root, 'resources/app');
    await mkdir(path.join(old, 'out'), { recursive: true });
    await writeFile(path.join(old, 'out/cli.js'), '');
    await writeFile(path.join(old, 'package.json'), '{}');
    assert.equal(await resolveWindowsApplicationRoot(executable), root);
    await rm(path.join(root, 'resources'), { recursive: true });
    const nested = path.join(root, 'example-release-hash', 'resources/app');
    await mkdir(path.join(nested, 'out'), { recursive: true });
    await writeFile(path.join(nested, 'out/cli.js'), '');
    await writeFile(path.join(nested, 'package.json'), '{}');
    assert.equal(
      await resolveWindowsApplicationRoot(executable),
      path.join(root, 'example-release-hash'),
    );
    if (process.platform === 'win32')
      assert.equal(
        (await resolveVSCodeApplicationPaths(executable)).cliPrefix[0],
        path.join(nested, 'out/cli.js'),
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
