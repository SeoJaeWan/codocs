import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractRaw, osContracts } from '../test-support/os-contracts.js';
import { assertEnvironmentHost, preparationCommand } from './preparation.mjs';

assertEnvironmentHost();
const contract = osContracts.find(
  (entry) => entry.platform === process.platform,
)!;
let fixture: string;
beforeEach(async () => {
  await mkdir('.workbench/environment', { recursive: true });
  fixture = await mkdtemp(path.resolve('.workbench/environment/한글 공간-'));
});
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe('실제 OS syscall 계약', () => {
  it('한글과 공백 경로를 읽으면 CRLF 바이트와 같은 실제 파일을 확인한다', async () => {
    const file = path.join(fixture, '한글 원문.yaml');
    await writeFile(file, contractRaw);
    expect(await readFile(file, 'utf8')).toBe(contractRaw);
    expect(path.relative(fixture, file)).toBe('한글 원문.yaml');
    expect(await realpath(file)).toBe(
      path.join(await realpath(fixture), '한글 원문.yaml'),
    );
  });

  it('OS별 폴더 링크를 준비하면 링크 자체와 대상 및 끊어진 대상을 구분한다', async () => {
    const target = path.join(fixture, '외부 자료');
    const link = path.join(fixture, '연결');
    await mkdir(target);
    const supplied = process.platform === 'win32' ? target : '외부 자료';
    try {
      await symlink(supplied, link, contract.linkType);
    } catch (cause) {
      throw new Error(
        'ENVIRONMENT_PREPARATION_FAILED: 폴더 링크를 만들 수 없습니다.',
        { cause },
      );
    }
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    const observed = await readlink(link);
    expect(path.resolve(path.dirname(link), observed)).toBe(target);
    expect(await realpath(link)).toBe(await realpath(target));
    await rm(target, { recursive: true });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    await expect(realpath(link)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('파일 symlink를 준비하면 원문을 공유하고 링크 삭제가 대상을 삭제하지 않는다', async () => {
    const target = path.join(fixture, '외부 파일.yaml');
    const link = path.join(fixture, '연결 파일.yaml');
    await writeFile(target, contractRaw);
    try {
      await symlink(target, link, 'file');
    } catch (cause) {
      throw new Error(
        'ENVIRONMENT_PREPARATION_FAILED: 파일 symlink 생성 권한이 필요합니다.',
        { cause },
      );
    }
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(link, 'utf8')).toBe(contractRaw);
    await rm(link);
    expect(await readFile(target, 'utf8')).toBe(contractRaw);
  });

  it('실제 파일 읽기 권한을 거부하면 모의 경계와 같은 OS 오류를 반환한다', async () => {
    const file = path.join(fixture, '권한 원문.yaml');
    await writeFile(file, contractRaw);
    let sid: string | undefined;
    try {
      if (process.platform === 'win32') {
        sid = preparationCommand('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
        ]);
        preparationCommand('icacls.exe', [file, '/deny', '*' + sid + ':(R)']);
      } else {
        try {
          await chmod(file, 0);
        } catch (cause) {
          throw new Error(
            'ENVIRONMENT_PREPARATION_FAILED: POSIX 읽기 권한 거부를 준비할 수 없습니다.',
            { cause },
          );
        }
      }
      let code: string | undefined;
      try {
        await readFile(file);
      } catch (error) {
        code = (error as NodeJS.ErrnoException).code;
      }
      if (!code)
        throw new Error(
          'ENVIRONMENT_PREPARATION_FAILED: 현재 사용자에게 읽기 거부가 적용되지 않았습니다.',
        );
      expect(contract.deniedCodes).toContain(code);
    } finally {
      if (sid) preparationCommand('icacls.exe', [file, '/remove:d', '*' + sid]);
      else await chmod(file, 0o600);
    }
    expect(await readFile(file, 'utf8')).toBe(contractRaw);
  });

  it('OS 감시가 변경을 전달하고 close한 뒤에는 새 이벤트를 전달하지 않는다', async () => {
    const events: string[] = [];
    const watcher = watch(fixture, (_event, name) => {
      if (name) events.push(String(name));
    });
    const closed = once(watcher, 'close');
    try {
      await writeFile(path.join(fixture, '원문.yaml'), contractRaw);
      await vi.waitFor(() => expect(events).toContain('원문.yaml'));
    } finally {
      watcher.close();
      await closed;
    }
    const completed = [...events];
    await writeFile(path.join(fixture, '종료 후.yaml'), contractRaw);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(completed);
  });

  it('자식을 종료하면 exit 후 stdio close까지 완료하여 실행 폴더를 정리할 수 있다', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        'process.on("SIGTERM", () => process.stdout.write("handled", () => process.exit(0))); process.stdout.write("ready"); setInterval(() => {}, 1000);',
      ],
      { cwd: fixture, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    const closed = once(child, 'close');
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const events: string[] = [];
    child.once('exit', () => events.push('exit'));
    child.once('close', () => events.push('close'));
    try {
      await once(child.stdout, 'data');
    } finally {
      child.kill('SIGTERM');
      await closed;
    }
    expect(events).toEqual(['exit', 'close']);
    expect(child.stdout.closed).toBe(true);
    expect(child.stderr.closed).toBe(true);
    expect(child.signalCode).toBe(contract.signal);
    expect(child.exitCode).toBe(contract.exitCode);
    expect(stdout.includes('handled')).toBe(contract.handled);
  });
});
