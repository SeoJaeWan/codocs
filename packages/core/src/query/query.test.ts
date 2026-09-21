import { describe, expect, it } from 'vitest';
import {
  catalogConfirmations,
  referenceResolutionStatuses,
  scanStatuses,
  type Catalog,
  type CatalogDocument,
  type CatalogOccurrence,
} from '../catalog/index.js';
import {
  catalogDiagnosticCodes,
  diagnosticSeverities,
  queryDiagnosticCodes,
  schemaDiagnosticCodes,
} from '../diagnostics/index.js';
import { referenceSyntaxStatuses } from '../references/domain-values.js';
import { documentKinds, documentStatuses } from '../validator/domain-values.js';
import {
  projectCatalogGet,
  projectCatalogList,
  projectCatalogPaths,
} from './index.js';

const parsedBase = {
  success: true as const,
  source: '',
  fields: [],
  strings: [],
  diagnostics: [],
};
const documentBase = {
  domains: ['도메인'],
  confirmation: catalogConfirmations.confirmed,
  documentDiagnostics: [],
  diagnostics: [],
  occurrences: [],
  references: [],
  referencedBy: [],
} satisfies Pick<
  CatalogDocument,
  | 'domains'
  | 'confirmation'
  | 'documentDiagnostics'
  | 'diagnostics'
  | 'occurrences'
  | 'references'
  | 'referencedBy'
>;
const catalogBase: Catalog = {
  status: scanStatuses.complete,
  failures: [],
  documents: new Map(),
  idPaths: new Map(),
  namePaths: new Map(),
  domainNamePaths: new Map(),
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
      source: 'id: a\nname: A\n',
      data: { id: 'a', name: 'A', domains: ['도메인'], definition: '설명' },
    },
  },
} satisfies CatalogDocument;
const occurrence = {
  occurrence: {
    syntax: referenceSyntaxStatuses.valid,
    name: 'Target',
    fieldPath: ['definition'],
    text: '[[Target]]',
    decodedRange: { start: 0, end: 10 },
    offsetRange: { start: 12, end: 22 },
    range: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 10 },
    },
  },
  resolution: { status: referenceResolutionStatuses.missing, candidates: [] },
} satisfies CatalogOccurrence;

