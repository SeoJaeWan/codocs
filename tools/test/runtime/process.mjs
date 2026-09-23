import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** 종료된 부모의 PID도 기준으로 삼아 관측된 자손만 반환한다. */
export function processTreePids(rows, roots) {
  const owned = new Set(roots);
  let changed;
  do {
    changed = false;
    for (const row of rows) {
      if (owned.has(row.parentPid) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
    }
  } while (changed);
  return rows.filter((row) => owned.has(row.pid)).map((row) => row.pid);
}

/** Windows 프로세스의 PID와 부모 관계를 실제 OS에서 조회한다. */
async function windowsProcesses() {
  const result = await execute(
    path.join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/u, '') || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
  }));
}

/** 현재 OS에서 창을 허용하고 실행별 자식 트리를 정상·실패·취소 시 정리한다. */
export async function runSupervised({
  executable,
  args,
  cwd,
  output,
  timeout = 300000,
  signal,
}) {
  await mkdir(output, { recursive: true });
  const child = spawn(
    executable,
    [path.join(import.meta.dirname, 'process-worker.mjs'), ...args],
    {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    },
  );
  let log = '';
  child.stdout.on('data', (data) => {
    log += data;
  });
  child.stderr.on('data', (data) => {
    log += data;
  });
  let closeResult;
  const closed = new Promise(
    /** 프로세스와 출력 스트림의 종료를 기다린다. */ (resolve) =>
      child.once('close', (code, signal) => {
        closeResult = { code, signal };
        resolve(closeResult);
      }),
  );
  let timer;
  let cancel;
  let report;
  try {
    report = await new Promise(
      /** 완료·취소·시간 초과 중 첫 결과를 받는다. */ (resolve, reject) => {
        child.once('error', reject);
        child.once(
          'message',
          /** 작업 완료와 원래 종료 상태를 받는다. */ (message) => {
            if (message.type === 'complete')
              resolve({ reason: 'exit', exitCode: message.exitCode });
          },
        );
        child.once('close', (code, signal) =>
          resolve({ reason: 'exit', exitCode: code ?? 1, signal }),
        );
        cancel = /** 취소 원인을 기록하고 정리 단계로 이동한다. */ () =>
          resolve({ reason: 'cancelled', exitCode: null });
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        timer = setTimeout(
          () => resolve({ reason: 'timeout', exitCode: null }),
          timeout,
        );
      },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    try {
      if (child.pid) {
        let windowsOwned;
        let killResult;
        if (process.platform === 'win32') {
          windowsOwned = new Set([
            child.pid,
            ...processTreePids(await windowsProcesses(), [child.pid]),
          ]);
          // worker는 완료 뒤에도 살아 있으므로 taskkill이 모든 자식을 찾을 수 있다.
          killResult = spawnSync(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            { encoding: 'utf8', windowsHide: true },
          );
          if (killResult.error) throw killResult.error;
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
        await Promise.race([
          closed,
          delay(10000, undefined, { ref: false }).then(() => {
            throw new Error('시험 프로세스 종료 시간 초과');
          }),
        ]);
        if (process.platform === 'win32') {
          const deadline = Date.now() + 5000;
          while (true) {
            const remaining = processTreePids(
              await windowsProcesses(),
              windowsOwned,
            );
            if (!remaining.length) break;
            for (const pid of remaining) windowsOwned.add(pid);
            if (Date.now() >= deadline)
              throw new Error(
                `시험 프로세스 트리가 남았습니다: ${remaining.join(', ')}. ${killResult.stderr}`,
              );
            await delay(50);
          }
        } else {
          const deadline = Date.now() + 5000;
          while (true) {
            try {
              process.kill(-child.pid, 0);
            } catch (error) {
              if (error.code === 'ESRCH') break;
              // EPERM은 그룹 소멸의 증거가 아니므로 제한 시간까지 다시 확인한다.
              if (error.code !== 'EPERM') throw error;
            }
            if (Date.now() >= deadline)
              throw new Error('시험 프로세스 그룹이 남았습니다.');
            await delay(50);
          }
        }
      }
    } catch (error) {
      await writeFile(
        path.join(output, 'process.json'),
        JSON.stringify({ ...report, cleanupError: String(error) }, null, 2),
      );
      throw error;
    } finally {
      await writeFile(path.join(output, 'supervisor.log'), log);
    }
  }
  report.cleanup =
    process.platform === 'win32' ? 'taskkill-tree' : 'process-group';
  report.residualProcesses = 0;
  await writeFile(
    path.join(output, 'process.json'),
    JSON.stringify(report, null, 2),
  );
  return report;
}
