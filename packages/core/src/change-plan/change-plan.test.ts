import { describe, expect, it } from 'vitest';
import {
  catalogConfirmations,
  scanStatuses,
  type Catalog,
  type CatalogDocument,
  type RenameChange,
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
import { parseYaml, type YamlParseResult } from '../parser/index.js';
import {
  applyRenameChanges,
  changePlanStatuses,
  planDocumentChange,
} from './index.js';

const path = '.codocs/zone.yaml';
const base = 'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\n';
const baseParsed: Extract<YamlParseResult, { success: true }> = {
  success: true,
  source: base,
  data: {
    id: 'zone',
    name: '구역',
    domains: ['운영'],
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

/** 원문과 파싱 데이터를 가진 문서 하나의 계획 문맥을 만든다. */
function contextFor(raw: string, data: Record<string, unknown>) {
  const id = String(data.id);
  const catalog: Catalog = {
    ...baseCatalog,
    documents: new Map([
      [
        path,
        {
          ...baseDocument,
          id,
          observation: {
            path,
            parsed: { ...baseParsed, source: raw, data },
          },
        },
      ],
    ]),
    idPaths: new Map([[id, new Set([path])]]),
  };
  return {
    catalog,
    source: { path, raw, revision: 'old-revision', utf8Lossless: true },
  };
}

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
        'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 새 설명\n',
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
      });
      expect(result.raw).toContain('id: new-zone');
    });

    it('deprecatedAliases를 포함해 문서를 생성하면 저장할 원문과 데이터에 그 키가 없다', () => {
      const request = {
        mode: 'create',
        path: '.codocs/new-zone.yaml',
        document: {
          id: 'new-zone',
          name: '새 구역',
          domains: ['운영'],
          definition: '설명',
          deprecatedAliases: [{ id: 'old-zone' }],
          custom: '보존',
        },
      };
      const result = planDocumentChange(request, { catalog: baseCatalog });

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.raw).not.toContain('deprecatedAliases');
      expect(result.raw).toContain('custom: 보존');
      expect(result.data).not.toHaveProperty('deprecatedAliases');
      expect(request.document.deprecatedAliases).toEqual([{ id: 'old-zone' }]);
    });

    it('deprecatedAliases 없이 문서를 생성하면 빈 배열을 채우지 않는다', () => {
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
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).not.toContain('deprecatedAliases');
    });

    it('블록 스타일 deprecatedAliases가 있는 문서의 설명을 바꾸면 그 키 블록만 사라지고 나머지 원문은 그대로다', () => {
      const raw =
        "id: zone\n# 이름 주석\nname: '구역' # 옆 주석\ndomains: [운영]\ndeprecatedAliases:\n  - id: old-zone\n    message: 안내\ndefinition: 설명\ncustom:   보존\n";
      const context = contextFor(raw, {
        id: 'zone',
        name: '구역',
        domains: ['운영'],
        deprecatedAliases: [{ id: 'old-zone', message: '안내' }],
        definition: '설명',
        custom: '보존',
      });
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명' },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.raw).toBe(
        "id: zone\n# 이름 주석\nname: '구역' # 옆 주석\ndomains: [운영]\ndefinition: 새 설명\ncustom:   보존\n",
      );
      expect(result.data).not.toHaveProperty('deprecatedAliases');
    });

    it('flow 스타일 deprecatedAliases가 있는 문서의 설명을 바꾸면 그 속성만 사라지고 나머지 원문은 그대로다', () => {
      const raw =
        '{id: zone, name: 구역, domains: [운영], deprecatedAliases: [{id: old-zone}], definition: 설명, custom:   보존}\n';
      const context = contextFor(raw, {
        id: 'zone',
        name: '구역',
        domains: ['운영'],
        deprecatedAliases: [{ id: 'old-zone' }],
        definition: '설명',
        custom: '보존',
      });
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명' },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.raw).toBe(
        '{id: zone, name: 구역, domains: [운영], definition: 새 설명, custom:   보존}\n',
      );
      expect(result.data).not.toHaveProperty('deprecatedAliases');
    });

    it('deprecatedAliases가 있는 문서에 변경 없는 요청을 보내면 키를 지우려고 저장하지 않고 무변경으로 응답한다', () => {
      const raw =
        'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\ndeprecatedAliases: [{id: old-zone}]\n';
      const context = contextFor(raw, {
        id: 'zone',
        name: '구역',
        domains: ['운영'],
        definition: '설명',
        deprecatedAliases: [{ id: 'old-zone' }],
      });
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '설명', deprecatedAliases: [] },
        unset: ['missing'],
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.unchanged);
    });

    it('deprecatedAliases를 unset해도 거부하지 않고 키만 지우려는 저장 없이 무변경으로 응답한다', () => {
      const raw =
        'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\ndeprecatedAliases: []\n';
      const context = contextFor(raw, {
        id: 'zone',
        name: '구역',
        domains: ['운영'],
        definition: '설명',
      });
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['deprecatedAliases'],
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.unchanged);
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

  describe('ID 변경', () => {
    it('ID를 변경하면 결과 데이터와 원문에 deprecatedAliases가 없다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone' },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.data).not.toHaveProperty('deprecatedAliases');
      expect(result.raw).toBe(
        'id: next-zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\n',
      );
    });

    it('이전 ID가 기록된 문서의 ID를 바꾸면 이전 ID를 더하지 않고 기존 키도 지운다', () => {
      const raw =
        'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\ndeprecatedAliases: [{id: previous, message: 안내}]\n';
      const context = contextFor(raw, {
        id: 'zone',
        name: '구역',
        domains: ['운영'],
        definition: '설명',
        deprecatedAliases: [{ id: 'previous', message: '안내' }],
      });
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone' },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.data).not.toHaveProperty('deprecatedAliases');
      expect(result.raw).toBe(
        'id: next-zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\n',
      );
    });
  });

  describe('문서 속성 편집과 기존 YAML 형식 보존', () => {
    it('설명만 바꾸면 수정하지 않은 따옴표·주석·CRLF·파일 끝을 보존한다', () => {
      const raw =
        '# 앞 주석\r\nid: zone\r\nname: "구역" # 옆 주석\r\ndomains: [운영]\r\ndefinition: 설명';
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
          '# 앞 주석\r\nid: zone\r\nname: "구역" # 옆 주석\r\ndomains: [운영]\r\ndefinition: 새😀설명',
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
        '  id: zone\n  name: 구역\n  domains: [운영]\n  definition: 설명\n  examples: [옛 예시]\n';
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

    it('들여쓴 문서의 ID를 바꾸면 들여쓰기를 유지하고 이전 ID 속성을 만들지 않는다', () => {
      const raw =
        '  id: zone\n  name: 구역\n  domains: [운영]\n  definition: 설명\n';
      const context = contextFor(raw, {
        id: 'zone',
        name: '구역',
        domains: ['운영'],
        definition: '설명',
      });
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone' },
      };
      const result = planDocumentChange(request, context);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(result.raw).toBe(
          '  id: next-zone\n  name: 구역\n  domains: [운영]\n  definition: 설명\n',
        );
    });

    it('중괄호 매핑에 중첩 객체를 추가하면 그 값을 결과 데이터에 반영한다', () => {
      const raw = '{id: zone, name: 구역, domains: [운영], definition: 설명}\n';
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
          '{id: zone, name: 구역, domains: [운영], definition: 설명, first: 1, middle: 2, last: 3}\n';
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
        '{id: zone, name: 구역, domains: [운영], definition: 설명, a: 1, b: 2, c: 3,}\n';
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
        '{id: zone, name: 구역, domains: [운영], definition: 설명, old: 1,}\n';
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
        '{id: zone, name: 구역, domains: [운영], definition: 설명, a: 1, # a comment\n # independent, comma\n b: 2}\n';
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
          '{id: zone, name: 구역, domains: [운영], definition: 설명, a: 1, # a comment\n # independent, comma\n b: 2}\n';
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
        '{id: zone, name: 구역, domains: [운영], definition: 설명, # 옆\n # 독립 주석, 쉼표\n old: 1, tail: 2}\n';
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

    it('수정 요청의 name이 현재 이름과 다르면 후보를 만들지 않고 이름 변경 안내와 함께 거부한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { name: '다른 구역' },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result).toEqual({
        status: changePlanStatuses.failed,
        diagnostics: [
          {
            code: changePlanDiagnosticCodes.nameChangeNotAllowed,
            severity: diagnosticSeverities.error,
            message: changePlanDiagnosticMessages.nameChangeNotAllowed,
            path,
          },
        ],
      });
    });

    it('수정 요청의 name이 현재 이름과 같으면 변경 없는 결과를 반환한다', () => {
      const request = {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { name: '구역' },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result).toMatchObject({
        status: changePlanStatuses.unchanged,
        path,
      });
    });

    it('문서 생성 요청의 name은 현재 이름과 비교하지 않고 후보로 만든다', () => {
      const request = {
        mode: 'create',
        path: '.codocs/new.yaml',
        document: {
          id: 'created',
          name: '새 문서',
          domains: ['운영'],
          definition: '설명',
        },
      };
      const result = planDocumentChange(request, baseContext);

      expect(result.status).toBe(changePlanStatuses.candidate);
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
        'id: other\nname: 다른 이름\ndomains: [운영]\ndefinition: ""\n';
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
              'id: other\nname: 다른 이름\ndomains: [운영]\ndefinition: 설명\n',
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
            source: 'id: target\nname: 대상\ndomains: [운영]\ndefinition: ""\n',
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

/** 위치 계산을 위해 원문 한 곳의 이름 변경 수정안을 만든다. 호출 테스트가 입력 원문과 기대 원문을 직접 가진다. */
function renameChange(
  source: string,
  fieldPath: readonly (string | number)[],
  rawOld: string,
  oldText: string,
  newText: string,
): RenameChange {
  const start = source.indexOf(rawOld);
  return {
    path,
    fieldPath,
    offsetRange: { start, end: start + rawOld.length },
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    oldText,
    newText,
    targetPath: path,
    candidates: [],
  };
}

describe('applyRenameChanges', () => {
  describe('YAML 스칼라 형식별 이름 변경 적용', () => {
    it.each([
      {
        title: 'plain 이름은 plain으로 바꾼다',
        source: 'id: a\nname: 주문\ndomains: [판매]\ndefinition: 설명\n',
        rawOld: '주문',
        newText: '새주문',
        expected: 'id: a\nname: 새주문\ndomains: [판매]\ndefinition: 설명\n',
      },
      {
        title: '작은따옴표 이름은 작은따옴표로 바꾼다',
        source: "id: a\nname: '주문'\ndomains: [판매]\ndefinition: 설명\n",
        rawOld: '주문',
        newText: '새주문',
        expected: "id: a\nname: '새주문'\ndomains: [판매]\ndefinition: 설명\n",
      },
      {
        title: '큰따옴표 이름은 큰따옴표로 바꾼다',
        source: 'id: a\nname: "주문"\ndomains: [판매]\ndefinition: 설명\n',
        rawOld: '주문',
        newText: '새주문',
        expected: 'id: a\nname: "새주문"\ndomains: [판매]\ndefinition: 설명\n',
      },
      {
        title:
          '작은따옴표 이름의 새 값에 작은따옴표가 있으면 두 개로 escape한다',
        source: "id: a\nname: '주문'\ndomains: [판매]\ndefinition: 설명\n",
        rawOld: '주문',
        newText: "it's",
        expected: "id: a\nname: 'it''s'\ndomains: [판매]\ndefinition: 설명\n",
      },
      {
        title: '큰따옴표 이름의 새 값에 따옴표와 역슬래시가 있으면 escape한다',
        source: 'id: a\nname: "주문"\ndomains: [판매]\ndefinition: 설명\n',
        rawOld: '주문',
        newText: 'a"b\\c',
        expected:
          'id: a\nname: "a\\"b\\\\c"\ndomains: [판매]\ndefinition: 설명\n',
      },
    ])('$title', ({ source, rawOld, newText, expected }) => {
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(source, ['name'], rawOld, '주문', newText);
      const result = applyRenameChanges(parsed, [change]);

      expect(result).toEqual({ success: true, raw: expected });
    });

    it("작은따옴표 안의 ''로 적힌 기존 이름은 해석값 기준으로 새 이름으로 바꾼다", () => {
      const source =
        "id: a\nname: 'it''s'\ndomains: [판매]\ndefinition: 설명\n";
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(source, ['name'], "it''s", "it's", '새주문');
      const result = applyRenameChanges(parsed, [change]);

      expect(result).toEqual({
        success: true,
        raw: "id: a\nname: '새주문'\ndomains: [판매]\ndefinition: 설명\n",
      });
    });

    it.each([
      {
        title: 'plain 설명 안의 참조를 바꾼다',
        definition: 'definition: 앞 [[주문]] 뒤\n',
        newText: '[[새주문]]',
        expected: 'definition: 앞 [[새주문]] 뒤\n',
      },
      {
        title: '작은따옴표 설명 안의 참조를 바꾼다',
        definition: "definition: '앞 [[주문]] 뒤'\n",
        newText: '[[새주문]]',
        expected: "definition: '앞 [[새주문]] 뒤'\n",
      },
      {
        title:
          '큰따옴표 설명 안의 참조에 새 이름의 콜론 escape를 역슬래시로 보존한다',
        definition: 'definition: "앞 [[주문]] 뒤"\n',
        newText: '[[a\\:b]]',
        expected: 'definition: "앞 [[a\\\\:b]] 뒤"\n',
      },
      {
        title: '블록 설명 안의 참조를 바꾼다',
        definition: 'definition: |\n  앞 [[주문]] 뒤\n  둘째 줄\n',
        newText: '[[판매:새주문]]',
        expected: 'definition: |\n  앞 [[판매:새주문]] 뒤\n  둘째 줄\n',
      },
    ])('$title', ({ definition, newText, expected }) => {
      const source = `id: a\nname: 출처\ndomains: [판매]\n${definition}`;
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(
        source,
        ['definition'],
        '[[주문]]',
        '[[주문]]',
        newText,
      );
      const result = applyRenameChanges(parsed, [change]);

      expect(result).toEqual({
        success: true,
        raw: `id: a\nname: 출처\ndomains: [판매]\n${expected}`,
      });
    });
  });

  describe('바꾸지 않는 원문의 보존', () => {
    it('바꾸는 위치 밖의 주석과 CRLF 줄바꿈을 그대로 둔다', () => {
      const source =
        "# 앞 주석\r\nid: a\r\nname: '주문' # 이름 주석\r\ndomains: [판매]\r\ndefinition: 설명\r\n";
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(source, ['name'], '주문', '주문', '새주문');
      const result = applyRenameChanges(parsed, [change]);

      expect(result).toEqual({
        success: true,
        raw: "# 앞 주석\r\nid: a\r\nname: '새주문' # 이름 주석\r\ndomains: [판매]\r\ndefinition: 설명\r\n",
      });
    });

    it('한 원문의 이름과 설명 참조 두 곳을 함께 바꾼다', () => {
      const source =
        'id: a\nname: 주문\ndomains: [판매]\ndefinition: "[[주문]]과 [[주문]]"\n';
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const first = source.indexOf('[[주문]]');
      const second = source.lastIndexOf('[[주문]]');
      const changes = [
        renameChange(source, ['name'], '주문', '주문', '새주문'),
        {
          ...renameChange(
            source,
            ['definition'],
            '[[주문]]',
            '[[주문]]',
            '[[새주문]]',
          ),
          offsetRange: { start: first, end: first + 6 },
        },
        {
          ...renameChange(
            source,
            ['definition'],
            '[[주문]]',
            '[[주문]]',
            '[[새주문]]',
          ),
          offsetRange: { start: second, end: second + 6 },
        },
      ];
      const result = applyRenameChanges(parsed, changes);

      expect(result).toEqual({
        success: true,
        raw: 'id: a\nname: 새주문\ndomains: [판매]\ndefinition: "[[새주문]]과 [[새주문]]"\n',
      });
    });
  });

  describe('쓸 수 없는 수정안의 거부', () => {
    it('plain 이름에 ": "가 들어간 새 이름을 쓰면 데이터가 달라지므로 실패한다', () => {
      const source = 'id: a\nname: 주문\ndomains: [판매]\ndefinition: 설명\n';
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(source, ['name'], '주문', '주문', 'a: b');
      const result = applyRenameChanges(parsed, [change]);

      expect(result).toEqual({ success: false });
    });

    it('수정안의 기존 텍스트가 해당 위치의 해석값과 다르면 실패한다', () => {
      const source = 'id: a\nname: 주문\ndomains: [판매]\ndefinition: 설명\n';
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(source, ['name'], '주문', '결제', '새주문');
      const result = applyRenameChanges(parsed, [change]);

      expect(result).toEqual({ success: false });
    });

    it('서로 겹치는 두 수정안을 받으면 실패한다', () => {
      const source =
        'id: a\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\n';
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(
        source,
        ['definition'],
        '[[주문]]',
        '[[주문]]',
        '[[새주문]]',
      );
      const result = applyRenameChanges(parsed, [change, change]);

      expect(result).toEqual({ success: false });
    });
  });
});

describe('applyRenameChanges: deprecatedAliases 삭제', () => {
  it.each([
    {
      title: '블록 스타일',
      source:
        'id: a\nname: 출처\ndomains: [판매]\ndeprecatedAliases:\n  - id: old-a\n    message: 안내\n# 정의 주석\ndefinition: "[[주문]]"\n',
      expected:
        'id: a\nname: 출처\ndomains: [판매]\n# 정의 주석\ndefinition: "[[새주문]]"\n',
    },
    {
      title: 'flow 스타일',
      source:
        '{id: a, name: 출처, domains: [판매], deprecatedAliases: [{id: old-a}], definition: "[[주문]]"}\n',
      expected:
        '{id: a, name: 출처, domains: [판매], definition: "[[새주문]]"}\n',
    },
  ])(
    '$title 문서의 참조를 바꾸면 deprecatedAliases만 지우고 참조를 바꾼다',
    ({ source, expected }) => {
      const parsed = parseYaml(source, path);
      if (!parsed.success)
        throw new Error('테스트 입력 원문이 파싱되지 않았다');
      const change = renameChange(
        source,
        ['definition'],
        '[[주문]]',
        '[[주문]]',
        '[[새주문]]',
      );

      const result = applyRenameChanges(parsed, [change]);

      expect(result).toEqual({ success: true, raw: expected });
    },
  );

  it('deprecatedAliases가 참조 편집 위치보다 뒤에 있어도 겹치지 않고 둘 다 적용한다', () => {
    const source =
      'id: a\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\ndeprecatedAliases: [{id: old-a}]\n';
    const parsed = parseYaml(source, path);
    if (!parsed.success) throw new Error('테스트 입력 원문이 파싱되지 않았다');
    const change = renameChange(
      source,
      ['definition'],
      '[[주문]]',
      '[[주문]]',
      '[[새주문]]',
    );

    const result = applyRenameChanges(parsed, [change]);

    expect(result).toEqual({
      success: true,
      raw: 'id: a\nname: 출처\ndomains: [판매]\ndefinition: "[[새주문]]"\n',
    });
  });
});
