import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runSupervised } from '../../../tools/test/runtime/process.mjs';
import { prepareVSCode } from '../../../tools/test/runtime/vscode.mjs';
import { vscodeVersion } from '../../../tools/test/runtime/vscode.mjs';

/** 실제 VS Code 시작 실패·기능 실패·취소·시간 제한에서도 자식 정리를 확인한다. */
async function main(args = process.argv.slice(2)) {
  if (
    args.length !== 0 &&
    (args.length !== 2 ||
      args[0] !== '--vscode-version' ||
      !/^\d+\.\d+\.\d+$/u.test(args[1]))
  )
    throw new Error('사용법: lifecycle.mjs [--vscode-version exact-x.y.z]');
  const version = args.length ? args[1] : vscodeVersion;
  const root = path.resolve(import.meta.dirname, '../../..');
  const output = path.join(
    root,
    '.workbench/vscode-lifecycle',
    `${Date.now()}-${process.pid}`,
  );
  await mkdir(output, { recursive: true });
  const build = spawnSync(
    process.execPath,
    ['tools/build/build.mjs', 'build'],
    { cwd: root, windowsHide: true, stdio: 'inherit' },
  );
  assert.equal(build.status, 0);
  const executable = await prepareVSCode({
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
    let interval;
    try {
      await mkdir(evidence, { recursive: true });
      await mkdir(path.join(temporary, '.codocs'));
      await writeFile(
        path.join(temporary, '.codocs/ready.yaml'),
        'id: ready\nname: Ready\ndefinition: Lifecycle ready\ndomains: [test]\n',
      );
      await writeFile(path.join(temporary, 'probe.java'), 'ready();\n');
      const config = path.join(evidence, 'config.json');
      await writeFile(
        config,
        JSON.stringify({
          executable,
          output: evidence,
          workspace: temporary,
          mode,
          extension: path.join(root, 'packages/vscode'),
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
      if (mode !== 'startup-failure')
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
      await rm(path.join(evidence, 'profile'), {
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
      JSON.stringify({ platform: process.platform, version, results }, null, 2),
    );
  }
  console.log(`VS Code lifecycle: ${output}`);
  assert.ok(
    results.every((result) => result.passed),
    JSON.stringify(results),
  );
}
await main();
