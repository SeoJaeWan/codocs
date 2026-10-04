import { describe, expect, it } from 'vitest';
import {
  catalogConfirmations,
  scanStatuses,
  type Catalog,
  type CatalogDocument,
} from '../catalog/index.js';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  changePlanDiagnosticCodes,
  changePlanDiagnosticMessages,
  diagnosticSeverities,
  schemaDiagnosticCodes,
  schemaDiagnosticMessages,
} from '../diagnostics/index.js';
import type { YamlParseResult } from '../parser/index.js';
import { changePlanStatuses, planDocumentChange } from './index.js';

const path = '.codocs/zone.yaml';
const base =
  'id: zone\nname: 구역\ndomains: [운영]\ndeprecatedAliases: []\ndefinition: 설명\n';
const baseParsed: Extract<YamlParseResult, { success: true }> = {
  success: true,
  source: base,
  data: {
    id: 'zone',
    name: '구역',
    domains: ['운영'],
    deprecatedAliases: [],
    definition: '설명',
  },
  fields: [],
  strings: [],
  diagnostics: [],
};
const baseDocument: CatalogDocument = {
  path,
  id: 'zone',
  name: '구역',
  domains: ['운영'],
  confirmation: catalogConfirmations.confirmed,
  observation: {
    path,
    parsed: baseParsed,
  },
  documentDiagnostics: [],
  diagnostics: [],
  occurrences: [],
  references: [],
  referencedBy: [],
};
const baseCatalog: Catalog = {
  status: scanStatuses.complete,
  failures: [],
  documents: new Map([[path, baseDocument]]),
  idPaths: new Map([['zone', new Set([path])]]),
  namePaths: new Map([['구역', new Set([path])]]),
  domainNamePaths: new Map([['운영', new Map([['구역', new Set([path])]])]]),
};
const baseContext = {
  catalog: baseCatalog,
  source: { path, raw: base, revision: 'old-revision', utf8Lossless: true },
};

