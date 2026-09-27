import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { trackChildClosure } from '../../../../tools/test/support/child-process.js';

/** 읽기·쓰기는 허용하되 삭제 공유를 제외한 실제 Windows 핸들을 소유 자식에서 연다. */
export async function holdWindowsFile(
  target: string,
): Promise<() => Promise<void>> {
  const environment = { ...process.env };
  environment['CODOCS_LOCK_TARGET'] = target;
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$file = [IO.File]::Open($env:CODOCS_LOCK_TARGET, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); try { [Console]::WriteLine('READY'); [Console]::ReadLine() | Out-Null } finally { $file.Dispose() }",
    ],
    {
      windowsHide: true,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const closure = trackChildClosure(child);
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise<void>(
        /** 준비 완료 신호를 받아야 저장 검사를 시작한다. */ (resolve) =>
          lines.once('line', (line) => {
            if (line === 'READY') resolve();
          }),
      ),
      closure.completion.then(() => {
        throw new Error(`Windows 핸들 준비 실패: ${stderr}`);
      }),
      new Promise<never>(
        /** 준비가 멈추면 소유 자식을 정리하도록 실패한다. */ (_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Windows 핸들 준비 시간 초과')),
            10000,
          );
        },
      ),
    ]);
  } catch (error) {
    await closure.stop();
    throw error;
  } finally {
    clearTimeout(timer);
    lines.close();
  }
  /** 입력 EOF로 핸들을 해제하고 자식의 실제 종료까지 확인한다. */
  return /** 핸들을 닫은 뒤 소유 자식 종료를 기다린다. */ async function release() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end('\n');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      await closure.completion;
    } finally {
      clearTimeout(deadline);
    }
    if (child.exitCode !== 0)
      throw new Error(`Windows 핸들 정리 실패: ${stderr}`);
  };
}
