import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { prepareVSCode, vscodeVersion } from '../test-runtime/vscode.mjs';
import { fixtureFiles } from './fixtures.mjs';
import { withCacheLock } from '../test-runtime/cache-lock.mjs';
import readDenial from '../test-runtime/read-denial.cjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = config.output;
const extension = path.join(config.temporary, 'extension');
const log = createWriteStream(path.join(output, 'process.log'));
let phase = 'build';
let releaseUnreadable;
/** 현재 단계와 성공 여부를 디스크에 즉시 남겨 비정상 종료도 구분한다. */
async function progress(extra = {}) {
  await writeFile(
    path.join(output, 'execution.json'),
    JSON.stringify({ phase, version: config.version, ...extra }, null, 2),
  );
}
try {
  await progress();
  await withCacheLock(
    path.join(config.root, '.workbench/vscode-build.lock'),
    /** 빌드와 확장 복사가 끝날 때까지 같은 작업 트리의 동시 빌드를 막는다. */ async () => {
      const built = spawnSync(
        process.execPath,
        ['tools/build/build.mjs', 'build'],
        { cwd: config.root, encoding: 'utf8', windowsHide: true },
      );
      log.write(built.stdout ?? '');
      log.write(built.stderr ?? '');
      if (built.error || built.status !== 0)
        throw built.error ?? new Error(`현재 소스 빌드 실패: ${built.status}`);
      await cp(path.join(config.root, 'packages/vscode'), extension, {
        recursive: true,
        /** 빌드와 확장 복사가 끝날 때까지 같은 작업 트리의 동시 빌드를 막는다. */ filter:
          (source) =>
            !source.includes('node_modules') &&
            !source.includes(`${path.sep}src`),
      });
    },
  );
  phase = 'download';
  await progress();
  const executable = await prepareVSCode({
    cacheRoot: config.cacheRoot,
    version: config.version ?? vscodeVersion,
  });
  phase = 'fixture';
  await progress();
  const workspace = path.join(config.temporary, 'workspace');
  const files = fixtureFiles();
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(workspace, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  releaseUnreadable = await readDenial.denyRead(
    path.join(workspace, 'partial/.codocs/unreadable.yaml'),
    path.join(config.temporary, 'file-denied'),
  );
  const profile = path.join(config.temporary, 'profile');
  await mkdir(path.join(profile, 'User'), { recursive: true });
  await writeFile(
    path.join(profile, 'User/settings.json'),
    JSON.stringify({
      'files.autoSave': 'off',
      'workbench.editor.enablePreview': false,
      'security.workspace.trust.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'workbench.startupEditor': 'none',
      'window.restoreWindows': 'none',
      'codocs-0.trace.server': 'verbose',
    }),
  );
  const workspaceFile = path.join(config.temporary, 'test.code-workspace');
  await writeFile(
    workspaceFile,
    JSON.stringify({
      folders: [
        { path: workspace },
        { path: path.join(workspace, 'nested') },
        { path: path.join(workspace, 'partial') },
      ],
    }),
  );
  phase = 'extension-host';
  await progress({ executable });
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.VSCODE_IPC_HOOK_CLI;
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: extension,
    extensionTestsPath: path.join(config.root, 'tools/vscode-tests/suite.cjs'),
    extensionTestsEnv: { CODOCS_VSCODE_CONFIG: process.argv[2] },
    stdout: log,
    stderr: log,
    launchArgs: [
      workspaceFile,
      '--user-data-dir',
      profile,
      '--extensions-dir',
      path.join(config.temporary, 'extensions'),
      '--disable-extensions',
      '--disable-telemetry',
      '--disable-experiments',
      '--new-window',
    ],
  });
  phase = 'complete';
  await progress({ passed: true });
} catch (error) {
  await progress({ passed: false, error: error.stack ?? String(error) });
  process.exitCode = 1;
} finally {
  if (releaseUnreadable) {
    try {
      await releaseUnreadable();
    } catch (error) {
      process.exitCode = 1;
      log.write(`fixture cleanup: ${error}\n`);
    }
  }
  log.end();
}
