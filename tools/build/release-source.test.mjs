import assert from 'node:assert/strict';
import { createGitFixtureEnvironment } from '../test/git-config.mjs';
const env = createGitFixtureEnvironment();
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sourceIdentity } from './release.mjs';

test('filesystem 실행 비트가 없어도 Git index의 실행 mode를 소스 식별자에 보존한다', /** Windows checkout과 같은 mode 차이를 실제 Git index로 재현한다. */ async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'codocs-source-mode-'),
  );
  try {
    execFileSync('git', ['init'], { cwd: directory, env, stdio: 'pipe' });
    await writeFile(
      path.join(directory, 'script.mjs'),
      'export const source = true;\n',
    );
    await chmod(path.join(directory, 'script.mjs'), 0o644);
    execFileSync('git', ['add', '.'], { cwd: directory, env });
    execFileSync('git', ['update-index', '--chmod=+x', 'script.mjs'], {
      cwd: directory,
      env,
    });
    const expectedBlob = execFileSync('git', ['rev-parse', ':script.mjs'], {
      cwd: directory,
      env,
      encoding: 'utf8',
    }).trim();
    assert.deepEqual(await sourceIdentity(directory), [
      { file: 'script.mjs', mode: '100755', gitBlob: expectedBlob },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
