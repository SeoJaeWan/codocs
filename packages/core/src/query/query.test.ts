import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  catalogConfirmations,
  referenceResolutionStatuses,
  scanStatuses,
  type Catalog,
  type CatalogDocument,
  type CatalogObservation,
} from '../catalog/index.js';
import { parseYaml } from '../parser/index.js';
import {
  catalogDiagnosticCodes,
  diagnosticSeverities,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  schemaDiagnosticCodes,
} from '../diagnostics/index.js';
import {
  projectCatalogDiagnostics,
  projectLiveReferences,
  countCatalogListItems,
  projectCatalogGet,
  projectCatalogList,
  projectCatalogPaths,
  type CatalogQueryDiagnostic,
} from './index.js';

const parsedBase = {
  success: true as const,
  source: '',
  fields: [],
  strings: [],
  diagnostics: [],
};
const documentBase = {
  confirmation: catalogConfirmations.confirmed,
  documentDiagnostics: [],
  diagnostics: [],
  occurrences: [],
  references: [],
  referencedBy: [],
  sectionReferencedBy: [],
} satisfies Pick<
  CatalogDocument,
  | 'confirmation'
  | 'documentDiagnostics'
  | 'diagnostics'
  | 'occurrences'
  | 'references'
  | 'referencedBy'
  | 'sectionReferencedBy'
>;
const catalogBase: Catalog = {
  status: scanStatuses.complete,
  failures: [],
  documents: new Map(),
  idPaths: new Map(),
  namePaths: new Map(),
};
const alpha = {
  ...documentBase,
  path: 'a.yaml',
  id: 'a',
  name: 'A',
  observation: {
    path: 'a.yaml',
    parsed: {
      ...parsedBase,
      source: '_codocs:\n  id: a\n  name: A\n',
      data: { _codocs: { id: 'a', name: 'A' }, definition: '설명' },
    },
  },
} satisfies CatalogDocument;
/** 문서 하나의 YAML 원문을 만든다. parent는 `parent:` 뒤에 그대로 붙일 YAML 조각이다. */
function documentSource(
  id: string,
  name: string,
  options: { parent?: string; body?: string } = {},
): string {
  return (
    `_codocs:\n  id: ${id}\n  name: ${name}\n` +
    (options.parent === undefined ? '' : `  parent:${options.parent}\n`) +
    (options.body ?? '개요: 설명\n')
  );
}

/** 실제 파서로 관측한 원문들에서 Catalog를 만든다. */
function catalogFromSources(
  sources: Record<string, string>,
  status: Catalog['status'] = scanStatuses.complete,
): Catalog {
  return buildCatalog({
    status,
    observations: Object.entries(sources).map(([path, source]) => ({
      path,
      parsed: parseYaml(source, path),
    })),
  });
}

/** list 결과의 항목 이름만 순서대로 꺼낸다. */
function listedNames(items: readonly { name: string }[]): string[] {
  return items.map((item) => item.name);
}

