import { mkdir, mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runSupervised } from '../../../tools/test/runtime/process.mjs';
import {
  parseRunnerArgs,
  readPerformanceConfig,
  resolveStableVersion,
} from './cli.mjs';
import { defaultPerformanceSettings } from '../../../tools/test/runtime/performance-contract.mjs';
import {
  createPerformanceReport,
  finishPerformanceReport,
  persistPerformanceReport,
  reconcileInterruptedScenario,
} from '../../../tools/test/runtime/performance-report.mjs';

/** 현재 소스의 VSIX를 설치해 공식 Extension Host에서 검사하고 실행 결과를 보존한다. */
export async function main(args = process.argv.slice(2)) {
  const options = parseRunnerArgs(args);
  if (options.resolveVersion) {
    const version = await resolveStableVersion();
    console.log(version);
    return version;
  }
  const root = path.resolve(import.meta.dirname, '../../..');
  const output = path.join(
    root,
    '.workbench/vscode-tests',
    `${Date.now()}-${process.pid}`,
  );
  await mkdir(output, { recursive: true });
  let temporary;
  const controller = new AbortController();
  /** 취소를 실행 감독기의 정상 정리 경로에 전달한다. */
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  const result = {
    platform: process.platform,
    arch: process.arch,
    version: options.version,
    mode: options.mode,
    scenario: options.scenario,
    phase: 'preparation',
    passed: false,
    output,
    visualInteraction: false,
    packageKind: 'installed-vsix',
  };
  let performanceReport;
  try {
    const configured =
      options.mode === 'performance'
        ? await readPerformanceConfig(options.config)
        : null;
    const settings = configured
      ? {
          ...defaultPerformanceSettings,
          ...configured,
          targets: {
            ...defaultPerformanceSettings.targets,
            ...configured.targets,
          },
        }
      : options.mode === 'performance'
        ? { ...defaultPerformanceSettings }
        : undefined;
    if (options.mode === 'performance') {
      performanceReport = createPerformanceReport({
        runId: path.basename(output),
        version: options.version,
        settings,
        command: `pnpm test:vscode -- ${args.join(' ')}`,
      });
      await persistPerformanceReport(performanceReport, output);
    }
    temporary = await mkdtemp(path.join(os.tmpdir(), 'codocs-vscode-'));
    const configPath = path.join(output, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        root,
        output,
        temporary,
        version: options.version,
        mode: options.mode,
        scenario: options.scenario,
        settings,
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
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.sourceHash = createHash('sha256')
      .update(result.head)
      .update(result.trackedDiff)
      .digest('hex');
    await writeFile(configPath, JSON.stringify(config));
    if (performanceReport) {
      performanceReport.hashes.source = config.sourceHash;
      await persistPerformanceReport(performanceReport, output);
    }
    result.phase = 'execution';
    const executionReport = await runSupervised({
      executable: process.execPath,
      args: [path.join(import.meta.dirname, 'host.mjs'), configPath],
      cwd: root,
      output,
      timeout: options.mode === 'performance' ? null : 600000,
      signal: controller.signal,
    });
    result.process = executionReport;
    let execution;
    try {
      execution = JSON.parse(
        await readFile(path.join(output, 'execution.json'), 'utf8'),
      );
      result.phase = execution.phase;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      result.phase = 'child-exit';
    }
    if (options.mode === 'performance') {
      try {
        performanceReport = JSON.parse(
          await readFile(path.join(output, 'performance.json'), 'utf8'),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (
      executionReport.reason !== 'exit' ||
      executionReport.exitCode !== 0 ||
      !execution?.passed
    )
      throw new Error(
        execution?.error ??
          `테스트 실행 ${executionReport.reason} (${executionReport.exitCode})`,
      );
    result.passed = true;
  } catch (error) {
    result.error = error.stack ?? String(error);
  } finally {
    if (performanceReport) {
      try {
        performanceReport = JSON.parse(
          await readFile(path.join(output, 'performance.json'), 'utf8'),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') result.evidenceError = String(error);
      }
      try {
        const progress = JSON.parse(
          await readFile(
            path.join(output, 'performance-progress.json'),
            'utf8',
          ),
        );
        if (result.passed) performanceReport.progress = progress;
        else
          reconcileInterruptedScenario(
            performanceReport,
            progress,
            controller.signal.aborted,
            result.error,
          );
      } catch (error) {
        if (error.code !== 'ENOENT') result.evidenceError = String(error);
      }
      finishPerformanceReport(
        performanceReport,
        result.passed
          ? 'complete'
          : controller.signal.aborted
            ? 'cancelled'
            : 'failed',
        result.error,
      );
      await persistPerformanceReport(performanceReport, output);
    }
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
