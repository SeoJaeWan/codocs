import { describe, expect, it } from 'vitest';
import {
  catalogConfirmations,
  scanStatuses,
  type Catalog,
} from '../catalog/index.js';
import {
  changePlanDiagnosticCodes,
  changePlanDiagnosticMessages,
  diagnosticSeverities,
} from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import { changePlanStatuses, planDocumentChange } from './index.js';

const path = '.codocs/zone.yaml';
const original = [
  '_codocs:',
  '  id: zone',
  '  name: 구역',
  '개요: |',
  '  구역은 배송 범위다.',
  '  구역은 지도에 그린다.',
  '# 생성 규칙 설명',
  'create: 구역을 만든다.',
  '결과: 결과를 돌려준다.',
  '',
].join('\n');

/** 원문 하나를 가진 문서의 계획 문맥을 만든다. */
function contextFor(raw: string) {
  const parsed = parseYaml(raw, path);
  if (!parsed.success) throw new Error('fixture YAML 오류');
  const catalog: Catalog = {
    status: scanStatuses.complete,
    failures: [],
    documents: new Map([
      [
        path,
        {
          path,
          id: 'zone',
          name: '구역',
          confirmation: catalogConfirmations.confirmed,
          observation: { path, parsed },
          documentDiagnostics: [],
          diagnostics: [],
          occurrences: [],
          references: [],
          referencedBy: [],
          sectionReferencedBy: [],
        },
      ],
    ]),
    idPaths: new Map([['zone', new Set([path])]]),
    namePaths: new Map([['구역', new Set([path])]]),
  };
  return {
    catalog,
    source: { path, raw, revision: 'old-revision', utf8Lossless: true },
  };
}

/** 원래 문서에 update 요청 하나를 계획한다. */
function plan(change: Record<string, unknown>, raw = original) {
  return planDocumentChange(
    { mode: 'update', id: 'zone', revision: 'old-revision', ...change },
    contextFor(raw),
  );
}

/** 계획이 해당 코드 하나로 실패했는지 확인한다. */
function expectFailure(
  result: ReturnType<typeof plan>,
  code: keyof typeof changePlanDiagnosticCodes,
): void {
  expect(result).toEqual({
    status: changePlanStatuses.failed,
    diagnostics: [
      expect.objectContaining({
        code: changePlanDiagnosticCodes[code],
        severity: diagnosticSeverities.error,
        message: changePlanDiagnosticMessages[code],
      }),
    ],
  });
}

describe('update edit: 섹션 안 부분 바꾸기', () => {
  it('old가 한 번 나오면 그 글자만 바꾸고 다른 섹션의 원문은 그대로 둔다', () => {
    const result = plan({
      edit: [{ section: '개요', old: '지도에 그린다', new: '지도에 표시한다' }],
    });

    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status !== changePlanStatuses.candidate) return;
    expect(result.data['개요']).toBe(
      '구역은 배송 범위다.\n구역은 지도에 표시한다.\n',
    );
    expect(result.raw).toBe(
      original.replace('지도에 그린다', '지도에 표시한다'),
    );
  });

  it('같은 섹션의 edit 여러 개는 적은 순서대로 직전 결과에 적용한다', () => {
    const result = plan({
      edit: [
        { section: 'create', old: '구역을', new: '새 구역을' },
        {
          section: 'create',
          old: '새 구역을 만든다',
          new: '새 구역을 등록한다',
        },
      ],
    });

    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate)
      expect(result.data.create).toBe('새 구역을 등록한다.');
  });

  it('old를 찾지 못하면 edit_text_not_found, 여러 번 나오면 edit_text_ambiguous로 실패한다', () => {
    expectFailure(
      plan({ edit: [{ section: '개요', old: '없는 문장', new: 'x' }] }),
      'editTextNotFound',
    );
    expectFailure(
      plan({ edit: [{ section: '개요', old: '구역은', new: '영역은' }] }),
      'editTextAmbiguous',
    );
  });

  it('없는 섹션을 edit하면 change_section_not_found로 실패한다', () => {
    expectFailure(
      plan({ edit: [{ section: '없음', old: 'a', new: 'b' }] }),
      'sectionNotFound',
    );
  });

  it('같은 섹션을 set과 edit으로 함께 바꾸거나 _codocs를 edit하면 잘못된 요청이다', () => {
    expectFailure(
      plan({
        set: { create: '다시 쓴 본문' },
        edit: [{ section: 'create', old: '구역', new: '영역' }],
      }),
      'invalidRequest',
    );
    expectFailure(
      plan({ edit: [{ section: '_codocs', old: 'zone', new: 'area' }] }),
      'invalidRequest',
    );
  });
});