describe('projectCatalogList: Catalog parent 기준 목록 투영', () => {
  const tree = catalogFromSources({
    'dev.yaml': documentSource('dev', '개발', {
      body: '개요: 설명\n규칙: 내용\n',
    }),
    'api.yaml': documentSource('api', 'API', { parent: '\n    - 개발' }),
    'test.yaml': documentSource('test', '테스트', { parent: '\n    - 개발' }),
    'both.yaml': documentSource('both', '공통', {
      parent: '\n    - 개발\n    - 운영',
    }),
    'ops.yaml': documentSource('ops', '운영'),
    'leaf.yaml': documentSource('leaf', '말단', { parent: '\n    - API' }),
  });

  describe('최상위 문서와 직속 자식', () => {
    it('parent를 생략하면 parent를 적지 않은 문서만 이름 순서로 반환한다', () => {
      const result = projectCatalogList(tree);

      expect(listedNames(result.items)).toEqual(['개발', '운영']);
      expect(result.parentFound).toBe(true);
    });

    it('항목에 섹션 이름과 childCount를 담고 섹션 내용은 담지 않는다', () => {
      const result = projectCatalogList(tree);

      expect(result.items[0]).toEqual({
        name: '개발',
        id: 'dev',
        hasErrors: false,
        sections: ['개요', '규칙'],
        childCount: 3,
        source: { path: 'dev.yaml' },
        confirmation: catalogConfirmations.confirmed,
        conflict: false,
      });
      expect(JSON.stringify(result.items)).not.toContain('내용');
    });

    it('parent를 주면 그 이름을 parent로 적은 직속 자식만 이름 순서로 반환한다', () => {
      const result = projectCatalogList(tree, { parent: '개발' });

      expect(listedNames(result.items)).toEqual(['API', '공통', '테스트']);
      expect(result.unreachable).toBeUndefined();
    });

    it('parent를 여럿 적은 문서는 각 parent의 결과에 모두 나온다', () => {
      const dev = projectCatalogList(tree, { parent: '개발' });
      const ops = projectCatalogList(tree, { parent: '운영' });

      expect(listedNames(dev.items)).toContain('공통');
      expect(listedNames(ops.items)).toEqual(['공통']);
    });

    it('손자는 조상의 직속 자식 결과에 나오지 않는다', () => {
      const result = projectCatalogList(tree, { parent: '개발' });

      expect(listedNames(result.items)).not.toContain('말단');
    });

    it('같은 parent를 두 번 적은 문서의 childCount는 한 번만 센다', () => {
      const catalog = catalogFromSources({
        'a.yaml': documentSource('a', '상위'),
        'b.yaml': documentSource('b', '하위', {
          parent: '\n    - 상위\n    - 상위',
        }),
      });

      expect(projectCatalogList(catalog).items[0]?.childCount).toBe(1);
    });

    it('이름이 같은 문서는 경로 순서로 반환한다', () => {
      const catalog = catalogFromSources({
        'z.yaml': documentSource('z', '같은 이름'),
        'a.yaml': documentSource('a', '같은 이름'),
      });

      const result = projectCatalogList(catalog);

      expect(result.items.map((item) => item.source.path)).toEqual([
        'a.yaml',
        'z.yaml',
      ]);
    });

    it('이름은 UTF-16 코드 단위 순서로 정렬한다', () => {
      const catalog = catalogFromSources({
        '1.yaml': documentSource('n1', '나'),
        '2.yaml': documentSource('n2', '가'),
        '3.yaml': documentSource('n3', 'b'),
        '4.yaml': documentSource('n4', 'B'),
      });

      expect(listedNames(projectCatalogList(catalog).items)).toEqual([
        'B',
        'b',
        '가',
        '나',
      ]);
    });
  });

  describe('없는 parent와 자식 없는 parent', () => {
    it('없는 이름을 parent로 주면 parentFound가 false다', () => {
      const result = projectCatalogList(tree, { parent: '없음' });

      expect(result).toEqual({ items: [], parentFound: false });
    });

    it('자식이 없는 문서를 parent로 주면 빈 items와 parentFound true를 반환한다', () => {
      const result = projectCatalogList(tree, { parent: '말단' });

      expect(result).toEqual({ items: [], parentFound: true });
    });

    it('문서가 없어도 그 이름을 parent로 적은 문서는 반환한다', () => {
      const catalog = catalogFromSources({
        'o.yaml': documentSource('o', '고아', { parent: '\n    - 성능' }),
      });

      const result = projectCatalogList(catalog, { parent: '성능' });

      expect(listedNames(result.items)).toEqual(['고아']);
      expect(result.parentFound).toBe(false);
    });
  });

  describe('최상위 문서에서 닿을 수 없는 문서', () => {
    it.each([
      {
        label: 'parent에 적은 이름의 문서가 하나도 없는 문서',
        sources: {
          'o.yaml': documentSource('o', '고아', { parent: '\n    - 성능' }),
        },
        hasErrors: true,
      },
      {
        label: 'parent 순환에 속한 문서',
        sources: {
          'a.yaml': documentSource('a', '가', { parent: '\n    - 나' }),
          'b.yaml': documentSource('b', '나', { parent: '\n    - 가' }),
        },
        hasErrors: true,
      },
      {
        label: 'parent가 빈 배열인 문서',
        sources: { 'm.yaml': documentSource('m', '형식', { parent: ' []' }) },
        hasErrors: false,
      },
      {
        label: 'parent가 빈 문자열인 문서',
        sources: { 'm.yaml': documentSource('m', '형식', { parent: ' ""' }) },
        hasErrors: true,
      },
      {
        label: 'parent가 배열이 아닌 문서',
        sources: { 'm.yaml': documentSource('m', '형식', { parent: ' 성능' }) },
        hasErrors: true,
      },
    ])(
      '$label 이면 items가 아니라 unreachable에 나온다',
      ({ sources, hasErrors }) => {
        const result = projectCatalogList(catalogFromSources(sources));

        expect(result.items).toEqual([]);
        expect(result.unreachable?.length).toBeGreaterThan(0);
        expect(
          result.unreachable?.every((item) => item.hasErrors === hasErrors),
        ).toBe(true);
      },
    );

    it('parent 중 하나라도 최상위 문서에서 닿으면 unreachable에 넣지 않는다', () => {
      const catalog = catalogFromSources({
        'dev.yaml': documentSource('dev', '개발'),
        'x.yaml': documentSource('x', '혼합', {
          parent: '\n    - 개발\n    - 없음',
        }),
      });

      const result = projectCatalogList(catalog);

      expect(result.unreachable).toEqual([]);
      expect(
        listedNames(projectCatalogList(catalog, { parent: '개발' }).items),
      ).toEqual(['혼합']);
    });

    it('unreachable 문서의 자식은 unreachable에 넣지 않고 그 이름의 자식으로 조회한다', () => {
      const catalog = catalogFromSources({
        'o.yaml': documentSource('o', '고아', { parent: '\n    - 성능' }),
        'c.yaml': documentSource('c', '손자', { parent: '\n    - 고아' }),
      });

      const result = projectCatalogList(catalog);

      expect(listedNames(result.unreachable ?? [])).toEqual(['고아']);
      expect(
        listedNames(projectCatalogList(catalog, { parent: '고아' }).items),
      ).toEqual(['손자']);
    });

    it('unreachable은 items와 같은 이름 순서와 항목 형식을 따른다', () => {
      const catalog = catalogFromSources({
        'b.yaml': documentSource('b', '나', { parent: '\n    - 없음' }),
        'a.yaml': documentSource('a', '가', { parent: ' ""' }),
      });

      const result = projectCatalogList(catalog);

      expect(listedNames(result.unreachable ?? [])).toEqual(['가', '나']);
      expect(result.unreachable?.[0]).toHaveProperty('sections');
      expect(result.unreachable?.[0]).toHaveProperty('childCount');
    });
  });

  describe('충돌과 식별 정보가 없는 문서', () => {
    it('같은 이름의 문서는 대표 없이 문서마다 conflict 항목과 모든 경로를 담는다', () => {
      const catalog = catalogFromSources({
        'a.yaml': documentSource('a', '같음'),
        'b.yaml': documentSource('b', '같음'),
      });

      const result = projectCatalogList(catalog);

      expect(result.items).toHaveLength(2);
      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'a',
          conflict: true,
          paths: ['a.yaml', 'b.yaml'],
          hasErrors: true,
        }),
        expect.objectContaining({
          id: 'b',
          conflict: true,
          paths: ['a.yaml', 'b.yaml'],
          hasErrors: true,
        }),
      ]);
    });

    it('같은 ID의 문서는 대표 없이 문서마다 conflict 항목과 모든 경로를 담는다', () => {
      const catalog = catalogFromSources({
        'a.yaml': documentSource('same', '하나'),
        'b.yaml': documentSource('same', '둘'),
      });

      const result = projectCatalogList(catalog);

      expect(result.items.map((item) => item.name)).toEqual(['둘', '하나']);
      expect(
        result.items.every(
          (item) =>
            item.conflict && item.paths.join() === ['a.yaml', 'b.yaml'].join(),
        ),
      ).toBe(true);
    });

    it('검증 오류가 있어도 ID와 이름을 확인할 수 있으면 hasErrors와 함께 나온다', () => {
      const catalog = catalogFromSources({
        'a.yaml': documentSource('a', '오류', {
          body: '개요: 설명\n참조: "[[없음]]"\n',
        }),
      });

      expect(projectCatalogList(catalog).items).toEqual([
        expect.objectContaining({ name: '오류', hasErrors: true }),
      ]);
    });

    it.each([
      {
        label: 'ID가 없는 문서',
        source: '_codocs:\n  name: 이름만\n개요: 설명\n',
      },
      {
        label: '이름이 없는 문서',
        source: '_codocs:\n  id: only-id\n개요: 설명\n',
      },
    ])('$label 이면 목록에 나오지 않는다', ({ source }) => {
      const result = projectCatalogList(
        catalogFromSources({ 'a.yaml': source }),
      );

      expect(result.items).toEqual([]);
      expect(result.unreachable).toEqual([]);
    });

    it('문서에 kind와 status가 있어도 목록 항목에는 두 속성을 표시하지 않는다', () => {
      const catalog = catalogFromSources({
        'a.yaml': documentSource('a', '문서', {
          body: 'kind: policy\nstatus: confirmed\n',
        }),
      });

      const item = projectCatalogList(catalog).items[0];

      expect(item).not.toHaveProperty('kind');
      expect(item).not.toHaveProperty('status');
    });
  });

  describe('항목 수', () => {
    it('ID가 충돌한 문서는 하나로 세고 목록에 나올 수 없는 문서는 세지 않는다', () => {
      const catalog = catalogFromSources({
        'a.yaml': documentSource('same', '하나'),
        'b.yaml': documentSource('same', '둘'),
        'c.yaml': documentSource('c', '셋'),
        'd.yaml': '_codocs:\n  name: ID 없음\n',
      });

      expect(countCatalogListItems(catalog)).toBe(2);
    });
  });
});

