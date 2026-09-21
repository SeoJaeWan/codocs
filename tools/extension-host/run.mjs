import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const developmentExtensionRoot = path.join(repositoryRoot, 'packages/vscode');
const extensionTestPath = path.join(
  repositoryRoot,
  'tools/extension-host/extension-test.cjs',
);
const defaultCodeExecutable =
  process.platform === 'darwin'
    ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
    : process.platform === 'win32'
      ? 'code.cmd'
      : 'code';
const codeExecutable =
  process.env.COD15_CODE_EXECUTABLE ?? defaultCodeExecutable;
const defaultCodeCli =
  process.platform === 'darwin' ? '/usr/local/bin/code' : defaultCodeExecutable;
const codeCli = process.env.COD15_CODE_CLI ?? defaultCodeCli;
const vsixArgumentIndex = process.argv.indexOf('--vsix');
const vsixPath =
  vsixArgumentIndex < 0 ? undefined : process.argv[vsixArgumentIndex + 1];
if (vsixArgumentIndex >= 0 && !vsixPath)
  throw new Error('--vsix requires an archive path');

/** 실행에 필요한 파일이 존재하는지 확인한다. */
async function requireFile(target, description) {
  try {
    await access(target);
  } catch {
    throw new Error(`${description} is unavailable: ${target}`);
  }
}

/** Extension Host fixture용 knowledge 파일을 만든다. */
async function writeKnowledge(root, id) {
  const directory = path.join(root, '.codocs');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${id}.yaml`),
    `id: ${id}\nname: ${id}\ndefinition: ${id}\ndomains: [test]\n`,
    'utf8',
  );
}

/** VS Code CLI 프로세스를 실행하고 종료 결과를 수집한다. */
function runCode(arguments_, environment, executable = codeExecutable) {
  /** 자식 프로세스의 출력과 종료 상태를 Promise 결과로 만든다. */
  const execute = (resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('VS Code Extension Host timed out after 120 seconds'));
    }, 120_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  };
  return new Promise(execute);
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cod15-host-'));
try {
  await requireFile(codeExecutable, 'Visual Studio Code executable');

  const parent = path.join(temporaryRoot, 'parent');
  const nested = path.join(parent, 'nested');
  const sibling = path.join(temporaryRoot, 'sibling');
  const missing = path.join(temporaryRoot, 'missing');
  await Promise.all([
    mkdir(nested, { recursive: true }),
    mkdir(sibling),
    mkdir(missing),
  ]);
  await Promise.all([
    writeKnowledge(parent, 'parent-zone'),
    writeKnowledge(nested, 'nested-zone'),
    writeKnowledge(sibling, 'sibling-zone'),
    writeFile(path.join(nested, 'source.java'), 'class Saved {}\n', 'utf8'),
  ]);

  const workspacePath = path.join(temporaryRoot, 'cod15.code-workspace');
  await writeFile(
    workspacePath,
    `${JSON.stringify(
      {
        folders: [
          { path: parent },
          { path: nested },
          { path: sibling },
          { path: missing },
        ],
        settings: {
          'files.autoSave': 'off',
          'security.workspace.trust.enabled': false,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const evidencePath = path.join(temporaryRoot, 'extension-host-evidence.json');
  const userData = path.join(temporaryRoot, 'user-data');
  const extensions = path.join(temporaryRoot, 'extensions');
  await Promise.all([mkdir(userData), mkdir(extensions)]);

  let extensionRoot = developmentExtensionRoot;
  let installResult;
  if (vsixPath) {
    await requireFile(codeCli, 'Visual Studio Code CLI');
    await requireFile(vsixPath, 'VSIX archive');
    installResult = await runCode(
      [
        '--install-extension',
        path.resolve(vsixPath),
        '--force',
        '--user-data-dir',
        userData,
        '--extensions-dir',
        extensions,
      ],
      process.env,
      codeCli,
    );
    assert.equal(
      installResult.code,
      0,
      `VSIX installation failed: ${installResult.stderr}`,
    );
    const installed = (await readdir(extensions)).find((entry) =>
      entry.startsWith('codocs.codocs-'),
    );
    assert.ok(installed, 'Installed codocs extension directory was not found');
    extensionRoot = path.join(extensions, installed);
  }
  await requireFile(
    path.join(extensionRoot, 'dist/index.cjs'),
    'built extension bundle',
  );
  await requireFile(
    path.join(extensionRoot, 'dist/server/index.cjs'),
    'bundled language server',
  );

  const result = await runCode(
    [
      '--extensionDevelopmentPath',
      extensionRoot,
      '--extensionTestsPath',
      extensionTestPath,
      '--user-data-dir',
      userData,
      '--extensions-dir',
      extensions,
      '--disable-extensions',
      '--disable-gpu',
      '--skip-welcome',
      '--skip-release-notes',
      workspacePath,
    ],
    {
      ...process.env,
      COD15_FIXTURE_ROOT: temporaryRoot,
      COD15_EXTENSION_ROOT: extensionRoot,
      COD15_EVIDENCE_PATH: evidencePath,
    },
  );
  assert.equal(
    result.code,
    0,
    `VS Code exited with ${String(result.code)} (${String(result.signal)})\n${result.stderr}`,
  );
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  process.stdout.write(
    `${JSON.stringify(
      {
        kind: 'real-vscode-extension-host',
        packageKind: vsixPath ? 'installed-vsix' : 'development-directory',
        executable: codeExecutable,
        extensionRoot,
        ...(installResult
          ? {
              installStdout: installResult.stdout,
              installStderr: installResult.stderr,
            }
          : {}),
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        evidence,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
