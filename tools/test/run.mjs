import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import path from 'node:path';
import { assertNodeVersion, root } from '../toolchain.mjs';

/** 하위 도구의 종료 상태를 그대로 전달한다. */
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** node:test 도구 회귀는 Vitest와 구분하며 패키지의 실행 도우미 검사도 수집한다. */
function runToolTests() {
  const tests = globSync(
    ['tools/**/*.test.mjs', 'packages/**/src/**/test-support/*.test.mjs'],
    { cwd: root },
  ).sort();
  if (tests.length) run(['--test', ...tests]);
}

try {
  assertNodeVersion();
  const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');
  run([
    vitest,
    watch ? '--watch' : 'run',
    ...args.filter((arg) => arg !== '--watch'),
  ]);
  if (!watch) runToolTests();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
