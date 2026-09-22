import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** 외부 데스크톱 관측과 자원 정리 결과를 판정한다. 사용자 자신의 창 전환은 허용한다. */
export function assertIsolation(report) {
  if (report.error) throw new Error(report.error);
  if (!report.desktopClosed || report.residualProcesses !== 0)
    throw new Error('격리 자원 정리 실패');
  if (!report.samples?.length) throw new Error('외부 포커스 관측 누락');
  const testWindows = new Set(report.windows.map((window) => window.handle));
  for (const sample of report.samples) {
    if (
      !sample.inputDesktop ||
      sample.inputDesktop === report.desktop ||
      testWindows.has(sample.window)
    )
      throw new Error('시험 데스크톱/창이 사용자 입력 데스크톱에 노출됨');
  }
}

/** 전용 데스크톱 생성 전 안전한 OS 어댑터의 존재를 확인한다. */
export function assertSupportedIsolation(platform = process.platform) {
  if (platform === 'win32') return;
  throw new Error(
    platform === 'darwin'
      ? 'macOS 준비 실패: 사용자 GUI 세션과 분리된 검증된 실행 어댑터가 없습니다. 일반 창 실행이나 포커스 복원으로 대체하지 않습니다. tools/test-runtime/macos-isolation.md를 확인하세요.'
      : `격리 실행을 지원하지 않는 OS: ${platform}`,
  );
}

/** 지정 프로세스와 모든 자식을 숨겨진 Windows 데스크톱·Job에서 실행한다. */
export async function runIsolated({
  executable,
  args,
  cwd,
  output,
  timeout = 300000,
  signal,
}) {
  assertSupportedIsolation();
  await mkdir(output, { recursive: true });
  const reportPath = path.join(output, 'isolation.json');
  const cancelPath = path.join(output, 'cancel');
  const request = path.join(output, 'isolation-request.json');
  await writeFile(
    request,
    JSON.stringify({
      executable,
      arguments: args,
      cwd,
      reportPath,
      cancelPath,
      timeout,
      parentPid: process.pid,
    }),
  );
  /** 신호 수신 후 감독기를 죽이지 않고 작업 소유 트리의 종료를 요청한다. */
  const cancel = () => {
    writeFile(cancelPath, 'cancel').catch((error) => console.error(error));
  };
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const child = spawn(
    path.join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(import.meta.dirname, 'isolated-desktop.ps1'),
      '-Request',
      request,
    ],
    { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (data) => {
    log += data;
  });
  child.stderr.on('data', (data) => {
    log += data;
  });
  try {
    await new Promise(
      /** 실제 입력·관측을 연결하고 실패를 호출자에게 전달한다. */ (
        resolve,
        reject,
      ) => {
        child.once('error', reject);
        child.once('close', resolve);
      },
    );
    await writeFile(path.join(output, 'supervisor.log'), log);
    const report = JSON.parse(
      (await readFile(reportPath, 'utf8')).replace(/^\uFEFF/u, ''),
    );
    assertIsolation(report);
    return report;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
