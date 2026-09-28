import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createGitFixtureEnvironment } from './git-config.mjs';

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
