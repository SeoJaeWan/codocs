import { describe, expect, it } from 'vitest';
import { buildCatalog, scanStatuses, type Catalog } from '../catalog/index.js';
import { extractCodeReferences } from '../code-reference/index.js';
import {
  changePlanDiagnosticCodes,
  diagnosticSeverities,
} from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import { changePlanStatuses, planDocumentChange } from './index.js';

const targetPath = '.codocs/target.yaml';
const targetRaw =
  '# 앞 주석\n_codocs:\n  id: target # id 주석\n  name: "대상"\n개요:   설명\n환불정책: 환불\n배송정책: 배송\n';

/** 경로별 원문으로 완료된 색인을 만든다. */
function catalogOf(
  files: Record<string, string>,
  status: Catalog['status'] = scanStatuses.complete,
): Catalog {
  return buildCatalog({
    status,
    observations: Object.entries(files).map(([path, raw]) => ({
      path,
      parsed: parseYaml(raw, path),
    })),
  });
}

/** 대상 문서를 수정할 수 있는 계획 문맥을 만든다. */
function contextOf(
  files: Record<string, string> = {},
  codeReferences: readonly { sourcePath: string; text: string }[] = [],
) {
  const catalog = catalogOf({ [targetPath]: targetRaw, ...files });
  return {
    catalog,
    source: {
      path: targetPath,
      raw: targetRaw,
      revision: 'r1',
      utf8Lossless: true,
    },
    codeReferences: codeReferences.flatMap((item) =>
      extractCodeReferences(item.text).map((marker) => ({
        sourcePath: item.sourcePath,
        marker,
      })),
    ),
  };
}

/** replace 요청을 만든다. */
function replace(document: Record<string, unknown>) {
  return { mode: 'replace', id: 'target', revision: 'r1', document };
}
const metadata = { id: 'target', name: '대상' };

describe('planDocumentChange replace', () => {
  it('생략한 섹션을 삭제하고 같은 값의 원문 주석과 따옴표와 간격은 보존한다', () => {
    const result = planDocumentChange(
      replace({ _codocs: metadata, 개요: '설명', 환불정책: '새 환불' }),
      contextOf(),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status !== changePlanStatuses.candidate) return;
    expect(result.raw).toBe(
      '# 앞 주석\n_codocs:\n  id: target # id 주석\n  name: "대상"\n개요:   설명\n환불정책: 새 환불\n',
    );
    expect(result.removedSections).toEqual(['배송정책']);
    expect(result.baseRevision).toBe('r1');
  });

  it('새 키는 입력 순서대로 기존 키 뒤에 추가하고 metadata 전체 교체를 검증한다', () => {
    const result = planDocumentChange(
      replace({
        _codocs: { ...metadata, id: 'target-2' },
        개요: '설명',
        환불정책: '환불',
        배송정책: '배송',
        다음: 'b',
        가: 'a',
      }),
      contextOf(),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status !== changePlanStatuses.candidate) return;
    expect(result.id).toBe('target-2');
    expect(result.raw.startsWith('# 앞 주석\n_codocs:\n  id: target-2\n')).toBe(
      true,
    );
    expect(result.raw).toContain('개요:   설명\n');
    expect(result.raw.endsWith('배송정책: 배송\n다음: b\n가: a\n')).toBe(true);
    expect(result.removedSections).toEqual([]);
  });

  it('입력 순서만 바꾸면 변경 없음으로 처리한다', () => {
    const result = planDocumentChange(
      replace({
        배송정책: '배송',
        환불정책: '환불',
        개요: '설명',
        _codocs: metadata,
      }),
      contextOf(),
    );
    expect(result.status).toBe(changePlanStatuses.unchanged);
  });

  it('name을 바꾸거나 _codocs가 없거나 알 수 없는 속성이 있으면 거절한다', () => {
    const cases = [
      replace({ _codocs: { ...metadata, name: '다른' }, 개요: '설명' }),
      replace({ 개요: '설명' }),
      { ...replace({ _codocs: metadata }), set: { 개요: 'x' } },
      { ...replace({ _codocs: metadata }), extra: true },
    ];
    for (const request of cases) {
      const result = planDocumentChange(request, contextOf());
      expect(result.status).toBe(changePlanStatuses.failed);
    }
  });

  it('revision이 다르면 거절한다', () => {
    const result = planDocumentChange(
      { ...replace({ _codocs: metadata }), revision: 'old' },
      contextOf(),
    );
    expect(result.status).toBe(changePlanStatuses.failed);
    if (result.status === changePlanStatuses.failed)
      expect(result.diagnostics[0]?.code).toBe(
        changePlanDiagnosticCodes.revisionMismatch,
      );
  });
});

