import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLink } from '../test-support/links.js';
import { loadWorkspace } from '../loader/index.js';
import {
  saveWorkspaceChange,
  type WorkspaceStorageFileHandle,
} from './index.js';
import {
  renameWithRetry,
  rmWithRetry,
} from '../../../../tools/test/support/retrying-fs.js';

let root: string;
let folder: string;
let originalFile: string;
const original =
  '# 원문 주석\r\n_codocs:\r\n  id: first\r\n  name: 첫 문서\r\ndefinition: 설명\r\n';
const document = {
  _codocs: { id: 'created', name: '새 문서' },
  definition: '설명',
};

/** 실제 원문 바이트의 SHA-256을 독립적으로 계산한다. */
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 실패 연산에 실제 시스템 코드 형태를 부여한다. */
function ioError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** 실제 프로젝트의 현재 관측에서 update 요청을 만든다. */
async function updateRequest(
  set: Record<string, unknown> = { definition: '바뀐 설명' },
) {
  const scan = await loadWorkspace({ cwd: root });
  const source = scan.documents.find(
    (item) => item.source.path === path.join('.codocs', 'first.yaml'),
  );
  return {
    scan,
    input: { mode: 'update', id: 'first', revision: source?.revision, set },
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-storage-'));
  folder = path.join(root, '.codocs');
  originalFile = path.join(folder, 'first.yaml');
  await mkdir(folder);
  await writeFile(originalFile, original);
});

afterEach(async () => {
  await rmWithRetry(root, { recursive: true, force: true });
});