describe('projectCatalogList: Catalog 문서 목록 투영', () => {
  describe('문서 표시와 ID 정렬', () => {
    it('유일한 ID 문서를 조회하면 이름과 발견 경로를 표시한다', () => {
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[alpha.path, alpha]]),
        idPaths: new Map([[alpha.id, new Set([alpha.path])]]),
      };

      const result = projectCatalogList(catalog);

      expect(result).toEqual({
        totalCount: 1,
        items: [
          expect.objectContaining({
            id: alpha.id,
            name: alpha.name,
            source: { path: alpha.path },
            conflict: false,
          }),
        ],
      });
    });

    it.each([0, 1, 49, 50, 51, 100])(
      '역순으로 등록한 문서 %i개를 조회하면 ID 오름차순으로 모두 반환한다',
      (size) => {
        const ids = Array.from({ length: size }, (_, index) =>
          String(index + 1).padStart(3, '0'),
        );
        const documents = ids.map((id) => {
          const path = id + '.yaml';
          return {
            ...alpha,
            path,
            id,
            name: '문서 ' + id,
            observation: {
              path,
              parsed: {
                ...parsedBase,
                data: { id, name: '문서 ' + id, domains: ['도메인'] },
              },
            },
          } satisfies CatalogDocument;
        });
        const catalog: Catalog = {
          ...catalogBase,
          documents: new Map(
            documents.map((document) => [document.path, document]),
          ),
          idPaths: new Map(
            [...documents]
              .reverse()
              .map((document) => [document.id, new Set([document.path])]),
          ),
        };

        const result = projectCatalogList(catalog);

        expect(result.totalCount).toBe(size);
        expect(result.items.map((item) => item.id)).toEqual(ids);
      },
    );
  });

  describe('목록 필터와 사용할 수 없는 속성', () => {
    it('한 문서가 도메인·종류·상태 조건을 모두 만족하면 그 문서를 포함한다', () => {
      const document = {
        ...alpha,
        domains: ['판매', '공통'],
        observation: {
          path: alpha.path,
          parsed: {
            ...parsedBase,
            data: {
              id: alpha.id,
              name: alpha.name,
              domains: ['판매', '공통'],
              kind: documentKinds.policy,
              status: documentStatuses.confirmed,
            },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[document.path, document]]),
        idPaths: new Map([[document.id, new Set([document.path])]]),
      };
      const filters = {
        domain: '판매',
        kind: documentKinds.policy,
        status: documentStatuses.confirmed,
      };

      const result = projectCatalogList(catalog, filters);

      expect(result.items.map((item) => item.id)).toEqual([document.id]);
    });

    it.each([
      {
        domain: '구매',
        kind: documentKinds.policy,
        status: documentStatuses.confirmed,
      },
      {
        domain: '판매',
        kind: documentKinds.decision,
        status: documentStatuses.confirmed,
      },
      {
        domain: '판매',
        kind: documentKinds.policy,
        status: documentStatuses.proposed,
      },
    ])(
      '한 필터만 불일치하는 %j 조건으로 조회하면 문서를 제외한다',
      (filters) => {
        const document = {
          ...alpha,
          domains: ['판매'],
          observation: {
            path: alpha.path,
            parsed: {
              ...parsedBase,
              data: {
                id: alpha.id,
                name: alpha.name,
                domains: ['판매'],
                kind: documentKinds.policy,
                status: documentStatuses.confirmed,
              },
            },
          },
        } satisfies CatalogDocument;
        const catalog: Catalog = {
          ...catalogBase,
          documents: new Map([[document.path, document]]),
          idPaths: new Map([[document.id, new Set([document.path])]]),
        };

        const result = projectCatalogList(catalog, filters);

        expect(result.items).toEqual([]);
      },
    );

    it('종류 필드에 오류가 있으면 다른 필드는 표시하고 종류 필터에서 제외한다', () => {
      const issue = {
        code: schemaDiagnosticCodes.invalidFieldValue,
        severity: diagnosticSeverities.error,
        message: '잘못된 종류',
        fieldPath: ['kind'],
      };
      const document = {
        ...alpha,
        documentDiagnostics: [issue],
        diagnostics: [issue],
        observation: {
          path: alpha.path,
          parsed: {
            ...parsedBase,
            data: {
              id: alpha.id,
              name: alpha.name,
              domains: ['판매'],
              kind: 'unknown',
            },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[document.path, document]]),
        idPaths: new Map([[document.id, new Set([document.path])]]),
      };

      const result = projectCatalogList(catalog);
      const filtered = projectCatalogList(catalog, {
        kind: documentKinds.policy,
      });

      expect(result.items[0]).toMatchObject({
        id: document.id,
        hasErrors: true,
      });
      expect(result.items[0]).not.toHaveProperty('kind');
      expect(filtered.items).toEqual([]);
    });

    it('같은 ID의 두 파일이 필터 조건을 나누어 만족하면 목록에서 제외한다', () => {
      const sales = {
        ...alpha,
        domains: ['판매'],
        observation: {
          path: alpha.path,
          parsed: {
            ...parsedBase,
            data: {
              id: alpha.id,
              name: alpha.name,
              domains: ['판매'],
              kind: documentKinds.decision,
            },
          },
        },
      } satisfies CatalogDocument;
      const policy = {
        ...alpha,
        path: 'policy.yaml',
        domains: ['구매'],
        observation: {
          path: 'policy.yaml',
          parsed: {
            ...parsedBase,
            data: {
              id: alpha.id,
              name: alpha.name,
              domains: ['구매'],
              kind: documentKinds.policy,
            },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [sales.path, sales],
          [policy.path, policy],
        ]),
        idPaths: new Map([[alpha.id, new Set([sales.path, policy.path])]]),
      };
      const filters = { domain: '판매', kind: documentKinds.policy };

      const result = projectCatalogList(catalog, filters);

      expect(result).toEqual({ items: [], totalCount: 0 });
    });

    it('중복 ID의 한 경로만 필터에 맞으면 모든 충돌 경로를 반환한다', () => {
      const matching = {
        ...alpha,
        path: 'z.yaml',
        id: 'shared',
        domains: ['판매'],
        observation: {
          path: 'z.yaml',
          parsed: {
            ...parsedBase,
            data: {
              id: 'shared',
              name: '판매',
              domains: ['판매'],
              kind: documentKinds.policy,
            },
          },
        },
      } satisfies CatalogDocument;
      const other = {
        ...alpha,
        path: 'a.yaml',
        id: 'shared',
        domains: ['구매'],
        observation: {
          path: 'a.yaml',
          parsed: {
            ...parsedBase,
            data: {
              id: 'shared',
              name: '구매',
              domains: ['구매'],
              kind: documentKinds.decision,
            },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [matching.path, matching],
          [other.path, other],
        ]),
        idPaths: new Map([['shared', new Set(['z.yaml', 'a.yaml'])]]),
      };

      const result = projectCatalogList(catalog, {
        domain: '판매',
        kind: documentKinds.policy,
      });

      expect(result.items).toEqual([
        {
          id: 'shared',
          paths: ['a.yaml', 'z.yaml'],
          hasErrors: true,
          conflict: true,
        },
      ]);
    });
  });
});

