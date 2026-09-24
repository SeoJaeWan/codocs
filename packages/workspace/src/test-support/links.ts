import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 파일 심볼릭 링크 권한이 없는 Windows 호스트에서도 나머지 테스트를 실행한다. */
export const fileSymlinksSupported = (
  /** 실제 파일 링크를 시도하고 권한 부족만 capability 부재로 구분한다. */ () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'codocs-link-check-'));
    try {
      const target = path.join(folder, 'target');
      writeFileSync(target, '');
      symlinkSync(target, path.join(folder, 'link'), 'file');
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'EPERM' || error.code === 'EACCES')
      )
        return false;
      throw error;
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
)();

/** 실제 OS 링크를 만들며 Windows가 요구하는 대상 종류를 명시한다. */
export async function createLink(
  target: string,
  input: string,
  type?: 'file' | 'dir' | 'junction',
): Promise<void> {
  let selected = type;
  if (selected === undefined) {
    try {
      selected = (
        await stat(path.resolve(path.dirname(input), target))
      ).isDirectory()
        ? 'dir'
        : 'file';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      selected = 'file';
    }
  }
  await symlink(target, input, selected);
}
