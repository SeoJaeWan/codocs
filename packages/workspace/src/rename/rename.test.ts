import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '../query/index.js';
import { calculateRevision } from '../revision/index.js';

let root: string;
let session: WorkspaceQuerySession;
const orderPath = path.join('.codocs', 'order.yaml');
const purchasePath = path.join('.codocs', 'purchase-order.yaml');
const sourcePath = path.join('.codocs', 'source.yaml');
const order = 'id: order\nname: 주문\ndomains: [판매]\ndefinition: 주문 설명\n';
const purchaseOrder =
  'id: purchase-order\nname: 주문\ndomains: [구매]\ndefinition: 구매 주문 설명\n';

/** 프로젝트 .codocs에 테스트 문서를 쓴다. 키는 .codocs 아래 파일 이름이다. */
async function writeDocuments(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files))
    await writeFile(path.join(root, '.codocs', name), content);
}

/** 디스크에 있는 파일의 바이트로 독립적으로 계산한 revision이다. */
async function diskRevision(name: string): Promise<string> {
  return calculateRevision(await readFile(path.join(root, '.codocs', name)));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-rename-'));
  await mkdir(path.join(root, '.codocs'));
  session = createWorkspaceQuerySession({ cwd: root });
});

afterEach(async () => {
  await session.close();
  await rm(root, { recursive: true, force: true });
});

