import { describe, expect, it } from 'vitest';
import { buildCatalog, scanStatuses, type Catalog } from '../catalog/index.js';
import { extractCodeReferences } from '../code-reference/index.js';
import {
  changePlanDiagnosticCodes,
  queryDiagnosticCodes,
} from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import {
  changePlanModes,
  changePlanStatuses,
  planDocumentChanges,
  type ChangePlanSource,
  type ChangesPlanResult,
} from './index.js';

/** 문서 원문을 만든다. */
function doc(
  id: string,
  name: string,
  body = '',
  parent: readonly string[] = [],
): string {
  const parentText = parent.length
    ? `  parent:\n${parent.map((item) => `    - ${item}`).join('\n')}\n`
    : '';
  return `_codocs:\n  id: ${id}\n  name: ${name}\n${parentText}${body}`;
}

const files: Record<string, string> = {
  '.codocs/a.yaml': doc('a', '가', '개요: 가 설명\n'),
  '.codocs/b.yaml': doc('b', '나', '개요: "[[가]] 참조"\n'),
  '.codocs/c.yaml': doc('c', '다', '개요: 다 설명\n'),
  '.codocs/p.yaml': doc('p', '부모', '개요: 부모\n환불: 환불\n'),
  '.codocs/child.yaml': doc('child', '자식', '개요: 자식\n', ['부모']),
};

/** 경로별 원문으로 색인과 원문 목록을 만든다. */
function planContext(
  codeReferences: readonly { sourcePath: string; text: string }[] = [],
) {
  const catalog: Catalog = buildCatalog({
    status: scanStatuses.complete,
    observations: Object.entries(files).map(([path, raw]) => ({
      path,
      parsed: parseYaml(raw, path),
    })),
  });
  const sources: ChangePlanSource[] = Object.entries(files).map(
    ([path, raw]) => ({
      path,
      raw,
      revision: `r-${path}`,
      utf8Lossless: true,
    }),
  );
  return {
    catalog,
    sources,
    codeReferences: codeReferences.flatMap((item) =>
      extractCodeReferences(item.text).map((marker) => ({
        sourcePath: item.sourcePath,
        marker,
      })),
    ),
  };
}

/** 기존 문서를 대상으로 하는 항목의 revision이다. */
const rev = (file: string): string => `r-.codocs/${file}.yaml`;
const del = (id: string) => ({
  mode: 'delete',
  id,
  revision: rev(id),
});

/** 실패 결과에서 진단 코드만 뽑는다. */
function codes(result: ChangesPlanResult): string[] {
  return result.diagnostics.map((item) => item.code);
}

