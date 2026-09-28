import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertNodeVersion, root } from '../toolchain.mjs';
import {
  discoverToolTests,
  selectToolTests,
  testSuites,
} from './selection.mjs';

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
function runToolTests(suite) {
  const tests = selectToolTests(discoverToolTests(), suite);
  if (tests.length) run(['--test', ...tests]);
}

try {
  assertNodeVersion();
  const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
  const input = process.argv.slice(2);
  const selector = input.find((arg) => arg.startsWith('--suite='));
  const suite = selector?.slice('--suite='.length) ?? testSuites.all;
  const tests = selectToolTests(discoverToolTests(), suite);
  const args = input.filter((arg) => arg !== selector);
  if (args.includes('--list-tools')) {
    console.log(JSON.stringify(tests, null, 2));
    process.exit(0);
  }
  const watch = args.includes('--watch');
  if (suite !== testSuites.management)
    run([
      vitest,
      watch ? '--watch' : 'run',
      ...args.filter((arg) => arg !== '--watch'),
    ]);
  if (suite === testSuites.management && watch)
    throw new Error('management watch unsupported');
  if (!watch) runToolTests(suite);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
