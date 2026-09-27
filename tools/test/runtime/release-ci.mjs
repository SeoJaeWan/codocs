import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRelease } from '../../build/release.mjs';
import { resolveStableVersion } from '../../../packages/vscode/test-runner/cli.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const input = path.join(root, '.workbench/release-input');

/** 다른 OS가 만든 receipt에서도 파일명만 추출하고 지정한 후보 두 개만 허용한다. */
export function artifactName(filename) {
  const name = filename.split(/[/\\]/u).at(-1);
  assert.ok(['co-documentation-0.0.1.tgz', 'codocs-0.0.1.vsix'].includes(name));
  return name;
}

/** 전달된 소스·버전·파일 바이트를 검사하고 호스트별 실제 환경을 기록한다. */
export async function verifyInput(directory, expectedCommit, expectedStable) {
  const receipt = JSON.parse(
    await readFile(path.join(directory, 'release.json'), 'utf8'),
  );
  const selection = JSON.parse(
    await readFile(path.join(directory, 'selection.json'), 'utf8'),
  );
  assert.equal(receipt.sourceCommit, expectedCommit);
  assert.equal(receipt.sourceDiff, '');
  assert.equal(selection.sourceCommit, expectedCommit);
  assert.match(selection.stable, /^\d+\.\d+\.\d+$/u);
  assert.equal(selection.stable, expectedStable);
  assert.equal(receipt.artifacts.length, 2);
  const names = new Set();
  for (const artifact of receipt.artifacts) {
    const name = artifactName(artifact.file);
    assert.ok(!names.has(name));
    names.add(name);
    const digest = createHash('sha256')
      .update(await readFile(path.join(directory, name)))
      .digest('hex');
    assert.equal(digest, artifact.sha256, name);
  }
  return { receipt, selection };
}

/** 한 번 패키징한 동일 바이트를 양 OS에서 소비하고 실패를 그대로 전달한다. */
async function main(mode) {
  const head = execFileSync(
    'git',
    ['-c', 'core.longpaths=true', 'rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  assert.equal(head, process.env.GITHUB_SHA);
  if (mode === 'prepare') {
    const stable = await resolveStableVersion();
    const resolvedAt = new Date().toISOString();
    const receipt = await packageRelease(root);
    assert.equal(receipt.sourceCommit, head);
    assert.equal(receipt.sourceDiff, '');
    await mkdir(input, { recursive: true });
    for (const artifact of receipt.artifacts)
      await copyFile(
        artifact.file,
        path.join(input, artifactName(artifact.file)),
      );
    await writeFile(
      path.join(input, 'release.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    await writeFile(
      path.join(input, 'selection.json'),
      JSON.stringify({ sourceCommit: head, stable, resolvedAt }, null, 2) +
        '\n',
    );
    await appendFile(process.env.GITHUB_OUTPUT, `stable=${stable}\n`);
  } else if (mode === 'verify') {
    const { receipt } = await verifyInput(
      input,
      head,
      process.env.CODOCS_EXPECTED_STABLE,
    );
    const entries = execFileSync(
      'git',
      ['-c', 'core.longpaths=true', 'ls-tree', '-r', '-z', head],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    const sourceFiles = entries
      .map((entry) => {
        const [metadata, file] = entry.split('\t');
        return { file, gitBlob: metadata.split(' ')[2] };
      })
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    assert.deepEqual(receipt.sourceFiles, sourceFiles);
    await writeFile(
      path.join(input, 'test-environment.json'),
      JSON.stringify(
        {
          sourceCommit: head,
          platform: process.platform,
          arch: process.arch,
          release: os.release(),
          cpu: os.cpus()[0]?.model,
          node: process.version,
          artifacts: receipt.artifacts,
        },
        null,
        2,
      ) + '\n',
    );
  } else throw new Error('Usage: release-ci.mjs prepare|verify');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2]);
