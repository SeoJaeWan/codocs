import { chmod, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagnosticSeverities } from '@codocs/core';
import { resolveProjectRoot, type ProjectRoot } from '../project-root/index.js';
import { calculateRevision } from '../revision/index.js';
import {
  createTempCodocsProject,
  failingLink,
  failingMkdir,
  failingRename,
  failingRmdir,
  failingUnlink,
  snapshotProjectTree,
  writeProjectTree,
} from '../test-support/storage-faults.js';
import {
  applyWorkspaceFileBatch,
  checkWorkspaceFileBatch,
  workspaceFileOperationKinds,
  workspaceFileStates,
  type WorkspaceFileOperation,
} from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

let dir: string;
let root: ProjectRoot;
const a = '_codocs:\n  id: a\n  name: A\ndefinition: 가\n';
const b = '_codocs:\n  id: b\n  name: B\ndefinition: 나\n';
const c = '_codocs:\n  id: c\n  name: C\ndefinition: 다\n';
const created = '_codocs:\n  id: n\n  name: N\ndefinition: 새\n';
const revision = (text: string): string => calculateRevision(Buffer.from(text));

/** 기존 파일을 새 내용으로 바꾸는 연산을 만든다. */
function replace(
  file: string,
  before: string,
  raw: string,
): WorkspaceFileOperation {
  return {
    kind: workspaceFileOperationKinds.replace,
    path: `.codocs/${file}`,
    baseRevision: revision(before),
    raw,
  };
}

/** 기존 파일을 지우는 연산을 만든다. */
function remove(file: string, before: string): WorkspaceFileOperation {
  return {
    kind: workspaceFileOperationKinds.delete,
    path: `.codocs/${file}`,
    baseRevision: revision(before),
  };
}

/** 기존 파일을 옮기는 연산을 만든다. */
function move(
  file: string,
  before: string,
  to: string,
): WorkspaceFileOperation {
  return {
    kind: workspaceFileOperationKinds.move,
    path: `.codocs/${file}`,
    baseRevision: revision(before),
    toPath: `.codocs/${to}`,
  };
}

/** 새 파일을 만드는 연산을 만든다. */
function create(file: string, raw: string): WorkspaceFileOperation {
  return {
    kind: workspaceFileOperationKinds.create,
    path: `.codocs/${file}`,
    raw,
  };
}

/** 프로젝트 안의 파일 내용을 읽는다. */
async function read(name: string): Promise<string> {
  return readFile(path.join(dir, '.codocs', ...name.split('/')), 'utf8');
}

beforeEach(async () => {
  dir = await createTempCodocsProject('codocs-storage-batch-');
  const resolved = await resolveProjectRoot({ cwd: dir });
  if (!resolved.success)
    throw new Error('임시 프로젝트 루트를 찾지 못했습니다.');
  root = resolved.root;
  await writeProjectTree(dir, {
    '.codocs/a.yaml': a,
    '.codocs/b.yaml': b,
    '.codocs/sub/deep/c.yaml': c,
  });
});

afterEach(async () => {
  await rmWithRetry(dir, { recursive: true, force: true });
});

describe('applyWorkspaceFileBatch: 연산 반영', () => {
  it('create·replace·delete·move를 입력 순서대로 반영하고 항목별 상태와 revision을 돌려준다', async () => {
    const result = await applyWorkspaceFileBatch(root, [
      create('new/n.yaml', created),
      replace('a.yaml', a, 'a2\n'),
      remove('b.yaml', b),
      move('sub/deep/c.yaml', c, 'moved.yaml'),
    ]);

    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      diagnostics: [],
      operations: [
        {
          index: 0,
          kind: 'create',
          state: 'changed',
          revision: revision(created),
        },
        {
          index: 1,
          kind: 'replace',
          state: 'changed',
          revision: revision('a2\n'),
        },
        { index: 2, kind: 'delete', state: 'changed' },
        {
          index: 3,
          kind: 'move',
          toPath: '.codocs/moved.yaml',
          state: 'changed',
          revision: revision(c),
        },
      ],
    });
    expect(result.operations[2]).not.toHaveProperty('revision');
    expect(await read('new/n.yaml')).toBe(created);
    expect(await read('a.yaml')).toBe('a2\n');
    await expect(read('b.yaml')).rejects.toThrow();
    expect(await read('moved.yaml')).toBe(c);
    await expect(read('sub/deep/c.yaml')).rejects.toThrow();
  });

  it('create가 없는 폴더를 만들고 임시 파일을 남기지 않는다', async () => {
    await applyWorkspaceFileBatch(root, [create('x/y/n.yaml', created)]);

    expect(await readdir(path.join(dir, '.codocs', 'x', 'y'))).toEqual([
      'n.yaml',
    ]);
    expect((await readdir(path.join(dir, '.codocs'))).sort()).toEqual([
      'a.yaml',
      'b.yaml',
      'sub',
      'x',
    ]);
  });

  it('연산이 없으면 아무것도 저장하지 않은 성공으로 돌려준다', async () => {
    expect(await applyWorkspaceFileBatch(root, [])).toMatchObject({
      success: true,
      saved: false,
      changed: false,
      operations: [],
    });
  });

  it('create가 이미 있는 파일을 덮어쓰지 않고 file_exists로 거절한다', async () => {
    const result = await applyWorkspaceFileBatch(root, [create('a.yaml', 'x')]);

    expect(result).toMatchObject({
      success: false,
      saved: false,
      diagnostics: [{ code: 'file_exists', path: '.codocs/a.yaml' }],
    });
    expect(await read('a.yaml')).toBe(a);
  });
});

