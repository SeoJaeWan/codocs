import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { git } from './release-flow.mjs';
import {
  repositoryFixture,
  fixtureEnv,
  changeset,
  commit,
  officialCli,
  versions,
  root,
} from './release-fixture.mjs';

test('fetch 가능한 원본을 잃은 shallow 소스는 공식 CLI가 실패하고 전체 history 확보 뒤 계산은 성공한다', /** checkout depth1을 물려받은 독립 clone의 공식 deepen 실패를 재현한다. */ async () => {
  const fixture = await repositoryFixture();
  try {
    await changeset(fixture.cwd, 'history', { '@codocs/mcp': 'patch' });
    commit(fixture.cwd, 'changeset source');
    git(fixture.cwd, ['push', 'origin', 'develop'], { env: fixtureEnv });
    const cwd = path.join(fixture.directory, 'shallow');
    git(
      fixture.directory,
      [
        'clone',
        '--depth=1',
        '--branch=develop',
        pathToFileURL(fixture.remote).href,
        cwd,
      ],
      { env: fixtureEnv },
    );
    assert.equal(git(cwd, ['rev-parse', '--is-shallow-repository']), 'true');
    git(cwd, [
      'remote',
      'set-url',
      'origin',
      path.join(fixture.directory, 'missing-origin.git'),
    ]);
    const failed = spawnSync(
      process.execPath,
      [path.join(root, 'node_modules/@changesets/cli/bin.js'), 'version'],
      { cwd, env: fixtureEnv, encoding: 'utf8', timeout: 10000 },
    );
    assert.notEqual(failed.status, 0);
    assert.equal(failed.error, undefined);
    assert.match(failed.stdout + failed.stderr, /deepenCloneBy/u);
    assert.match(
      failed.stdout + failed.stderr,
      /does not appear to be a git repository/u,
    );
    git(cwd, ['remote', 'set-url', 'origin', fixture.remote]);
    git(cwd, ['fetch', '--unshallow', 'origin'], { env: fixtureEnv });
    git(cwd, ['fetch', 'origin', 'main:refs/heads/main'], { env: fixtureEnv });
    assert.equal(git(cwd, ['rev-parse', '--is-shallow-repository']), 'false');
    officialCli(cwd);
    assert.deepEqual(await versions(cwd), { npm: '1.2.4', vscode: '2.3.4' });
    await writeFile(
      path.join(root, '.workbench/ci-split-r1-shallow-evidence.json'),
      JSON.stringify(
        {
          failed: {
            status: failed.status,
            stdout: failed.stdout,
            stderr: failed.stderr,
            wasShallow: true,
          },
          fullHistory: {
            isShallow: false,
            versions: await versions(cwd),
            officialCli: 'PASS',
          },
          fixtureOnly: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.dispose();
  }
});
