import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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
