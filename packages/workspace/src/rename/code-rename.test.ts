import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import {
  mkdir,
  mkdtemp,
  readFile,
  rename as renameFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { extractCodeReferences } from '@codocs/core';
import { codeCollectionStatuses } from '../code-reference/domain-values.js';
import type { WorkspaceCodeRenameSources } from '../code-reference/index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
  type WorkspaceQuerySessionOptions,
} from '../query/index.js';
import { calculateRevision } from '../revision/index.js';
import { codeFileReasons } from '../code-reference/domain-values.js';
import { ioFailures } from '../test-support/file-system.js';
import { workspaceRenameFileKinds } from './domain-values.js';
import { loadWorkspace } from '../loader/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import { applyWorkspaceRename } from '../storage/index.js';
import { prepareWorkspaceRename } from './index.js';

let project: string;
let session: WorkspaceQuerySession;
/** 코드 수집을 붙잡은 테스트가 실패해도 afterEach가 수집을 풀어 세션을 닫을 수 있게 한다. */
let releaseGate: () => void = () => undefined;
const refundPath = path.join('.codocs', 'refund.yaml');
const paymentPath = path.join('.codocs', 'payment.yaml');
const refund =
  '_codocs:\n  id: refund\n  name: 환불\n환불정책: |\n  내용\n배송: |\n  내용\n';
const payment =
  '_codocs:\n  id: payment\n  name: 결제\n환불정책: |\n  다른 문서의 같은 이름 섹션\n';

/** 프로젝트에 파일을 쓴다. 키는 프로젝트 상대 경로다. */
async function writeProject(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, name)), { recursive: true });
    await writeFile(path.join(project, name), content);
  }
}

/** 프로젝트 파일의 현재 내용을 읽는다. */
async function read(name: string): Promise<string> {
  return readFile(path.join(project, name), 'utf8');
}

/** 코드 수집이 끝난 세션을 만든다. 첫 이름 변경 요청이 최초 수집을 기다린다. */
function startSession(options: WorkspaceQuerySessionOptions = {}): void {
  session = createWorkspaceQuerySession({ cwd: project }, undefined, options);
}

/** 미리보기에 성공한 결과를 돌려준다. */
async function preview(request: object) {
  const result = await session.previewRename(request);
  if (!result.success) throw new Error('미리보기가 실패했다');
  return result;
}

beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/fixtures/code-rename-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(project));
  await writeProject({
    '.codocs/refund.yaml': refund,
    '.codocs/payment.yaml': payment,
  });
});

afterEach(async () => {
  ioFailures.clear();
  releaseGate();
  releaseGate = () => undefined;
  await session?.close();
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
});

