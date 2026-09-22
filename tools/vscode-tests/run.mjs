import { mkdir, mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertSupportedIsolation,
  runIsolated,
} from '../test-runtime/isolation.mjs';
import { vscodeVersion } from '../test-runtime/vscode.mjs';

/** 현재 소스를 공식 Extension Host에서 검사하고 단계별 증거를 보존한다. */
export async function main(args = process.argv.slice(2)) {
  const root = path.resolve(import.meta.dirname, '../..');
  const output = path.join(
    root,
    '.workbench/vscode-tests',
    `${Date.now()}-${process.pid}`,
  );
  await mkdir(output, { recursive: true });
  let temporary;
  const controller = new AbortController();
  /** 취소를 격리 감독기의 정상 정리 경로에 전달한다. */
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  const result = {
    platform: process.platform,
    arch: process.arch,
    version: vscodeVersion,
    phase: 'preparation',
    passed: false,
    output,
    visualInteraction: false,
    macOSVerified: false,
  };
  try {
    if (args.length)
      throw new Error(
        `지원하지 않는 옵션: ${args.join(' ')}. 기본 명령이 현재 빌드와 고정 VS Code를 준비합니다.`,
      );
    assertSupportedIsolation();
    temporary = await mkdtemp(path.join(os.tmpdir(), 'codocs-vscode-'));
    const configPath = path.join(output, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        root,
        output,
        temporary,
        version: vscodeVersion,
        cacheRoot: path.join(root, '.workbench/vscode-cache'),
      }),
    );
    result.head = spawnSync(
      'git',
      ['-c', 'core.longpaths=true', 'rev-parse', 'HEAD'],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      },
    ).stdout.trim();
    result.trackedDiff = spawnSync(
      'git',
      ['-c', 'core.longpaths=true', 'diff', 'HEAD', '--'],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      },
    ).stdout;
    result.phase = 'execution';
    const isolation = await runIsolated({
      executable: process.execPath,
      args: [path.join(import.meta.dirname, 'host.mjs'), configPath],
      cwd: root,
      output,
      timeout: 600000,
      signal: controller.signal,
    });
    if (
      isolation.reason === 'exit' &&
      isolation.exitCode === 0 &&
      isolation.windows.length === 0
    )
      throw new Error('실제 VS Code 창 관측 누락');
    result.isolation = {
      reason: isolation.reason,
      exitCode: isolation.exitCode,
      residualProcesses: isolation.residualProcesses,
      samples: isolation.samples.length,
      testWindows: isolation.windows.length,
    };
    const execution = JSON.parse(
      await readFile(path.join(output, 'execution.json'), 'utf8'),
    );
    result.phase = execution.phase;
    if (
      isolation.reason !== 'exit' ||
      isolation.exitCode !== 0 ||
      !execution.passed
    )
      throw new Error(
        execution.error ??
          `격리 실행 ${isolation.reason} (${isolation.exitCode})`,
      );
    result.passed = true;
  } catch (error) {
    result.error = error.stack ?? String(error);
  } finally {
    if (temporary) {
      try {
        await cp(
          path.join(temporary, 'profile/logs'),
          path.join(output, 'logs'),
          { recursive: true },
        ).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      } catch (error) {
        result.passed = false;
        result.evidenceError = String(error);
      }
      try {
        await rm(temporary, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
        result.cleaned = true;
      } catch (error) {
        result.passed = false;
        result.cleanupError = String(error);
      }
    }
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    await writeFile(
      path.join(output, 'result.json'),
      JSON.stringify(result, null, 2),
    );
  }
  console.log(
    `VS Code ${result.passed ? 'PASS' : 'FAIL'} (${result.phase}): ${output}`,
  );
  if (result.error) console.error(result.error);
  if (!result.passed) process.exitCode = 1;
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(import.meta.dirname, 'run.mjs')
)
  await main();
