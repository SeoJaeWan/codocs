import { symlink, stat } from 'node:fs/promises';
import path from 'node:path';

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