describe('WorkspaceQuerySession.previewRename: 이름 변경 미리보기', () => {
  describe('고칠 참조와 결과 상태 계산', () => {
    it('이름만 가진 문서의 이름을 변경하면 ready와 이름 변경 한 건을 반환한다', async () => {
      await writeDocuments({ 'order.yaml': order });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
      });

      expect(result).toMatchObject({
        success: true,
        status: 'ready',
        oldName: '주문',
        newName: '새주문',
        changes: [
          {
            path: orderPath,
            fieldPath: ['name'],
            oldText: '주문',
            newText: '새주문',
          },
        ],
        impacts: [],
        conflicts: [],
      });
    });

    it('이 문서를 가리키는 참조 세 곳만 새 이름으로 고치고 다른 도메인 문서를 가리키는 참조는 고치지 않는다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'purchase-order.yaml': purchaseOrder,
        'a.yaml':
          'id: a\nname: 가\ndomains: [판매]\ndefinition: "[[판매:주문]] 그리고 [[판매:주문]]"\n',
        'b.yaml':
          'id: b\nname: 나\ndomains: [판매]\ndefinition: "[[판매:주문]]"\n',
        'c.yaml':
          'id: c\nname: 다\ndomains: [구매]\ndefinition: "[[구매:주문]]"\n',
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
      });

      expect(result).toMatchObject({ success: true, status: 'ready' });
      if (!result.success) return;
      expect(
        result.changes
          .filter((change) => change.fieldPath[0] === 'definition')
          .map((change) => [
            path.basename(change.path),
            change.oldText,
            change.newText,
          ]),
      ).toEqual([
        ['a.yaml', '[[판매:주문]]', '[[판매:새주문]]'],
        ['a.yaml', '[[판매:주문]]', '[[판매:새주문]]'],
        ['b.yaml', '[[판매:주문]]', '[[판매:새주문]]'],
      ]);
    });

    it('도메인 없이 적은 참조 세 곳은 도메인 없이 새 이름으로 고친다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'a.yaml':
          'id: a\nname: 가\ndomains: [판매]\ndefinition: "[[주문]] [[주문]]"\n',
        'b.yaml': 'id: b\nname: 나\ndomains: [판매]\ndefinition: "[[주문]]"\n',
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
      });

      expect(result).toMatchObject({ success: true, status: 'ready' });
      if (!result.success) return;
      expect(
        result.changes
          .filter((change) => change.fieldPath[0] === 'definition')
          .map((change) => change.newText),
      ).toEqual(['[[새주문]]', '[[새주문]]', '[[새주문]]']);
    });

    it('새 이름이 다른 도메인 문서와 같으면 이 문서를 가리키던 참조에 대상 도메인을 붙인다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'payment.yaml':
          'id: payment\nname: 결제\ndomains: [구매]\ndefinition: 결제 설명\n',
        'a.yaml': 'id: a\nname: 가\ndomains: [판매]\ndefinition: "[[주문]]"\n',
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '결제',
      });

      expect(result).toMatchObject({ success: true, status: 'ready' });
      if (!result.success) return;
      expect(
        result.changes.find((change) => change.fieldPath[0] === 'definition'),
      ).toMatchObject({ oldText: '[[주문]]', newText: '[[판매:결제]]' });
    });

    it('새 이름에 콜론이 있으면 참조에서 역슬래시로 escape한다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'a.yaml': 'id: a\nname: 가\ndomains: [판매]\ndefinition: "[[주문]]"\n',
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새:주문',
      });

      expect(result).toMatchObject({ success: true, status: 'ready' });
      if (!result.success) return;
      expect(
        result.changes.find((change) => change.fieldPath[0] === 'definition')
          ?.newText,
      ).toBe('[[새\\:주문]]');
    });
  });

  describe('모호했던 참조의 후보 보고와 선택', () => {
    const ambiguousSource =
      'id: source\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\n';

    it('원래 모호한 참조는 선택이 없으면 고치지 않고 후보의 도메인·이름·경로와 함께 미해결로 보고한다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'purchase-order.yaml': purchaseOrder,
        'source.yaml': ambiguousSource,
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
      });

      expect(result).toMatchObject({ success: true, status: 'unresolved' });
      if (!result.success) return;
      expect(
        result.changes.filter((change) => change.path === sourcePath),
      ).toEqual([]);
      expect(result.impacts).toEqual([
        expect.objectContaining({
          path: sourcePath,
          text: '[[주문]]',
          before: {
            status: 'ambiguous',
            candidates: [
              { path: orderPath, name: '주문', domains: ['판매'] },
              { path: purchasePath, name: '주문', domains: ['구매'] },
            ],
          },
        }),
      ]);
    });

    it('원래 모호한 참조에서 대상 문서를 선택하면 그 참조를 새 이름으로 고친다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'purchase-order.yaml': purchaseOrder,
        'source.yaml': ambiguousSource,
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
        selections: [{ sourcePath, occurrenceIndex: 0, targetPath: orderPath }],
      });

      expect(result).toMatchObject({ success: true, status: 'ready' });
      if (!result.success) return;
      expect(
        result.changes.find((change) => change.path === sourcePath),
      ).toMatchObject({ oldText: '[[주문]]', newText: '[[새주문]]' });
    });

    it('원래 모호한 참조에서 다른 후보를 선택하면 그 참조는 고치지 않는다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'purchase-order.yaml': purchaseOrder,
        'source.yaml': ambiguousSource,
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
        selections: [
          { sourcePath, occurrenceIndex: 0, targetPath: purchasePath },
        ],
      });

      expect(result).toMatchObject({ success: true });
      if (!result.success) return;
      expect(
        result.changes.filter((change) => change.path === sourcePath),
      ).toEqual([]);
    });
  });

  describe('진행할 수 없는 이름 변경의 차단', () => {
    it('대상 문서의 도메인에 새 이름과 같은 문서가 있으면 충돌 후보와 함께 blocked로 보고한다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'other.yaml':
          'id: other\nname: 새주문\ndomains: [판매]\ndefinition: 설명\n',
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
      });

      expect(result).toMatchObject({
        success: true,
        status: 'blocked',
        blockingReason: 'name_conflict',
        changes: [],
        conflicts: [
          {
            domain: '판매',
            candidates: [
              {
                path: path.join('.codocs', 'other.yaml'),
                name: '새주문',
                domains: ['판매'],
              },
            ],
          },
        ],
      });
    });

    it('존재하지 않는 참조를 선택하면 blocked로 보고하고 변경을 만들지 않는다', async () => {
      await writeDocuments({ 'order.yaml': order });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
        selections: [
          { sourcePath: orderPath, occurrenceIndex: 5, targetPath: orderPath },
        ],
      });

      expect(result).toMatchObject({
        success: true,
        status: 'blocked',
        blockingReason: 'invalid_selection',
        changes: [],
      });
    });

    it('원본이 UTF-8 손실 없이 보존되지 않는 파일에 고칠 곳이 있으면 blocked로 보고한다', async () => {
      await writeDocuments({ 'order.yaml': order });
      await writeFile(
        path.join(root, '.codocs', 'source.yaml'),
        Buffer.concat([
          Buffer.from(
            'id: source\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\n# ',
          ),
          Buffer.from([0xff]),
          Buffer.from('\n'),
        ]),
      );
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
      });

      expect(result).toMatchObject({
        success: true,
        status: 'blocked',
        blockingReason: 'source_not_lossless',
        changes: [],
      });
    });

    it('대상 경로나 새 이름의 형식이 올바르지 않으면 입력 오류를 반환한다', async () => {
      await writeDocuments({ 'order.yaml': order });
      const result = await session.previewRename({ targetPath: orderPath });

      expect(result).toMatchObject({
        success: false,
        error: { code: 'invalid_input' },
      });
    });
  });

  describe('파일별 revision과 미리보기의 부수 효과 방지', () => {
    it('영향받는 파일마다 현재 디스크 내용의 revision을 반환한다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'source.yaml':
          'id: source\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\n',
        'unrelated.yaml':
          'id: unrelated\nname: 무관\ndomains: [판매]\ndefinition: 설명\n',
      });
      const result = await session.previewRename({
        targetPath: orderPath,
        newName: '새주문',
      });

      expect(result).toMatchObject({ success: true });
      if (!result.success) return;
      expect(result.revisions).toEqual({
        [orderPath]: await diskRevision('order.yaml'),
        [sourcePath]: await diskRevision('source.yaml'),
      });
    });

    it('미리보기를 계산해도 파일 내용과 색인의 이름을 바꾸지 않는다', async () => {
      await writeDocuments({
        'order.yaml': order,
        'source.yaml':
          'id: source\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\n',
      });
      const before = {
        order: await readFile(path.join(root, '.codocs', 'order.yaml'), 'utf8'),
        source: await readFile(
          path.join(root, '.codocs', 'source.yaml'),
          'utf8',
        ),
      };
      await session.previewRename({ targetPath: orderPath, newName: '새주문' });

      expect({
        order: await readFile(path.join(root, '.codocs', 'order.yaml'), 'utf8'),
        source: await readFile(
          path.join(root, '.codocs', 'source.yaml'),
          'utf8',
        ),
      }).toEqual(before);
      expect(await session.get(['order'])).toMatchObject({
        success: true,
        results: [{ found: true, document: { name: '주문' } }],
      });
    });
  });
});

