import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvironmentHost } from './preparation.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, '.workbench/environment');
const evidence = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  sha: null,
  passed: false,
  phase: 'preparation',
};
mkdirSync(output, { recursive: true });
try {
  assertEnvironmentHost();
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (head.error || head.status !== 0)
    throw new Error('ENVIRONMENT_PREPARATION_FAILED: SHA 확인 실패');
  evidence.sha = head.stdout.trim();
  if (evidence.sha !== process.env.GITHUB_SHA)
    throw new Error(
      'ENVIRONMENT_PREPARATION_FAILED: 실행 SHA와 CI 이벤트 SHA가 다릅니다.',
    );
  evidence.phase = 'contracts';
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
  evidence.passed = result.status === 0;
  evidence.exitCode = result.status;
  process.exitCode = result.status ?? 1;
} catch (error) {
  evidence.error = error.stack ?? String(error);
  console.error(evidence.error);
  process.exitCode = 1;
} finally {
  writeFileSync(
    path.join(output, 'execution.json'),
    JSON.stringify(evidence, null, 2),
  );
}