describe('projectCatalogGet: ID별 문서 상세 투영', () => {
  describe('문서 조회와 요청 ID 처리', () => {
    it('유일한 ID를 조회하면 문서와 경로를 반환한다', () => {
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[alpha.path, alpha]]),
        idPaths: new Map([[alpha.id, new Set([alpha.path])]]),
      };
      const ids = [alpha.id];

      const result = projectCatalogGet(catalog, ids);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.results).toEqual([
        expect.objectContaining({
          id: ids[0],
          found: true,
          conflict: false,
          source: { path: alpha.path },
          document: alpha.observation.parsed.data,
        }),
      ]);
    });

    it('같은 ID를 반복해서 조회하면 첫 등장 순서로 한 번씩 반환한다', () => {
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[alpha.path, alpha]]),
        idPaths: new Map([[alpha.id, new Set([alpha.path])]]),
      };
      const ids = ['a', 'b', 'a'];

      const result = projectCatalogGet(catalog, ids);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results.map((item) => item.id)).toEqual(['a', 'b']);
    });

    it('없는 ID를 조회하면 내용 없이 not_found 진단을 반환한다', () => {
      const catalog: Catalog = { ...catalogBase };
      const ids = ['missing'];

      const result = projectCatalogGet(catalog, ids);

      expect(result).toEqual({
        success: true,
        results: [
          {
            id: ids[0],
            found: false,
            diagnostics: [
              expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
            ],
          },
        ],
      });
    });

    it.each([
      { name: '빈 목록', ids: [] },
      {
        name: '21개 고유 ID',
        ids: Array.from({ length: 21 }, (_, i) => 'id-' + i),
      },
    ])('$name을 조회하면 invalid_input 오류를 반환한다', ({ ids }) => {
      const catalog: Catalog = { ...catalogBase };

      const result = projectCatalogGet(catalog, ids);

      expect(result).toMatchObject({
        success: false,
        error: { code: queryDiagnosticCodes.invalidInput },
      });
    });

    it('20개 ID를 반복해서 조회하면 중복 제거 후 유효한 요청으로 처리한다', () => {
      const catalog: Catalog = { ...catalogBase };
      const ids = Array.from({ length: 20 }, (_, i) => 'id-' + i);

      const result = projectCatalogGet(catalog, [...ids, ...ids]);

      expect(result.success).toBe(true);
      if (result.success) expect(result.results).toHaveLength(ids.length);
    });
  });

  describe('중복 ID와 원문 보존', () => {
    it('중복 ID를 조회하면 두 경로를 반환하고 대표 문서나 revision을 만들지 않는다', () => {
      const other = {
        ...alpha,
        path: 'z.yaml',
        observation: { ...alpha.observation, path: 'z.yaml' },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [alpha.path, alpha],
          [other.path, other],
        ]),
        idPaths: new Map([[alpha.id, new Set([other.path, alpha.path])]]),
      };
      const ids = [alpha.id];
      const options = {
        revisions: new Map([
          [alpha.path, 'a-revision'],
          [other.path, 'z-revision'],
        ]),
      };

      const result = projectCatalogGet(catalog, ids, options);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.results[0]).toMatchObject({
        id: ids[0],
        found: true,
        conflict: true,
        paths: [alpha.path, other.path],
        diagnostics: [
          expect.objectContaining({ code: catalogDiagnosticCodes.duplicateId }),
        ],
      });
      expect(result.results[0]).not.toHaveProperty('document');
      expect(result.results[0]).not.toHaveProperty('rawYaml');
      expect(result.results[0]).not.toHaveProperty('revision');
    });

    it('문서 데이터에 비유한 수가 있으면 원문과 진단을 반환한다', () => {
      const issue = {
        code: schemaDiagnosticCodes.invalidFieldValue,
        severity: diagnosticSeverities.error,
        message: 'JSON 값이 아닙니다.',
        fieldPath: ['value'],
      };
      const document = {
        ...alpha,
        id: 'broken',
        path: 'broken.yaml',
        name: '오류 문서',
        documentDiagnostics: [issue],
        diagnostics: [issue],
        observation: {
          path: 'broken.yaml',
          parsed: {
            ...parsedBase,
            source: 'id: broken\nvalue: .nan\n',
            data: { id: 'broken', value: NaN },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[document.path, document]]),
        idPaths: new Map([[document.id, new Set([document.path])]]),
      };
      const ids = [document.id];
      const options = { revisions: new Map([[document.path, 'raw-revision']]) };

      const result = projectCatalogGet(catalog, ids, options);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.results[0]).toMatchObject({
        id: ids[0],
        rawYaml: document.observation.parsed.source,
        source: { path: document.path },
        revision: options.revisions.get(document.path),
        diagnostics: [
          expect.objectContaining({ severity: diagnosticSeverities.error }),
        ],
      });
      expect(result.results[0]).not.toHaveProperty('document');
    });
  });

  describe('확정 참조를 외부 ID로 표시', () => {
    it('다른 문서를 직접 참조하면 대상 ID를 반환한다', () => {
      const source = {
        ...alpha,
        path: 'source.yaml',
        id: 'source',
        name: 'Source',
        observation: {
          path: 'source.yaml',
          parsed: {
            ...parsedBase,
            data: { id: 'source', definition: '[[A]]' },
          },
        },
        references: [alpha],
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [source.path, source],
          [alpha.path, alpha],
        ]),
        idPaths: new Map([
          [source.id, new Set([source.path])],
          [alpha.id, new Set([alpha.path])],
        ]),
      };

      const result = projectCatalogGet(catalog, [source.id]);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results[0]).toMatchObject({ references: [alpha.id] });
    });

    it.each([
      { label: '직접 참조', field: 'references' },
      { label: '역참조', field: 'referencedBy' },
    ] as const)(
      '$label 경로 순서와 ID 순서가 다르면 ID 오름차순으로 반환한다',
      ({ field }) => {
        const zebra = {
          ...alpha,
          id: 'zebra',
          path: 'first.yaml',
          observation: {
            path: 'first.yaml',
            parsed: { ...parsedBase, data: { id: 'zebra', name: 'Zebra' } },
          },
        } satisfies CatalogDocument;
        const beta = {
          ...alpha,
          id: 'beta',
          path: 'last.yaml',
          observation: {
            path: 'last.yaml',
            parsed: { ...parsedBase, data: { id: 'beta', name: 'Beta' } },
          },
        } satisfies CatalogDocument;
        const source = {
          ...alpha,
          [field]: [zebra, beta],
        } satisfies CatalogDocument;
        const catalog: Catalog = {
          ...catalogBase,
          documents: new Map([
            [source.path, source],
            [zebra.path, zebra],
            [beta.path, beta],
          ]),
          idPaths: new Map([
            [source.id, new Set([source.path])],
            [zebra.id, new Set([zebra.path])],
            [beta.id, new Set([beta.path])],
          ]),
        };
        const ids = [source.id];

        const result = projectCatalogGet(catalog, ids);

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('상세 조회 실패');
        expect(result.results).toHaveLength(1);
        expect(result.results[0]).toMatchObject({
          [field]: [beta.id, zebra.id],
        });
      },
    );

    it('같은 대상 경로가 반복되면 외부 참조 ID를 한 번만 반환한다', () => {
      const source = {
        ...alpha,
        path: 'source.yaml',
        id: 'source',
        references: [alpha, alpha],
        observation: {
          path: 'source.yaml',
          parsed: {
            ...parsedBase,
            data: { id: 'source', definition: '[[A]] [[A]]' },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [source.path, source],
          [alpha.path, alpha],
        ]),
        idPaths: new Map([
          [source.id, new Set([source.path])],
          [alpha.id, new Set([alpha.path])],
        ]),
      };

      const result = projectCatalogGet(catalog, [source.id]);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results[0]).toMatchObject({ references: [alpha.id] });
    });

    it('없는 참조를 조회하면 원래 위치와 대상 없음 진단을 반환한다', () => {
      const source = {
        ...alpha,
        occurrences: [occurrence],
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[source.path, source]]),
        idPaths: new Map([[source.id, new Set([source.path])]]),
      };

      const result = projectCatalogGet(catalog, [source.id]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.results[0]).toMatchObject({
        references: [],
        diagnostics: [
          expect.objectContaining({
            code: queryDiagnosticCodes.referenceNotFound,
            path: source.path,
            range: occurrence.occurrence.range,
            offsetRange: occurrence.occurrence.offsetRange,
          }),
        ],
      });
      expect(result.results[0]?.diagnostics[0]).not.toHaveProperty(
        'relatedPaths',
      );
    });

    it('동명이인 참조를 조회하면 확정 ID 없이 모든 후보 경로를 반환한다', () => {
      const a = { ...alpha, path: 'a.yaml' } satisfies CatalogDocument;
      const z = { ...alpha, path: 'z.yaml' } satisfies CatalogDocument;
      const source = {
        ...alpha,
        path: 'source.yaml',
        id: 'source',
        occurrences: [
          {
            ...occurrence,
            resolution: {
              status: referenceResolutionStatuses.ambiguous,
              candidates: [
                { ...z, errors: [] },
                { ...a, errors: [] },
              ],
            },
          },
        ],
        observation: {
          path: 'source.yaml',
          parsed: {
            ...parsedBase,
            data: { id: 'source', definition: '[[Target]]' },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[source.path, source]]),
        idPaths: new Map([[source.id, new Set([source.path])]]),
      };

      const result = projectCatalogGet(catalog, [source.id]);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results[0]).toMatchObject({
          references: [],
          diagnostics: [
            expect.objectContaining({
              code: queryDiagnosticCodes.referenceAmbiguous,
              relatedPaths: ['a.yaml', 'z.yaml'],
            }),
          ],
        });
    });
  });

  describe('연결 문서의 ID를 외부 참조로 표시할 수 없는 경우', () => {
    it('대상 문서에 ID가 없으면 외부 ID를 제외하고 대상 경로와 원인을 반환한다', () => {
      const target = {
        ...documentBase,
        path: 'target.yaml',
        name: 'Target',
        observation: {
          path: 'target.yaml',
          parsed: {
            ...parsedBase,
            data: { name: 'Target', domains: ['도메인'] },
          },
        },
      } satisfies CatalogDocument;
      const source = {
        ...alpha,
        path: 'source.yaml',
        id: 'source',
        references: [target],
        occurrences: [
          {
            ...occurrence,
            resolution: {
              status: referenceResolutionStatuses.resolved,
              candidates: [{ ...target, errors: [] }],
              target: { ...target, errors: [] },
            },
          },
        ],
        observation: {
          path: 'source.yaml',
          parsed: {
            ...parsedBase,
            data: { id: 'source', definition: '[[Target]]' },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [source.path, source],
          [target.path, target],
        ]),
        idPaths: new Map([[source.id, new Set([source.path])]]),
      };

      const result = projectCatalogGet(catalog, [source.id]);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results[0]).toMatchObject({
          references: [],
          diagnostics: [
            expect.objectContaining({
              code: catalogDiagnosticCodes.referenceTargetError,
              relatedPaths: [target.path],
              reason: 'missing_id',
            }),
          ],
        });
    });

    it('대상 ID가 다른 문서와 충돌하면 외부 ID를 제외하고 충돌 원인을 반환한다', () => {
      const target = {
        ...alpha,
        path: 'target.yaml',
        id: 'shared',
        name: 'Target',
      } satisfies CatalogDocument;
      const other = {
        ...alpha,
        path: 'other.yaml',
        id: 'shared',
        name: 'Other',
      } satisfies CatalogDocument;
      const source = {
        ...alpha,
        path: 'source.yaml',
        id: 'source',
        references: [target],
        occurrences: [
          {
            ...occurrence,
            resolution: {
              status: referenceResolutionStatuses.resolved,
              candidates: [{ ...target, errors: [] }],
              target: { ...target, errors: [] },
            },
          },
        ],
        observation: {
          path: 'source.yaml',
          parsed: {
            ...parsedBase,
            data: { id: 'source', definition: '[[Target]]' },
          },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [source.path, source],
          [target.path, target],
          [other.path, other],
        ]),
        idPaths: new Map([
          [source.id, new Set([source.path])],
          ['shared', new Set([target.path, other.path])],
        ]),
      };

      const result = projectCatalogGet(catalog, [source.id]);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results[0]).toMatchObject({
          references: [],
          diagnostics: [
            expect.objectContaining({
              relatedPaths: [target.path],
              reason: 'duplicate_id',
            }),
          ],
        });
    });

    it('역참조 출처에 ID가 없으면 외부 ID를 제외하고 출처 경로를 반환한다', () => {
      const source = {
        ...documentBase,
        path: 'source.yaml',
        observation: {
          path: 'source.yaml',
          parsed: {
            ...parsedBase,
            data: { name: 'Source', domains: ['도메인'] },
          },
        },
      } satisfies CatalogDocument;
      const target = {
        ...alpha,
        path: 'target.yaml',
        id: 'target',
        referencedBy: [source],
        observation: {
          path: 'target.yaml',
          parsed: { ...parsedBase, data: { id: 'target', name: 'Target' } },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [target.path, target],
          [source.path, source],
        ]),
        idPaths: new Map([[target.id, new Set([target.path])]]),
      };

      const result = projectCatalogGet(catalog, [target.id]);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results[0]).toMatchObject({
          referencedBy: [],
          diagnostics: [
            expect.objectContaining({
              relatedPaths: [source.path],
              reason: 'missing_id',
            }),
          ],
        });
    });
  });

  describe('큰 응답과 입력 보존', () => {
    it('서로 다른 문서 19개를 직접 참조하면 모든 대상 ID를 반환한다', () => {
      const ids = Array.from(
        { length: 19 },
        (_, index) => 'target-' + String(index).padStart(2, '0'),
      );
      const targets = ids.map((id) => {
        const path = id + '.yaml';
        return {
          ...alpha,
          id,
          path,
          observation: {
            path,
            parsed: { ...parsedBase, data: { id, name: id } },
          },
        } satisfies CatalogDocument;
      });
      const source = {
        ...alpha,
        id: 'source',
        path: 'source.yaml',
        references: targets,
        observation: {
          path: 'source.yaml',
          parsed: { ...parsedBase, data: { id: 'source', name: 'Source' } },
        },
      } satisfies CatalogDocument;
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map<string, CatalogDocument>([
          [source.path, source],
          ...targets.map((target) => [target.path, target] as const),
        ]),
        idPaths: new Map([
          [source.id, new Set([source.path])],
          ...targets.map(
            (target) => [target.id, new Set([target.path])] as const,
          ),
        ]),
      };

      const result = projectCatalogGet(catalog, [source.id]);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.results[0]).toMatchObject({ references: ids });
    });

    it('20개 ID의 큰 본문을 조회하면 결과와 원문 내용을 자르지 않는다', () => {
      const definition = '큰 본문'.repeat(100_000);
      const ids = Array.from({ length: 20 }, (_, index) => 'id-' + index);
      const documents = ids.map((id) => {
        const path = id + '.yaml';
        return {
          ...alpha,
          id,
          path,
          observation: {
            path,
            parsed: { ...parsedBase, data: { id, definition } },
          },
        } satisfies CatalogDocument;
      });
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map(
          documents.map((document) => [document.path, document]),
        ),
        idPaths: new Map(
          documents.map((document) => [document.id, new Set([document.path])]),
        ),
      };

      const result = projectCatalogGet(catalog, ids);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.results).toHaveLength(ids.length);
      expect(result.results[0]).toMatchObject({
        document: { definition },
      });
    });

    it('문서를 조회하면 입력 ID와 원본 Catalog 문서를 변경하지 않고 새 값을 반환한다', () => {
      const catalog: Catalog = {
        ...catalogBase,
        documents: new Map([[alpha.path, alpha]]),
        idPaths: new Map([[alpha.id, new Set([alpha.path])]]),
      };
      const ids = [alpha.id, alpha.id];
      const beforeIds = [...ids];
      const beforeData = {
        ...alpha.observation.parsed.data,
        domains: [...alpha.observation.parsed.data.domains],
      };

      const result = projectCatalogGet(catalog, ids);

      expect(ids).toEqual(beforeIds);
      expect(alpha.observation.parsed.data).toEqual(beforeData);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const item = result.results[0];
      if (!item?.found || item.conflict) return;
      expect(item.document).toEqual(beforeData);
      expect(item.document).not.toBe(alpha.observation.parsed.data);
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
                id: `document-${index + 1}`,
                name: '같은 이름',
                domains: ['도메인'],
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
          source: 'id: target\nname: Target\n',
          data: { id: 'target', name: 'Target', domains: ['도메인'] },
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
      fieldPath: ['id'],
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
          source: 'name: Broken\n',
          data: {
            ...(id === undefined ? {} : { id }),
            name: 'Broken',
            domains: ['도메인'],
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
          document: { name: 'Broken', definition: '본문' },
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
