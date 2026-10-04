import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
  type WorkspaceQuerySessionOptions,
} from '../query/index.js';

let root: string;
let source: string;
let sessions: WorkspaceQuerySession[];
const original =
  'id: first\nname: 첫 문서\ndomains: [업무]\ndefinition: "[[둘째 문서]]"\ndeprecatedAliases:\n  - id: old-first\n    message: 유지할 안내\n';

/** 저장 테스트마다 실제 프로젝트와 세션을 새로 소유한다. */
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-write-'));
  await mkdir(path.join(root, '.codocs'));
  source = path.join(root, '.codocs', 'first.yaml');
  await writeFile(source, original);
  await writeFile(
    path.join(root, '.codocs', 'second.yaml'),
    'id: second\nname: 둘째 문서\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n',
  );
  sessions = [];
});

afterEach(async () => {
  await Promise.all(sessions.map((session) => session.close()));
  await rm(root, { recursive: true, force: true });
});

/** 선택적 실제 IO 실패 지점 외에는 프로젝트 파일을 그대로 사용한다. */
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

/** 현재 파일에서 독립적으로 계산한 저장 요청 revision이다. */
function revision(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('WorkspaceQuerySession.write 실제 IO', () => {
  it('ID와 이전 ID를 한 파일에 반영하고 저장 직후 참조·진단·목록을 게시한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { id: 'renamed', definition: '새 설명' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
      id: 'renamed',
    });
    if (!result.success) return;
    const bytes = await readFile(source);
    expect(result.revision).toBe(revision(bytes));
    expect(bytes.toString()).toContain('id: renamed');
    expect(bytes.toString()).toContain('id: first');
    expect(bytes.toString()).toContain('id: old-first');
    expect(bytes.toString()).toContain('message: 유지할 안내');
    const fetched = await current.get(['renamed', 'first']);
    expect(fetched).toMatchObject({
      success: true,
      results: [{ found: true, revision: result.revision }, { found: false }],
    });
    expect(await current.match('first old-first')).toMatchObject({
      success: true,
      candidates: [{ id: 'renamed' }],
    });
    const listed = await current.list();
    expect(listed).toMatchObject({ success: true, totalCount: 2 });
    const diagnostics = await current.diagnostics();
    expect(diagnostics.scanStatus).toBe('complete');
    expect(
      diagnostics.documents.find((item) => item.path.endsWith('first.yaml'))
        ?.text,
    ).toContain('id: renamed');
  });

  it('수정 요청의 name이 현재 이름과 다르면 저장하지 않고 이름 변경 도구를 안내한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { name: '다른 이름' },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'name_change_not_allowed' },
    });
    if (!result.success)
      expect(result.error.message).toContain('codocs_rename');
    expect(await readFile(source, 'utf8')).toBe(original);
  });

  it('무변경과 저장 전 충돌은 바이트를 보존하며 무변경에 색인 결과를 붙이지 않는다', async () => {
    const current = session();
    const same = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { name: '첫 문서' },
    });
    expect(same).toMatchObject({
      success: true,
      saved: false,
      changed: false,
      revision: revision(original),
    });
    expect(same).not.toHaveProperty('indexUpdated');
    const required = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      unset: ['name'],
    });
    expect(required).toMatchObject({ success: false, saved: false });
    const duplicate = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { id: 'second' },
    });
    expect(duplicate).toMatchObject({ success: false, saved: false });
    const stale = await current.write({
      mode: 'update',
      id: 'first',
      revision: 'old',
      set: { definition: '다름' },
    });
    expect(stale).toMatchObject({ success: false, saved: false });
    expect(await readFile(source, 'utf8')).toBe(original);
  });

  it('저장 IO 실패는 원본과 시스템 오류를 보존한다', async () => {
    const current = session({
      storage: {
        operations: {
          rename: () =>
            Promise.reject(
              Object.assign(new Error('거부'), { code: 'EACCES' }),
            ),
        },
      },
    });
    const result = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { definition: '수정' },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'file_write_failed', ioCode: 'EACCES' },
    });
    expect(await readFile(source, 'utf8')).toBe(original);
  });

  it('같은 도메인의 동명은 차단하고 다른 도메인의 동명은 후보 안내 없이 저장한다', async () => {
    const current = session();
    const conflicting = await current.write({
      mode: 'create',
      path: '.codocs/conflict.yaml',
      document: {
        id: 'conflict',
        name: '첫 문서',
        domains: ['업무'],
        definition: '본문',
      },
    });
    expect(conflicting).toMatchObject({ success: false, saved: false });
    expect(conflicting.diagnostics.map((item) => item.code)).toContain(
      'duplicate_name',
    );
    const allowed = await current.write({
      mode: 'create',
      path: '.codocs/allowed.yaml',
      document: {
        id: 'allowed',
        name: '첫 문서',
        domains: ['별도'],
        definition: '본문',
      },
    });
    expect(allowed).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    expect(allowed).not.toHaveProperty('sameNameCandidates');
    expect(
      await readFile(path.join(root, '.codocs', 'allowed.yaml'), 'utf8'),
    ).toContain('id: allowed');
  });

  it('저장 직전 revision 경쟁은 최신 원문을 보존하고 다시 조회하도록 안내한다', async () => {
    const changed = original.replace('유지할 안내', '사람이 수정한 안내');
    const current = session({
      storage: {
        beforeApply: async () => {
          await writeFile(source, changed);
        },
      },
    });
    const result = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { definition: '수정' },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'revision_conflict' },
    });
    if (!result.success) expect(result.error.suggestion).toContain('다시');
    expect(await readFile(source, 'utf8')).toBe(changed);
  });

  it('저장 뒤 임시 파일 정리 오류가 있어도 저장과 색인 성공을 보존한다', async () => {
    const createdPath = path.join(root, '.codocs', 'created.yaml');
    const current = session({
      storage: {
        operations: {
          unlink: () =>
            Promise.reject(
              Object.assign(new Error('정리 거부'), { code: 'EACCES' }),
            ),
        },
      },
    });
    const result = await current.write({
      mode: 'create',
      path: '.codocs/created.yaml',
      document: {
        id: 'created',
        name: '생성',
        domains: ['별도'],
        definition: '본문',
      },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    if (!result.success) return;
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'file_write_failed',
      ioCode: 'EACCES',
    });
    expect(result.revision).toBe(revision(await readFile(createdPath)));
  });

  it('과거 ID를 다시 현재 ID로 선택하면 이전 목록의 새 현재 ID를 제거한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { id: 'old-first' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
      id: 'old-first',
    });
    const text = await readFile(source, 'utf8');
    expect(text).toContain('id: old-first');
    expect(text).toContain('- id: first');
    expect(text).not.toContain('- id: old-first');
    expect(text).not.toContain('message: 유지할 안내');
  });

  it('첫 색인 오류는 저장 없이 반복하지 않고 해당 경로만 추가 복구한다', async () => {
    const attempts: number[] = [];
    const current = session({
      beforeIndexUpdate: (attempt) => {
        attempts.push(attempt);
        return attempt === 1
          ? Promise.reject(new Error('첫 관측 실패'))
          : Promise.resolve();
      },
    });
    const result = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { definition: '복구됨' },
    });
    expect(attempts).toEqual([1, 2]);
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    expect(await current.get(['first'])).toMatchObject({
      success: true,
      results: [
        { found: true, revision: result.success ? result.revision : '' },
      ],
    });
  });

  it('두 색인 오류 뒤에도 저장 revision과 진단 및 refresh 안내를 유지한다', async () => {
    const attempts: number[] = [];
    const current = session({
      beforeIndexUpdate: (attempt) => {
        attempts.push(attempt);
        return Promise.reject(new Error(`관측 ${attempt} 실패`));
      },
    });
    const result = await current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { definition: '저장됨' },
    });
    expect(attempts).toEqual([1, 2]);
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: false,
    });
    if (!result.success) return;
    expect(result.revision).toBe(revision(await readFile(source)));
    expect(result.diagnostics.at(-1)).toMatchObject({
      code: 'index_update_failed',
    });
    expect(result.diagnostics.at(-1)?.suggestion).toContain('codocs_refresh');
  });

  it('1초를 넘는 직접 게시와 복구를 실제 완료까지 기다린다', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const current = session({
      beforeIndexUpdate: async (attempt) => {
        if (attempt === 1) await pending;
      },
    });
    let settled = false;
    const operation = current
      .write({
        mode: 'update',
        id: 'first',
        revision: revision(original),
        set: { definition: '느린 저장' },
      })
      .then((value) => {
        settled = true;
        return value;
      });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(settled).toBe(false);
    finish!();
    expect(await operation).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
  });

  it('1초를 넘는 추가 복구도 실제 완료까지 기다린다', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const current = session({
      beforeIndexUpdate: async (attempt) => {
        if (attempt === 1) throw new Error('첫 관측 실패');
        await pending;
      },
    });
    let settled = false;
    const operation = current
      .write({
        mode: 'update',
        id: 'first',
        revision: revision(original),
        set: { definition: '복구 지연' },
      })
      .then((value) => {
        settled = true;
        return value;
      });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(settled).toBe(false);
    finish!();
    expect(await operation).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
  });

  it('저장 중 세션이 닫히면 종료 뒤 색인을 게시하지 않고 저장 사실을 보존한다', async () => {
    let finish: (() => void) | undefined;
    let signalEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const published: unknown[] = [];
    const current = createWorkspaceQuerySession(
      { cwd: root },
      (kind, detail) => {
        if (kind === 'index-published') published.push(detail);
      },
      {
        beforeIndexUpdate: async () => {
          signalEntered!();
          await pending;
        },
      },
    );
    sessions.push(current);
    const operation = current.write({
      mode: 'update',
      id: 'first',
      revision: revision(original),
      set: { definition: '저장됨' },
    });
    await entered;
    await current.close();
    const count = published.length;
    finish!();
    expect(await operation).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: false,
    });
    expect(published).toHaveLength(count);
  });
});
