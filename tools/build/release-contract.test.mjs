import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  artifactName,
  assertVersion,
  readProductVersions,
} from './release-contract.mjs';

test('제품 manifest의 서로 다른 버전을 읽고 잘못된 제품 identity는 거부한다', /** 자체 판단의 입력과 고유 결과를 확인한다. */ async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'codocs-product-versions-'),
  );
  try {
    for (const [folder, name, version] of [
      ['mcp', '@codocs/mcp', '1.2.3'],
      ['vscode', 'codocs', '2.3.4'],
    ]) {
      await mkdir(path.join(directory, 'packages', folder), {
        recursive: true,
      });
      await writeFile(
        path.join(directory, 'packages', folder, 'package.json'),
        JSON.stringify({ name, version }),
      );
    }
    assert.deepEqual(await readProductVersions(directory), {
      npm: '1.2.3',
      vscode: '2.3.4',
    });
    await writeFile(
      path.join(directory, 'packages/mcp/package.json'),
      JSON.stringify({ name: 'other-product', version: '1.2.3' }),
    );
    await assert.rejects(
      readProductVersions(directory),
      /manifest product mismatch/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('두 제품의 다른 버전을 전달하면 제품별 안전한 파일명을 만든다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  assert.equal(artifactName('npm', '1.2.3'), 'co-documentation-1.2.3.tgz');
  assert.equal(artifactName('vscode', '2.3.4'), 'codocs-2.3.4.vsix');
  assert.throws(() => artifactName('other', '1.2.3'), /unknown product/u);
});

test('semver가 아니거나 경로 문자가 있는 버전은 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  assert.equal(assertVersion('1.2.3-beta.1+build.5'), '1.2.3-beta.1+build.5');
  for (const value of ['1.2', '../1.2.3', '1.2.3/x', '01.2.3', '', 7])
    assert.throws(() => assertVersion(value));
});
