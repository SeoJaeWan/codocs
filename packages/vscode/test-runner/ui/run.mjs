import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { killTree } from '@vscode/test-electron/out/util.js';
import { parseArguments } from './cli.mjs';
import { connectRenderer } from './driver.mjs';

/** 보조 수집·정리가 원래 실패를 덮지 않도록 자체 제한 시간을 적용한다. */
async function bounded(action, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise(
        /** 현재 UI 입력·응답 관측을 연결한다. */ (resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timeout`)),
            timeout,
          );
        },
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** CI job에서 최종 VSIX와 고정 버전으로 한 번의 실제 UI 검사를 실행한다. */
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const vsixSha256 = createHash('sha256')
    .update(await readFile(options.vsix))
    .digest('hex');
  await mkdir(path.dirname(options.output), { recursive: true });
  await mkdir(options.output); // 이전 결과를 덮어쓰거나 재사용하지 않는다.
  const result = {
    version: options.version,
    vsix: options.vsix,
    vsixSha256,
    platform: process.platform,
    passed: false,
    status: 'running',
    phase: 'preparation',
    cleaned: false,
    evidenceErrors: [],
  };
  let temporary;
  let config;
  let log;
  let child;
  let timer;
  let cancel;
  let stopped;
  try {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'codocs-ui-'));
    config = {
      ...options,
      temporary,
      vsixSha256,
      profile: path.join(temporary, 'profile'),
      extensions: path.join(temporary, 'extensions'),
      workspace: path.join(temporary, 'workspace'),
    };
    const configFile = path.join(temporary, 'config.json');
    await writeFile(configFile, JSON.stringify(config));
    log = createWriteStream(path.join(options.output, 'process.log'));
    const logFailed = new Promise(
      /** 로그 오류도 실행 실패로 연결한다. */ (resolve, reject) =>
        log.once('error', reject),
    );
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./worker.mjs', import.meta.url)), configFile],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    stopped = new Promise(
      /** 현재 UI 입력·응답 관측을 연결한다. */ (resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );
    const interrupted = new Promise(
      /** 현재 UI 입력·응답 관측을 연결한다. */ (resolve, reject) => {
        timer = setTimeout(() => {
          result.status = 'timed-out';
          reject(new Error('UI run timeout'));
        }, options.timeout);
        cancel = /** 현재 UI 입력·응답 관측을 연결한다. */ () => {
          result.status = 'cancelled';
          reject(new Error('UI run cancelled'));
        };
        process.once('SIGINT', cancel);
        process.once('SIGTERM', cancel);
      },
    );
    const exit = await Promise.race([stopped, interrupted, logFailed]);
    result.exit = exit;
    const worker = JSON.parse(
      await readFile(path.join(options.output, 'worker.json'), 'utf8'),
    );
    result.phase = worker.phase;
    if (exit.code !== 0 || !worker.passed)
      throw new Error(
        worker.error ?? `UI worker exit: ${JSON.stringify(exit)}`,
      );
    result.passed = true;
    result.status = 'passed';
    result.phase = 'complete';
  } catch (error) {
    result.error = error.stack ?? String(error);
    if (result.status === 'running') result.status = 'failed';
    try {
      const worker = JSON.parse(
        await readFile(path.join(options.output, 'worker.json'), 'utf8'),
      );
      result.phase = worker.phase;
    } catch {
      /* 준비 전에 중단했으면 원래 단계와 실패를 보존한다. */
    }
    try {
      await bounded(
        /** 현재 UI 입력·응답 관측을 연결한다. */ async () => {
          if (!config) throw new Error('No renderer profile was prepared');
          const driver = await connectRenderer(config.profile, 1_000);
          try {
            await driver.screenshot(path.join(options.output, 'failure.png'));
          } finally {
            driver.close();
          }
        },
        8_000,
        'failure screenshot',
      );
    } catch (error) {
      result.evidenceErrors.push(`screenshot: ${error}`);
    }
  } finally {
    clearTimeout(timer);
    if (cancel) {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
    try {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        await bounded(
          () => killTree(child.pid, true),
          10_000,
          'owned process cleanup',
        );
        await bounded(() => stopped, 5_000, 'owned worker exit');
      }
      result.cleaned = true;
    } catch (error) {
      result.cleanupError = String(error);
      result.passed = false;
    }
    try {
      await bounded(
        /** 현재 UI 입력·응답 관측을 연결한다. */ () =>
          config &&
          cp(
            path.join(config.profile, 'logs'),
            path.join(options.output, 'vscode-logs'),
            { recursive: true },
          ),
        10_000,
        'VS Code logs',
      );
    } catch (error) {
      result.evidenceErrors.push(`logs: ${error}`);
    }
    if (log) {
      child?.stdout.unpipe(log);
      child?.stderr.unpipe(log);
      log.end();
      try {
        await finished(log);
      } catch (error) {
        result.evidenceErrors.push(`process log: ${error}`);
        result.passed = false;
      }
    }
    if (temporary && result.cleaned) {
      try {
        await rm(temporary, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 200,
        });
      } catch (error) {
        result.cleaned = false;
        result.passed = false;
        result.cleanupError = String(error);
      }
    }
    if (!result.cleaned) result.temporary = temporary;
    if (!result.passed && result.status === 'passed')
      result.status = result.cleaned ? 'failed' : 'cleanup-failed';
    await writeFile(
      path.join(options.output, 'result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({ output: options.output, ...result }));
    if (!result.passed) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
