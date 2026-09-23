import { execFile, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { createVSIX } from '@vscode/vsce';
import {
  prepareVSCodeApplication,
  vscodeVersion,
} from '../../../tools/test/runtime/vscode.mjs';
import { fixtureFiles } from '../src/integration/test-support/fixtures.mjs';
import { withCacheLock } from '../../../tools/test/runtime/cache-lock.mjs';
import readDenial from '../../../tools/test/runtime/read-denial.cjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = config.output;
const archive = path.join(output, 'codocs.vsix');
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
    /** 빌드와 패키징이 끝날 때까지 같은 작업 트리의 동시 빌드를 막는다. */ async () => {
      const built = spawnSync(
        process.execPath,
        ['tools/build/build.mjs', 'build'],
        { cwd: config.root, encoding: 'utf8', windowsHide: true },
      );
      log.write(built.stdout ?? '');
      log.write(built.stderr ?? '');
      if (built.error || built.status !== 0)
        throw built.error ?? new Error(`현재 소스 빌드 실패: ${built.status}`);
      phase = 'package';
      await progress();
      await createVSIX({
        cwd: path.join(config.root, 'packages/vscode'),
        packagePath: archive,
        dependencies: false,
        allowMissingRepository: true,
        skipLicense: true,
      });
    },
  );
  phase = 'download';
  await progress();
  const runtime = await prepareVSCodeApplication({
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
      'extensions.ignoreRecommendations': true,
      'codocs-0.trace.server': 'verbose',
    }),
  );
  phase = 'install';
  await progress();
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.VSCODE_IPC_HOOK_CLI;
  const extensions = path.join(config.temporary, 'extensions');
  await mkdir(extensions, { recursive: true });
  const installed = await promisify(execFile)(
    runtime.cli,
    [
      ...runtime.cliPrefix,
      '--install-extension',
      archive,
      '--force',
      '--user-data-dir',
      profile,
      '--extensions-dir',
      extensions,
    ],
    {
      env: runtime.cliAsNode
        ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        : process.env,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  log.write(installed.stdout);
  log.write(installed.stderr);
  const entries = (await readdir(extensions)).filter((entry) =>
    entry.startsWith('codocs.codocs-'),
  );
  if (entries.length !== 1)
    throw new Error(`설치된 Codocs 확장 경로가 하나여야 합니다: ${entries}`);
  config.extension = path.join(extensions, entries[0]);
  await writeFile(process.argv[2], JSON.stringify(config));
  await writeFile(
    path.join(output, 'installation.json'),
    JSON.stringify(
      {
        archive,
        sha256: createHash('sha256')
          .update(await readFile(archive))
          .digest('hex'),
        extension: config.extension,
        ...installed,
      },
      null,
      2,
    ),
  );
  // 테스트 Host를 여는 빈 확장만 개발 모드로 등록한다. 제품은 설치된 VSIX에서 로드한다.
  const harness = path.join(config.temporary, 'test-harness');
  await mkdir(harness);
  await writeFile(
    path.join(harness, 'package.json'),
    JSON.stringify({
      name: 'codocs-test-harness',
      publisher: 'codocs-tests',
      version: '0.0.0',
      engines: { vscode: '^1.100.0' },
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
  await progress({ executable: runtime.executable });
  await runTests({
    vscodeExecutablePath: runtime.executable,
    extensionDevelopmentPath: harness,
    extensionTestsPath: path.join(
      config.root,
      'packages/vscode/src/integration/index.cjs',
    ),
    extensionTestsEnv: { CODOCS_VSCODE_CONFIG: process.argv[2] },
    stdout: log,
    stderr: log,
    launchArgs: [
      workspaceFile,
      '--user-data-dir',
      profile,
      '--extensions-dir',
      extensions,
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
  await finished(log);
}