describe('코드 파일 표기를 포함한 섹션 이름 변경', () => {
  const code =
    '// @codocs [[환불:환불정책]]#L3\nconst a = 1; // @codocs [[결제:환불정책]]\n';

  it('섹션 이름 변경 미리보기에 코드 파일의 이름·섹션이 확정된 표기만 코드 변경으로 포함한다', async () => {
    await writeProject({ 'src/refund.ts': code });
    startSession();
    const result = await preview({
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    });

    expect(result.status).toBe('ready');
    expect(
      result.changes.filter(
        (item) => item.fileKind === workspaceRenameFileKinds.code,
      ),
    ).toMatchObject([
      {
        path: 'src/refund.ts',
        oldText: '환불정책',
        newText: '환불 규정',
        targetPath: refundPath,
        occurrenceIndex: 0,
        range: {
          start: { line: 0, character: 16 },
          end: { line: 0, character: 20 },
        },
      },
    ]);
    expect(result.changes.some((item) => item.path === refundPath)).toBe(true);
    expect(result.revisions['src/refund.ts']).toBe(
      calculateRevision(Buffer.from(code, 'utf8')),
    );
  });

  it('반영하면 그 문서 섹션을 가리킨 표기만 고치고 다른 문서의 같은 이름 섹션 표기와 #L3은 그대로 둔다', async () => {
    await writeProject({ 'src/refund.ts': code });
    startSession();
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    };
    const planned = await preview(request);
    const applied = await session.applyRename({
      ...request,
      revisions: planned.revisions,
    });

    expect(applied).toMatchObject({
      success: true,
      indexUpdated: true,
      files: [
        { path: refundPath, state: 'changed' },
        { path: 'src/refund.ts', state: 'changed', fileKind: 'code' },
      ],
    });
    expect(await read('src/refund.ts')).toBe(
      '// @codocs [[환불:환불 규정]]#L3\nconst a = 1; // @codocs [[결제:환불정책]]\n',
    );
    expect(await read('.codocs/refund.yaml')).toContain('환불 규정: |');
    expect(await read('.codocs/payment.yaml')).toBe(payment);
  });

  it('반영 직후 코드 색인이 새 섹션 이름의 표기를 즉시 확정한다', async () => {
    await writeProject({ 'src/refund.ts': code });
    startSession();
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    };
    const planned = await preview(request);
    await session.applyRename({ ...request, revisions: planned.revisions });

    const reverse = await session.codeReferencesForSection(
      refundPath,
      '환불 규정',
    );
    expect(reverse.occurrences.map((item) => item.sourcePath)).toEqual([
      'src/refund.ts',
    ]);
  });

  it('새 섹션 이름의 콜론은 \\:로 적고 CRLF와 다른 원문은 그대로 보존한다', async () => {
    const crlf = 'a\r\n// @codocs [[환불:환불정책]] 끝\r\n';
    await writeProject({ 'src/crlf.ts': crlf });
    startSession();
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '정책:신',
    };
    const planned = await preview(request);
    await session.applyRename({ ...request, revisions: planned.revisions });

    expect(await read('src/crlf.ts')).toBe(
      'a\r\n// @codocs [[환불:정책\\:신]] 끝\r\n',
    );
  });

  it('미리보기 뒤 코드 파일이 바뀌면 revision_conflict로 거절하고 어떤 파일도 바꾸지 않는다', async () => {
    await writeProject({ 'src/refund.ts': code });
    startSession();
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    };
    const planned = await preview(request);
    await writeFile(path.join(project, 'src/refund.ts'), `${code}// 추가\n`);
    const applied = await session.applyRename({
      ...request,
      revisions: planned.revisions,
    });

    expect(applied).toMatchObject({
      success: false,
      changed: false,
      diagnostics: [{ code: 'revision_conflict', path: 'src/refund.ts' }],
    });
    expect(await read('.codocs/refund.yaml')).toBe(refund);
    expect(await read('src/refund.ts')).toBe(`${code}// 추가\n`);
  });

  it('미리보기에 없던 코드 파일이 영향 집합에 생기면 rename_affected_files_changed로 거절한다', async () => {
    await writeProject({ 'src/refund.ts': code });
    startSession();
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    };
    const planned = await preview(request);
    const withoutCode = Object.fromEntries(
      Object.entries(planned.revisions).filter(
        ([filePath]) => filePath !== 'src/refund.ts',
      ),
    );
    const applied = await session.applyRename({
      ...request,
      revisions: withoutCode,
    });

    expect(applied).toMatchObject({
      success: false,
      diagnostics: [
        { code: 'rename_affected_files_changed', path: 'src/refund.ts' },
      ],
    });
    expect(await read('src/refund.ts')).toBe(code);
  });

  it('코드 파일 교체가 실패하면 먼저 바꾼 파일을 역순으로 원본 바이트로 되돌린다', async () => {
    await writeProject({ 'src/refund.ts': code });
    startSession({
      storage: {
        operations: {
          rename: async (source, target) => {
            if (target.endsWith(path.join('src', 'refund.ts')))
              throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
            await renameFile(source, target);
          },
        },
      },
    });
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    };
    const planned = await preview(request);
    const applied = await session.applyRename({
      ...request,
      revisions: planned.revisions,
    });

    expect(applied).toMatchObject({
      success: false,
      files: [
        { path: refundPath, state: 'restored' },
        { path: 'src/refund.ts', state: 'unchanged', fileKind: 'code' },
      ],
    });
    expect(await read('.codocs/refund.yaml')).toBe(refund);
    expect(await read('src/refund.ts')).toBe(code);
  });
});

