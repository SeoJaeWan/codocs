import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface FileSystemTestCapabilities {
  symlink: boolean;
  permissionDenial: boolean;
}

/** 파일 시스템 기능을 제공하지 않는 오류 코드인지 판별한다. */
function isUnsupportedFileSystemCapability(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === 'EACCES' ||
    code === 'EINVAL' ||
    code === 'ENOTSUP' ||
    code === 'EPERM'
  );
}

/** 현재 실행 환경에서 심볼릭 링크와 권한 거부 fixture를 만들 수 있는지 확인한다. */
export async function detectFileSystemTestCapabilities(): Promise<FileSystemTestCapabilities> {
  const fixture = await mkdtemp(path.join(tmpdir(), 'codocs-test-capability-'));
  const target = path.join(fixture, 'target');
  const link = path.join(fixture, 'link');
  const restricted = path.join(fixture, 'restricted');
  let symlinkSupported = false;
  let permissionDenialSupported = false;

  try {
    await mkdir(restricted);
    try {
      await symlink(target, link, 'file');
      symlinkSupported = (await lstat(link)).isSymbolicLink();
    } catch (error: unknown) {
      if (!isUnsupportedFileSystemCapability(error)) throw error;
    }
    try {
      await chmod(restricted, 0);
      try {
        await readdir(restricted);
      } catch (error: unknown) {
        if (!isUnsupportedFileSystemCapability(error)) throw error;
        permissionDenialSupported = true;
      }
    } catch (error: unknown) {
      if (!isUnsupportedFileSystemCapability(error)) throw error;
    }
  } finally {
    await chmod(restricted, 0o700).catch(() => undefined);
    await rm(fixture, { recursive: true, force: true });
  }

  return {
    symlink: symlinkSupported,
    permissionDenial: permissionDenialSupported,
  };
}