describe('saveWorkspaceChange: 실제 파일에 단일 문서 반영', () => {
  it('create가 없는 부모를 만들면 후보 바이트와 revision을 그대로 저장한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    let sawTemp = false;
    const result = await saveWorkspaceChange(
      { mode: 'create', path: '.codocs/new/nested/created.yaml', document },
      scan,
      {
        beforeApply: async () => {
          const entries = await readdir(path.join(folder, 'new', 'nested'));
          sawTemp = entries.some((name) => name.startsWith('.codocs-write-'));
          const fresh = await loadWorkspace({ cwd: root });
          expect(fresh.documents.map((item) => item.source.path)).not.toContain(
            path.join('.codocs', 'new', 'nested', 'created.yaml'),
          );
        },
      },
    );
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      id: 'created',
    });
    if (!result.success) return;
    const bytes = await readFile(
      path.join(folder, 'new', 'nested', 'created.yaml'),
    );
    expect(bytes.toString()).toBe(
      '_codocs:\n  id: created\n  name: 새 문서\ndefinition: 설명\n',
    );
    expect(result.revision).toBe(sha256(bytes));
    expect(sawTemp).toBe(true);
    expect(await readdir(path.join(folder, 'new', 'nested'))).toEqual([
      'created.yaml',
    ]);
  });

  it('.codocs 자체가 없으면 허용 경계에 만들어 새 문서를 등록한다', async () => {
    await rmWithRetry(folder, { recursive: true });
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(
      { mode: 'create', path: '.codocs/created.yaml', document },
      scan,
    );
    expect(result).toMatchObject({ success: true, saved: true, changed: true });
    expect(await readFile(path.join(folder, 'created.yaml'), 'utf8')).toContain(
      'id: created',
    );
  });

  it('update가 앞 주석과 CRLF를 보존해 반영한다', async () => {
    const { scan, input } = await updateRequest({
      _codocs: { id: 'renamed', name: '첫 문서' },
    });
    const result = await saveWorkspaceChange(input, scan);
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      id: 'renamed',
    });
    if (!result.success) return;
    const bytes = await readFile(originalFile);
    expect(bytes.toString()).toContain('# 원문 주석\r\n');
    expect(bytes.toString()).toContain('id: renamed\r\n');
    expect(result.revision).toBe(sha256(bytes));
  });

  it('검증된 무변경이면 파일과 임시 파일을 쓰지 않는다', async () => {
    const { scan } = await updateRequest();
    const source = scan.documents.find(
      (item) => item.source.path === path.join('.codocs', 'first.yaml'),
    );
    const result = await saveWorkspaceChange(
      {
        mode: 'update',
        id: 'first',
        revision: source?.revision,
        set: { _codocs: { id: 'first', name: '첫 문서' } },
      },
      scan,
    );
    expect(result).toMatchObject({
      success: true,
      saved: false,
      changed: false,
    });
    expect(await readFile(originalFile, 'utf8')).toBe(original);
    expect(await readdir(folder)).toEqual(['first.yaml']);
  });

  it('임시 기록 실패와 닫기 실패가 원본을 보존하고 요청 임시 파일을 정리한다', async () => {
    for (const failing of ['write', 'close']) {
      const { scan, input } = await updateRequest();
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          open: async (
            target,
            flags,
            mode,
          ): Promise<WorkspaceStorageFileHandle> => {
            const handle = await open(target, flags, mode);
            return {
              writeFile: async (...args) => {
                if (failing === 'write') {
                  await handle.writeFile(Buffer.from('partial'));
                  throw ioError('EIO');
                }
                return handle.writeFile(...args);
              },
              sync: () => handle.sync(),
              stat: handle.stat.bind(handle),
              close: async () => {
                await handle.close();
                if (failing === 'close') throw ioError('EIO');
              },
            };
          },
        },
      });
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'file_write_failed',
        ioCode: 'EIO',
      });
      expect(await readFile(originalFile, 'utf8')).toBe(original);
      expect(await readdir(folder)).toEqual(['first.yaml']);
    }
  });

  it('rename 실패가 원본을 보존하고 원래 IO 오류를 반환한다', async () => {
    const { scan, input } = await updateRequest();
    const result = await saveWorkspaceChange(input, scan, {
      operations: {
        rename: () => Promise.reject(ioError('EACCES')),
      },
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(result.diagnostics[0]).toMatchObject({
      code: 'file_write_failed',
      ioCode: 'EACCES',
    });
    expect(await readFile(originalFile, 'utf8')).toBe(original);
    expect(await readdir(folder)).toEqual(['first.yaml']);
  });

  it('임시 파일 생성 권한 오류가 원본을 보존하고 IO 코드를 전달한다', async () => {
    const { scan, input } = await updateRequest();
    const result = await saveWorkspaceChange(input, scan, {
      operations: { open: () => Promise.reject(ioError('EACCES')) },
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(result.diagnostics[0]).toMatchObject({
      code: 'file_write_failed',
      ioCode: 'EACCES',
    });
    expect(await readFile(originalFile, 'utf8')).toBe(original);
    expect(await readdir(folder)).toEqual(['first.yaml']);
  });

  it('대상 선검사 뒤 다른 생성이 끼어도 하드링크가 덮어쓰지 않는다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const target = path.join(folder, 'created.yaml');
    const result = await saveWorkspaceChange(
      { mode: 'create', path: '.codocs/created.yaml', document },
      scan,
      {
        operations: {
          link: async (source, destination) => {
            await writeFile(target, 'other process');
            await link(source, destination);
          },
        },
      },
    );
    expect(result).toMatchObject({ success: false, saved: false });
    expect(result.diagnostics[0]).toMatchObject({
      code: 'file_exists',
      ioCode: 'EEXIST',
    });
    expect(await readFile(target, 'utf8')).toBe('other process');
    expect(await readdir(folder)).toEqual(['created.yaml', 'first.yaml']);
  });

  it('대상에 같은 ID의 문서가 먼저 생기면 file_exists를 반환한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const target = path.join(folder, 'created.yaml');
    const source =
      '_codocs:\n  id: created\n  name: 다른 생성\ndefinition: 설명\n';
    const result = await saveWorkspaceChange(
      { mode: 'create', path: '.codocs/created.yaml', document },
      scan,
      {
        beforeApply: async () => {
          await writeFile(target, source);
        },
      },
    );
    expect(result).toMatchObject({ success: false, saved: false });
    expect(result.diagnostics[0]).toMatchObject({ code: 'file_exists' });
    expect(await readFile(target, 'utf8')).toBe(source);
  });

  it('주석 한 바이트가 뒤늦게 바뀌면 revision_conflict로 차단한다', async () => {
    const { scan, input } = await updateRequest();
    const changed = original.replace('원문 주석', '사람의 주석');
    const result = await saveWorkspaceChange(input, scan, {
      beforeApply: async () => {
        await writeFile(originalFile, changed);
      },
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(result.diagnostics[0]).toMatchObject({ code: 'revision_conflict' });
    expect(await readFile(originalFile, 'utf8')).toBe(changed);
  });

  it('저장 직전 작업 폴더가 정션으로 바뀌면 외부 파일을 변경하지 않는다', async () => {
    const { scan, input } = await updateRequest();
    const external = path.join(root, 'external');
    const moved = path.join(root, '.codocs-moved');
    await mkdir(external);
    await writeFile(path.join(external, 'first.yaml'), 'outside');
    const result = await saveWorkspaceChange(input, scan, {
      beforeApply: async () => {
        await renameWithRetry(folder, moved);
        await createLink(external, folder, 'junction');
      },
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(result.diagnostics[0]).toMatchObject({
      code: 'unsupported_workspace_link',
    });
    expect(await readFile(path.join(external, 'first.yaml'), 'utf8')).toBe(
      'outside',
    );
    expect(await readFile(path.join(moved, 'first.yaml'), 'utf8')).toBe(
      original,
    );
  });

  it('늦게 추가된 동일 ID 문서가 있으면 파일을 저장하지 않는다', async () => {
    const { scan, input } = await updateRequest({
      _codocs: { id: 'new-id', name: '첫 문서' },
    });
    const result = await saveWorkspaceChange(input, scan, {
      beforeApply: async () => {
        await writeFile(
          path.join(folder, 'other.yaml'),
          '_codocs:\n  id: new-id\n  name: 충돌\ndefinition: 설명\n',
        );
      },
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(result.diagnostics[0]).toMatchObject({ code: 'duplicate_id' });
    expect(await readFile(originalFile, 'utf8')).toBe(original);
  });

  it('저장 전 부모가 정션으로 바뀌면 정션 밖에 쓰지 않는다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const external = await mkdtemp(
      path.join(tmpdir(), 'codocs-storage-outside-'),
    );
    try {
      await createLink(external, path.join(folder, 'linked'), 'junction');
      const result = await saveWorkspaceChange(
        { mode: 'create', path: '.codocs/linked/created.yaml', document },
        scan,
      );
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'unsupported_workspace_link',
      });
      expect(await readdir(external)).toEqual([]);
    } finally {
      await rmWithRetry(external, { recursive: true, force: true });
    }
  });

  it('임시 파일의 부모가 정션으로 바뀌면 다른 요청의 같은 이름 파일을 정리하지 않는다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const parent = path.join(folder, 'nested');
    const moved = path.join(folder, 'moved');
    const external = await mkdtemp(
      path.join(tmpdir(), 'codocs-storage-other-'),
    );
    let otherTemp = '';
    try {
      const result = await saveWorkspaceChange(
        { mode: 'create', path: '.codocs/nested/created.yaml', document },
        scan,
        {
          beforeApply: async () => {
            const ownedName = (await readdir(parent)).find((item) =>
              item.startsWith('.codocs-write-'),
            );
            expect(ownedName).toBeDefined();
            otherTemp = path.join(external, ownedName!);
            await renameWithRetry(parent, moved);
            await writeFile(otherTemp, 'another request');
            await createLink(external, parent, 'junction');
          },
        },
      );
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics.map((item) => item.code)).toContain(
        'unsupported_workspace_link',
      );
      expect(result.diagnostics.map((item) => item.code)).toContain(
        'file_write_failed',
      );
      expect(await readFile(otherTemp, 'utf8')).toBe('another request');
      expect(
        (await readdir(moved)).some((item) =>
          item.startsWith('.codocs-write-'),
        ),
      ).toBe(true);
    } finally {
      await rmWithRetry(external, { recursive: true, force: true });
    }
  });

  it('반영 뒤 임시 정리 실패는 저장 성공과 후속 진단을 함께 반환한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(
      { mode: 'create', path: '.codocs/created.yaml', document },
      scan,
      {
        operations: {
          unlink: () => Promise.reject(ioError('EACCES')),
        },
      },
    );
    expect(result).toMatchObject({ success: true, saved: true, changed: true });
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'file_write_failed',
      ioCode: 'EACCES',
    });
    expect(await readFile(path.join(folder, 'created.yaml'), 'utf8')).toContain(
      'id: created',
    );
    expect(
      (await readdir(folder)).filter((name) =>
        name.startsWith('.codocs-write-'),
      ),
    ).toHaveLength(1);
  });

  it('반영 전 오류의 정리도 실패하면 첫 원인을 유지한다', async () => {
    const { scan, input } = await updateRequest();
    const result = await saveWorkspaceChange(input, scan, {
      operations: {
        rename: () => Promise.reject(ioError('EPERM')),
        unlink: () => Promise.reject(ioError('EACCES')),
      },
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(
      result.diagnostics.map((item) =>
        'ioCode' in item ? item.ioCode : undefined,
      ),
    ).toEqual(['EPERM', 'EACCES']);
    expect(await readFile(originalFile, 'utf8')).toBe(original);
  });
});