describe('WorkspaceQuerySession.applyRename: 이름 변경 반영과 색인', () => {
  const sourceDocument =
    'id: source\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\n';

  it('미리보기의 revision으로 반영하면 파일을 바꾸고 저장 직후 색인에 새 이름을 게시한다', async () => {
    await writeDocuments({
      'order.yaml': order,
      'source.yaml': sourceDocument,
    });
    const preview = await session.previewRename({
      targetPath: orderPath,
      newName: '새주문',
    });
    if (!preview.success) throw new Error('미리보기가 실패했다');
    const result = await session.applyRename({
      targetPath: orderPath,
      newName: '새주문',
      revisions: preview.revisions,
    });

    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    expect(await session.get(['order'])).toMatchObject({
      success: true,
      results: [{ found: true, document: { name: '새주문' } }],
    });
    expect(
      await readFile(path.join(root, '.codocs', 'source.yaml'), 'utf8'),
    ).toContain('[[새주문]]');
  });

  it('deprecatedAliases가 있는 대상 문서와 참조 문서의 이름을 변경하면 두 문서의 키만 지우고 참조를 바꾸며 관계없는 문서는 그대로 둔다', async () => {
    const orderWithAlias =
      'id: order\nname: 주문\ndomains: [판매]\n# 보존 주석\ndeprecatedAliases:\n  - id: old-order\ndefinition: 주문 설명\n';
    const sourceWithAlias =
      '{id: source, name: 출처, domains: [판매], deprecatedAliases: [{id: old-source}], definition: "[[주문]]"}\n';
    const unrelated =
      'id: unrelated\nname: 관계없음\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: 다른 설명\n';
    await writeDocuments({
      'order.yaml': orderWithAlias,
      'source.yaml': sourceWithAlias,
      'unrelated.yaml': unrelated,
    });
    const preview = await session.previewRename({
      targetPath: orderPath,
      newName: '새주문',
    });
    if (!preview.success) throw new Error('미리보기가 실패했다');
    const result = await session.applyRename({
      targetPath: orderPath,
      newName: '새주문',
      revisions: preview.revisions,
    });

    expect(result).toMatchObject({ success: true, saved: true, changed: true });
    const read = (name: string) =>
      readFile(path.join(root, '.codocs', name), 'utf8');
    expect(await read('order.yaml')).toBe(
      'id: order\nname: 새주문\ndomains: [판매]\n# 보존 주석\ndefinition: 주문 설명\n',
    );
    expect(await read('source.yaml')).toBe(
      '{id: source, name: 출처, domains: [판매], definition: "[[새주문]]"}\n',
    );
    expect(await read('unrelated.yaml')).toBe(unrelated);
  });

  it('반영 직후 같은 요청을 다시 미리보기하면 변경 없이 ready로 보고한다', async () => {
    await writeDocuments({
      'order.yaml': order,
      'source.yaml': sourceDocument,
    });
    const preview = await session.previewRename({
      targetPath: orderPath,
      newName: '새주문',
    });
    if (!preview.success) throw new Error('미리보기가 실패했다');
    await session.applyRename({
      targetPath: orderPath,
      newName: '새주문',
      revisions: preview.revisions,
    });
    const again = await session.previewRename({
      targetPath: orderPath,
      newName: '새주문',
    });

    expect(again).toMatchObject({
      success: true,
      status: 'ready',
      changes: [],
      oldName: '새주문',
    });
  });

  it('미리보기 뒤 영향 파일이 바뀌면 revision_conflict로 거절하고 파일을 바꾸지 않는다', async () => {
    await writeDocuments({
      'order.yaml': order,
      'source.yaml': sourceDocument,
    });
    const preview = await session.previewRename({
      targetPath: orderPath,
      newName: '새주문',
    });
    if (!preview.success) throw new Error('미리보기가 실패했다');
    const changed = sourceDocument.replace('definition: ', 'definition: 앞 ');
    await writeDocuments({ 'source.yaml': changed });
    const result = await session.applyRename({
      targetPath: orderPath,
      newName: '새주문',
      revisions: preview.revisions,
    });

    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'revision_conflict' },
    });
    expect(
      await readFile(path.join(root, '.codocs', 'order.yaml'), 'utf8'),
    ).toBe(order);
  });
});
