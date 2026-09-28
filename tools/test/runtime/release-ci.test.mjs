import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourceDigest } from '../../build/release-contract.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { artifactName, executionBinding, verifyInput } from './release-ci.mjs';

test('전달 OS와 무관하게 후보 파일명을 검사한다', /** 전달 경로 형식을 독립적으로 확인한다. */ () => {
  assert.equal(
    artifactName('D:\\candidate\\codocs-2.3.4.vsix'),
    'codocs-2.3.4.vsix',
  );
  assert.equal(
    artifactName('/tmp/co-documentation-1.2.3.tgz'),
    'co-documentation-1.2.3.tgz',
  );
  assert.throws(() => artifactName('/tmp/other.tgz'), {
    message: /unknown artifact filename/u,
  });
});

test('같은 소스와 버전이어도 전송 뒤 바뀐 바이트를 거부한다', /** 변경된 전달물을 거부하는지 확인한다. */ async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'codocs-release-identity-'),
  );
  try {
    const names = ['co-documentation-1.2.3.tgz', 'codocs-2.3.4.vsix'];
    const artifacts = [];
    for (const [index, name] of names.entries()) {
      await writeFile(path.join(directory, name), name);
      artifacts.push({
        file: 'D:\\candidate\\' + name,
        product: index === 0 ? 'npm' : 'vscode',
        version: index === 0 ? '1.2.3' : '2.3.4',
        basename: name,
        sha256: createHash('sha256').update(name).digest('hex'),
      });
    }
    const sourceFiles = [
      { file: 'package.json', mode: '100644', gitBlob: 'b'.repeat(40) },
    ];
    const receipt = {
      schemaVersion: 1,
      sourceCommit: 'a'.repeat(40),
      sourceTree: 'c'.repeat(40),
      sourceFiles,
      sourceDigest: sourceDigest(sourceFiles),
      binding: null,
      artifactName: null,
      artifactId: null,
      sourceDiff: '',
      artifacts,
    };
    await writeFile(
      path.join(directory, 'release.json'),
      JSON.stringify(receipt),
    );
    const execution = executionBinding(receipt.sourceCommit, {
      GITHUB_REPOSITORY: 'SeoJaeWan/codocs',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
    });
    await writeFile(
      path.join(directory, 'selection.json'),
      JSON.stringify({
        sourceCommit: receipt.sourceCommit,
        stable: '1.139.1',
        execution,
      }),
    );
    await verifyInput(directory, receipt.sourceCommit, '1.139.1');
    const manual = await verifyInput(
      directory,
      receipt.sourceCommit,
      '1.139.1',
      { execution, artifactId: '456' },
    );
    assert.equal(manual.receipt.binding, null);
    assert.equal(manual.receipt.artifactId, '456');
    await assert.rejects(
      verifyInput(directory, receipt.sourceCommit, '1.139.1', {
        execution: { ...execution, runAttempt: '3' },
        artifactId: '456',
      }),
      { message: /execution run mismatch/u },
    );
    await assert.rejects(verifyInput(directory, 'b'.repeat(40), '1.139.1'), {
      message: /selection source mismatch/u,
    });
    await assert.rejects(
      verifyInput(directory, receipt.sourceCommit, '1.100.0'),
      { message: /selection stable mismatch/u },
    );
    await writeFile(path.join(directory, names[0]), 'modified');
    await assert.rejects(
      verifyInput(directory, receipt.sourceCommit, '1.139.1'),
      { message: /artifact hash mismatch/u },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
