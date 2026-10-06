import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLink } from '../test-support/links.js';
import { ioFailures } from '../test-support/file-system.js';
import { resolveProjectRoot } from '../project-root/index.js';
import { resolveWorkspacePath } from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

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
  await rmWithRetry(temporary, { recursive: true, force: true });
});

describe('현재 OS의 실제 경로·링크와 오류 처리', () => {
  it('외부 폴더 연결은 대상을 읽지 않고 거부한다', async () => {
    const selected = await resolveProjectRoot({ cwd: root });
    if (!selected.success) throw new Error('root');
    const result = await resolveWorkspacePath(
      selected.root,
      '.codocs/연결/한글.yaml',
    );
    expect(result).toMatchObject({
      success: false,
      status: 'denied',
      path: path.join('.codocs', '연결'),
      diagnostics: [{ code: 'unsupported_workspace_link' }],
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
  it('연결 대상이 삭제되어도 미지원 연결로 구분한다', async () => {
    const selected = await resolveProjectRoot({ cwd: root });
    if (!selected.success) throw new Error('root');
    await rmWithRetry(target, { recursive: true });
    expect(
      await resolveWorkspacePath(selected.root, '.codocs/연결/한글.yaml'),
    ).toMatchObject({
      success: false,
      status: 'denied',
      diagnostics: [{ code: 'unsupported_workspace_link' }],
    });
  });
});