/** 결과 종류와 상관없이 공통으로 확인하는 속성만 담은 느슨한 결과 형태다. */
interface LooseGetResult {
  address: string;
  found: boolean;
  revision?: string;
  references?: readonly string[];
  document?: unknown;
  diagnostics: readonly CatalogQueryDiagnostic[];
}

describe('projectCatalogGet: 이름 주소별 문서와 섹션 투영', () => {
  const sources = {
    'refund.yaml': documentSource('refund', '환불', {
      body: '정책: "[[결제]] 와 [[결제:취소]] 와 [[환불:규칙]] 와 [[없는문서]]"\n규칙: 설명\n연락: "[[고객]]"\n',
    }),
    'payment.yaml': documentSource('payment', '결제', {
      body: '취소: 설명\n승인: "[[환불:정책]]"\n',
    }),
    'customer.yaml': documentSource('customer', '고객'),
  };
  const catalog = catalogFromSources(sources);
  const revisions = new Map([
    ['refund.yaml', 'refund-revision'],
    ['payment.yaml', 'payment-revision'],
  ]);

  /** 성공한 투영의 결과 목록을 꺼낸다. */
  function resultsOf(
    addresses: readonly string[],
    target: Catalog = catalog,
  ): readonly LooseGetResult[] {
    const result = projectCatalogGet(target, addresses, { revisions });
    if (!result.success) throw new Error('요청이 거부되었습니다.');
    return result.results;
  }

  describe('요청 전체 입력', () => {
    it.each([
      { name: '빈 목록', addresses: [] },
      {
        name: '21개 고유 주소',
        addresses: Array.from({ length: 21 }, (_, i) => '문서 ' + i),
      },
    ])(
      '$name 입력을 조회하면 invalid_input 오류를 반환한다',
      ({ addresses }) => {
        const result = projectCatalogGet(catalog, addresses);

        expect(result).toMatchObject({
          success: false,
          error: { code: queryDiagnosticCodes.invalidInput },
        });
      },
    );

    it('20개 주소를 반복해서 조회하면 중복 제거 후 유효한 요청으로 처리한다', () => {
      const addresses = Array.from({ length: 20 }, (_, i) => '문서 ' + i);

      expect(resultsOf([...addresses, ...addresses])).toHaveLength(20);
    });

    it('같은 주소를 반복해서 조회하면 첫 등장 순서로 한 번씩 반환한다', () => {
      const results = resultsOf(['결제', '없음', '결제']);

      expect(results.map((item) => item.address)).toEqual(['결제', '없음']);
    });
  });

  describe('문서 결과', () => {
    it('이름으로 조회하면 address, 문서 내용, 파일 위치와 revision을 반환한다', () => {
      const [result] = resultsOf(['환불']);

      expect(result).toMatchObject({
        address: '환불',
        id: 'refund',
        found: true,
        conflict: false,
        source: { path: 'refund.yaml' },
        confirmation: catalogConfirmations.confirmed,
        revision: 'refund-revision',
        document: {
          _codocs: { id: 'refund', name: '환불' },
          규칙: '설명',
        },
      });
    });

    it('references와 referencedBy는 확정된 대상 문서 이름을 이름 순서로 담는다', () => {
      const [refund, payment] = resultsOf(['환불', '결제']);

      expect(refund).toMatchObject({
        references: ['결제', '고객'],
        referencedBy: ['결제'],
      });
      expect(payment).toMatchObject({
        references: ['환불'],
        referencedBy: ['환불'],
      });
    });

    it('같은 문서와 확정되지 않은 참조는 references에 담지 않는다', () => {
      const [refund] = resultsOf(['환불']);

      expect(refund?.references).not.toContain('환불');
      expect(refund?.references).not.toContain('없는문서');
    });

    it('내용을 JSON으로 나타낼 수 없으면 원문 rawYaml을 반환한다', () => {
      const broken = catalogFromSources({
        'b.yaml': documentSource('b', '깨짐', { body: '값: .nan\n' }),
      });

      const [result] = resultsOf(['깨짐'], broken);

      expect(result).toMatchObject({
        rawYaml: expect.stringContaining('.nan') as string,
      });
      expect(result).not.toHaveProperty('document');
    });

    it('이름의 콜론을 \\:로 적으면 그 이름의 문서를 찾는다', () => {
      const colon = catalogFromSources({
        'c.yaml': documentSource('c', '"a:b"'),
      });

      const [result] = resultsOf(['a\\:b'], colon);

      expect(result).toMatchObject({ found: true, address: 'a\\:b' });
    });

    it('조회해도 원본 Catalog 문서를 변경하지 않고 새 값을 반환한다', () => {
      const parsed = catalog.documents.get('refund.yaml')?.observation.parsed;
      const before = JSON.stringify(parsed);

      const [result] = resultsOf(['환불']);

      expect(JSON.stringify(parsed)).toBe(before);
      expect(result?.document).not.toBe(
        parsed?.success ? parsed.data : undefined,
      );
    });
  });

  describe('섹션 결과', () => {
    it('이름:섹션으로 조회하면 문서 이름, ID, 파일 위치, revision과 섹션 하나만 반환한다', () => {
      const [result] = resultsOf(['환불:규칙']);

      expect(result).toMatchObject({
        address: '환불:규칙',
        found: true,
        conflict: false,
        name: '환불',
        id: 'refund',
        source: { path: 'refund.yaml' },
        revision: 'refund-revision',
        section: { name: '규칙', content: '설명' },
      });
      expect(result).not.toHaveProperty('document');
      expect(result).not.toHaveProperty('referencedBy');
    });

    it('섹션 결과의 revision은 같은 문서의 문서 결과 revision과 같다', () => {
      const [document, section] = resultsOf(['환불', '환불:규칙']);

      expect(section?.revision).toBeDefined();
      expect(section?.revision).toBe(document?.revision);
    });

    it('references는 그 섹션 안의 확정된 참조 대상 이름만 담는다', () => {
      const [policy, rule, contact] = resultsOf([
        '환불:정책',
        '환불:규칙',
        '환불:연락',
      ]);

      expect(policy?.references).toEqual(['결제']);
      expect(rule?.references).toEqual([]);
      expect(contact?.references).toEqual(['고객']);
    });

    it('섹션 내용을 JSON으로 나타낼 수 없으면 rawYaml을 반환한다', () => {
      const broken = catalogFromSources({
        'b.yaml': documentSource('b', '깨짐', { body: '값: .nan\n' }),
      });

      const [result] = resultsOf(['깨짐:값'], broken);

      expect(result).toMatchObject({
        section: {
          name: '값',
          rawYaml: expect.stringContaining('.nan') as string,
        },
      });
    });
  });

  describe('주소별 부재와 오류', () => {
    it.each([
      { label: '빈 문자열', address: '' },
      { label: '콜론이 둘인 주소', address: 'a:b:c' },
      { label: '빈 이름', address: ':섹션' },
      { label: '빈 섹션', address: '환불:' },
      { label: '대괄호가 있는 주소', address: '[[환불]]' },
    ])('$label 주소는 그 주소만 invalid_input이다', ({ address }) => {
      const results = resultsOf([address, '환불']);

      expect(results[0]).toMatchObject({
        address,
        found: false,
        diagnostics: [
          expect.objectContaining({ code: queryDiagnosticCodes.invalidInput }),
        ],
      });
      expect(results[1]).toMatchObject({ found: true });
    });

    it('없는 이름은 내용 없이 not_found 진단을 반환한다', () => {
      const [result] = resultsOf(['없음']);

      expect(result).toEqual({
        address: '없음',
        found: false,
        diagnostics: [
          expect.objectContaining({
            code: queryDiagnosticCodes.notFound,
            message: queryDiagnosticMessages.notFound,
          }),
        ],
      });
    });

    it('문서는 있지만 섹션이 없으면 section_not_found 진단을 반환한다', () => {
      const [result] = resultsOf(['환불:없음']);

      expect(result).toMatchObject({
        address: '환불:없음',
        found: false,
        diagnostics: [
          expect.objectContaining({
            code: queryDiagnosticCodes.sectionNotFound,
            message: queryDiagnosticMessages.sectionNotFound,
          }),
        ],
      });
    });

    it('_codocs는 섹션이 아니므로 section_not_found다', () => {
      const [result] = resultsOf(['환불:_codocs']);

      expect(result).toMatchObject({ found: false });
      expect(result?.diagnostics[0]?.code).toBe(
        queryDiagnosticCodes.sectionNotFound,
      );
    });

    it('한 주소의 오류가 다른 주소의 결과를 막지 않고 입력 순서를 유지한다', () => {
      const results = resultsOf([
        '환불',
        '환불:규칙',
        '없음',
        '환불:없음',
        'a:b:c',
      ]);

      expect(results.map((item) => item.found)).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
      expect(results.slice(2).map((item) => item.diagnostics[0]?.code)).toEqual(
        [
          queryDiagnosticCodes.notFound,
          queryDiagnosticCodes.sectionNotFound,
          queryDiagnosticCodes.invalidInput,
        ],
      );
    });
  });

  describe('중복 이름과 중복 ID', () => {
    it.each([
      { label: '문서 주소', address: '같음' },
      { label: '섹션 주소', address: '같음:개요' },
    ])(
      '중복 이름의 $label 조회는 conflict와 모든 경로를 반환하고 revision을 만들지 않는다',
      ({ address }) => {
        const duplicated = catalogFromSources({
          'b.yaml': documentSource('b', '같음'),
          'a.yaml': documentSource('a', '같음'),
        });

        const [result] = resultsOf([address], duplicated);

        expect(result).toMatchObject({
          address,
          found: true,
          conflict: true,
          paths: ['a.yaml', 'b.yaml'],
          diagnostics: [
            expect.objectContaining({
              code: catalogDiagnosticCodes.duplicateName,
            }),
          ],
        });
        expect(result).not.toHaveProperty('document');
        expect(result).not.toHaveProperty('rawYaml');
        expect(result).not.toHaveProperty('revision');
      },
    );

    it('찾은 문서의 ID가 다른 파일과 같으면 conflict와 duplicate_id 진단을 주고 revision을 만들지 않는다', () => {
      const duplicated = catalogFromSources({
        'a.yaml': documentSource('same', '하나'),
        'b.yaml': documentSource('same', '둘'),
      });

      const [result] = resultsOf(['하나'], duplicated);

      expect(result).toMatchObject({
        found: true,
        conflict: true,
        paths: ['a.yaml', 'b.yaml'],
        diagnostics: [
          expect.objectContaining({ code: catalogDiagnosticCodes.duplicateId }),
        ],
      });
      expect(result).not.toHaveProperty('revision');
    });
  });
});