describe('update position: 섹션 위치 지정', () => {
  it('set으로 더한 새 섹션을 기준 섹션 뒤에 넣는다', () => {
    const result = plan({
      set: { update: '구역을 고친다.' },
      position: { update: { after: 'create' } },
    });

    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status !== changePlanStatuses.candidate) return;
    expect(Object.keys(result.data)).toEqual([
      '_codocs',
      '개요',
      'create',
      'update',
      '결과',
    ]);
    expect(result.raw).toBe(
      original.replace(
        'create: 구역을 만든다.\n',
        'create: 구역을 만든다.\nupdate: 구역을 고친다.\n',
      ),
    );
  });

  it('기존 섹션을 옮기면 바로 위 주석을 함께 옮기고 내용은 바꾸지 않는다', () => {
    const result = plan({ position: { create: { before: '개요' } } });

    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status !== changePlanStatuses.candidate) return;
    expect(result.raw).toBe(
      [
        '_codocs:',
        '  id: zone',
        '  name: 구역',
        '# 생성 규칙 설명',
        'create: 구역을 만든다.',
        '개요: |',
        '  구역은 배송 범위다.',
        '  구역은 지도에 그린다.',
        '결과: 결과를 돌려준다.',
        '',
      ].join('\n'),
    );
  });

  it('여러 위치 지정은 적은 순서대로 직전 결과를 기준으로 옮긴다', () => {
    const result = plan({
      position: { 결과: { after: '_codocs' }, create: { after: '결과' } },
    });

    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate)
      expect(Object.keys(result.data)).toEqual([
        '_codocs',
        '결과',
        'create',
        '개요',
      ]);
  });

  it('edit과 position을 함께 주면 내용과 위치를 모두 반영한다', () => {
    const result = plan({
      edit: [{ section: '결과', old: '돌려준다', new: '반환한다' }],
      position: { 결과: { before: 'create' } },
    });

    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status !== changePlanStatuses.candidate) return;
    expect(result.data['결과']).toBe('결과를 반환한다.');
    expect(Object.keys(result.data)).toEqual([
      '_codocs',
      '개요',
      '결과',
      'create',
    ]);
  });

  it('이미 그 자리에 있으면 바뀐 것이 없는 요청으로 본다', () => {
    const result = plan({ position: { 결과: { after: 'create' } } });

    expect(result.status).toBe(changePlanStatuses.unchanged);
  });

  it('없는 섹션이나 없는 기준을 지정하면 change_section_not_found로 실패한다', () => {
    expectFailure(
      plan({ position: { 없음: { after: '개요' } } }),
      'sectionNotFound',
    );
    expectFailure(
      plan({ position: { create: { after: '없음' } } }),
      'sectionNotFound',
    );
  });

  it('_codocs를 옮기거나 그 앞에 두거나 자기 자신·지우는 섹션을 기준으로 삼으면 잘못된 요청이다', () => {
    for (const change of [
      { position: { _codocs: { after: '개요' } } },
      { position: { create: { before: '_codocs' } } },
      { position: { create: { after: 'create' } } },
      { unset: ['결과'], position: { create: { after: '결과' } } },
      { position: { create: { beside: '개요' } } },
      { position: { create: { after: '개요', before: '결과' } } },
    ])
      expectFailure(plan(change), 'invalidRequest');
  });
});