describe('코드 파일 표기를 포함한 문서 이름 변경', () => {
  it('이름 부분만 새 이름으로 바꾸고 섹션과 표기 뒤 글자는 그대로 둔다', async () => {
    await writeProject({
      'src/a.ts':
        '// @codocs [[환불]]#L2\n// @codocs [[환불:환불정책]]#L3\n// @codocs [[결제]]\n',
    });
    startSession();
    const request = { targetPath: refundPath, newName: '반품' };
    const planned = await preview(request);
    await session.applyRename({ ...request, revisions: planned.revisions });

    expect(await read('src/a.ts')).toBe(
      '// @codocs [[반품]]#L2\n// @codocs [[반품:환불정책]]#L3\n// @codocs [[결제]]\n',
    );
    expect(await read('.codocs/refund.yaml')).toContain('name: 반품');
  });

  it('이름 중복으로 모호한 코드 표기는 선택 대상으로 보고하고 고르지 않으면 그대로 둔다', async () => {
    await writeProject({
      '.codocs/refund-two.yaml':
        '_codocs:\n  id: refund-two\n  name: 환불\n개요: 내용\n',
      'src/a.ts': '// @codocs [[환불]]\n',
    });
    startSession();
    const request = { targetPath: refundPath, newName: '반품' };
    const planned = await preview(request);

    expect(planned.status).toBe('unresolved');
    expect(planned.impacts).toMatchObject([
      {
        path: 'src/a.ts',
        occurrenceIndex: 0,
        text: '@codocs [[환불]]',
        reason: 'selection_required',
        fileKind: 'code',
        before: { status: 'ambiguous' },
      },
    ]);
    expect(planned.impacts[0]?.before.candidates).toHaveLength(2);

    const applied = await session.applyRename({
      ...request,
      revisions: planned.revisions,
    });

    expect(applied).toMatchObject({ success: true, status: 'unresolved' });
    expect(await read('src/a.ts')).toBe('// @codocs [[환불]]\n');
  });

  it('모호한 코드 표기에서 이 문서를 고르면 그 표기의 이름 부분을 고친다', async () => {
    await writeProject({
      '.codocs/refund-two.yaml':
        '_codocs:\n  id: refund-two\n  name: 환불\n개요: 내용\n',
      'src/a.ts': '// @codocs [[환불]]\n// @codocs [[환불]]\n',
    });
    startSession();
    const request = {
      targetPath: refundPath,
      newName: '반품',
      selections: [
        { sourcePath: 'src/a.ts', occurrenceIndex: 1, targetPath: refundPath },
      ],
    };
    const planned = await preview(request);
    await session.applyRename({ ...request, revisions: planned.revisions });

    expect(await read('src/a.ts')).toBe(
      '// @codocs [[환불]]\n// @codocs [[반품]]\n',
    );
  });

  it('후보에 없는 대상을 고른 코드 표기 선택은 invalid_selection으로 막는다', async () => {
    await writeProject({ 'src/a.ts': '// @codocs [[환불]]\n' });
    startSession();
    const result = await preview({
      targetPath: refundPath,
      newName: '반품',
      selections: [
        { sourcePath: 'src/a.ts', occurrenceIndex: 0, targetPath: paymentPath },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockingReason: 'invalid_selection',
      invalidSelections: [{ sourcePath: 'src/a.ts' }],
      changes: [],
    });
  });

  it('새 이름과 같은 이름을 쓰던 끊어진 코드 표기는 해석이 달라지는 영향으로 보고하고 고치지 않는다', async () => {
    await writeProject({ 'src/a.ts': '// @codocs [[반품]]\n' });
    startSession();
    const result = await preview({
      targetPath: refundPath,
      newName: '반품',
    });

    expect(result.status).toBe('unresolved');
    expect(result.impacts).toMatchObject([
      {
        path: 'src/a.ts',
        reason: 'changed_resolution',
        fileKind: 'code',
        before: { status: 'missing' },
        after: { status: 'resolved' },
      },
    ]);
    expect(
      result.changes.some(
        (item) => item.fileKind === workspaceRenameFileKinds.code,
      ),
    ).toBe(false);
  });

  it('.codocs 안의 파일은 코드 표기로 고치지 않는다', async () => {
    await writeProject({
      '.codocs/notes.yaml':
        '_codocs:\n  id: notes\n  name: 노트\n메모: "// @codocs [[환불]]"\n',
    });
    startSession();
    const result = await preview({ targetPath: refundPath, newName: '반품' });

    expect(result.changes.every((item) => item.fileKind === undefined)).toBe(
      true,
    );
  });
});

describe('코드 수집 상태에 따른 이름 변경', () => {
  const code = '// @codocs [[환불:환불정책]]\n';

  it('코드 수집이 진행 중이면 미리보기는 blocked이고 파일을 바꾸지 않는다', async () => {
    await writeProject({ 'src/a.ts': code });
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    startSession({ codeReference: { beforeRead: () => gate } });
    await session.codeReferenceSnapshot();
    const result = await session.previewRename({
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    });

    expect(result).toMatchObject({
      success: true,
      status: 'blocked',
      blockingReason: 'unconfirmed',
      changes: [],
    });
    expect(await read('src/a.ts')).toBe(code);
    expect(await read('.codocs/refund.yaml')).toBe(refund);
  });

  it('코드 수집이 진행 중이면 반영 재계산도 거절하고 파일을 바꾸지 않는다', async () => {
    await writeProject({ 'src/a.ts': code });
    startSession();
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    };
    const planned = await preview(request);
    await session.close();

    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    startSession({ codeReference: { beforeRead: () => gate } });
    await session.codeReferenceSnapshot();
    const applied = await session.applyRename({
      ...request,
      revisions: planned.revisions,
    });

    expect(applied).toMatchObject({
      success: false,
      changed: false,
      preview: { status: 'blocked', blockingReason: 'unconfirmed' },
    });
    expect(await read('src/a.ts')).toBe(code);
    expect(await read('.codocs/refund.yaml')).toBe(refund);
  });

  it('일부 파일을 읽지 못한 incomplete 수집은 확인한 파일만 고치고 읽지 못한 경로를 unconfirmed 영향으로 보고한다', async () => {
    await writeProject({ 'src/a.ts': code, 'src/legacy.ts': code });
    ioFailures.set(path.join(project, 'src', 'legacy.ts'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    startSession();
    const request = {
      targetPath: refundPath,
      section: '환불정책',
      newName: '환불 규정',
    };
    const planned = await preview(request);

    expect(planned.status).toBe('unresolved');
    expect(planned.impacts).toMatchObject([
      {
        path: 'src/legacy.ts',
        occurrenceIndex: -1,
        text: '',
        reason: 'unconfirmed',
        fileKind: 'code',
        before: { status: 'unconfirmed', candidates: [] },
      },
    ]);
    expect(planned.revisions['src/legacy.ts']).toBeUndefined();

    const applied = await session.applyRename({
      ...request,
      revisions: planned.revisions,
    });

    expect(applied).toMatchObject({
      success: true,
      status: 'unresolved',
      files: [
        { path: refundPath, state: 'changed' },
        { path: 'src/a.ts', state: 'changed' },
      ],
    });
    expect(await read('src/a.ts')).toBe('// @codocs [[환불:환불 규정]]\n');
    expect(await read('src/legacy.ts')).toBe(code);
  });
});

describe('prepareWorkspaceRename: 합성한 코드 수집 관측', () => {
  /** 파일 시스템 없이 만든 문서 색인과 스캔이다. */
  async function indexes() {
    const scan = await loadWorkspace({ cwd: project });
    return { scan, catalog: buildWorkspaceCatalog(scan) };
  }

  it('특정 파일로 좁힐 수 없는 수집 실패는 경로 .의 unconfirmed 영향으로 보고한다', async () => {
    const { scan, catalog } = await indexes();
    const sources: WorkspaceCodeRenameSources = {
      status: codeCollectionStatuses.incomplete,
      files: [],
      failures: [{ reason: codeFileReasons.watch, message: '감시가 끊겼다' }],
    };
    const { preview: result } = prepareWorkspaceRename(
      { targetPath: refundPath, section: '환불정책', newName: '규정' },
      scan,
      catalog,
      sources,
    );

    expect(result.status).toBe('unresolved');
    expect(result.impacts).toMatchObject([
      { path: '.', reason: 'unconfirmed', fileKind: 'code' },
    ]);
  });

  it('collecting 관측이면 문서가 모두 준비되어도 blocked다', async () => {
    const { scan, catalog } = await indexes();
    const { preview: result, edits } = prepareWorkspaceRename(
      { targetPath: refundPath, newName: '반품' },
      scan,
      catalog,
      { status: codeCollectionStatuses.collecting, files: [], failures: [] },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      blockingReason: 'unconfirmed',
    });
    expect(edits).toEqual([]);
  });

  it('코드 관측을 주지 않으면 코드 파일을 다루지 않고 문서 계획만 반환한다', async () => {
    const { scan, catalog } = await indexes();
    const { preview: result } = prepareWorkspaceRename(
      { targetPath: refundPath, newName: '반품' },
      scan,
      catalog,
    );

    expect(result.status).toBe('ready');
    expect(result.changes.every((item) => item.fileKind === undefined)).toBe(
      true,
    );
  });
});

describe('applyWorkspaceRename: 코드 파일 쓰기 경계', () => {
  /** 합성한 관측으로 한 코드 파일만 고치는 반영 입력을 만든다. */
  async function applyFor(
    name: string,
    text: string,
  ): Promise<ReturnType<typeof applyWorkspaceRename>> {
    const scan = await loadWorkspace({ cwd: project });
    const catalog = buildWorkspaceCatalog(scan);
    const sources: WorkspaceCodeRenameSources = {
      status: codeCollectionStatuses.complete,
      files: [
        {
          path: name,
          text,
          revision: calculateRevision(Buffer.from(text, 'utf8')),
          markers: extractCodeReferences(text),
        },
      ],
      failures: [],
    };
    const request = { targetPath: refundPath, newName: '반품' };
    const { preview: planned } = prepareWorkspaceRename(
      request,
      scan,
      catalog,
      sources,
    );
    return applyWorkspaceRename(
      { ...request, revisions: planned.revisions },
      scan,
      catalog,
      {},
      sources,
    );
  }

  it('ignore 규칙에 걸린 파일은 수집 경계 밖이라 revision이 맞아도 쓰지 않는다', async () => {
    const text = '// @codocs [[환불]]\n';
    await writeProject({ '.gitignore': 'secret.ts\n', 'secret.ts': text });
    const result = await applyFor('secret.ts', text);

    expect(result).toMatchObject({
      success: false,
      changed: false,
      diagnostics: [{ code: 'file_access_failed', path: 'secret.ts' }],
    });
    expect(await read('secret.ts')).toBe(text);
    expect(await read('.codocs/refund.yaml')).toBe(refund);
  });

  it('.codocsignore가 제외한 파일은 revision이 맞아도 쓰지 않는다', async () => {
    const text = '// @codocs [[환불]]\n';
    await writeProject({ '.codocsignore': 'secret.ts\n', 'secret.ts': text });
    const result = await applyFor('secret.ts', text);

    expect(result).toMatchObject({
      success: false,
      changed: false,
      diagnostics: [{ code: 'file_access_failed', path: 'secret.ts' }],
    });
    expect(await read('secret.ts')).toBe(text);
  });

  it('프로젝트 밖을 가리키는 경로는 쓰지 않는다', async () => {
    const text = '// @codocs [[환불]]\n';
    const outside = path.join(path.dirname(project), 'outside-code.ts');
    await writeFile(outside, text);
    try {
      const result = await applyFor('../outside-code.ts', text);

      expect(result).toMatchObject({ success: false, changed: false });
      expect(await readFile(outside, 'utf8')).toBe(text);
    } finally {
      await rm(outside, { force: true });
    }
  });

  it('UTF-8이 아닌 바이트가 섞인 파일은 손실 없이 쓸 수 없어 건드리지 않는다', async () => {
    const bytes = Buffer.concat([
      Buffer.from('// @codocs [[환불]]\n', 'utf8'),
      Buffer.from([0xff, 0xfe]),
    ]);
    await writeFile(path.join(project, 'bin.ts'), bytes);
    const result = await applyFor('bin.ts', bytes.toString('utf8'));

    expect(result).toMatchObject({ success: false, changed: false });
    expect((await readFile(path.join(project, 'bin.ts'))).equals(bytes)).toBe(
      true,
    );
  });
});
