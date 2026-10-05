import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '../query/index.js';
import { parseRenameRequest } from './index.js';

let root: string;
let session: WorkspaceQuerySession;
const refundPath = path.join('.codocs', 'refund.yaml');
const refund =
  '_codocs:\n  id: refund\n  name: 환불\n환불정책: 환불 규정 본문\n예외: "자기 참조 [[환불:환불정책]]"\n';
const payment =
  '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불정책]] [[환불:없는섹션]]"\n메모: \'[[환불:환불정책]] [[환불]]\'\n';

/** 프로젝트 .codocs에 테스트 문서를 쓴다. 키는 .codocs 아래 파일 이름이다. */
async function writeDocuments(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files))
    await writeFile(path.join(root, '.codocs', name), content);
}

/** .codocs 파일의 현재 내용을 읽는다. */
async function read(name: string): Promise<string> {
  return readFile(path.join(root, '.codocs', name), 'utf8');
}

const request = {
  targetPath: refundPath,
  section: '환불정책',
  newName: '환불 규정',
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-section-rename-'));
  await mkdir(path.join(root, '.codocs'));
  session = createWorkspaceQuerySession({ cwd: root });
});

afterEach(async () => {
  await session.close();
  await rm(root, { recursive: true, force: true });
});

describe('parseRenameRequest: section 입력', () => {
  it('section이 없으면 문서 이름 변경 요청이고 section 키를 만들지 않는다', () => {
    expect(
      parseRenameRequest({ targetPath: refundPath, newName: '새환불' }),
    ).toEqual({ targetPath: refundPath, newName: '새환불' });
  });

  it('section이 있으면 섹션 이름 변경 요청이다', () => {
    expect(parseRenameRequest(request)).toEqual(request);
  });

  it.each([
    { title: '빈 문자열', section: '' },
    { title: '숫자', section: 1 },
    { title: 'null', section: null },
  ])('section이 $title이면 거절한다', ({ section }) => {
    expect(parseRenameRequest({ ...request, section })).toBeUndefined();
  });
});

