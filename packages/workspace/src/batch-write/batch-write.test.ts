import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectWorkspaceCodeEvidence,
  workspaceCodeEvidenceDiagnosticCodes,
} from '../code-reference/index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
  type WorkspaceQuerySessionOptions,
} from '../query/index.js';
import { calculateRevision } from '../revision/index.js';
import {
  createTempCodocsProject,
  failingLink,
  failingUnlink,
  snapshotProjectTree,
  writeProjectTree,
} from '../test-support/storage-faults.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

/** 요청의 `/` 구분 경로를 결과가 담는 OS 구분자 표기로 바꾼다. */
function native(requestPath: string): string {
  return path.join(...requestPath.split('/'));
}

let root: string;
let sessions: WorkspaceQuerySession[];

/** 프로젝트 루트 아래 문서 YAML 원문을 만든다. */
function doc(id: string, name: string, body = '본문', parent?: string): string {
  const head = `_codocs:\n  id: ${id}\n  name: ${name}\n`;
  const parentLine = parent ? `  parent:\n    - ${parent}\n` : '';
  return `${head}${parentLine}definition: ${JSON.stringify(body)}\n`;
}

/** 테스트마다 독립된 프로젝트와 세션 목록을 만든다. */
beforeEach(async () => {
  root = await createTempCodocsProject('codocs-batch-write-');
  sessions = [];
});

afterEach(async () => {
  await Promise.all(sessions.map((session) => session.close()));
  await rmWithRetry(root, { recursive: true, force: true });
});

/** 실제 프로젝트를 쓰는 세션을 연다. */
function session(
  options: WorkspaceQuerySessionOptions = {},
): WorkspaceQuerySession {
  const created = createWorkspaceQuerySession(
    { cwd: root },
    undefined,
    options,
  );
  sessions.push(created);
  return created;
}

/** 파일의 현재 revision을 독립적으로 계산한다. */
async function revisionOf(relative: string): Promise<string> {
  return calculateRevision(await readFile(path.join(root, relative)));
}

