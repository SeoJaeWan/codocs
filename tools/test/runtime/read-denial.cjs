const { spawn } = require('node:child_process');
const { chmod, readFile, stat, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');

/** 실제 읽기 거부를 준비하고, 실패와 정상 종료에서 원래 접근 상태를 복원한다. */
async function denyRead(
  target,
  marker,
  platform = process.platform,
  io = { chmod, readFile, stat, writeFile, rm },
) {
  let child;
  let mode;
  const ready = marker + '-ready';
  const release = marker + '-release';
  let stderr = '';
  let spawnError;
  if (platform === 'win32') {
    child = spawn(
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
        path.join(__dirname, 'read-denial.ps1'),
        '-Target',
        target,
        '-Ready',
        ready,
        '-Release',
        release,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      spawnError = error;
      stderr += String(error);
    });
  } else if (platform === 'darwin') {
    mode = (await io.stat(target)).mode & 0o7777;
    try {
      await io.chmod(target, 0);
      await io.writeFile(ready, 'denied');
    } catch (error) {
      await io.chmod(target, mode);
      throw error;
    }
  } else {
    throw new Error(`읽기 거부 fixture 미지원 OS: ${platform}`);
  }
  let closed = false;
  /** 획득한 자원을 한 번만 해제한다. */
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (mode !== undefined) await io.chmod(target, mode);
    if (child) {
      try {
        await io.writeFile(release, '');
      } catch {
        child.kill();
      }
      const exited =
        !child.pid || child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise(
              /** 종료·시작 실패 어느 쪽도 자원을 남기지 않는다. */ (resolve) =>
                child.once('close', resolve),
            );
      const timer = setTimeout(() => child.kill(), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
    await Promise.all([
      io.rm(ready, { force: true }),
      io.rm(release, { force: true }),
    ]);
  };
  try {
    const deadline = Date.now() + 15000;
    while (true) {
      try {
        await io.readFile(ready);
        break;
      } catch (error) {
        if (
          error.code !== 'ENOENT' ||
          spawnError ||
          Date.now() > deadline ||
          (child?.exitCode !== null && child?.exitCode !== undefined)
        )
          throw new Error(`읽기 거부 준비 실패: ${stderr || String(error)}`);
        await new Promise(
          /** 준비 표시가 생길 때까지 짧게 기다린다. */ (resolve) =>
            setTimeout(resolve, 50),
        );
      }
    }
    try {
      await io.readFile(target);
    } catch (error) {
      if (['EACCES', 'EPERM', 'EBUSY'].includes(error.code)) return cleanup;
      throw error;
    }
    throw new Error(`읽기 거부 준비 실패: 실제 read 성공 (${target})`);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

module.exports = { denyRead };
