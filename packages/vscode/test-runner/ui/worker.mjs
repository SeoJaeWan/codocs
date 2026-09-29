import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadAndUnzipVSCode,
  runTests,
  runVSCodeCommand,
} from '@vscode/test-electron';
import { createFixture } from '../../src/integration/test-support/ui-fixture.mjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const result = { phase: 'preparation', passed: false };
/** 다음 단계가 시작되기 전에 실패 판정에 필요한 최소 상태를 저장한다. */
async function phase(name) {
  result.phase = name;
  await writeFile(
    path.join(config.output, 'worker.json'),
    JSON.stringify(result, null, 2),
  );
}

try {
  const options = {
    version: config.version,
    cachePath: path.join(config.temporary, 'download'),
  };
  await phase('download');
  const executable = await downloadAndUnzipVSCode(options);
  await mkdir(path.join(config.profile, 'User'), { recursive: true });
  await mkdir(config.extensions);
  await writeFile(
    path.join(config.profile, 'User/settings.json'),
    JSON.stringify({
      'editor.hover.delay': 100,
      'editor.hover.sticky': true,
      'editor.links': true,
      'editor.multiCursorModifier': 'alt',
      'editor.minimap.enabled': false,
      'editor.wordWrap': 'off',
      'workbench.startupEditor': 'none',
      'window.restoreWindows': 'none',
      'security.workspace.trust.enabled': false,
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
    }),
  );
  const profileArgs = [
    '--user-data-dir',
    config.profile,
    '--extensions-dir',
    config.extensions,
  ];
  await phase('install');
  const reported = await runVSCodeCommand(
    ['--version', ...profileArgs],
    options,
  );
  if (reported.stdout.trim().split(/\r?\n/u)[0] !== config.version)
    throw new Error(`Downloaded VS Code version differs: ${reported.stdout}`);
  const installed = await runVSCodeCommand(
    ['--install-extension', config.vsix, '--force', ...profileArgs],
    options,
  );
  console.log(installed.stdout, installed.stderr);
  const matches = [];
  for (const entry of await readdir(config.extensions, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const extensionPath = path.join(config.extensions, entry.name);
    const manifest = JSON.parse(
      await readFile(path.join(extensionPath, 'package.json'), 'utf8'),
    );
    if (manifest.publisher === 'seojaewan' && manifest.name === 'codocs')
      matches.push(await realpath(extensionPath));
  }
  if (matches.length !== 1)
    throw new Error(
      `Expected one installed Codocs VSIX, found ${matches.length}`,
    );
  config.extension = matches[0];
  await createFixture(config.workspace);
  const workspaceFile = path.join(config.temporary, 'ui.code-workspace');
  await writeFile(
    workspaceFile,
    JSON.stringify({
      folders: [
        { path: config.workspace },
        { path: path.join(config.workspace, 'nested') },
      ],
    }),
  );
  const harness = path.join(config.temporary, 'harness');
  await mkdir(harness);
  await writeFile(
    path.join(harness, 'package.json'),
    JSON.stringify({
      name: 'codocs-ui-harness',
      publisher: 'codocs-test',
      version: '0.0.0',
      engines: { vscode: '*' },
      main: './index.cjs',
    }),
  );
  await writeFile(
    path.join(harness, 'index.cjs'),
    'exports.activate = function () {};\n',
  );
  await writeFile(process.argv[2], JSON.stringify(config));
  await phase('extension-host');
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: harness,
    extensionTestsPath: fileURLToPath(
      new URL('../../src/integration/index.cjs', import.meta.url),
    ),
    extensionTestsEnv: { CODOCS_VSCODE_CONFIG: process.argv[2] },
    launchArgs: [
      workspaceFile,
      ...profileArgs,
      '--remote-debugging-port=0',
      '--lang=en',
      '--disable-telemetry',
      '--disable-experiments',
      '--new-window',
    ],
  });
  await phase('complete');
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(config.output, 'worker.json'),
    JSON.stringify(result, null, 2),
  );
}