/** 프로젝트 파일이 존재하는지 확인한다. */
async function exists(relative: string): Promise<boolean> {
  try {
    await stat(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

describe('세션 write의 changes 저장', () => {
  it('A 생성과 B·C 수정을 한 번에 저장하면 세 항목이 changed이고 색인에서 A 참조가 확정된다', async () => {
    await writeProjectTree(root, {
      '.codocs/b.yaml': doc('b', '문서B'),
      '.codocs/c.yaml': doc('c', '문서C'),
    });
    const current = session();
    const result = await current.write({
      changes: [
        {
          mode: 'create',
          path: '.codocs/a.yaml',
          document: {
            _codocs: { id: 'a', name: '문서A' },
            definition: '새 문서',
          },
        },
        {
          mode: 'update',
          id: 'b',
          revision: await revisionOf('.codocs/b.yaml'),
          set: { definition: '[[문서A]] 참조' },
        },
        {
          mode: 'update',
          id: 'c',
          revision: await revisionOf('.codocs/c.yaml'),
          set: { definition: '[[문서A]] 참조' },
        },
      ],
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: true,
      changes: [
        { index: 0, mode: 'create', id: 'a', state: 'changed' },
        { index: 1, mode: 'update', id: 'b', state: 'changed' },
        { index: 2, mode: 'update', id: 'c', state: 'changed' },
      ],
    });
    if (!result.success || !('changes' in result)) return;
    expect(result.changes[0]?.revision).toBe(
      await revisionOf('.codocs/a.yaml'),
    );
    const live = await current.get(['문서A']);
    expect(live).toMatchObject({ success: true, results: [{ found: true }] });
    const validation = await current.validate();
    expect(JSON.stringify(validation)).not.toContain('reference_');
  });

  it('한 항목이 검증 오류면 아무것도 저장하지 않고 모든 파일 바이트가 그대로다', async () => {
    await writeProjectTree(root, { '.codocs/b.yaml': doc('b', '문서B') });
    const before = await snapshotProjectTree(root);
    const result = await session().write({
      changes: [
        {
          mode: 'create',
          path: '.codocs/a.yaml',
          document: { _codocs: { id: 'a', name: '문서A' }, definition: 'x' },
        },
        {
          mode: 'update',
          id: 'b',
          revision: await revisionOf('.codocs/b.yaml'),
          set: { definition: '[[없는 문서]]' },
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
    });
    expect(await snapshotProjectTree(root)).toEqual(before);
  });

  it('두 문서의 revision이 오래되면 두 경로를 모두 진단에 담고 저장하지 않는다', async () => {
    await writeProjectTree(root, {
      '.codocs/b.yaml': doc('b', '문서B'),
      '.codocs/c.yaml': doc('c', '문서C'),
    });
    const before = await snapshotProjectTree(root);
    const result = await session().write({
      changes: [
        {
          mode: 'update',
          id: 'b',
          revision: 'stale',
          set: { definition: 'x' },
        },
        {
          mode: 'update',
          id: 'c',
          revision: 'stale',
          set: { definition: 'x' },
        },
      ],
    });
    expect(result).toMatchObject({ success: false, saved: false });
    if (result.success) return;
    const paths = result.diagnostics.map((item) => item.path);
    expect(paths).toContain(native('.codocs/b.yaml'));
    expect(paths).toContain(native('.codocs/c.yaml'));
    expect(await snapshotProjectTree(root)).toEqual(before);
  });

  it('빈 changes와 중복 ID·경로와 changes 외 속성은 invalid_input으로 거절한다', async () => {
    await writeProjectTree(root, { '.codocs/b.yaml': doc('b', '문서B') });
    const current = session();
    const revision = await revisionOf('.codocs/b.yaml');
    const update = {
      mode: 'update',
      id: 'b',
      revision,
      set: { definition: 'x' },
    };
    for (const input of [
      { changes: [] },
      { changes: [update, update] },
      { changes: [update], extra: true },
      { changes: 'x' },
    ]) {
      const result = await current.write(input);
      expect(result).toMatchObject({ success: false, saved: false });
      if (result.success) continue;
      expect([JSON.stringify(input), result.error.code]).toEqual([
        JSON.stringify(input),
        'invalid_input',
      ]);
    }
    expect(await readFile(path.join(root, '.codocs/b.yaml'), 'utf8')).toBe(
      doc('b', '문서B'),
    );
  });

  it('항목의 name 변경은 name_change_not_allowed로 거절한다', async () => {
    await writeProjectTree(root, { '.codocs/b.yaml': doc('b', '문서B') });
    const result = await session().write({
      changes: [
        {
          mode: 'update',
          id: 'b',
          revision: await revisionOf('.codocs/b.yaml'),
          set: { _codocs: { id: 'b', name: '새 이름' } },
        },
      ],
    });
    expect(result).toMatchObject({ success: false, saved: false });
    if (result.success) return;
    expect(result.error.code).toBe('name_change_not_allowed');
  });

  it('변경 없는 항목만 있으면 saved:false이고 항목은 unchanged다', async () => {
    await writeProjectTree(root, { '.codocs/b.yaml': doc('b', '문서B') });
    const revision = await revisionOf('.codocs/b.yaml');
    const result = await session().write({
      changes: [
        { mode: 'update', id: 'b', revision, set: { definition: '본문' } },
      ],
    });
    expect(result).toMatchObject({
      success: true,
      saved: false,
      changed: false,
      changes: [{ id: 'b', state: 'unchanged', revision }],
    });
    if (result.success) expect(result).not.toHaveProperty('indexUpdated');
  });
});

describe('세션 write의 delete·move', () => {
  it('참조되는 문서의 delete는 reference_broken이고 참조를 함께 고치면 저장되어 색인에서 사라진다', async () => {
    await writeProjectTree(root, {
      '.codocs/a.yaml': doc('a', '문서A'),
      '.codocs/b.yaml': doc('b', '문서B', '[[문서A]]'),
    });
    const current = session();
    const revisionA = await revisionOf('.codocs/a.yaml');
    const rejected = await current.write({
      changes: [{ mode: 'delete', id: 'a', revision: revisionA }],
    });
    expect(rejected).toMatchObject({ success: false, saved: false });
    if (rejected.success) return;
    expect(rejected.error.code).toBe('reference_broken');
    expect(await exists('.codocs/a.yaml')).toBe(true);
    const saved = await current.write({
      changes: [
        { mode: 'delete', id: 'a', revision: revisionA },
        {
          mode: 'update',
          id: 'b',
          revision: await revisionOf('.codocs/b.yaml'),
          set: { definition: '참조 없음' },
        },
      ],
    });
    expect(saved).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
      changes: [
        { id: 'a', mode: 'delete', state: 'changed' },
        { id: 'b', state: 'changed' },
      ],
    });
    expect(await exists('.codocs/a.yaml')).toBe(false);
    expect(await current.get(['문서A'])).toMatchObject({
      success: true,
      results: [{ found: false }],
    });
  });

  it('코드가 @codocs로 참조하는 문서의 delete는 거절한다', async () => {
    await writeProjectTree(root, { '.codocs/a.yaml': doc('a', '문서A') });
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[문서A]]');
    const result = await session().write({
      mode: 'delete',
      id: 'a',
      revision: await revisionOf('.codocs/a.yaml'),
    });
    expect(result).toMatchObject({ success: false, saved: false });
    if (result.success) return;
    expect(result.error.code).toBe('reference_broken');
    expect(await exists('.codocs/a.yaml')).toBe(true);
  });

  it('코드 증거가 불완전하면 code_evidence_incomplete로 저장하지 않는다', async () => {
    await writeProjectTree(root, { '.codocs/a.yaml': doc('a', '문서A') });
    const result = await session({
      storage: {
        collectCodeEvidence: () =>
          Promise.resolve({
            complete: false,
            files: [],
            failures: [{ reason: 'read', message: '읽기 실패' } as never],
          }),
      },
    }).write({
      mode: 'delete',
      id: 'a',
      revision: await revisionOf('.codocs/a.yaml'),
    });
    expect(result).toMatchObject({ success: false, saved: false });
    if (result.success) return;
    expect(result.error.code).toBe(
      workspaceCodeEvidenceDiagnosticCodes.incomplete,
    );
    expect(await exists('.codocs/a.yaml')).toBe(true);
  });

  it('코드 증거는 delete가 있는 batch에서 계획마다 한 번만 수집하고 코드 영향이 없는 batch에서는 수집하지 않는다', async () => {
    await writeProjectTree(root, {
      '.codocs/a.yaml': doc('a', '문서A'),
      '.codocs/b.yaml': doc('b', '문서B'),
      '.codocs/c.yaml': doc('c', '문서C'),
    });
    const collect = vi.fn(collectWorkspaceCodeEvidence);
    const current = session({ storage: { collectCodeEvidence: collect } });
    await current.write({
      changes: [
        {
          mode: 'update',
          id: 'b',
          revision: await revisionOf('.codocs/b.yaml'),
          set: { definition: 'x' },
        },
      ],
    });
    expect(collect).not.toHaveBeenCalled();
    const result = await current.write({
      changes: [
        {
          mode: 'delete',
          id: 'a',
          revision: await revisionOf('.codocs/a.yaml'),
        },
        {
          mode: 'delete',
          id: 'c',
          revision: await revisionOf('.codocs/c.yaml'),
        },
      ],
    });
    expect(result).toMatchObject({ success: true, saved: true });
    // 항목 수와 관계없이 최초 계획 1회와 반영 직전 재계획 1회다.
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('move는 같은 ID·이름과 참조를 유지하고 옛 경로를 색인에서 지우며 단일 결과에 previousPath를 담는다', async () => {
    await writeProjectTree(root, {
      '.codocs/a.yaml': doc('a', '문서A'),
      '.codocs/b.yaml': doc('b', '문서B', '[[문서A]]'),
    });
    const current = session();
    const revision = await revisionOf('.codocs/a.yaml');
    const result = await current.write({
      mode: 'move',
      id: 'a',
      revision,
      path: '.codocs/moved/a.yaml',
    });
    expect(result).toEqual({
      success: true,
      saved: true,
      changed: true,
      id: 'a',
      source: { path: native('.codocs/moved/a.yaml') },
      revision,
      previousPath: native('.codocs/a.yaml'),
      warnings: [],
      diagnostics: [],
      indexUpdated: true,
    });
    expect(await exists('.codocs/a.yaml')).toBe(false);
    expect(await current.get(['문서A'])).toMatchObject({
      success: true,
      results: [
        { found: true, source: { path: native('.codocs/moved/a.yaml') } },
      ],
    });
    expect(JSON.stringify(await current.validate())).not.toContain(
      'reference_',
    );
  });

  it('존재하는 경로로의 move는 거절하고 파일을 바꾸지 않는다', async () => {
    await writeProjectTree(root, {
      '.codocs/a.yaml': doc('a', '문서A'),
      '.codocs/b.yaml': doc('b', '문서B'),
    });
    const before = await snapshotProjectTree(root);
    const result = await session().write({
      mode: 'move',
      id: 'a',
      revision: await revisionOf('.codocs/a.yaml'),
      path: '.codocs/b.yaml',
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(await snapshotProjectTree(root)).toEqual(before);
  });

  it('단일 delete 결과는 기존 단일 형태이고 revision이 없다', async () => {
    await writeProjectTree(root, { '.codocs/a.yaml': doc('a', '문서A') });
    const result = await session().write({
      mode: 'delete',
      id: 'a',
      revision: await revisionOf('.codocs/a.yaml'),
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      id: 'a',
      source: { path: native('.codocs/a.yaml') },
      indexUpdated: true,
    });
    expect(result).not.toHaveProperty('revision');
    expect(result).not.toHaveProperty('previousPath');
  });

  it('delete·move로 비게 된 폴더만 .codocs 아래까지 제거하고 원래 빈 폴더는 남긴다', async () => {
    await writeProjectTree(root, {
      '.codocs/x/y/a.yaml': doc('a', '문서A'),
      '.codocs/keep/': '',
      '.codocs/other/b.yaml': doc('b', '문서B'),
    });
    const result = await session().write({
      changes: [
        {
          mode: 'delete',
          id: 'a',
          revision: await revisionOf('.codocs/x/y/a.yaml'),
        },
      ],
    });
    expect(result).toMatchObject({ success: true, saved: true });
    expect(await exists('.codocs/x')).toBe(false);
    expect(await exists('.codocs/keep')).toBe(true);
    expect(await exists('.codocs/other/b.yaml')).toBe(true);
    expect(await exists('.codocs')).toBe(true);
  });

  it('자식이 있는 문서 delete는 거절하고 같은 batch에서 자식도 지우면 저장한다', async () => {
    await writeProjectTree(root, {
      '.codocs/p.yaml': doc('p', '부모'),
      '.codocs/k.yaml': doc('k', '자식', '본문', '부모'),
    });
    const current = session();
    const revisionP = await revisionOf('.codocs/p.yaml');
    const rejected = await current.write({
      changes: [{ mode: 'delete', id: 'p', revision: revisionP }],
    });
    expect(rejected).toMatchObject({ success: false, saved: false });
    if (rejected.success) return;
    expect(rejected.diagnostics[0]).toMatchObject({
      code: 'reference_broken',
      path: native('.codocs/k.yaml'),
    });
    const saved = await current.write({
      changes: [
        { mode: 'delete', id: 'p', revision: revisionP },
        {
          mode: 'delete',
          id: 'k',
          revision: await revisionOf('.codocs/k.yaml'),
        },
      ],
    });
    expect(saved).toMatchObject({ success: true, saved: true });
  });
});

describe('세션 write의 반영 실패·경쟁', () => {
  it('두 번째 항목 반영이 실패하면 첫 항목을 restored로 되돌리고 saved:false다', async () => {
    await writeProjectTree(root, { '.codocs/b.yaml': doc('b', '문서B') });
    const before = await snapshotProjectTree(root);
    const result = await session({
      storage: {
        operations: {
          link: failingLink((target) => target.endsWith('second.yaml')),
        },
      },
    }).write({
      changes: [
        {
          mode: 'create',
          path: '.codocs/first.yaml',
          document: { _codocs: { id: 'f', name: '첫째' }, definition: 'x' },
        },
        {
          mode: 'create',
          path: '.codocs/second.yaml',
          document: { _codocs: { id: 's', name: '둘째' }, definition: 'x' },
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      changes: [{ state: 'restored' }, { state: 'unchanged' }],
    });
    expect(await snapshotProjectTree(root)).toEqual(before);
  });

  it('복구까지 실패하면 restore_failed와 write_restore_failed를 담고 saved:true이며 색인은 실제 디스크를 따른다', async () => {
    await writeProjectTree(root, { '.codocs/b.yaml': doc('b', '문서B') });
    const current = session({
      storage: {
        operations: {
          link: failingLink((target) => target.endsWith('second.yaml')),
          unlink: failingUnlink((target) => target.endsWith('first.yaml')),
        },
      },
    });
    const result = await current.write({
      changes: [
        {
          mode: 'create',
          path: '.codocs/first.yaml',
          document: { _codocs: { id: 'f', name: '첫째' }, definition: 'x' },
        },
        {
          mode: 'create',
          path: '.codocs/second.yaml',
          document: { _codocs: { id: 's', name: '둘째' }, definition: 'x' },
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      saved: true,
      changed: true,
      changes: [{ state: 'restore_failed' }, { state: 'unchanged' }],
      indexUpdated: true,
    });
    if (result.success) return;
    expect(result.diagnostics.map((item) => item.code)).toContain(
      'write_restore_failed',
    );
    expect(await exists('.codocs/first.yaml')).toBe(true);
    expect(await current.get(['첫째'])).toMatchObject({
      results: [{ found: true }],
    });
  });

  it('반영 직전 다른 문서가 바뀌면 재계획 후보가 달라져 revision_conflict로 저장하지 않는다', async () => {
    await writeProjectTree(root, {
      '.codocs/b.yaml': doc('b', '문서B'),
      '.codocs/c.yaml': doc('c', '문서C'),
    });
    const revisionB = await revisionOf('.codocs/b.yaml');
    const revisionC = await revisionOf('.codocs/c.yaml');
    const result = await session({
      storage: {
        beforeApply: async () => {
          await writeFile(
            path.join(root, '.codocs/c.yaml'),
            doc('c', '문서C', '외부 수정'),
          );
        },
      },
    }).write({
      changes: [
        {
          mode: 'update',
          id: 'b',
          revision: revisionB,
          set: { definition: '1' },
        },
        {
          mode: 'update',
          id: 'c',
          revision: revisionC,
          set: { definition: '2' },
        },
      ],
    });
    expect(result).toMatchObject({ success: false });
    if (result.success) return;
    expect(result.diagnostics.map((item) => item.code)).toContain(
      'revision_conflict',
    );
    expect(await readFile(path.join(root, '.codocs/b.yaml'), 'utf8')).toBe(
      doc('b', '문서B'),
    );
  });

  it('반영 직전 재스캔 전에 두 문서가 바뀌면 바뀐 문서를 모두 진단에 담고 저장하지 않는다', async () => {
    await writeProjectTree(root, {
      '.codocs/b.yaml': doc('b', '문서B'),
      '.codocs/c.yaml': doc('c', '문서C'),
    });
    const revisionB = await revisionOf('.codocs/b.yaml');
    const revisionC = await revisionOf('.codocs/c.yaml');
    const changedB = doc('b', '문서B', '외부 수정');
    const changedC = doc('c', '문서C', '외부 수정');
    const result = await session({
      storage: {
        beforeBatchApply: async () => {
          await writeFile(path.join(root, '.codocs/b.yaml'), changedB);
          await writeFile(path.join(root, '.codocs/c.yaml'), changedC);
        },
      },
    }).write({
      changes: [
        {
          mode: 'update',
          id: 'b',
          revision: revisionB,
          set: { definition: '1' },
        },
        {
          mode: 'update',
          id: 'c',
          revision: revisionC,
          set: { definition: '2' },
        },
      ],
    });
    expect(result).toMatchObject({ success: false, saved: false });
    if (result.success) return;
    const conflicts = result.diagnostics.filter(
      (item) =>
        item.code === 'revision_conflict' ||
        item.code === 'change_revision_mismatch',
    );
    expect(conflicts.map((item) => item.path).sort()).toEqual([
      native('.codocs/b.yaml'),
      native('.codocs/c.yaml'),
    ]);
    expect(await readFile(path.join(root, '.codocs/b.yaml'), 'utf8')).toBe(
      changedB,
    );
    expect(await readFile(path.join(root, '.codocs/c.yaml'), 'utf8')).toBe(
      changedC,
    );
  });

  it('저장 뒤 색인 게시가 실패하면 index_update_failed와 codocs_refresh 안내를 담고 저장은 유지한다', async () => {
    await writeProjectTree(root, { '.codocs/a.yaml': doc('a', '문서A') });
    const result = await session({
      beforeIndexUpdate: () => Promise.reject(new Error('색인 실패')),
    }).write({
      mode: 'delete',
      id: 'a',
      revision: await revisionOf('.codocs/a.yaml'),
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: false,
    });
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'index_update_failed',
    });
    expect(result.diagnostics.at(-1)?.suggestion).toContain('codocs_refresh');
    expect(await exists('.codocs/a.yaml')).toBe(false);
  });

  it('세션이 닫힌 뒤의 changes 저장은 단일 저장과 같이 거절한다', async () => {
    await writeProjectTree(root, { '.codocs/a.yaml': doc('a', '문서A') });
    const current = session();
    await current.close();
    const result = await current.write({
      changes: [
        {
          mode: 'delete',
          id: 'a',
          revision: await revisionOf('.codocs/a.yaml'),
        },
      ],
    });
    expect(result).toMatchObject({ success: false, saved: false });
    expect(await exists('.codocs/a.yaml')).toBe(true);
  });
});

describe('세션 write의 단일 저장 회귀', () => {
  it('단일 create는 기존 결과 형태를 유지하고 changes 필드를 담지 않는다', async () => {
    await mkdir(path.join(root, '.codocs/sub'), { recursive: true });
    const result = await session().write({
      mode: 'create',
      path: '.codocs/sub/n.yaml',
      document: { _codocs: { id: 'n', name: '새 문서' }, definition: 'x' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      id: 'n',
      source: { path: native('.codocs/sub/n.yaml') },
      indexUpdated: true,
    });
    expect(result).not.toHaveProperty('changes');
  });
});