describe('사전 검사', () => {
  it('두 대상의 revision이 모두 다르면 두 경로 모두 revision_conflict로 알리고 파일을 그대로 둔다', async () => {
    await writeFile(path.join(dir, '.codocs', 'a.yaml'), 'ext-a\n');
    await writeFile(path.join(dir, '.codocs', 'b.yaml'), 'ext-b\n');
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(root, [
      replace('a.yaml', a, 'x'),
      remove('b.yaml', b),
    ]);

    expect(result.success).toBe(false);
    expect(result.saved).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'revision_conflict',
        path: '.codocs/a.yaml',
      }),
      expect.objectContaining({
        code: 'revision_conflict',
        path: '.codocs/b.yaml',
      }),
    ]);
    expect(result.operations.map((item) => item.state)).toEqual([
      'unchanged',
      'unchanged',
    ]);
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('하나라도 실패하면 유효한 앞 연산도 반영하지 않고 새 폴더도 만들지 않는다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(root, [
      create('fresh/n.yaml', created),
      replace('a.yaml', a, 'a2\n'),
      replace('b.yaml', 'old\n', 'x'),
    ]);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'revision_conflict',
        path: '.codocs/b.yaml',
      }),
    ]);
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('move 대상 경로에 이미 파일이 있으면 file_exists로 알리고 아무것도 바꾸지 않는다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(root, [
      move('a.yaml', a, 'b.yaml'),
    ]);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'file_exists', path: '.codocs/b.yaml' }),
    ]);
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('원본이 UTF-8로 손실 없이 읽히지 않으면 source_not_lossless로 거절한다', async () => {
    const invalid = Buffer.from([0xff, 0xfe, 0x41]);
    await writeFile(path.join(dir, '.codocs', 'a.yaml'), invalid);
    const result = await applyWorkspaceFileBatch(root, [
      {
        kind: workspaceFileOperationKinds.replace,
        path: '.codocs/a.yaml',
        baseRevision: calculateRevision(invalid),
        raw: 'x',
      },
    ]);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: expect.stringContaining('lossless') as string,
        path: '.codocs/a.yaml',
      }),
    ]);
    expect(await readFile(path.join(dir, '.codocs', 'a.yaml'))).toEqual(
      invalid,
    );
  });

  it('같은 경로를 두 연산이 다루면 반영하지 않는다', async () => {
    const result = await applyWorkspaceFileBatch(root, [
      replace('a.yaml', a, 'x'),
      remove('a.yaml', a),
    ]);

    expect(result.success).toBe(false);
    expect(await read('a.yaml')).toBe(a);
  });

  it('checkWorkspaceFileBatch는 파일과 폴더를 바꾸지 않고 검사 결과만 돌려준다', async () => {
    const before = await snapshotProjectTree(dir);

    expect(
      await checkWorkspaceFileBatch(root, [create('new/n.yaml', created)]),
    ).toEqual({ success: true });
    expect(
      await checkWorkspaceFileBatch(root, [replace('a.yaml', 'old', 'x')]),
    ).toMatchObject({ success: false });
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('반영 직전 일괄 재확인이 진단을 돌려주면 아무것도 바꾸지 않는다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(
      root,
      [replace('a.yaml', a, 'x'), create('new/n.yaml', created)],
      {
        beforeBatchApply: () =>
          Promise.resolve([
            {
              code: 'revision_conflict',
              severity: diagnosticSeverities.error,
              message: '재확인 실패',
            },
          ]),
      },
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ message: '재확인 실패' }),
    ]);
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });
});

