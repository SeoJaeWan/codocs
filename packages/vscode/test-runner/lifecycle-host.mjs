import { readFile, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { runTests } from '@vscode/test-electron';
import path from 'node:path';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const log = createWriteStream(path.join(config.output, 'process.log'));
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.VSCODE_IPC_HOOK_CLI;
try {
  await runTests({
    vscodeExecutablePath: config.executable,
    extensionDevelopmentPath: config.extension,
    extensionTestsPath:
      config.mode === 'startup-failure'
        ? path.join(config.output, 'absent-suite.cjs')
        : path.join(import.meta.dirname, 'lifecycle-suite.cjs'),
    extensionTestsEnv: { CODOCS_VSCODE_CONFIG: process.argv[2] },
    stdout: log,
    stderr: log,
    launchArgs: [
      config.workspace,
      '--user-data-dir',
      path.join(config.output, 'profile'),
      '--extensions-dir',
      path.join(config.output, 'extensions'),
      '--disable-extensions',
      '--new-window',
    ],
  });
} catch (error) {
  await writeFile(
    path.join(config.output, 'expected-error.txt'),
    String(error),
  );
  process.exitCode = 1;
} finally {
  log.end();
  await finished(log);
}
