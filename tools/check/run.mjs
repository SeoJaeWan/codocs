import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertNodeVersion, resolvePnpm, root } from './runtime.mjs';

/** 하위 도구의 종료 상태를 그대로 전달한다. */
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  assertNodeVersion();
  const mode = process.argv[2];
  const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
  if (mode === 'test' || mode === 'test:run') {
    run([
      vitest,
      mode === 'test' ? '--watch' : 'run',
      ...process.argv.slice(3),
    ]);
  } else {
    resolvePnpm();
    if (mode === 'all') {
      run(['tools/build/build.mjs', 'typecheck']);
      run(['node_modules/eslint/bin/eslint.js', '.']);
      run(['node_modules/prettier/bin/prettier.cjs', '.', '--check']);
      run(['tools/build/build.mjs', 'build']);
      run([vitest, 'run']);
    }
    if (mode === 'all' || mode === 'development')
      run([
        vitest,
        'run',
        '--config',
        'vitest.checks.config.mjs',
        'tools/development-checks',
      ]);
    if (mode === 'all' || mode === 'build')
      run([
        vitest,
        'run',
        '--config',
        'vitest.checks.config.mjs',
        'tools/build-checks',
      ]);
    if (!['all', 'development', 'build'].includes(mode))
      throw new Error(`알 수 없는 검사: ${mode}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
