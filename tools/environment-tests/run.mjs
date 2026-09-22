import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertEnvironmentHost } from './preparation.mjs';

try {
  assertEnvironmentHost();
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.environment.config.mjs',
      ...process.argv.slice(2),
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
