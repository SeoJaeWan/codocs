const { execFileSync } = require('node:child_process');

/** OS 명령 출력에서 경로와 IPC 인자를 가진 서버 PID만 추출한다. */
function matchingPids(processes, serverPath, platform = process.platform) {
  const normalizedPath =
    platform === 'win32'
      ? serverPath.replaceAll('/', '\\').toLowerCase()
      : serverPath;
  return processes
    .filter(
      /** 플랫폼 경로 표기로 변환하고 IPC 서버 명령행만 남긴다. */
      ({ command }) => {
        const normalizedCommand =
          platform === 'win32'
            ? command.replaceAll('/', '\\').toLowerCase()
            : command;
        return (
          normalizedCommand.includes(normalizedPath) &&
          command.includes('--node-ipc')
        );
      },
    )
    .map(({ pid }) => pid)
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
}

/** 현재 OS에서 실제 실행 중인 언어 서버 프로세스를 찾는다. */
function serverProcesses(serverPath, platform = process.platform) {
  if (platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
    const output = execFileSync(
      process.env.SystemRoot +
        '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true },
    );
    const parsed = JSON.parse(output.replace(/^\uFEFF/u, ''));
    return matchingPids(
      (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
        pid: Number(entry.ProcessId),
        command: entry.CommandLine ?? '',
      })),
      serverPath,
      platform,
    );
  }
  if (platform === 'darwin' || platform === 'linux') {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8',
    });
    return matchingPids(
      output.split('\n').map((line) => ({
        pid: Number.parseInt(line.trim().split(/\s+/u)[0], 10),
        command: line,
      })),
      serverPath,
      platform,
    );
  }
  throw new Error(`Unsupported process observation OS: ${platform}`);
}

module.exports = { matchingPids, serverProcesses };
