import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixtureFiles } from './fixtures.mjs';

const files = fixtureFiles();
const unreadable = 'partial/.codocs/unreadable.yaml';
const temporaryFiles = ['.codocs/moved.yaml', '.codocs/closed-a.yaml'];

/** 한 번의 기능 검사 실행에 사용할 기준 작업 공간을 만든다. */
export async function createWorkspaceFixture(root) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/** 사례가 변경한 파일만 기준 내용으로 복원한다. 읽기 거부 사례의 파일은 건드리지 않는다. */
export async function restoreWorkspaceFixture(root) {
  for (const relative of temporaryFiles)
    await rm(path.join(root, relative), { force: true });

  for (const [relative, content] of Object.entries(files)) {
    if (relative === unreadable) continue;
    const target = path.join(root, relative);
    let current;
    try {
      current = await readFile(target, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current === content) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}