describe('WorkspaceQuerySession.previewRename: 섹션 이름 변경 미리보기', () => {
  it('키와 확정 참조의 섹션 부분을 고칠 위치로 보고하고 oldName·newName은 섹션 이름이며 targetSection을 담는다', async () => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    const result = await session.previewRename(request);
    if (!result.success) throw new Error('미리보기가 실패했다');

    expect(result).toMatchObject({
      status: 'ready',
      targetPath: refundPath,
      oldName: '환불정책',
      newName: '환불 규정',
      targetSection: '환불정책',
      impacts: [],
      conflicts: [],
    });
    expect(
      result.changes.map((change) => [
        change.path,
        change.kind,
        change.oldText,
        change.newText,
      ]),
    ).toEqual([
      [
        path.join('.codocs', 'payment.yaml'),
        undefined,
        '환불정책',
        '환불 규정',
      ],
      [
        path.join('.codocs', 'payment.yaml'),
        undefined,
        '환불정책',
        '환불 규정',
      ],
      [refundPath, 'key', '환불정책', '환불 규정'],
      [refundPath, undefined, '환불정책', '환불 규정'],
    ]);
    expect(Object.keys(result.revisions).sort()).toEqual([
      path.join('.codocs', 'payment.yaml'),
      refundPath,
    ]);
  });

  it('미리보기는 파일을 바꾸지 않는다', async () => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    await session.previewRename(request);

    expect(await read('refund.yaml')).toBe(refund);
    expect(await read('payment.yaml')).toBe(payment);
  });

  it('문서 이름 변경 응답에는 targetSection이 없다', async () => {
    await writeDocuments({ 'refund.yaml': refund });
    const result = await session.previewRename({
      targetPath: refundPath,
      newName: '새환불',
    });

    expect(result).toMatchObject({ success: true, status: 'ready' });
    expect(result).not.toHaveProperty('targetSection');
  });

  it('같은 이름의 섹션이 있으면 section_conflict로 blocked이며 충돌 문서를 보고한다', async () => {
    await writeDocuments({
      'refund.yaml': `${refund}환불 규정: 이미 있음\n`,
      'payment.yaml': payment,
    });
    const result = await session.previewRename(request);

    expect(result).toMatchObject({
      success: true,
      status: 'blocked',
      blockingReason: 'section_conflict',
      targetSection: '환불정책',
      changes: [],
      conflicts: [{ candidates: [{ path: refundPath, name: '환불' }] }],
    });
  });

  it.each([
    {
      title: '없는 섹션',
      change: { section: '없음' },
      reason: 'section_not_found',
    },
    {
      title: '같은 이름',
      change: { newName: '환불정책' },
      reason: 'invalid_name',
    },
    { title: '_ 시작', change: { newName: '_a' }, reason: 'invalid_name' },
    { title: '대괄호', change: { newName: 'a[b' }, reason: 'invalid_name' },
    { title: '빈 새 이름', change: { newName: '' }, reason: 'invalid_name' },
  ])('$title이면 $reason로 blocked다', async ({ change, reason }) => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    const result = await session.previewRename({ ...request, ...change });

    expect(result).toMatchObject({
      success: true,
      status: 'blocked',
      blockingReason: reason,
      changes: [],
    });
  });

  it('plain 키에 쓸 수 없는 새 이름이면 따옴표로 승격하지 않고 unrepresentable로 blocked다', async () => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    const result = await session.previewRename({
      ...request,
      newName: 'a: b',
    });

    expect(result).toMatchObject({
      success: true,
      status: 'blocked',
      blockingReason: 'unrepresentable',
      changes: [],
    });
  });

  it('고칠 참조가 있는 파일이 UTF-8 손실 없이 보존되지 않으면 source_not_lossless로 blocked다', async () => {
    await writeDocuments({ 'refund.yaml': refund });
    await writeFile(
      path.join(root, '.codocs', 'payment.yaml'),
      Buffer.concat([
        Buffer.from(`${payment}# `),
        Buffer.from([0xff]),
        Buffer.from('\n'),
      ]),
    );
    const result = await session.previewRename(request);

    expect(result).toMatchObject({
      success: true,
      status: 'blocked',
      blockingReason: 'source_not_lossless',
      changes: [],
    });
  });

  it('후보가 여럿인 참조는 선택이 필요한 영향으로 보고하고 선택하면 고친다', async () => {
    await writeDocuments({
      'refund.yaml': '_codocs:\n  id: refund\n  name: 환불\n환불정책: 본문\n',
      'refund2.yaml':
        '_codocs:\n  id: refund2\n  name: 환불\n환불정책: 다른 문서\n',
      'ref.yaml':
        '_codocs:\n  id: ref\n  name: 참조\n본문: "[[환불:환불정책]]"\n',
    });
    const refPath = path.join('.codocs', 'ref.yaml');
    const unselected = await session.previewRename(request);

    expect(unselected).toMatchObject({
      success: true,
      status: 'unresolved',
      impacts: [
        {
          path: refPath,
          occurrenceIndex: 0,
          reason: 'selection_required',
          before: {
            status: 'ambiguous',
            candidates: [
              { path: refundPath },
              { path: path.join('.codocs', 'refund2.yaml') },
            ],
          },
        },
      ],
    });
    const selected = await session.previewRename({
      ...request,
      selections: [
        { sourcePath: refPath, occurrenceIndex: 0, targetPath: refundPath },
      ],
    });

    expect(selected).toMatchObject({ success: true, status: 'ready' });
    expect(
      selected.success && selected.changes.map((change) => change.path),
    ).toContain(refPath);
  });

  it('섹션 입력이 비어 있거나 문자열이 아니면 invalid_input이다', async () => {
    await writeDocuments({ 'refund.yaml': refund });

    for (const section of ['', 1])
      expect(
        await session.previewRename({ ...request, section }),
      ).toMatchObject({ success: false, error: { code: 'invalid_input' } });
  });
});