describe('비게 된 폴더 제거', () => {
  it('삭제와 이동으로 빈 하위 폴더는 .codocs 바로 아래까지 제거하고 원래 빈 폴더와 .codocs는 남긴다', async () => {
    await writeProjectTree(dir, {
      '.codocs/empty-before/': '',
      '.codocs/keep/other/x.yaml': 'x',
      '.codocs/keep/other/removed.yaml': a,
    });
    const result = await applyWorkspaceFileBatch(root, [
      move('sub/deep/c.yaml', c, 'c-moved.yaml'),
    ]);
    const second = await applyWorkspaceFileBatch(root, [
      remove('keep/other/removed.yaml', a),
    ]);

    expect(result.folders).toEqual([
      { path: '.codocs/sub/deep', state: 'changed' },
      { path: '.codocs/sub', state: 'changed' },
    ]);
    expect(second.folders).toEqual([]);
    const tree = await snapshotProjectTree(dir);
    expect(Object.keys(tree).sort()).toEqual([
      '.codocs',
      '.codocs/a.yaml',
      '.codocs/b.yaml',
      '.codocs/c-moved.yaml',
      '.codocs/empty-before',
      '.codocs/keep',
      '.codocs/keep/other',
      '.codocs/keep/other/x.yaml',
    ]);
  });

  it('.codocs 바로 아래 파일만 지워 .codocs가 비어도 .codocs 자체는 제거하지 않는다', async () => {
    await rmWithRetry(path.join(dir, '.codocs', 'sub'), { recursive: true });
    await rmWithRetry(path.join(dir, '.codocs', 'b.yaml'));
    const result = await applyWorkspaceFileBatch(root, [remove('a.yaml', a)]);

    expect(result.success).toBe(true);
    expect(await readdir(path.join(dir, '.codocs'))).toEqual([]);
  });

  it('폴더를 지우는 시점에 다른 파일이 생겼으면 그 폴더를 지우지 않는다', async () => {
    const result = await applyWorkspaceFileBatch(
      root,
      [remove('sub/deep/c.yaml', c)],
      {
        operations: {
          readdir: async (target) => {
            if (target.endsWith('deep'))
              await writeFile(path.join(target, 'late.yaml'), 'late');
            return readdir(target);
          },
        },
      },
    );

    expect(result).toMatchObject({ success: true, folders: [] });
    expect(
      await readFile(
        path.join(dir, '.codocs', 'sub', 'deep', 'late.yaml'),
        'utf8',
      ),
    ).toBe('late');
  });
});

