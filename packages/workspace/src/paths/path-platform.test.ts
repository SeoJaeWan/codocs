import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLink } from '../test-support/links.js';
import { ioFailures } from '../test-support/file-system.js';
import { resolveProjectRoot } from '../project-root/index.js';
import { resolveWorkspacePath } from './index.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});

let temporary: string;
let root: string;
let target: string;
let logical: string;
beforeEach(async () => {
  temporary = await realpath(
    await mkdtemp(path.join(tmpdir(), 'codocs-native-path-')),
  );
  root = path.join(temporary, '자료 공간');
  target = path.join(temporary, '외부 자료');
  logical = path.join(root, '.codocs', '연결');
  await mkdir(path.dirname(logical), { recursive: true });
  await mkdir(target);
  await writeFile(path.join(target, '한글.yaml'), '원문');
  await createLink(
    target,
    logical,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
});
afterEach(async () => {
  ioFailures.clear();
  await rm(temporary, { recursive: true, force: true });
});

describe('현재 OS의 실제 경로·링크와 오류 처리', () => {
  it('외부 폴더 링크를 통해 읽으면 발견 경로와 실제 범위를 구분한다', async () => {
    const selected = await resolveProjectRoot({ cwd: root });
    if (!selected.success) throw new Error('root');
    const result = await resolveWorkspacePath(
      selected.root,
      '.codocs/연결/한글.yaml',
    );
    expect(result).toMatchObject({
      success: true,
      path: path.join('.codocs', '연결', '한글.yaml'),
      realPath: path.join(target, '한글.yaml'),
      scope: { logicalPath: logical, realPath: target },
      links: [{ targetPath: target, confirmed: true }],
    });
  });
  it('링크 뒤 상위 이동으로 범위를 벗어나면 거부한다', async () => {
    const selected = await resolveProjectRoot({ cwd: root });
    if (!selected.success) throw new Error('root');
    expect(
      await resolveWorkspacePath(selected.root, '.codocs/연결/../비밀.yaml'),
    ).toMatchObject({ success: false, status: 'denied' });
  });
  it.each(['EACCES', 'EPERM'])(
    '%s를 받으면 원래 IO 원인을 보존한다',
    async (code) => {
      const selected = await resolveProjectRoot({ cwd: root });
      if (!selected.success) throw new Error('root');
      ioFailures.set(logical, { operations: ['lstat'], code });
      expect(
        await resolveWorkspacePath(selected.root, '.codocs/연결/한글.yaml'),
      ).toMatchObject({
        success: false,
        status: 'unavailable',
        diagnostics: [{ ioCode: code }],
      });
    },
  );
  it('실제 링크 대상이 삭제되면 끊어진 링크와 원인을 보존한다', async () => {
    const selected = await resolveProjectRoot({ cwd: root });
    if (!selected.success) throw new Error('root');
    await rm(target, { recursive: true });
    expect(
      await resolveWorkspacePath(selected.root, '.codocs/연결/한글.yaml'),
    ).toMatchObject({
      success: false,
      status: 'unavailable',
      links: [{ targetPath: target, confirmed: false }],
      diagnostics: [{ ioCode: 'ENOENT' }],
    });
  });
});
