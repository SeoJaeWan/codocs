const { execFileSync } = require('node:child_process');
const path = require('node:path');

/** OS 조회 출력을 PID·부모 PID·명령행으로 정규화한다. */
function parseProcesses(output, platform) {
  if (platform === 'win32') {
    const parsed = JSON.parse(output.replace(/^\uFEFF/u, '') || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed]).map(
      /** Windows 프로세스 레코드의 숫자 필드를 보존한다. */ (entry) => ({
        pid: Number(entry.ProcessId),
        parentPid: Number(entry.ParentProcessId),
        command: entry.CommandLine ?? '',
      }),
    );
  }
  if (platform === 'darwin')
    return output.split('\n').flatMap(
      /** ps 한 줄을 PID와 부모 PID로 분리한다. */ (line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
        return match
          ? [
              {
                pid: Number(match[1]),
                parentPid: Number(match[2]),
                command: match[3],
              },
            ]
          : [];
      },
    );
  throw new Error(`서버 프로세스 관측 미지원 OS: ${platform}`);
}

/** 시험 Host의 직접 자식이며 실제 서버 경로를 실행한 PID만 반환한다. */
function matchingServers(rows, parentPid, serverPath, platform) {
  /** Windows 명령행 표기만 소문자와 역슬래시로 맞춘다. */
  const normalize = (value) =>
    platform === 'win32' ? value.replaceAll('/', '\\').toLowerCase() : value;
  const expected = normalize(serverPath);
  /** 명령행의 독립 경로 인자와 일치하는지 확인한다. */
  const hasPathArgument = (command) => {
    const normalized = normalize(command);
    let index = normalized.indexOf(expected);
    while (index >= 0) {
      const before = normalized[index - 1];
      const after = normalized[index + expected.length];
      if (
        (!before || /[\s"']/u.test(before)) &&
        (!after || /[\s"']/u.test(after))
      )
        return true;
      index = normalized.indexOf(expected, index + 1);
    }
    return false;
  };
  return rows
    .filter(
      /** 부모·실행 경로·IPC 표시가 모두 일치하는 서버만 남긴다. */ (row) =>
        row.parentPid === parentPid &&
        Number.isSafeInteger(row.pid) &&
        row.pid > 0 &&
        hasPathArgument(row.command) &&
        row.command.includes('--node-ipc'),
    )
    .map((row) => row.pid)
    .sort((a, b) => a - b);
}

/** 현재 시험의 실제 언어 서버 세 개를 OS 프로세스 표에서 조회한다. */
function ownedServers(c, platform = process.platform) {
  const serverPath = path.join(c.config.extension, 'dist/server/index.cjs');
  let output;
  if (platform === 'win32') {
    output = execFileSync(
      path.join(
        process.env.SystemRoot,
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${process.pid}" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true, encoding: 'utf8' },
    );
  } else if (platform === 'darwin') {
    output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
    });
  } else throw new Error(`서버 프로세스 관측 미지원 OS: ${platform}`);
  return matchingServers(
    parseProcesses(output, platform),
    process.pid,
    serverPath,
    platform,
  );
}

/** 종료 직전에 소유 관계를 다시 확인해 다른 프로세스를 종료하지 않는다. */
function killOwnedServer(c, pid) {
  if (!ownedServers(c).includes(pid))
    throw new Error(`시험 서버 소유 검증 실패: ${pid}`);
  process.kill(pid);
}

module.exports = {
  parseProcesses,
  matchingServers,
  ownedServers,
  killOwnedServer,
};