describe('projectCatalogPaths: 발견 경로별 문서 상세 투영', () => {
  it('같은 이름의 여러 후보 경로를 각각의 문서 내용으로 반환한다', () => {
    const documents = ['first.yaml', 'second.yaml'].map(
      (documentPath, index) =>
        ({
          ...alpha,
          path: documentPath,
          id: `document-${index + 1}`,
          name: '같은 이름',
          observation: {
            path: documentPath,
            parsed: {
              ...parsedBase,
              data: {
                _codocs: { id: `document-${index + 1}`, name: '같은 이름' },
                definition: `본문 ${index + 1}`,
              },
            },
          },
        }) satisfies CatalogDocument,
    );
    const catalog: Catalog = {
      ...catalogBase,
      documents: new Map(
        documents.map((document) => [document.path, document]),
      ),
      idPaths: new Map(
        documents.map((document) => [document.id, new Set([document.path])]),
      ),
      namePaths: new Map([
        ['같은 이름', new Set(documents.map((document) => document.path))],
      ]),
    };

    const result = projectCatalogPaths(
      catalog,
      documents.map((document) => document.path),
    );

    expect(result).toMatchObject({
      success: true,
      results: [
        { path: documents[0]?.path, document: { definition: '본문 1' } },
        { path: documents[1]?.path, document: { definition: '본문 2' } },
      ],
    });
  });

  it('확정 직접·역참조를 경로로 구분하고 빈 관계 항목은 생략한다', () => {
    const target = {
      ...alpha,
      path: 'target.yaml',
      id: 'target',
      name: 'Target',
      referencedBy: [alpha],
      observation: {
        path: 'target.yaml',
        parsed: {
          ...parsedBase,
          source: '_codocs:\n  id: target\n  name: Target\n',
          data: { _codocs: { id: 'target', name: 'Target' } },
        },
      },
    } satisfies CatalogDocument;
    const source = {
      ...alpha,
      references: [target],
    } satisfies CatalogDocument;
    const catalog: Catalog = {
      ...catalogBase,
      documents: new Map<string, CatalogDocument>([
        [source.path, source],
        [target.path, target],
      ]),
      idPaths: new Map([
        [source.id, new Set([source.path])],
        [target.id, new Set([target.path])],
      ]),
    };

    const result = projectCatalogPaths(catalog, [source.path, target.path]);

    expect(result).toEqual({
      success: true,
      results: [
        expect.objectContaining({
          path: source.path,
          id: source.id,
          references: [{ path: target.path, id: target.id }],
        }),
        expect.objectContaining({
          path: target.path,
          id: target.id,
          referencedBy: [{ path: source.path, id: source.id }],
        }),
      ],
    });
    if (!result.success) throw new Error('경로 조회 실패');
    expect(result.results[0]).not.toHaveProperty('referencedBy');
    expect(result.results[1]).not.toHaveProperty('references');
  });

  it.each([
    { label: '누락', id: undefined },
    { label: '형식 오류', id: 'Invalid_Id' },
  ])('현재 ID $label 문서는 ID 없이 내용과 진단을 보존한다', ({ id }) => {
    const issue = {
      code: schemaDiagnosticCodes.invalidFieldValue,
      severity: diagnosticSeverities.error,
      message: 'ID 오류',
      path: 'broken.yaml',
      fieldPath: ['_codocs', 'id'],
    };
    const document = {
      ...documentBase,
      path: issue.path,
      ...(id === undefined ? {} : { id }),
      name: 'Broken',
      documentDiagnostics: [issue],
      diagnostics: [issue],
      observation: {
        path: issue.path,
        parsed: {
          ...parsedBase,
          source: '_codocs:\n  name: Broken\n',
          data: {
            _codocs: { ...(id === undefined ? {} : { id }), name: 'Broken' },
            definition: '본문',
          },
        },
      },
    } satisfies CatalogDocument;
    const catalog: Catalog = {
      ...catalogBase,
      documents: new Map([[document.path, document]]),
      idPaths:
        id === undefined
          ? new Map()
          : new Map([[id, new Set([document.path])]]),
    };

    const result = projectCatalogPaths(catalog, [document.path]);

    expect(result).toMatchObject({
      success: true,
      results: [
        {
          path: document.path,
          found: true,
          document: { _codocs: { name: 'Broken' }, definition: '본문' },
          diagnostics: [issue],
        },
      ],
    });
    if (!result.success) throw new Error('경로 조회 실패');
    expect(result.results[0]).not.toHaveProperty('id');
  });

  it('파싱 실패로 원문 범위를 확인할 수 없으면 이동 좌표를 만들지 않는다', () => {
    const document = {
      ...documentBase,
      path: 'parse-error.yaml',
      observation: {
        path: 'parse-error.yaml',
        parsed: {
          success: false as const,
          source: 'id: [\n',
          diagnostics: [],
        },
      },
    } satisfies CatalogDocument;
    const catalog: Catalog = {
      ...catalogBase,
      documents: new Map([[document.path, document]]),
    };

    const result = projectCatalogPaths(catalog, [document.path]);

    expect(result).toMatchObject({
      success: true,
      results: [
        {
          path: document.path,
          found: true,
          rawYaml: document.observation.parsed.source,
          source: { path: document.path },
        },
      ],
    });
    if (!result.success || !result.results[0]?.found)
      throw new Error('경로 조회 실패');
    expect(result.results[0].source).not.toHaveProperty('offsetRange');
    expect(result.results[0].source).not.toHaveProperty('range');
  });

  it('중복 현재 ID 문서는 ID 없이 모든 충돌 경로를 제공한다', () => {
    const paths = ['a.yaml', 'b.yaml'];
    const documents = paths.map(
      (documentPath) =>
        ({
          ...alpha,
          path: documentPath,
          observation: { ...alpha.observation, path: documentPath },
        }) satisfies CatalogDocument,
    );
    const catalog: Catalog = {
      ...catalogBase,
      documents: new Map(
        documents.map((document) => [document.path, document]),
      ),
      idPaths: new Map([[alpha.id, new Set(paths)]]),
    };

    const result = projectCatalogPaths(catalog, paths);

    expect(result).toMatchObject({
      success: true,
      results: paths.map((documentPath) => ({
        path: documentPath,
        found: true,
        conflictPaths: paths,
      })),
    });
    if (!result.success) throw new Error('경로 조회 실패');
    expect(result.results.every((item) => !('id' in item))).toBe(true);
  });
});

