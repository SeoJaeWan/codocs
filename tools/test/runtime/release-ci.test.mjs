import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { artifactName, verifyInput } from './release-ci.mjs';

test('전달 OS와 무관하게 후보 파일명을 검사한다', /** 전달 경로 형식을 독립적으로 확인한다. */ () => {
  assert.equal(
    artifactName('D:\\candidate\\codocs-0.0.1.vsix'),
    'codocs-0.0.1.vsix',
  );
  assert.equal(
    artifactName('/tmp/co-documentation-0.0.1.tgz'),
    'co-documentation-0.0.1.tgz',
  );
  assert.throws(() => artifactName('/tmp/other.tgz'));
});

test('같은 소스와 버전이어도 전송 뒤 바뀐 바이트를 거부한다', /** 변경된 전달물을 거부하는지 확인한다. */ async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'codocs-release-identity-'),
  );
  try {
    const names = ['co-documentation-0.0.1.tgz', 'codocs-0.0.1.vsix'];
    const artifacts = [];
    for (const name of names) {
      await writeFile(path.join(directory, name), name);
      artifacts.push({
        file: 'D:\\candidate\\' + name,
        sha256: createHash('sha256').update(name).digest('hex'),
      });
    }
    const receipt = { sourceCommit: 'a'.repeat(40), sourceDiff: '', artifacts };
    await writeFile(
      path.join(directory, 'release.json'),
      JSON.stringify(receipt),
    );
    await writeFile(
      path.join(directory, 'selection.json'),
      JSON.stringify({ sourceCommit: receipt.sourceCommit, stable: '1.139.1' }),
    );
    await verifyInput(directory, receipt.sourceCommit, '1.139.1');
    await assert.rejects(verifyInput(directory, 'b'.repeat(40), '1.139.1'));
    await assert.rejects(
      verifyInput(directory, receipt.sourceCommit, '1.100.0'),
    );
    await writeFile(path.join(directory, names[0]), 'modified');
    await assert.rejects(
      verifyInput(directory, receipt.sourceCommit, '1.139.1'),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
