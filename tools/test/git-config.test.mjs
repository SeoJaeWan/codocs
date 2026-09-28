import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGitFixtureEnvironment } from './git-config.mjs';

/** 훅이 가리키는 저장소의 index·설정·ref를 실제 바이트로 비교한다. */
function sentinelFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'codocs-hook-env-'));
  const repository = path.join(directory, 'sentinel');
  mkdirSync(repository);
  const env = {
    ...createGitFixtureEnvironment(),
    GIT_AUTHOR_NAME: 'Sentinel',
    GIT_AUTHOR_EMAIL: 'sentinel@example.invalid',
    GIT_COMMITTER_NAME: 'Sentinel',
    GIT_COMMITTER_EMAIL: 'sentinel@example.invalid',
  };
  /** 외부 Git 환경 없이 sentinel 저장소를 준비한다. */
  function git(args) {
    return execFileSync('git', args, {
      cwd: repository,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Sentinel']);
  git(['config', 'user.email', 'sentinel@example.invalid']);
  writeFileSync(path.join(repository, 'tracked.txt'), 'committed\n');
  git(['add', '.']);
  git(['commit', '-m', 'sentinel']);
  writeFileSync(path.join(repository, 'tracked.txt'), 'staged\n');
  git(['add', '.']);
  writeFileSync(path.join(repository, 'tracked.txt'), 'unstaged\n');
  writeFileSync(path.join(repository, 'untracked.txt'), 'keep\n');
  const gitDirectory = path.join(repository, '.git');
  /** staged·unstaged·미추적 파일과 저장소 메타데이터를 함께 보호한다. */
  function snapshot() {
    return {
      files: Object.fromEntries(
        [
          '.git/config',
          '.git/index',
          '.git/HEAD',
          '.git/logs/HEAD',
          'tracked.txt',
          'untracked.txt',
        ].map((file) => [
          file,
          readFileSync(path.join(repository, file)).toString('base64'),
        ]),
      ),
      refs: git(['show-ref']),
    };
  }
  return {
    directory,
    repository,
    env,
    gitDirectory,
    snapshot,
    inherited: {
      ...env,
      GIT_DIR: gitDirectory,
      GIT_COMMON_DIR: gitDirectory,
      GIT_WORK_TREE: repository,
      GIT_INDEX_FILE: path.join(gitDirectory, 'index'),
      GIT_OBJECT_DIRECTORY: path.join(gitDirectory, 'objects'),
      GIT_PREFIX: '',
    },
    /** 이 사례가 만든 sacrificial 저장소만 정리한다. */
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('훅의 저장소·index·설정을 상속해도 fixture init·config·add·commit·bare init은 sentinel을 바꾸지 않는다', /** 실패해도 사용자 저장소가 아닌 sentinel만 영향을 받는다. */ () => {
  const fixture = sentinelFixture();
  const before = fixture.snapshot();
  const target = path.join(fixture.directory, 'independent');
  const helperUrl = new URL('./git-config.mjs', import.meta.url).href;
  const child = `
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
    import path from 'node:path';
    import { createGitFixtureEnvironment } from ${JSON.stringify(helperUrl)};
    const cwd = ${JSON.stringify(target)};
    const env = { ...createGitFixtureEnvironment(), GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
    for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS']) assert.equal(env[key], undefined, key);
    mkdirSync(cwd);
    const git = (args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    writeFileSync(path.join(cwd, 'owned.txt'), 'fixture\\n');
    git(['add', '.']);
    git(['commit', '-m', 'fixture']);
    assert.equal(realpathSync(git(['rev-parse', '--show-toplevel'])), realpathSync(cwd));
    git(['init', '--bare', path.join(cwd, 'remote.git')]);
    assert.equal(git(['config', '--local', 'core.bare']), 'false');
  `;
  try {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', child],
      {
        env: {
          ...fixture.inherited,
          GIT_CONFIG: path.join(fixture.gitDirectory, 'config'),
          GIT_CONFIG_PARAMETERS: "'core.bare=true'",
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'core.bare',
          GIT_CONFIG_VALUE_0: 'true',
        },
        encoding: 'utf8',
      },
    );
    assert.deepEqual(fixture.snapshot(), before);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fixture.close();
  }
});

test('실제 훅은 lint-staged 뒤 Git local 환경을 비우고 test를 실행하며 두 실패 코드를 보존한다', /** 실제 shell과 Git으로 현재 작업 트리 훅의 경계를 검사한다. */ () => {
  const fixture = sentinelFixture();
  const before = fixture.snapshot();
  const bin = path.join(fixture.directory, 'bin');
  mkdirSync(bin);
  const probe = path.join(bin, 'probe.cjs');
  const command = path.join(bin, 'pnpm');
  const hook = fileURLToPath(
    new URL('../../.husky/pre-commit', import.meta.url),
  );
  const shell =
    process.platform === 'win32'
      ? path.resolve(
          execFileSync('git', ['--exec-path'], {
            env: fixture.env,
            encoding: 'utf8',
          }).trim(),
          '../../../bin/sh.exe',
        )
      : 'sh';
  writeFileSync(
    probe,
    `
    const assert = require('node:assert/strict');
    const { execFileSync } = require('node:child_process');
    const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    appendFileSync(process.env.PROBE_LOG, JSON.stringify({args, gitDir: process.env.GIT_DIR}) + '\\n');
    if (args[0] === 'exec') {
      assert.equal(process.env.GIT_DIR, process.env.SENTINEL_GIT_DIR);
      process.exit(Number(process.env.LINT_STATUS));
    }
    for (const key of process.env.LOCAL_GIT_KEYS.split(' ')) assert.equal(process.env[key], undefined, key);
    if (Number(process.env.TEST_STATUS)) process.exit(Number(process.env.TEST_STATUS));
    const cwd = process.env.PROBE_FIXTURE;
    mkdirSync(cwd);
    const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Hook test']);
    writeFileSync(path.join(cwd, 'test.txt'), 'current tree\\n');
    git(['add', '.']);
    git(['commit', '-m', 'test']);
    git(['init', '--bare', path.join(cwd, 'remote.git')]);
    assert.equal(git(['config', '--local', 'core.bare']), 'false');
  `,
  );
  writeFileSync(
    command,
    `#!/bin/sh\n"${process.execPath.replaceAll('\\', '/')}" "${probe.replaceAll('\\', '/')}" "$@"\n`,
  );
  chmodSync(command, 0o755);
  const localGitKeys = execFileSync('git', ['rev-parse', '--local-env-vars'], {
    cwd: fixture.repository,
    env: fixture.env,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/u)
    .join(' ');
  try {
    for (const [name, lintStatus, testStatus, expected] of [
      ['pass', 0, 0, 0],
      ['lint-failure', 30, 0, 30],
      ['test-failure', 0, 29, 29],
    ]) {
      const log = path.join(fixture.directory, `${name}.jsonl`);
      const result = spawnSync(shell, [hook], {
        cwd: fixture.repository,
        env: {
          ...fixture.inherited,
          PATH: bin + path.delimiter + fixture.env.PATH,
          SENTINEL_GIT_DIR: fixture.gitDirectory,
          LOCAL_GIT_KEYS: localGitKeys,
          PROBE_LOG: log,
          PROBE_FIXTURE: path.join(fixture.directory, name),
          LINT_STATUS: String(lintStatus),
          TEST_STATUS: String(testStatus),
        },
        encoding: 'utf8',
      });
      assert.deepEqual(fixture.snapshot(), before);
      assert.equal(result.status, expected, result.stderr);
      const calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.deepEqual(
        calls.map(({ args }) => args),
        lintStatus
          ? [['exec', 'lint-staged']]
          : [['exec', 'lint-staged'], ['test']],
      );
      if (!lintStatus) assert.equal(calls[1].gitDir, undefined);
    }
  } finally {
    fixture.close();
  }
});

test('빈 일반 Git 설정 파일이 실제 global·system 조회에 사용되며 사용자 설정을 덮어쓰지 않는다', /** Windows에서도 파일 경로는 장치 이름이 아니다. */ () => {
  const env = createGitFixtureEnvironment();
  for (const kind of ['GLOBAL', 'SYSTEM']) {
    const file = env[`GIT_CONFIG_${kind}`];
    assert.ok(statSync(file).isFile());
    assert.equal(readFileSync(file, 'utf8'), '');
    assert.equal(
      execFileSync('git', ['config', `--${kind.toLowerCase()}`, '--list'], {
        env,
        encoding: 'utf8',
      }),
      '',
    );
    assert.notEqual(file, process.env[`GIT_CONFIG_${kind}`]);
  }
});

test('긴 추적 경로를 실제 checkout하고 외부 줄바꿈 설정에도 add·commit·merge가 깨끗하다', /** 설정 조회만으로 checkout 성공을 대신하지 않는다. */ () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'codocs-git-'));
  const env = {
    ...createGitFixtureEnvironment(),
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  /** 모든 실제 Git 연산이 같은 환경을 사용한다. */
  function git(args) {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  }
  /** 사용자 설정 파일이 없는 환경의 종료 상태도 그대로 비교한다. */
  function globalConfig() {
    const { status, stdout, stderr, error } = spawnSync(
      'git',
      ['config', '--global', '--list'],
      { encoding: 'utf8' },
    );
    if (error) throw error;
    return { status, stdout, stderr };
  }
  const globalBefore = globalConfig();
  try {
    git(['init', '-b', 'main']);
    git(['config', '--local', 'core.autocrlf', 'true']);
    git(['config', '--local', 'core.longpaths', 'false']);
    const relative = path.join(
      ...Array(5).fill('long-path-'.repeat(5)),
      '한글 %20 #.txt',
    );
    const filename = path.join(cwd, relative);
    assert.ok(filename.length > 260);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, 'first\nsecond\n');
    git(['add', '.']);
    git(['commit', '-m', 'initial']);
    git(['checkout', '-b', 'change']);
    writeFileSync(filename, 'first\nchanged\n');
    git(['add', '.']);
    git(['commit', '-m', 'change']);
    git(['checkout', 'main']);
    assert.equal(readFileSync(filename, 'utf8'), 'first\nsecond\n');
    git(['merge', '--no-ff', 'change', '-m', 'merge']);
    assert.equal(readFileSync(filename, 'utf8'), 'first\nchanged\n');
    assert.equal(git(['status', '--porcelain']), '');
    assert.deepEqual(globalConfig(), globalBefore);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