describe('planDocumentChanges', () => {
  describe('여러 항목의 최종 상태 검증', () => {
    it('새 문서를 만들고 다른 문서들이 그 문서를 참조하도록 고치면 모두 후보가 된다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'create',
            path: '.codocs/n.yaml',
            document: { _codocs: { id: 'n', name: '새문서' }, 개요: '새 설명' },
          },
          {
            mode: 'update',
            id: 'b',
            revision: rev('b'),
            set: { 개요: '[[새문서]] 참조' },
          },
          {
            mode: 'update',
            id: 'c',
            revision: rev('c'),
            set: { 개요: '[[새문서]] 참조' },
          },
        ],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.items.map((item) => item.mode)).toEqual([
        changePlanModes.create,
        changePlanModes.update,
        changePlanModes.update,
      ]);
      expect(result.items.map((item) => item.index)).toEqual([0, 1, 2]);
      expect(result.items[1]?.raw).toContain('[[새문서]] 참조');
      expect(result.items[1]?.baseRevision).toBe(rev('b'));
      expect(result.requiresCodeEvidence).toBe(false);
    });

    it('한 항목에 error가 있으면 전체가 실패하고 그 항목 경로의 진단을 담는다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'update',
            id: 'c',
            revision: rev('c'),
            set: { 개요: '바뀐 설명' },
          },
          {
            mode: 'update',
            id: 'b',
            revision: rev('b'),
            set: { 개요: '[[없는이름]] 참조' },
          },
        ],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.failed);
      expect(
        result.diagnostics.some((item) => item.path === '.codocs/b.yaml'),
      ).toBe(true);
      expect(
        result.diagnostics.some((item) => item.path === '.codocs/c.yaml'),
      ).toBe(false);
    });

    it('모든 항목이 원문을 바꾸지 않으면 변경 없음으로 반환한다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'update',
            id: 'c',
            revision: rev('c'),
            unset: ['없는섹션'],
          },
        ],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.unchanged);
      if (result.status !== changePlanStatuses.unchanged) return;
      expect(result.items[0]?.changed).toBe(false);
      expect(result.items[0]?.revision).toBe(rev('c'));
    });

    it('빈 목록이나 배열이 아닌 입력은 요청 오류로 실패한다', () => {
      expect(codes(planDocumentChanges([], planContext()))).toEqual([
        changePlanDiagnosticCodes.invalidRequest,
      ]);
      expect(codes(planDocumentChanges({}, planContext()))).toEqual([
        changePlanDiagnosticCodes.invalidRequest,
      ]);
    });
  });

  describe('중복 입력과 name 변경', () => {
    it('같은 문서 ID가 두 항목에 나오면 invalid_input으로 실패한다', () => {
      const result = planDocumentChanges(
        [
          { mode: 'update', id: 'c', revision: rev('c'), set: { 개요: '1' } },
          { mode: 'update', id: 'c', revision: rev('c'), set: { 개요: '2' } },
        ],
        planContext(),
      );

      expect(codes(result)).toEqual([queryDiagnosticCodes.invalidInput]);
    });

    it('create의 문서 ID가 다른 항목의 ID와 같으면 invalid_input으로 실패한다', () => {
      const result = planDocumentChanges(
        [
          { mode: 'update', id: 'c', revision: rev('c'), set: { 개요: '1' } },
          {
            mode: 'create',
            path: '.codocs/n.yaml',
            document: { _codocs: { id: 'c', name: '새문서' } },
          },
        ],
        planContext(),
      );

      expect(codes(result)).toEqual([queryDiagnosticCodes.invalidInput]);
    });

    it('move의 새 경로가 다른 항목의 원래 경로와 같으면 invalid_input으로 실패한다', () => {
      const result = planDocumentChanges(
        [
          { mode: 'update', id: 'c', revision: rev('c'), set: { 개요: '1' } },
          {
            mode: 'move',
            id: 'a',
            revision: rev('a'),
            path: '.codocs/c.yaml',
          },
        ],
        planContext(),
      );

      expect(codes(result)).toEqual([queryDiagnosticCodes.invalidInput]);
      expect(result.diagnostics[0]?.path).toBe('.codocs/c.yaml');
    });

    it('create 경로가 move의 새 경로와 같으면 invalid_input으로 실패한다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'create',
            path: '.codocs/x/n.yaml',
            document: { _codocs: { id: 'n', name: '새문서' } },
          },
          {
            mode: 'move',
            id: 'c',
            revision: rev('c'),
            path: '.codocs/x/n.yaml',
          },
        ],
        planContext(),
      );

      expect(codes(result)).toEqual([queryDiagnosticCodes.invalidInput]);
    });

    it('항목이 이름을 바꾸면 name_change_not_allowed로 실패한다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'update',
            id: 'c',
            revision: rev('c'),
            set: { _codocs: { id: 'c', name: '새이름' } },
          },
        ],
        planContext(),
      );

      expect(codes(result)).toEqual([
        changePlanDiagnosticCodes.nameChangeNotAllowed,
      ]);
    });
  });

  describe('delete 항목', () => {
    it('다른 문서가 참조하는 문서를 지우면 참조를 쓴 파일 경로와 위치를 담아 reference_broken으로 실패한다', () => {
      const result = planDocumentChanges([del('a')], planContext());

      expect(result.status).toBe(changePlanStatuses.failed);
      expect(codes(result)).toEqual([
        changePlanDiagnosticCodes.brokenReference,
      ]);
      expect(result.diagnostics[0]?.path).toBe('.codocs/b.yaml');
      expect(result.diagnostics[0]?.range).toBeDefined();
    });

    it('같은 계획에서 참조를 고치면 삭제가 후보가 되고 코드 확인이 필요하다고 알린다', () => {
      const result = planDocumentChanges(
        [
          del('a'),
          {
            mode: 'update',
            id: 'b',
            revision: rev('b'),
            set: { 개요: '참조 없음' },
          },
        ],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.requiresCodeEvidence).toBe(true);
      expect(result.items[0]).toMatchObject({
        mode: changePlanModes.delete,
        id: 'a',
        path: '.codocs/a.yaml',
        baseRevision: rev('a'),
        removedSections: ['개요'],
      });
      expect(result.items[0]?.raw).toBeUndefined();
    });

    it('같은 계획에서 참조한 문서도 함께 지우면 삭제가 후보가 된다', () => {
      const result = planDocumentChanges([del('a'), del('b')], planContext());

      expect(result.status).toBe(changePlanStatuses.candidate);
    });

    it('코드가 참조하는 문서를 지우면 reference_broken으로 실패한다', () => {
      const result = planDocumentChanges(
        [del('c')],
        planContext([
          { sourcePath: 'src/code.ts', text: '// @codocs [[다]]\n' },
        ]),
      );

      expect(codes(result)).toEqual([
        changePlanDiagnosticCodes.brokenReference,
      ]);
      expect(result.diagnostics[0]?.path).toBe('src/code.ts');
    });

    it('코드 참조가 없으면 코드 표기가 다른 문서를 가리켜도 삭제가 후보가 된다', () => {
      const result = planDocumentChanges(
        [del('c')],
        planContext([
          { sourcePath: 'src/code.ts', text: '// @codocs [[가]]\n' },
        ]),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
    });

    it('자식이 있는 문서를 지우면 자식 파일의 parent 항목 위치를 담아 reference_broken으로 실패한다', () => {
      const result = planDocumentChanges([del('p')], planContext());

      expect(result.status).toBe(changePlanStatuses.failed);
      expect(codes(result)).toEqual([
        changePlanDiagnosticCodes.brokenReference,
      ]);
      expect(result.diagnostics[0]).toMatchObject({
        path: '.codocs/child.yaml',
        fieldPath: ['_codocs', 'parent', 0],
      });
    });

    it('같은 계획에서 자식의 parent를 고치면 부모 삭제가 후보가 된다', () => {
      const result = planDocumentChanges(
        [
          del('p'),
          {
            mode: 'replace',
            id: 'child',
            revision: rev('child'),
            document: {
              _codocs: { id: 'child', name: '자식' },
              개요: '자식',
            },
          },
        ],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
    });

    it('같은 계획에서 자식도 지우면 부모 삭제가 후보가 된다', () => {
      const result = planDocumentChanges(
        [del('p'), del('child')],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
    });

    it('이번 계획과 무관하게 이미 끊겨 있던 parent는 실패 사유가 아니다', () => {
      files['.codocs/orphan.yaml'] = doc('orphan', '고아', '개요: 고아\n', [
        '없는부모',
      ]);
      try {
        const result = planDocumentChanges([del('c')], planContext());

        expect(result.status).toBe(changePlanStatuses.candidate);
      } finally {
        delete files['.codocs/orphan.yaml'];
      }
    });

    it('revision이 다르면 change_revision_mismatch로 실패한다', () => {
      const result = planDocumentChanges(
        [{ mode: 'delete', id: 'c', revision: 'old' }],
        planContext(),
      );

      expect(codes(result)).toEqual([
        changePlanDiagnosticCodes.revisionMismatch,
      ]);
      expect(result.diagnostics[0]?.path).toBe('.codocs/c.yaml');
    });

    it('delete 항목에 허용하지 않은 속성이 있으면 요청 오류로 실패한다', () => {
      const result = planDocumentChanges(
        [{ ...del('c'), path: '.codocs/z.yaml' }],
        planContext(),
      );

      expect(codes(result)).toEqual([changePlanDiagnosticCodes.invalidRequest]);
    });

    it('같은 ID가 여러 파일에 있으면 그 ID로 지우지 못한다', () => {
      files['.codocs/c2.yaml'] = doc('c', '다2', '개요: 중복\n');
      try {
        const context = planContext();
        const result = planDocumentChanges([del('c')], context);

        expect(codes(result)).toEqual([
          changePlanDiagnosticCodes.targetUnavailable,
        ]);
      } finally {
        delete files['.codocs/c2.yaml'];
      }
    });

    it('불완전한 탐색에서는 삭제를 확정하지 못한다', () => {
      const context = planContext();
      const result = planDocumentChanges([del('c')], {
        ...context,
        catalog: { ...context.catalog, status: scanStatuses.partial },
      });

      expect(codes(result)).toEqual([
        changePlanDiagnosticCodes.incompleteCatalog,
      ]);
    });
  });

  describe('섹션 제거와 코드 증거', () => {
    it('섹션을 지우는 후보는 코드 확인이 필요하고 제거 섹션을 항목에 담는다', () => {
      const result = planDocumentChanges(
        [{ mode: 'update', id: 'p', revision: rev('p'), unset: ['환불'] }],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.requiresCodeEvidence).toBe(true);
      expect(result.items[0]?.removedSections).toEqual(['환불']);
    });

    it('코드가 참조하는 섹션을 지우면 reference_broken으로 실패한다', () => {
      const result = planDocumentChanges(
        [{ mode: 'update', id: 'p', revision: rev('p'), unset: ['환불'] }],
        planContext([
          { sourcePath: 'src/code.ts', text: '// @codocs [[부모:환불]]\n' },
        ]),
      );

      expect(codes(result)).toEqual([
        changePlanDiagnosticCodes.brokenReference,
      ]);
    });

    it('텍스트만 고치는 후보는 코드 확인이 필요하지 않다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'update',
            id: 'c',
            revision: rev('c'),
            set: { 개요: '변경' },
          },
        ],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.requiresCodeEvidence).toBe(false);
    });
  });

  describe('move 항목', () => {
    it('문서를 옮기면 같은 ID와 이름으로 새 경로에 후보가 생기고 기존 참조는 유지된다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'move',
            id: 'a',
            revision: rev('a'),
            path: '.codocs/sub/a2.yaml',
          },
        ],
        planContext([
          { sourcePath: 'src/code.ts', text: '// @codocs [[가]]\n' },
        ]),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.items[0]).toMatchObject({
        mode: changePlanModes.move,
        id: 'a',
        path: '.codocs/sub/a2.yaml',
        previousPath: '.codocs/a.yaml',
        raw: files['.codocs/a.yaml'],
        baseRevision: rev('a'),
        changed: true,
      });
      expect(result.requiresCodeEvidence).toBe(false);
    });

    it('이미 있는 경로로 옮기면 change_path_exists로 실패한다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'move',
            id: 'a',
            revision: rev('a'),
            path: '.codocs/c.yaml',
          },
        ],
        planContext(),
      );

      expect(codes(result)).toEqual([changePlanDiagnosticCodes.pathExists]);
    });

    it('자기 경로로 옮기면 change_path_exists로 실패한다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'move',
            id: 'a',
            revision: rev('a'),
            path: '.codocs/a.yaml',
          },
        ],
        planContext(),
      );

      expect(codes(result)).toEqual([changePlanDiagnosticCodes.pathExists]);
    });

    it.each([
      '/abs/a.yaml',
      '.codocs/../a.yaml',
      '.codocs/./a.yaml',
      '.codocs//a.yaml',
      '.codocs\\a.yaml',
      '.codocs/a.txt',
      '',
    ])('옮길 경로 %j가 경로 규칙에 어긋나면 요청 오류로 실패한다', (path) => {
      const result = planDocumentChanges(
        [{ mode: 'move', id: 'a', revision: rev('a'), path }],
        planContext(),
      );

      expect(codes(result)).toEqual([changePlanDiagnosticCodes.invalidRequest]);
    });

    it('move 항목에 path가 없으면 요청 오류로 실패한다', () => {
      const result = planDocumentChanges(
        [{ mode: 'move', id: 'a', revision: rev('a') }],
        planContext(),
      );

      expect(codes(result)).toEqual([changePlanDiagnosticCodes.invalidRequest]);
    });

    it('같은 계획에서 한 문서를 옮기고 참조한 문서를 고쳐도 후보가 된다', () => {
      const result = planDocumentChanges(
        [
          {
            mode: 'move',
            id: 'a',
            revision: rev('a'),
            path: '.codocs/moved/a.yaml',
          },
          {
            mode: 'update',
            id: 'b',
            revision: rev('b'),
            set: { 개요: '[[가]] 그대로 참조' },
          },
        ],
        planContext(),
      );

      expect(result.status).toBe(changePlanStatuses.candidate);
    });
  });
});