describe('planDocumentChange', () => {
  describe('문서 생성·수정과 변경 없는 요청 처리', () => {
    it('문서의 설명을 바꾸면 수정한 원문과 데이터가 담긴 후보를 반환한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명' },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.path).toBe(baseContext.source.path);
      expect(result.baseRevision).toBe(baseContext.source.revision);
      expect(result.raw).toBe(
        'id: zone\nname: 구역\ndomains: [운영]\ndeprecatedAliases: []\ndefinition: 새 설명\n',
      );
      expect(result.data.definition).toBe(request.set.definition);
    });

    it('새 경로에 문서를 생성하면 원문과 데이터가 담긴 후보를 반환한다', () => {
      const request = {
        mode: 'create',
        path: '.codocs/new-zone.yaml',
        document: {
          id: 'new-zone',
          name: '새 구역',
          domains: ['운영'],
          definition: '설명',
        },
      };
      const context = { catalog: baseCatalog };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.path).toBe(request.path);
      expect(result.id).toBe(request.document.id);
      expect(result.data).toEqual({
        ...request.document,
        deprecatedAliases: [],
      });
      expect(result.raw).toContain('id: new-zone');
    });

    it('문서를 생성하면 요청에 없던 deprecatedAliases를 빈 배열로 원문에 저장한다', () => {
      const request = {
        mode: 'create',
        path: '.codocs/new-zone.yaml',
        document: {
          id: 'new-zone',
          name: '새 구역',
          domains: ['운영'],
          definition: '설명',
        },
      };
      const result = planDocumentChange(request, { catalog: baseCatalog });

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.raw).toContain('deprecatedAliases: []');
    });

    it('없는 선택 속성을 삭제하면 기존 revision을 담은 무변경 결과를 반환한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['missing'],
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.unchanged);
      if (result.status === changePlanStatuses.unchanged)
        expect(result.revision).toBe(baseContext.source.revision);
    });
  });

  describe('ID 변경과 이전 ID 기록', () => {
    it('ID를 변경하면 이전 ID를 deprecatedAliases에 추가한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone' },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.data.deprecatedAliases).toEqual([{ id: 'zone' }]);
    });

    it('이전 ID로 되돌리면 그 ID를 이전 목록에서 빼고 직전 ID를 기록한다', () => {
      const raw =
        'id: return-zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\ndeprecatedAliases: [{id: zone}]\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              id: 'return-zone',
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: {
                    ...baseParsed.data,
                    id: 'return-zone',
                    deprecatedAliases: [{ id: 'zone' }],
                  },
                },
              },
            },
          ],
        ]),
        idPaths: new Map([['return-zone', new Set([path])]]),
      };
      const request = {
        mode: 'update',
        id: 'return-zone',
        revision: 'old-revision',
        set: { id: 'zone' },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.data.deprecatedAliases).toEqual([{ id: 'return-zone' }]);
    });

    it('기존 이전 ID에 메시지가 있으면 새 ID를 기록할 때 그 메시지를 보존한다', () => {
      const raw =
        'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\ndeprecatedAliases: [{id: previous, message: 남길 메시지}]\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: {
                    ...baseParsed.data,
                    deprecatedAliases: [
                      { id: 'previous', message: '남길 메시지' },
                    ],
                  },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone' },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.data.deprecatedAliases).toEqual([
          { id: 'previous', message: '남길 메시지' },
          { id: 'zone' },
        ]);
    });
  });

  describe('문서 속성 편집과 기존 YAML 형식 보존', () => {
    it('설명만 바꾸면 수정하지 않은 따옴표·주석·CRLF·파일 끝을 보존한다', () => {
      const raw =
        '# 앞 주석\r\nid: zone\r\nname: "구역" # 옆 주석\r\ndomains: [운영]\r\ndeprecatedAliases: []\r\ndefinition: 설명';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새😀설명' },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).toBe(
          '# 앞 주석\r\nid: zone\r\nname: "구역" # 옆 주석\r\ndomains: [운영]\r\ndeprecatedAliases: []\r\ndefinition: 새😀설명',
        );
    });

    it('설명을 블록 문자열로 바꾸면 값의 끝 개행을 보존한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명\n' },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.data.definition).toBe(request.set.definition);
    });

    it('배열 전체를 교체하면 새 배열을 결과 데이터에 반영한다', () => {
      const raw = base + 'examples: [옛 예시]\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, examples: ['옛 예시'] },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { examples: ['하나', '둘'] },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.data.examples).toEqual(request.set.examples);
    });

    it('끝 개행이 없는 문서의 배열을 교체하면 파일 끝에 개행을 추가하지 않는다', () => {
      const raw = base + 'examples: [옛 예시]';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, examples: ['옛 예시'] },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { examples: ['새 예시', '다음 예시'] },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw.endsWith('\n')).toBe(false);
    });

    it('들여쓴 문서의 배열을 교체하면 기존 속성 들여쓰기를 따른다', () => {
      const raw =
        '  id: zone\n  name: 구역\n  domains: [운영]\n  deprecatedAliases: []\n  definition: 설명\n  examples: [옛 예시]\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, examples: ['옛 예시'] },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { examples: ['새 예시', '두 번째'] },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).toContain(
          '  examples: \n    - 새 예시\n    - 두 번째',
        );
    });

    it('들여쓴 문서의 ID를 바꾸면 이전 ID 속성에도 같은 들여쓰기를 적용한다', () => {
      const raw =
        '  id: zone\n  name: 구역\n  domains: [운영]\n  deprecatedAliases: []\n  definition: 설명\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone' },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).toContain('  deprecatedAliases:');
    });

    it('중괄호 매핑에 중첩 객체를 추가하면 그 값을 결과 데이터에 반영한다', () => {
      const raw =
        '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [], definition: 설명}\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { 'custom.key': { nested: [1, 2] } },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.data['custom.key']).toEqual({ nested: [1, 2] });
    });

    it.each([
      ['첫 번째', 'first'],
      ['가운데', 'middle'],
      ['마지막', 'last'],
    ])(
      '중괄호 매핑의 %s 선택 속성을 삭제하면 결과 데이터에서 그 속성을 제거한다',
      (_position, key) => {
        const raw =
          '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [], definition: 설명, first: 1, middle: 2, last: 3}\n';
        const catalog: Catalog = {
          ...baseCatalog,
          documents: new Map([
            [
              path,
              {
                ...baseDocument,
                observation: {
                  path,
                  parsed: {
                    ...baseParsed,
                    source: raw,
                    data: { ...baseParsed.data, first: 1, middle: 2, last: 3 },
                  },
                },
              },
            ],
          ]),
        };
        const request = {
          mode: 'update',
          id: 'zone',
          revision: 'old-revision',
          unset: [key],
        };
        const context = {
          catalog,
          source: { path, raw, revision: 'old-revision', utf8Lossless: true },
        };
        const result = planDocumentChange(request, context);

        expect(result.status).toBe(changePlanStatuses.candidate);
        if (result.status === changePlanStatuses.candidate)
          expect(Object.hasOwn(result.data, key)).toBe(false);
      },
    );

    it('중괄호 매핑의 인접한 속성을 삭제하고 새 속성을 추가하면 한 후보에 모두 반영한다', () => {
      const raw =
        '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [], definition: 설명, a: 1, b: 2, c: 3,}\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, a: 1, b: 2, c: 3 },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['a', 'b'],
        set: { extra: [1, 2] },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.data.extra).toEqual([1, 2]);
      expect(result.data).not.toHaveProperty('a');
      expect(result.data).not.toHaveProperty('b');
    });

    it('중괄호 매핑의 마지막 속성을 삭제하고 새 속성을 추가하면 한 후보에 모두 반영한다', () => {
      const raw =
        '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [], definition: 설명, old: 1,}\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, old: 1 },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['old'],
        set: { newest: 2 },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.data.newest).toBe(2);
      expect(result.data).not.toHaveProperty('old');
    });
  });

  describe('속성 삭제 시 옆 주석 제거와 독립 주석 보존', () => {
    it('블록 매핑의 속성을 삭제하면 다음 속성 앞의 독립 주석을 보존한다', () => {
      const raw = base + 'extra: 1 # 옆 주석\n# 독립 주석\nother: 2\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, extra: 1, other: 2 },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['extra'],
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).toContain('# 독립 주석\nother: 2');
    });

    it('중괄호 매핑의 속성을 삭제하면 그 속성의 옆 주석을 함께 제거한다', () => {
      const raw =
        '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [], definition: 설명, a: 1, # a comment\n # independent, comma\n b: 2}\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, a: 1, b: 2 },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['a'],
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).not.toContain('# a comment');
    });

    it.each([['a'], ['b']])(
      '중괄호 매핑의 %s 속성을 삭제하면 쉼표가 든 독립 주석을 보존한다',
      (key) => {
        const raw =
          '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [], definition: 설명, a: 1, # a comment\n # independent, comma\n b: 2}\n';
        const catalog: Catalog = {
          ...baseCatalog,
          documents: new Map([
            [
              path,
              {
                ...baseDocument,
                observation: {
                  path,
                  parsed: {
                    ...baseParsed,
                    source: raw,
                    data: { ...baseParsed.data, a: 1, b: 2 },
                  },
                },
              },
            ],
          ]),
        };
        const request = {
          mode: 'update',
          id: 'zone',
          revision: 'old-revision',
          unset: [key],
        };
        const context = {
          catalog,
          source: { path, raw, revision: 'old-revision', utf8Lossless: true },
        };
        const result = planDocumentChange(request, context);

        expect(result.status).toBe(changePlanStatuses.candidate);
        if (result.status === changePlanStatuses.candidate)
          expect(result.raw).toContain('# independent, comma');
      },
    );

    it('중괄호 매핑의 중간 속성을 삭제하면 그 앞의 독립 주석을 보존한다', () => {
      const raw =
        '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [], definition: 설명, # 옆\n # 독립 주석, 쉼표\n old: 1, tail: 2}\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, old: 1, tail: 2 },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['old'],
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).toContain('# 독립 주석, 쉼표');
    });
  });

  describe('문서 변경 요청의 유효성 검사', () => {
    it.each([
      ['이전 ID 목록을 set으로 수정', { set: { deprecatedAliases: [] } }],
      ['이전 ID 목록을 unset으로 삭제', { unset: ['deprecatedAliases'] }],
      [
        'ID와 이전 ID 목록을 함께 수정',
        { set: { id: 'next-zone', deprecatedAliases: [] } },
      ],
      ['빈 변경', { set: {} }],
      [
        '같은 속성을 수정하면서 삭제',
        { set: { name: '동일' }, unset: ['name'] },
      ],
    ] as const)('%s하면 잘못된 요청으로 거부한다', (_condition, changes) => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        ...changes,
      };
      const result = planDocumentChange(request, baseContext);

      expect(result).toEqual({
        status: changePlanStatuses.failed,
        diagnostics: [
          {
            code: changePlanDiagnosticCodes.invalidRequest,
            severity: diagnosticSeverities.error,
            message: changePlanDiagnosticMessages.invalidRequest,
          },
        ],
      });
    });

    it('접근자 속성이 있는 요청을 전달하면 접근자를 실행하지 않고 거부한다', () => {
      let invoked = 0;
      const request = Object.defineProperty({}, 'mode', {
        /** 실행되어서는 안 되는 외부 입력의 접근자다. */
        get() {
          invoked++;
          return 'update';
        },
        enumerable: true,
      });
      const result = planDocumentChange(request, baseContext);

      expect(result).toEqual({
        status: changePlanStatuses.failed,
        diagnostics: [
          {
            code: changePlanDiagnosticCodes.invalidRequest,
            severity: diagnosticSeverities.error,
            message: changePlanDiagnosticMessages.invalidRequest,
          },
        ],
      });
      expect(invoked).toBe(0);
    });

    it('순환 객체를 속성값으로 전달하면 후보를 만들지 않고 거부한다', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { custom: cyclic },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.failed);
      if (result.status === changePlanStatuses.failed)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: schemaDiagnosticCodes.invalidFieldValue,
            severity: diagnosticSeverities.error,
            message: schemaDiagnosticMessages.cyclicReference,
          }),
        );
    });
  });

  describe('문서 경로·원문 버전·색인 상태 확인', () => {
    it.each([
      ['현재 폴더 구간', '.codocs/./new.yaml'],
      ['상위 폴더 구간', '.codocs/team/../new.yaml'],
      ['빈 경로 구간', '.codocs//new.yaml'],
      ['역슬래시', '.codocs\\new.yaml'],
      ['절대 경로', '/project/.codocs/new.yaml'],
      ['지원하지 않는 확장자', '.codocs/new.json'],
    ])(
      '생성 경로에 %s을 사용하면 잘못된 요청으로 거부한다',
      (_label, targetPath) => {
        const request = {
          mode: 'create',
          path: targetPath,
          document: {
            id: 'new',
            name: '새 문서',
            domains: ['운영'],
            definition: '설명',
          },
        };
        const context = { catalog: baseCatalog };

        const result = planDocumentChange(request, context);

        expect(result).toEqual({
          status: changePlanStatuses.failed,
          diagnostics: [
            {
              code: changePlanDiagnosticCodes.invalidRequest,
              severity: diagnosticSeverities.error,
              message: changePlanDiagnosticMessages.invalidRequest,
            },
          ],
        });
      },
    );

    it.each([
      { label: '설명 변경', set: { definition: '새 설명' } },
      { label: '동일한 설명 재지정', set: { definition: '설명' } },
    ])(
      'UTF-8 해석 손실이 있는 원문에 $label을 요청하면 원문 손실 오류로 거부한다',
      ({ set }) => {
        // 원본 바이트의 손실 판정은 로더 책임이며, 여기서는 전달받은 판정을 사용한다.
        const context = {
          ...baseContext,
          source: { ...baseContext.source, utf8Lossless: false },
        };
        const request = {
          mode: 'update',
          id: baseDocument.id,
          revision: context.source.revision,
          set,
        };
        const before = { ...context.source };

        const result = planDocumentChange(request, context);

        expect(result).toEqual({
          status: changePlanStatuses.failed,
          diagnostics: [
            {
              code: changePlanDiagnosticCodes.sourceNotLossless,
              severity: diagnosticSeverities.error,
              message: changePlanDiagnosticMessages.sourceNotLossless,
              path: context.source.path,
            },
          ],
        });
        expect(context.source).toEqual(before);
      },
    );

    it('오래된 revision으로 수정을 요청하면 불일치 오류를 반환한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'stale',
        unset: ['absent'],
      };
      const result = planDocumentChange(request, baseContext);

      expect(result).toEqual({
        status: changePlanStatuses.failed,
        diagnostics: [
          {
            code: changePlanDiagnosticCodes.revisionMismatch,
            severity: diagnosticSeverities.error,
            message: changePlanDiagnosticMessages.revisionMismatch,
            path,
          },
        ],
      });
    });

    it('이미 색인된 경로에 문서를 생성하면 경로 충돌 오류를 반환한다', () => {
      const request = {
        mode: 'create',
        path,
        document: {
          id: 'new-zone',
          name: '새 구역',
          domains: ['운영'],
          definition: '설명',
        },
      };
      const context = { catalog: baseCatalog };
      const result = planDocumentChange(request, context);

      expect(result).toEqual({
        status: changePlanStatuses.failed,
        diagnostics: [
          {
            code: changePlanDiagnosticCodes.pathExists,
            severity: diagnosticSeverities.error,
            message: changePlanDiagnosticMessages.pathExists,
            path,
          },
        ],
      });
    });

    it('불완전한 색인에서 수정을 요청하면 확인 불가 오류를 반환한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명' },
      };
      const context = {
        catalog: { ...baseCatalog, status: scanStatuses.partial },
        source: baseContext.source,
      };
      const result = planDocumentChange(request, context);

      expect(result).toEqual({
        status: changePlanStatuses.failed,
        diagnostics: [
          {
            code: changePlanDiagnosticCodes.incompleteCatalog,
            severity: diagnosticSeverities.error,
            message: changePlanDiagnosticMessages.incompleteCatalog,
            path,
          },
        ],
      });
    });
  });

  describe('변경할 문서와 참조 대상의 오류·경고 처리', () => {
    it('새 ID에 공백이 있으면 필드 값 오류를 반환한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'Bad ID' },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.failed);
      if (result.status !== changePlanStatuses.failed) return;
      const diagnostic = result.diagnostics.find(
        (item) => item.code === schemaDiagnosticCodes.invalidFieldValue,
      );
      expect(diagnostic).toMatchObject({
        severity: diagnosticSeverities.error,
        message: schemaDiagnosticMessages.invalidId,
      });
      expect(diagnostic?.range).toEqual({
        start: { line: 0, character: 4 },
        end: { line: 0, character: 10 },
      });
    });

    it('원문에 잘못된 이전 ID가 있으면 무변경 요청도 실패한다', () => {
      const raw = base.replace(
        'deprecatedAliases: []',
        'deprecatedAliases: [{id: Bad ID}]',
      );
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: {
                    ...baseParsed.data,
                    deprecatedAliases: [{ id: 'Bad ID' }],
                  },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['absent'],
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.failed);
      if (result.status === changePlanStatuses.failed)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: schemaDiagnosticCodes.invalidFieldValue,
            severity: diagnosticSeverities.error,
            message: schemaDiagnosticMessages.invalidId,
          }),
        );
    });

    it('원문에 잘못된 ID가 있으면 무변경 요청도 실패한다', () => {
      const raw = base.replace('id: zone', 'id: Bad');
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              id: 'Bad',
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, id: 'Bad' },
                },
              },
            },
          ],
        ]),
        idPaths: new Map([['Bad', new Set([path])]]),
      };
      const request = {
        mode: 'update',
        id: 'Bad',
        revision: 'old-revision',
        unset: ['absent'],
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.failed);
      if (result.status === changePlanStatuses.failed)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: schemaDiagnosticCodes.invalidFieldValue,
            severity: diagnosticSeverities.error,
            message: schemaDiagnosticMessages.invalidId,
          }),
        );
    });

    it('알 수 없는 속성이 있는 원문에서 무변경 요청을 하면 경고 없이 완료한다', () => {
      const raw = base + 'custom: value\n';
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, custom: 'value' },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['missing'],
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.unchanged);
      if (result.status === changePlanStatuses.unchanged)
        expect(result.diagnostics).toEqual([]);
    });

    it('다른 문서의 필드 오류가 있으면 대상 문서 수정 후보에는 포함하지 않는다', () => {
      const otherPath = '.codocs/other.yaml';
      const otherRaw =
        'id: other\nname: 다른 이름\ndomains: [운영]\ndeprecatedAliases: []\ndefinition: ""\n';
      const otherDocument: CatalogDocument = {
        ...baseDocument,
        path: otherPath,
        id: 'other',
        name: '다른 이름',
        observation: {
          path: otherPath,
          parsed: {
            ...baseParsed,
            source: otherRaw,
            data: {
              id: 'other',
              name: '다른 이름',
              domains: ['운영'],
              definition: '',
            },
          },
        },
      };
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [path, baseDocument],
          [otherPath, otherDocument],
        ]),
        idPaths: new Map([
          ['zone', new Set([path])],
          ['other', new Set([otherPath])],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명' },
      };
      const context = { catalog, source: baseContext.source };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.diagnostics).toEqual([]);
    });

    it('다른 문서와 같은 ID로 바꾸면 중복 ID 오류를 반환한다', () => {
      const otherPath = '.codocs/other.yaml';
      const otherDocument: CatalogDocument = {
        ...baseDocument,
        path: otherPath,
        id: 'other',
        name: '다른 이름',
        observation: {
          path: otherPath,
          parsed: {
            ...baseParsed,
            source:
              'id: other\nname: 다른 이름\ndomains: [운영]\ndeprecatedAliases: []\ndefinition: 설명\n',
            data: {
              id: 'other',
              name: '다른 이름',
              domains: ['운영'],
              definition: '설명',
            },
          },
        },
      };
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [path, baseDocument],
          [otherPath, otherDocument],
        ]),
        idPaths: new Map([
          ['zone', new Set([path])],
          ['other', new Set([otherPath])],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'other' },
      };
      const context = { catalog, source: baseContext.source };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.failed);
      if (result.status === changePlanStatuses.failed)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: catalogDiagnosticCodes.duplicateId,
            severity: diagnosticSeverities.error,
            message: catalogDiagnosticMessages.duplicateId,
          }),
        );
    });

    it('깨진 참조를 설명에서 제거하면 수정 후보를 반환한다', () => {
      const raw = base.replace(
        'definition: 설명',
        'definition: "[[없는 이름]]"',
      );
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, definition: '[[없는 이름]]' },
                },
              },
            },
          ],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '설명' },
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
    });

    it('오류가 있는 문서를 참조하면 대상 오류를 경고로 반환한다', () => {
      const raw = base.replace('definition: 설명', 'definition: "[[대상]]"');
      const targetPath = '.codocs/target.yaml';
      const targetDocument: CatalogDocument = {
        ...baseDocument,
        path: targetPath,
        id: 'target',
        name: '대상',
        observation: {
          path: targetPath,
          parsed: {
            ...baseParsed,
            source:
              'id: target\nname: 대상\ndomains: [운영]\ndeprecatedAliases: []\ndefinition: ""\n',
            data: {
              id: 'target',
              name: '대상',
              domains: ['운영'],
              definition: '',
            },
          },
        },
      };
      const catalog: Catalog = {
        ...baseCatalog,
        documents: new Map([
          [
            path,
            {
              ...baseDocument,
              observation: {
                path,
                parsed: {
                  ...baseParsed,
                  source: raw,
                  data: { ...baseParsed.data, definition: '[[대상]]' },
                },
              },
            },
          ],
          [targetPath, targetDocument],
        ]),
        idPaths: new Map([
          ['zone', new Set([path])],
          ['target', new Set([targetPath])],
        ]),
      };
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['absent'],
      };
      const context = {
        catalog,
        source: { path, raw, revision: 'old-revision', utf8Lossless: true },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.unchanged);
      if (result.status === changePlanStatuses.unchanged)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: catalogDiagnosticCodes.referenceTargetError,
            severity: diagnosticSeverities.warning,
            message: catalogDiagnosticMessages.referenceTargetError,
          }),
        );
    });
  });
});
