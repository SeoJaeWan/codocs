import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArguments, resolveRuntime } from './runtime.mjs';

test('VSIX와 반복한 앱 경로를 읽고 이후 인자는 Playwright에 전달한다', /** 입력과 관측 결과의 계약을 검증한다. */ () => {
  assert.deepEqual(
    parseArguments([
      '--vsix',
      'x.vsix',
      '--code-path',
      'a.app',
      '--code-path',
      'b.app',
      '--',
      '--grep',
      '호버',
    ]),
    {
      vsix: 'x.vsix',
      codePaths: ['a.app', 'b.app'],
      playwright: ['--grep', '호버'],
    },
  );
});
for (const args of [
  [],
  ['--vsix'],
  ['--vsix', '--code-path', 'a'],
  ['--vsix', 'a'],
  ['--unknown'],
]) {
  test(`필수 옵션이 없거나 잘못된 옵션 ${JSON.stringify(args)}이면 실행 전에 거부한다`, () => {
    assert.throws(() => parseArguments(args));
  });
}
test('도움말은 설치 경로 없이 조회한다', () => {
  assert.deepEqual(parseArguments(['--help']), { help: true });
});
for (const [version, binary] of [
  ['1.95.0', 'Electron'],
  ['1.136.1', 'Code'],
]) {
  test(`macOS ${version}의 실제 GUI 이름을 선택한다`, /** 입력과 관측 결과의 계약을 검증한다. */ async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-runtime-'));
    try {
      const app = path.join(directory, 'Visual Studio Code.app');
      const resources = path.join(app, 'Contents/Resources/app');
      await mkdir(path.join(resources, 'out'), { recursive: true });
      await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
      await writeFile(
        path.join(resources, 'package.json'),
        JSON.stringify({ version }),
      );
      await writeFile(
        path.join(resources, 'product.json'),
        JSON.stringify({ nameShort: 'Code' }),
      );
      await writeFile(path.join(resources, 'out/cli.js'), '');
      await writeFile(path.join(app, 'Contents/MacOS', binary), '');
      const runtime = await resolveRuntime(app, 'darwin');
      assert.equal(runtime.version, version);
      assert.equal(path.basename(runtime.executable), binary);
      assert.equal(path.basename(runtime.cli), 'cli.js');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
for (const platform of ['linux', 'win32']) {
  test(`${platform}의 명시적 GUI 경로에서 셸 wrapper 없이 CLI를 찾는다`, /** 입력과 관측 결과의 계약을 검증한다. */ async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-runtime-'));
    try {
      const binary = path.join(
        directory,
        platform === 'win32' ? 'Code.exe' : 'code',
      );
      await mkdir(path.join(directory, 'resources/app/out'), {
        recursive: true,
      });
      await writeFile(
        path.join(directory, 'resources/app/package.json'),
        '{"version":"1.136.1"}',
      );
      await writeFile(path.join(directory, 'resources/app/out/cli.js'), '');
      await writeFile(binary, '');
      const runtime = await resolveRuntime(binary, platform);
      assert.equal(runtime.version, '1.136.1');
      assert.equal(path.basename(runtime.executable), path.basename(binary));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
