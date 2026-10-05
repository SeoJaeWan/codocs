import { describe, expect, it } from 'vitest';
import { applyRenameChanges } from '../change-plan/index.js';
import { parseYaml } from '../parser/index.js';
import {
  buildCatalog,
  planRename,
  planSectionRename,
  renameBlockingReasons,
  renameChangeKinds,
  renameImpactReasons,
  renamePlanStatuses,
  scanStatuses,
  type Catalog,
  type CatalogObservation,
  type RenameChange,
  type RenamePlan,
  type SectionRenameRequest,
} from './index.js';

/** 파일 경로와 원문으로 색인 관측을 만든다. */
function observe(path: string, source: string): CatalogObservation {
  return { path, parsed: parseYaml(source, path) };
}

const refundPath = '.codocs/refund.yaml';
const refund =
  '_codocs:\n  id: refund\n  name: 환불\n환불정책: 환불 규정 본문\n예외: 자기 참조 [[환불:환불정책]] 그리고 [[환불:예외]]\n';
const payment =
  '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불정책]] 와 [[환불:없는섹션]] 와 [[환불]]"\n';

/** 문서들로 완전한 색인을 만든다. */
function catalogOf(
  files: Record<string, string>,
  status: Catalog['status'] = scanStatuses.complete,
): Catalog {
  return buildCatalog({
    status,
    observations: Object.entries(files).map(([path, source]) =>
      observe(path, source),
    ),
  });
}

/** 계획을 파일별 원문에 적용해 새 원문을 돌려준다. 하나라도 실패하면 오류를 낸다. */
function applyPlan(
  files: Record<string, string>,
  plan: RenamePlan,
): Record<string, string> {
  const result = { ...files };
  for (const path of new Set(plan.changes.map((change) => change.path))) {
    const parsed = parseYaml(files[path] ?? '', path);
    if (!parsed.success) throw new Error('입력 원문이 파싱되지 않았다');
    const edited = applyRenameChanges(
      parsed,
      plan.changes.filter((change) => change.path === path),
    );
    if (!edited.success) throw new Error(`적용 실패: ${path}`);
    result[path] = edited.raw;
  }
  return result;
}

const request = {
  targetPath: refundPath,
  section: '환불정책',
  newName: '환불 규정',
} satisfies SectionRenameRequest;