describe('projectLiveReferences: live YAML와 디스크 색인의 결합', () => {
  it.each([
    {
      label: 'LF와 한글·emoji',
      text: 'definition: "😀[[A]]"\n',
      start: 15,
      end: 20,
    },
    {
      label: 'CRLF',
      text: '# 😀\r\ndefinition: "[[A]]"\r\n',
      start: 19,
      end: 24,
    },
    {
      label: 'escape',
      text: 'definition: "\\u005b[A]]"\n',
      start: 13,
      end: 23,
    },
    {
      label: '작은따옴표',
      text: "definition: '한글 [[A]]'\n",
      start: 16,
      end: 21,
    },
    {
      label: '접힌 문자열',
      text: 'definition: >\n  [[A]]\n',
      start: 16,
      end: 21,
    },
  ])(
    '$label을 조회하면 실제 UTF-16 등장 범위를 반환한다',
    ({ text, start, end }) => {
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[alpha.path, alpha]]),
        idPaths: new Map([[alpha.id, new Set([alpha.path])]]),
        namePaths: new Map([[alpha.name, new Set([alpha.path])]]),
      };
      const before = JSON.stringify([...catalog.documents]);
      const result = projectLiveReferences(
        catalog,
        '한글 경로/source.yaml',
        text,
        { revisions: new Map([[alpha.path, 'revision']]) },
      );
      expect(result.occurrences).toHaveLength(1);
      expect(result.occurrences[0]?.occurrence.offsetRange).toEqual({
        start,
        end,
      });
      expect(result.occurrences[0]?.resolution.target?.path).toBe(alpha.path);
      expect(result.targets[0]).toMatchObject({
        found: true,
        revision: 'revision',
        document: alpha.observation.parsed.data,
      });
      expect(JSON.stringify([...catalog.documents])).toBe(before);
    },
  );

  it('다른 필드 오류가 있어도 문자열 section의 확인한 참조만 순서대로 반환한다', () => {
    const catalog: Catalog = {
      ...catalogBase,
      documents: new Map([[alpha.path, alpha]]),
      namePaths: new Map([[alpha.name, new Set([alpha.path])]]),
    };
    const result = projectLiveReferences(
      catalog,
      'source.yaml',
      '_codocs:\n  id: 123\n  name: "[[무시]]"\n개요: "[[A]] [[도메인:A]]"\n예시: 12\n',
    );
    expect(result.occurrences.map((item) => item.occurrence.text)).toEqual([
      '[[A]]',
      '[[도메인:A]]',
    ]);
    expect(result.targets).toHaveLength(1);
  });

  it('YAML 파싱에 실패하면 원문에서 참조를 추측하지 않는다', () => {
    const result = projectLiveReferences(
      catalogBase,
      'source.yaml',
      'definition: "[[A]]',
    );
    expect(result.occurrences).toEqual([]);
    expect(result.targets).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid_yaml' }),
    );
  });

  it('status가 deprecated인 문서를 참조해도 폐기 경고 없이 위치별 해석을 유지한다', () => {
    const target = {
      ...alpha,
      observation: {
        ...alpha.observation,
        parsed: {
          ...alpha.observation.parsed,
          data: { ...alpha.observation.parsed.data, status: 'deprecated' },
        },
      },
    };
    const catalog: Catalog = {
      ...catalogBase,
      documents: new Map([[target.path, target]]),
      idPaths: new Map([[alpha.id, new Set([alpha.path])]]),
      namePaths: new Map([[alpha.name, new Set([alpha.path])]]),
    };
    const result = projectLiveReferences(
      catalog,
      'source.yaml',
      'definition: "[[A]] [[A]]"\n',
    );
    expect(result.diagnostics.map((item) => item.code)).not.toContain(
      'deprecated_reference',
    );
    expect(
      result.occurrences.every(
        (item) =>
          item.resolution.status === referenceResolutionStatuses.resolved,
      ),
    ).toBe(true);
  });
});