describe('planDocumentChange 참조 영향', () => {
  const referrer =
    '_codocs:\n  id: referrer\n  name: 참조자\n본문: "[[대상:배송정책]] 참고"\n';

  it('다른 문서가 참조하는 섹션을 삭제하면 출처 경로와 위치를 담아 거절한다', () => {
    const result = planDocumentChange(
      { mode: 'update', id: 'target', revision: 'r1', unset: ['배송정책'] },
      contextOf({ '.codocs/referrer.yaml': referrer }),
    );
    expect(result.status).toBe(changePlanStatuses.failed);
    if (result.status !== changePlanStatuses.failed) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: changePlanDiagnosticCodes.brokenReference,
      severity: diagnosticSeverities.error,
      path: '.codocs/referrer.yaml',
      fieldPath: ['본문'],
    });
    expect(result.diagnostics[0]?.range?.start.line).toBe(3);
  });

  it('전체 교체로 참조된 섹션을 생략해도 같은 이유로 거절한다', () => {
    const result = planDocumentChange(
      replace({ _codocs: metadata, 개요: '설명', 환불정책: '환불' }),
      contextOf({ '.codocs/referrer.yaml': referrer }),
    );
    expect(result.status).toBe(changePlanStatuses.failed);
  });

  it('참조되지 않은 섹션 삭제는 허용하고 무관한 기존 오류는 막지 않는다', () => {
    const broken =
      '_codocs:\n  id: broken\n  name: 깨짐\n본문: "[[없는문서]] [[대상:없는섹션]]"\n';
    const whole =
      '_codocs:\n  id: whole\n  name: 전체\n본문: "[[대상]] 전체 참조"\n';
    const result = planDocumentChange(
      replace({ _codocs: metadata, 개요: '설명', 환불정책: '환불' }),
      contextOf({
        '.codocs/broken.yaml': broken,
        '.codocs/whole.yaml': whole,
      }),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
  });

  it('id만 바꾸는 요청은 이름으로 연결한 참조를 끊지 않는다', () => {
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'target',
        revision: 'r1',
        set: { _codocs: { ...metadata, id: 'moved' } },
      },
      contextOf({ '.codocs/referrer.yaml': referrer }),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
  });

  it('코드가 참조하는 섹션 삭제는 코드 경로와 위치로 거절하고 문서 전체 참조는 유지한다', () => {
    const request = {
      mode: 'update',
      id: 'target',
      revision: 'r1',
      unset: ['배송정책'],
    };
    const result = planDocumentChange(
      request,
      contextOf({}, [
        {
          sourcePath: 'src/a.ts',
          text: '// @codocs [[대상]]\n// @codocs [[대상:배송정책]]\n',
        },
      ]),
    );
    expect(result.status).toBe(changePlanStatuses.failed);
    if (result.status !== changePlanStatuses.failed) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: changePlanDiagnosticCodes.brokenReference,
      path: 'src/a.ts',
      range: { start: { line: 1, character: 3 } },
    });
  });

  it('이미 끊긴 코드 참조와 다른 섹션 참조는 삭제를 막지 않는다', () => {
    const result = planDocumentChange(
      { mode: 'update', id: 'target', revision: 'r1', unset: ['배송정책'] },
      contextOf({}, [
        {
          sourcePath: 'src/a.ts',
          text: '// @codocs [[대상:없음]]\n// @codocs [[대상:환불정책]]\n',
        },
      ]),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
  });
});