describe('중간 실패의 역순 복구', () => {
  it('두 번째 연산 반영이 실패하면 첫 연산을 복구하고 파일과 폴더를 원래대로 둔다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(
      root,
      [replace('a.yaml', a, 'a2\n'), create('x/n.yaml', created)],
      {
        operations: {
          link: failingLink((target) => target.endsWith('n.yaml')),
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      operations: [
        { state: 'restored', revision: revision(a) },
        { state: 'unchanged' },
      ],
      diagnostics: [
        { code: 'file_write_failed', path: '.codocs/x/n.yaml', ioCode: 'EIO' },
      ],
    });
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('삭제를 복구하면 원본 바이트와 권한으로 다시 만들고 비웠던 폴더도 되살린다', async () => {
    await chmod(path.join(dir, '.codocs', 'sub', 'deep', 'c.yaml'), 0o640);
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(
      root,
      [remove('sub/deep/c.yaml', c), replace('a.yaml', a, 'a2\n')],
      { operations: { rename: failingRename(() => true) } },
    );

    expect(result).toMatchObject({
      success: false,
      saved: false,
      operations: [{ state: 'restored' }, { state: 'unchanged' }],
    });
    expect(await snapshotProjectTree(dir)).toEqual(before);
    if (process.platform !== 'win32')
      expect(
        (await stat(path.join(dir, '.codocs', 'sub', 'deep', 'c.yaml'))).mode &
          0o777,
      ).toBe(0o640);
  });

  it('이동을 복구하면 원래 경로로 되돌리고 이번에 만든 폴더를 제거한다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(
      root,
      [move('a.yaml', a, 'moved/dir/a.yaml'), replace('b.yaml', b, 'b2\n')],
      { operations: { rename: failingRename(() => true) } },
    );

    expect(result.operations.map((item) => item.state)).toEqual([
      'restored',
      'unchanged',
    ]);
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('create를 복구하면 이번에 만든 파일과 폴더를 제거한다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(
      root,
      [create('p/q/n.yaml', created), replace('a.yaml', a, 'a2\n')],
      { operations: { rename: failingRename(() => true) } },
    );

    expect(result.operations.map((item) => item.state)).toEqual([
      'restored',
      'unchanged',
    ]);
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('폴더 제거가 실패하면 반영한 연산을 모두 되돌린다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(
      root,
      [move('sub/deep/c.yaml', c, 'c2.yaml'), replace('a.yaml', a, 'a2\n')],
      {
        operations: { rmdir: failingRmdir((target) => target.endsWith('sub')) },
      },
    );

    expect(result).toMatchObject({
      success: false,
      saved: false,
      operations: [{ state: 'restored' }, { state: 'restored' }],
      folders: [{ path: '.codocs/sub/deep', state: 'restored' }],
    });
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('복구까지 실패하면 restore_failed와 saved:true, write_restore_failed 진단과 원인 진단을 돌려준다', async () => {
    const result = await applyWorkspaceFileBatch(
      root,
      [replace('a.yaml', a, 'a2\n'), create('x/n.yaml', created)],
      {
        operations: {
          link: failingLink((target) => target.endsWith('n.yaml')),
          rename: failingRename((_target, call) => call >= 2),
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      saved: true,
      changed: true,
      operations: [
        { state: 'restore_failed', revision: revision('a2\n') },
        { state: 'unchanged' },
      ],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'write_restore_failed',
        path: '.codocs/a.yaml',
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'file_write_failed', ioCode: 'EIO' }),
    );
    expect(await read('a.yaml')).toBe('a2\n');
  });

  it('복구 시점에 만든 파일을 다른 곳에서 바꿨으면 지우지 않고 restore_failed로 남긴다', async () => {
    const result = await applyWorkspaceFileBatch(
      root,
      [create('n.yaml', created), replace('a.yaml', a, 'a2\n')],
      {
        operations: {
          rename: async () => {
            await writeFile(path.join(dir, '.codocs', 'n.yaml'), 'external');
            throw Object.assign(new Error('EIO'), { code: 'EIO' });
          },
        },
      },
    );

    expect(result.operations.map((item) => item.state)).toEqual([
      'restore_failed',
      'unchanged',
    ]);
    expect(result).toMatchObject({ saved: true });
    expect(await read('n.yaml')).toBe('external');
  });

  it('복구 시점에 원래 경로에 다른 파일이 생겼으면 덮어쓰지 않고 restore_failed로 남긴다', async () => {
    const result = await applyWorkspaceFileBatch(
      root,
      [remove('a.yaml', a), replace('b.yaml', b, 'b2\n')],
      {
        operations: {
          rename: async () => {
            await writeFile(path.join(dir, '.codocs', 'a.yaml'), 'external');
            throw Object.assign(new Error('EIO'), { code: 'EIO' });
          },
        },
      },
    );

    expect(result.operations.map((item) => item.state)).toEqual([
      'restore_failed',
      'unchanged',
    ]);
    expect(await read('a.yaml')).toBe('external');
  });

  it('이동 복구가 원래 경로를 되살리지 못하면 restore_failed로 남기고 새 경로 파일을 지우지 않는다', async () => {
    const result = await applyWorkspaceFileBatch(
      root,
      [move('a.yaml', a, 'a-new.yaml'), replace('b.yaml', b, 'b2\n')],
      {
        operations: {
          rename: failingRename(() => true),
          link: failingLink((target) => target.endsWith('a.yaml')),
        },
      },
    );

    expect(result.operations[0]).toMatchObject({
      state: 'restore_failed',
      revision: revision(a),
    });
    expect(await read('a-new.yaml')).toBe(a);
  });

  it('원래 경로 unlink가 실패한 이동은 새 경로의 링크를 지워 원상으로 둔다', async () => {
    const before = await snapshotProjectTree(dir);
    const result = await applyWorkspaceFileBatch(
      root,
      [move('a.yaml', a, 'new/a2.yaml')],
      {
        operations: {
          unlink: failingUnlink((target) => path.basename(target) === 'a.yaml'),
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      saved: false,
      operations: [{ state: 'unchanged' }],
    });
    expect(await snapshotProjectTree(dir)).toEqual(before);
  });

  it('폴더 복구가 실패하면 그 폴더와 그 안에 되살릴 파일을 restore_failed로 보고한다', async () => {
    const result = await applyWorkspaceFileBatch(
      root,
      [remove('sub/deep/c.yaml', c)],
      {
        operations: {
          rmdir: failingRmdir((target) => target.endsWith('sub')),
          mkdir: failingMkdir(() => true),
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      saved: true,
      changed: true,
      operations: [{ state: 'restore_failed' }],
      folders: [{ path: '.codocs/sub/deep', state: 'restore_failed' }],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'write_restore_failed' }),
    );
  });
});

describe('공유 상태 상수', () => {
  it('이름 변경과 파일 반영이 같은 상태 값을 공유한다', async () => {
    const { workspaceRenameFileStates } = await import('../rename/index.js');

    expect(workspaceRenameFileStates).toBe(workspaceFileStates);
  });
});