describe('섹션 참조의 조회 투영', () => {
  /** 실제 파서로 만든 문서 관측이다. */
  const observe = (path: string, source: string): CatalogObservation => ({
    path,
    parsed: parseYaml(source, path),
  });
  const refund = observe(
    'refund.yaml',
    '_codocs:\n  id: refund\n  name: 환불\n환불정책: 설명\n자기: "[[환불:환불정책]] [[환불:없음]]"\n',
  );
  const payment = observe(
    'payment.yaml',
    '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불정책]] [[환불:없는섹션]] [[없는문서:x]]"\n',
  );
  const catalog = buildCatalog({
    status: scanStatuses.complete,
    observations: [refund, payment],
  });

  it('섹션이 없는 참조는 section_reference_not_found를 원문 범위와 함께 반환한다', () => {
    const occurrences = catalog.documents.get('payment.yaml')?.occurrences;
    const missingSection = occurrences?.[1]?.occurrence;
    const diagnostics = projectCatalogDiagnostics(catalog, 'payment.yaml');
    expect(diagnostics.map((item) => item.code)).toEqual([
      queryDiagnosticCodes.sectionReferenceNotFound,
      queryDiagnosticCodes.referenceNotFound,
    ]);
    expect(diagnostics[0]).toMatchObject({
      severity: diagnosticSeverities.error,
      message: queryDiagnosticMessages.sectionReferenceNotFound,
      path: 'payment.yaml',
      offsetRange: missingSection?.offsetRange,
      range: missingSection?.range,
    });
    expect(diagnostics.map((item) => item.code)).not.toContain(
      catalogDiagnosticCodes.missingSectionReference,
    );
  });

  it('같은 문서의 없는 섹션도 같은 코드로 투영하고 있는 섹션은 진단하지 않는다', () => {
    expect(
      projectCatalogDiagnostics(catalog, 'refund.yaml').map(
        (item) => item.code,
      ),
    ).toEqual([queryDiagnosticCodes.sectionReferenceNotFound]);
  });

  it('codocs_get의 references와 referencedBy는 문서 이름 목록이고 섹션 정보가 없다', () => {
    const result = projectCatalogGet(catalog, ['환불', '결제']);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.results[0]).toMatchObject({
      references: [],
      referencedBy: ['결제'],
    });
    expect(result.results[1]).toMatchObject({
      references: ['환불'],
      referencedBy: [],
    });
    expect(JSON.stringify(result.results)).not.toContain('sectionReferencedBy');
  });
});