describe('planSectionRename: 섹션 이름 변경 계획', () => {
  describe('키와 확정 참조의 수정안 생성', () => {
    const files = { [refundPath]: refund, '.codocs/payment.yaml': payment };

    it('키 수정안과 이 섹션으로 확정된 다른 문서·같은 문서 참조의 섹션 부분만 수정안으로 만든다', () => {
      const plan = planSectionRename(catalogOf(files), request);

      expect(plan).toMatchObject({
        status: renamePlanStatuses.ready,
        targetPath: refundPath,
        oldName: '환불정책',
        newName: '환불 규정',
        targetSection: '환불정책',
        impacts: [],
        conflicts: [],
      });
      expect(
        plan.changes.map((change) => [change.path, change.oldText]),
      ).toEqual([
        ['.codocs/payment.yaml', '환불정책'],
        [refundPath, '환불정책'],
        [refundPath, '환불정책'],
      ]);
      const key = plan.changes.find(
        (change) => change.kind === renameChangeKinds.key,
      );
      expect(key).toMatchObject({
        path: refundPath,
        fieldPath: ['환불정책'],
        newText: '환불 규정',
        targetPath: refundPath,
      });
      expect(key?.occurrenceIndex).toBeUndefined();
      expect(
        plan.changes.filter((change) => change.occurrenceIndex !== undefined),
      ).toHaveLength(2);
    });

    it('적용하면 키와 확정 참조만 바뀌고 없는 섹션·문서 전체 참조·다른 섹션 참조는 그대로다', () => {
      const plan = planSectionRename(catalogOf(files), request);
      const next = applyPlan(files, plan);

      expect(next[refundPath]).toBe(
        '_codocs:\n  id: refund\n  name: 환불\n환불 규정: 환불 규정 본문\n예외: 자기 참조 [[환불:환불 규정]] 그리고 [[환불:예외]]\n',
      );
      expect(next['.codocs/payment.yaml']).toBe(
        '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불 규정]] 와 [[환불:없는섹션]] 와 [[환불]]"\n',
      );
      const after = catalogOf(next);
      const references = [...after.documents.values()].flatMap((doc) =>
        doc.occurrences.map((item) => item.resolution.status),
      );
      expect(references).not.toContain('ambiguous');
      expect(
        (after.documents.get(refundPath)?.sectionReferencedBy ?? []).filter(
          (item) => item.targetSection !== undefined,
        ),
      ).toEqual([
        expect.objectContaining({
          sourceSection: '취소',
          targetSection: '환불 규정',
        }),
      ]);
    });

    it('다른 문서의 같은 이름 섹션을 가리키는 참조는 고치지 않는다', () => {
      const other =
        '_codocs:\n  id: sale\n  name: 판매\n환불정책: 판매 쪽 환불정책\n';
      const refer =
        '_codocs:\n  id: ref\n  name: 참조\n본문: "[[판매:환불정책]] [[환불:환불정책]]"\n';
      const all = {
        [refundPath]: refund,
        '.codocs/sale.yaml': other,
        '.codocs/ref.yaml': refer,
      };
      const plan = planSectionRename(catalogOf(all), request);

      expect(plan.changes.map((change) => change.path)).not.toContain(
        '.codocs/sale.yaml',
      );
      expect(applyPlan(all, plan)['.codocs/ref.yaml']).toBe(
        '_codocs:\n  id: ref\n  name: 참조\n본문: "[[판매:환불정책]] [[환불:환불 규정]]"\n',
      );
    });

    it('새 이름에 콜론이 있으면 참조에는 \\: 로 적고 키에는 그대로 적는다', () => {
      const plan = planSectionRename(catalogOf(files), {
        ...request,
        newName: '가:나',
      });
      expect(plan.status).toBe(renamePlanStatuses.ready);
      const next = applyPlan(files, plan);

      expect(next['.codocs/payment.yaml']).toContain('[[환불:가\\\\:나]]');
      const after = catalogOf(next);
      expect(
        after.documents
          .get(refundPath)
          ?.sectionReferencedBy.map((item) => item.targetSection),
      ).toContain('가:나');
    });

    it('기존 섹션 이름에 콜론이 있어도 \\: 로 적힌 참조를 정확히 고친다', () => {
      const colon = '_codocs:\n  id: refund\n  name: 환불\n"가:나": 본문\n';
      const refer =
        '_codocs:\n  id: ref\n  name: 참조\n본문: "[[환불:가\\\\:나]]"\n';
      const all = { [refundPath]: colon, '.codocs/ref.yaml': refer };
      const plan = planSectionRename(catalogOf(all), {
        targetPath: refundPath,
        section: '가:나',
        newName: '다',
      });
      const next = applyPlan(all, plan);

      expect(next[refundPath]).toContain('"다": 본문');
      expect(next['.codocs/ref.yaml']).toContain('[[환불:다]]');
    });
  });

  describe('모호한 문서 참조의 선택 흐름', () => {
    const duplicate =
      '_codocs:\n  id: refund2\n  name: 환불\n환불정책: 다른 문서\n';
    const refer =
      '_codocs:\n  id: ref\n  name: 참조\n본문: "[[환불:환불정책]]"\n';
    const all = {
      [refundPath]: '_codocs:\n  id: refund\n  name: 환불\n환불정책: 본문\n',
      '.codocs/refund2.yaml': duplicate,
      '.codocs/ref.yaml': refer,
    };

    it('선택이 없으면 selection_required 영향으로 남기고 unresolved다', () => {
      const plan = planSectionRename(catalogOf(all), request);

      expect(plan.status).toBe(renamePlanStatuses.unresolved);
      expect(plan.impacts).toEqual([
        expect.objectContaining({
          path: '.codocs/ref.yaml',
          reason: renameImpactReasons.selectionRequired,
        }),
      ]);
      expect(plan.changes.map((change) => change.kind)).toEqual([
        renameChangeKinds.key,
      ]);
    });

    it('대상 문서를 선택하면 그 참조를 고친다', () => {
      const plan = planSectionRename(catalogOf(all), {
        ...request,
        selections: [
          {
            sourcePath: '.codocs/ref.yaml',
            occurrenceIndex: 0,
            targetPath: refundPath,
          },
        ],
      });

      expect(plan.status).toBe(renamePlanStatuses.ready);
      expect(applyPlan(all, plan)['.codocs/ref.yaml']).toContain(
        '[[환불:환불 규정]]',
      );
    });

    it('다른 후보를 선택하면 그 참조는 그대로 둔다', () => {
      const plan = planSectionRename(catalogOf(all), {
        ...request,
        selections: [
          {
            sourcePath: '.codocs/ref.yaml',
            occurrenceIndex: 0,
            targetPath: '.codocs/refund2.yaml',
          },
        ],
      });

      expect(plan.status).toBe(renamePlanStatuses.ready);
      expect(plan.changes.map((change) => change.path)).toEqual([refundPath]);
    });

    it('후보에 없는 대상이나 존재하지 않는 등장을 고르면 invalid_selection으로 blocked다', () => {
      for (const selection of [
        {
          sourcePath: '.codocs/ref.yaml',
          occurrenceIndex: 0,
          targetPath: '.codocs/nope.yaml',
        },
        {
          sourcePath: '.codocs/ref.yaml',
          occurrenceIndex: 5,
          targetPath: refundPath,
        },
      ]) {
        const plan = planSectionRename(catalogOf(all), {
          ...request,
          selections: [selection],
        });
        expect(plan).toMatchObject({
          status: renamePlanStatuses.blocked,
          blockingReason: renameBlockingReasons.invalidSelection,
          invalidSelections: [selection],
          changes: [],
        });
      }
    });
  });

  describe('진행할 수 없는 요청', () => {
    const files = { [refundPath]: refund, '.codocs/payment.yaml': payment };

    it.each([
      {
        title: '같은 이름의 섹션이 있으면 section_conflict',
        files: {
          [refundPath]: `${refund}환불 규정: 이미 있음\n`,
        },
        change: {},
        reason: renameBlockingReasons.sectionConflict,
      },
      {
        title: '대상 섹션이 없으면 section_not_found',
        files,
        change: { section: '없는섹션' },
        reason: renameBlockingReasons.sectionNotFound,
      },
      {
        title: '_codocs는 섹션이 아니므로 section_not_found',
        files,
        change: { section: '_codocs' },
        reason: renameBlockingReasons.sectionNotFound,
      },
      {
        title: '기존 이름과 같으면 invalid_name',
        files,
        change: { newName: '환불정책' },
        reason: renameBlockingReasons.invalidName,
      },
      {
        title: '빈 이름은 invalid_name',
        files,
        change: { newName: '  ' },
        reason: renameBlockingReasons.invalidName,
      },
      {
        title: '_로 시작하면 invalid_name',
        files,
        change: { newName: '_숨김' },
        reason: renameBlockingReasons.invalidName,
      },
      {
        title: '대괄호를 포함하면 invalid_name',
        files,
        change: { newName: '가[나' },
        reason: renameBlockingReasons.invalidName,
      },
      {
        title: '없는 문서는 target_unavailable',
        files,
        change: { targetPath: '.codocs/none.yaml' },
        reason: renameBlockingReasons.targetUnavailable,
      },
    ])('$title이며 수정안이 없다', ({ files: input, change, reason }) => {
      const plan = planSectionRename(catalogOf(input), {
        ...request,
        ...change,
      });

      expect(plan).toMatchObject({
        status: renamePlanStatuses.blocked,
        blockingReason: reason,
        changes: [],
        targetSection: change.section ?? '환불정책',
      });
    });

    it('중복 섹션의 충돌 문서를 conflicts에 담는다', () => {
      const plan = planSectionRename(
        catalogOf({ [refundPath]: `${refund}환불 규정: 이미 있음\n` }),
        request,
      );

      expect(plan.conflicts).toEqual([
        { candidates: [expect.objectContaining({ path: refundPath })] },
      ]);
    });

    it('탐색이 끝나지 않았으면 unconfirmed다', () => {
      const plan = planSectionRename(
        catalogOf(files, scanStatuses.partial),
        request,
      );

      expect(plan).toMatchObject({
        status: renamePlanStatuses.blocked,
        blockingReason: renameBlockingReasons.unconfirmed,
        changes: [],
      });
    });
  });

  describe('문서 이름 변경 호환', () => {
    it('section 없는 planRename 결과에는 kind와 targetSection이 없다', () => {
      const plan = planRename(
        catalogOf({ [refundPath]: refund, '.codocs/payment.yaml': payment }),
        { targetPath: refundPath, newName: '새환불' },
      );

      expect(plan.targetSection).toBeUndefined();
      expect(plan.changes.every((change: RenameChange) => !change.kind)).toBe(
        true,
      );
    });
  });
});