describe('WorkspaceQuerySession.applyRename: 섹션 이름 변경 반영', () => {
  it('미리보기의 revision으로 반영하면 키와 확정 참조만 바꾸고 색인에 새 섹션을 게시한다', async () => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    const preview = await session.previewRename(request);
    if (!preview.success) throw new Error('미리보기가 실패했다');
    const result = await session.applyRename({
      ...request,
      revisions: preview.revisions,
    });

    expect(result).toMatchObject({
      success: true,
      status: 'ready',
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    expect(await read('refund.yaml')).toBe(
      '_codocs:\n  id: refund\n  name: 환불\n환불 규정: 환불 규정 본문\n예외: "자기 참조 [[환불:환불 규정]]"\n',
    );
    expect(await read('payment.yaml')).toBe(
      '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불 규정]] [[환불:없는섹션]]"\n메모: \'[[환불:환불 규정]] [[환불]]\'\n',
    );
    expect(await session.get(['refund'])).toMatchObject({
      success: true,
      results: [{ found: true, document: { '환불 규정': '환불 규정 본문' } }],
    });
  });

  it('반영 직후 같은 요청은 대상 섹션이 없어 section_not_found로 blocked다', async () => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    const preview = await session.previewRename(request);
    if (!preview.success) throw new Error('미리보기가 실패했다');
    await session.applyRename({ ...request, revisions: preview.revisions });

    expect(await session.previewRename(request)).toMatchObject({
      status: 'blocked',
      blockingReason: 'section_not_found',
    });
  });

  it('미리보기 뒤 영향 파일이 바뀌면 revision_conflict로 거절하고 아무 파일도 바꾸지 않는다', async () => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    const preview = await session.previewRename(request);
    if (!preview.success) throw new Error('미리보기가 실패했다');
    await writeDocuments({
      'payment.yaml': payment.replace('취소: ', '취소: 앞 '),
    });
    const result = await session.applyRename({
      ...request,
      revisions: preview.revisions,
    });

    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'revision_conflict' },
    });
    expect(await read('refund.yaml')).toBe(refund);
  });

  it('섹션 이름 변경의 키 파일만 바뀌었어도 revision_conflict로 거절한다', async () => {
    await writeDocuments({ 'refund.yaml': refund, 'payment.yaml': payment });
    const preview = await session.previewRename(request);
    if (!preview.success) throw new Error('미리보기가 실패했다');
    const changed = refund.replace('환불 규정 본문', '바뀐 본문');
    await writeDocuments({ 'refund.yaml': changed });
    const result = await session.applyRename({
      ...request,
      revisions: preview.revisions,
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'revision_conflict' },
    });
    expect(await read('refund.yaml')).toBe(changed);
    expect(await read('payment.yaml')).toBe(payment);
  });

  it.each([
    {
      title: '섹션 충돌',
      change: {},
      files: { 'refund.yaml': `${refund}환불 규정: x\n` },
    },
    { title: '쓸 수 없는 키 이름', change: { newName: 'a: b' }, files: {} },
    { title: '없는 섹션', change: { section: '없음' }, files: {} },
  ])(
    '$title이면 rename_blocked로 거절하고 아무 파일도 바꾸지 않는다',
    async ({ change, files }) => {
      const documents = {
        'refund.yaml': refund,
        'payment.yaml': payment,
        ...files,
      };
      await writeDocuments(documents);
      const result = await session.applyRename({
        ...request,
        ...change,
        revisions: {},
      });

      expect(result).toMatchObject({
        success: false,
        saved: false,
        changed: false,
        files: [],
        error: { code: 'rename_blocked' },
      });
      expect(await read('refund.yaml')).toBe(documents['refund.yaml']);
      expect(await read('payment.yaml')).toBe(payment);
    },
  );

  it('revisions 없이 요청하면 invalid_input이다', async () => {
    await writeDocuments({ 'refund.yaml': refund });

    expect(await session.applyRename(request)).toMatchObject({
      success: false,
      error: { code: 'invalid_input' },
    });
  });
});
