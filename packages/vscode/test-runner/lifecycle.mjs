import { readProductVersions } from '../../../tools/build/release-contract.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { packageVSIX } from '../../../tools/build/release.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { runSupervised } from '../../../tools/test/runtime/process.mjs';
import { prepareVSCodeApplication } from '../../../tools/test/runtime/vscode.mjs';
import { vscodeVersion } from '../../../tools/test/runtime/vscode.mjs';
import {
  createLifecycleProfile,
  assertMissingSuiteFailure,
} from '../../../tools/test/runtime/lifecycle-evidence.mjs';

/** 실제 VS Code 시작 실패·기능 실패·취소·시간 제한에서도 자식 정리를 확인한다. */
async function main(args = process.argv.slice(2)) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--vscode-version', '--vsix'].includes(args[i]) ||
      !args[i + 1] ||
      options.has(args[i])
    )
      throw new Error(
        '사용법: lifecycle.mjs [--vscode-version x.y.z] [--vsix file]',
      );
    options.set(args[i], args[i + 1]);
  }
  const version = options.get('--vscode-version') ?? vscodeVersion;
  if (!/^\d+\.\d+\.\d+$/u.test(version))
    throw new Error('정확한 VS Code 버전이 필요합니다');
  const root = path.resolve(import.meta.dirname, '../../..');
  const productVersions = await readProductVersions(root);
  const output = path.join(
    root,
    '.workbench/vscode-lifecycle',
    `${Date.now()}-${process.pid}`,
  );
  await mkdir(output, { recursive: true });
  const archive = options.has('--vsix')
    ? path.resolve(options.get('--vsix'))
    : path.join(output, 'codocs.vsix');
  if (!options.has('--vsix')) {
    const build = spawnSync(
      process.execPath,
      ['tools/build/build.mjs', 'build'],
      { cwd: root, windowsHide: true, stdio: 'inherit' },
    );
    assert.equal(build.status, 0);
    await packageVSIX(root, archive);
  }
  const archiveSha256 = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  const runtime = await prepareVSCodeApplication({
    cacheRoot: path.join(root, '.workbench/vscode-cache'),
    version,
  });
  const results = [];
  for (const mode of ['startup-failure', 'failure', 'timeout', 'cancelled']) {
    const evidence = path.join(output, mode);
    const temporary = await mkdtemp(
      path.join(os.tmpdir(), 'codocs-lifecycle-'),
    );
    const controller = new AbortController();
    const profile = await createLifecycleProfile();
    const missingSuite = path.join(evidence, 'absent-suite.cjs');
    let interval;
    try {
      await mkdir(evidence, { recursive: true });
      await mkdir(path.join(temporary, '.codocs'));
      await writeFile(
        path.join(temporary, '.codocs/ready.yaml'),
        'id: ready\nname: Ready\ndefinition: Lifecycle ready\ndomains: [test]\n',
      );
      await writeFile(path.join(temporary, 'probe.java'), 'ready();\n');
      const extensions = path.join(evidence, 'extensions');
      await mkdir(extensions);
      const environment = { ...process.env };
      delete environment.VSCODE_IPC_HOOK_CLI;
      delete environment.ELECTRON_RUN_AS_NODE;
      execFileSync(
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
            ? { ...environment, ELECTRON_RUN_AS_NODE: '1' }
            : environment,
          windowsHide: true,
          timeout: 120000,
        },
      );
      const harness = path.join(temporary, 'harness');
      await mkdir(harness);
      await writeFile(
        path.join(harness, 'package.json'),
        JSON.stringify({
          name: 'lifecycle-harness',
          publisher: 'codocs-tests',
          version: '0.0.1',
          engines: { vscode: '^1.100.0' },
        }),
      );
      const config = path.join(evidence, 'config.json');
      await writeFile(
        config,
        JSON.stringify({
          executable: runtime.executable,
          output: evidence,
          workspace: temporary,
          mode,
          extension: harness,
          archive,
          archiveSha256,
          extensionVersion: productVersions.vscode,
          profile,
          missingSuite,
        }),
      );
      if (mode === 'cancelled')
        interval = setInterval(
          /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ () => {
            readFile(path.join(evidence, 'ready.json'))
              .then(() => controller.abort())
              .catch((error) => {
                if (error.code !== 'ENOENT') console.error(error);
              });
          },
          50,
        );
      const report = await runSupervised({
        executable: process.execPath,
        args: [path.join(import.meta.dirname, 'lifecycle-host.mjs'), config],
        cwd: root,
        output: evidence,
        signal: controller.signal,
        timeout: mode === 'timeout' ? 20000 : 60000,
      });
      assert.equal(
        report.reason,
        ['timeout', 'cancelled'].includes(mode) ? mode : 'exit',
      );
      assert.notEqual(report.exitCode, 0);
      if (mode === 'startup-failure')
        assertMissingSuiteFailure(
          await readFile(path.join(evidence, 'process.log'), 'utf8'),
          missingSuite,
        );
      else
        assert.equal(
          JSON.parse(await readFile(path.join(evidence, 'ready.json'), 'utf8'))
            .ready,
          true,
        );
      assert.equal(report.residualProcesses, 0);
      results.push({
        mode,
        passed: true,
        reason: report.reason,
        residualProcesses: report.residualProcesses,
        profile,
        intendedCause: mode === 'startup-failure' ? 'missing-suite' : mode,
      });
    } catch (error) {
      results.push({ mode, passed: false, error: error.stack });
    } finally {
      clearInterval(interval);
      await rm(temporary, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
      await rm(path.join(evidence, 'extensions'), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
    await writeFile(
      path.join(output, 'result.json'),
      JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          node: process.versions.node,
          version,
          archive,
          archiveSha256,
          results,
        },
        null,
        2,
      ),
    );
  }
  console.log(`VS Code lifecycle: ${output}`);
  assert.ok(
    results.every((result) => result.passed),
    JSON.stringify(results),
  );
}
await main();
