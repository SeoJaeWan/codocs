/* eslint-disable codocs/korean-jsdoc -- Vitest의 인라인 콜백은 선언 함수가 아니다. */
import { describe, expect, it } from 'vitest';
import {
  catalogConfirmations,
  catalogFailureKinds,
  scanStatuses,
  type Catalog,
  type CatalogDocument,
} from '../catalog/index.js';
import {
  diagnosticSeverities,
  schemaDiagnosticCodes,
} from '../diagnostics/index.js';
import {
  matchCode,
  matcherComparisonKinds,
  matcherEvidenceKinds,
} from './index.js';

const documentBase = {
  domains: ['test'],
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
const parsedBase = {
  success: true as const,
  fields: [],
  strings: [],
  diagnostics: [],
};
const catalogBase: Catalog = {
  status: scanStatuses.complete,
  failures: [],
  documents: new Map(),
  idPaths: new Map(),
  namePaths: new Map(),
  domainNamePaths: new Map(),
};
const returnZone = {
  ...documentBase,
  path: 'return-zone.yaml',
  id: 'return-zone',
  name: 'return-zone',
  observation: {
    path: 'return-zone.yaml',
    parsed: {
      ...parsedBase,
      source:
        '{"id": "return-zone", "name": "return-zone", "domains": ["test"], "definition": "설명"}',
      data: {
        id: 'return-zone',
        name: 'return-zone',
        domains: ['test'],
        definition: '설명',
      },
    },
  },
} satisfies CatalogDocument;
const zone = {
  ...documentBase,
  path: 'zone.yaml',
  id: 'zone',
  name: 'zone',
  observation: {
    path: 'zone.yaml',
    parsed: {
      ...parsedBase,
      source:
        '{"id": "zone", "name": "zone", "domains": ["test"], "definition": "설명"}',
      data: { id: 'zone', name: 'zone', domains: ['test'], definition: '설명' },
    },
  },
} satisfies CatalogDocument;

describe('matchCode: 코드와 문서 ID 매칭', () => {
  describe('현재 ID·이전 ID로 문서 후보 조회', () => {
    it('코드가 현재 ID와 일치하면 문서와 일치 근거를 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([[zone.path, zone]]),
        },
        code: 'zone',
      };
      const result = matchCode(request);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        id: zone.id,
        path: zone.path,
        name: zone.name,
        domains: zone.domains,
      });
      expect(result.candidates[0]?.evidence).toEqual([
        {
          kind: matcherEvidenceKinds.current,
          comparison: matcherComparisonKinds.exact,
          token: request.code,
          sourceId: zone.id,
          range: { start: 0, end: 4 },
          consecutiveTokens: 1,
        },
      ]);
    });
    it('코드가 이전 ID와 일치하면 현재 문서와 이전 ID 메시지를 반환한다', () => {
      const document = {
        ...documentBase,
        path: 'current-zone.yaml',
        id: 'current-zone',
        name: 'current-zone',
        observation: {
          path: 'current-zone.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "current-zone", "name": "current-zone", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "legacy-zone", "message": "새 ID를 사용하세요"}]}',
            data: {
              id: 'current-zone',
              name: 'current-zone',
              domains: ['test'],
              definition: '설명',
              deprecatedAliases: [
                { id: 'legacy-zone', message: '새 ID를 사용하세요' },
              ],
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [document.path, document],
          ]),
        },
        code: 'legacyZone',
      };
      const result = matchCode(request);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.id).toBe(document.id);
      expect(result.candidates[0]?.evidence).toEqual([
        expect.objectContaining({
          kind: matcherEvidenceKinds.previous,
          sourceId: document.observation.parsed.data.deprecatedAliases[0]?.id,
          message:
            document.observation.parsed.data.deprecatedAliases[0]?.message,
        }),
      ]);
    });
    it('일치하는 ID가 없으면 빈 후보 목록을 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([[zone.path, zone]]),
        },
        code: 'unknown',
      };
      const result = matchCode(request);
      expect(result.candidates).toEqual([]);
    });
    it('코드가 문서 이름에만 일치하면 후보를 반환하지 않는다', () => {
      const document = {
        ...documentBase,
        path: 'unrelated-id.yaml',
        id: 'unrelated-id',
        name: 'zone',
        observation: {
          path: 'unrelated-id.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "unrelated-id", "name": "zone", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'unrelated-id',
              name: 'zone',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [document.path, document],
          ]),
        },
        code: document.name,
      };
      const result = matchCode(request);
      expect(result.candidates).toEqual([]);
    });
    it('복합 ID의 일부 토큰만 일치하면 후보를 반환하지 않는다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [returnZone.path, returnZone],
          ]),
        },
        code: 'return',
      };
      const result = matchCode(request);
      expect(result.candidates).toEqual([]);
    });
    it('마지막 토큰이 복수형으로 일치하면 단수화 일치 근거를 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [returnZone.path, returnZone],
          ]),
        },
        code: 'returnZones',
      };
      const result = matchCode(request);
      expect(result.candidates[0]?.id).toBe(returnZone.id);
      expect(result.candidates[0]?.evidence[0]?.comparison).toBe(
        matcherComparisonKinds.singular,
      );
    });
  });
  describe('식별자 표기별 연속 토큰과 UTF-16 위치', () => {
    it('camelCase 코드 앞에 이모지가 있으면 일치 부분의 UTF-16 범위를 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [returnZone.path, returnZone],
          ]),
        },
        code: '😀selectedReturnZones',
      };
      const result = matchCode(request);
      // 😀는 UTF-16 두 칸이며 selected는 여덟 칸이다. 끝 위치는 포함하지 않는다.
      expect(result.candidates[0]?.evidence).toEqual([
        expect.objectContaining({
          token: 'ReturnZones',
          range: { start: 10, end: 21 },
          consecutiveTokens: 2,
        }),
      ]);
    });
    it('약어 뒤에 일반 단어가 이어지면 두 토큰으로 매칭한다', () => {
      const document = {
        ...documentBase,
        path: 'http-server.yaml',
        id: 'http-server',
        name: 'http-server',
        observation: {
          path: 'http-server.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "http-server", "name": "http-server", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'http-server',
              name: 'http-server',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [document.path, document],
          ]),
        },
        code: 'HTTPServer',
      };
      const result = matchCode(request);
      expect(result.candidates[0]?.id).toBe(document.id);
      expect(result.candidates[0]?.evidence[0]).toMatchObject({
        token: request.code,
        consecutiveTokens: 2,
      });
    });
    it('영문과 숫자가 붙어 있으면 경계를 나누어 매칭한다', () => {
      const document = {
        ...documentBase,
        path: 'zone-2-count.yaml',
        id: 'zone-2-count',
        name: 'zone-2-count',
        observation: {
          path: 'zone-2-count.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "zone-2-count", "name": "zone-2-count", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'zone-2-count',
              name: 'zone-2-count',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [document.path, document],
          ]),
        },
        code: 'zone2Count',
      };
      const result = matchCode(request);
      expect(result.candidates[0]?.id).toBe(document.id);
      expect(result.candidates[0]?.evidence[0]).toMatchObject({
        token: request.code,
        consecutiveTokens: 3,
      });
    });
    it.each([
      { condition: '밑줄', code: 'return_zone' },
      { condition: '하이픈', code: 'return-zone' },
    ])(
      '$condition로 연결한 코드를 조회하면 연속된 두 토큰으로 매칭한다',
      ({ code }) => {
        const request = {
          catalog: {
            ...catalogBase,
            documents: new Map<string, CatalogDocument>([
              [returnZone.path, returnZone],
            ]),
          },
          code,
        };
        const result = matchCode(request);
        expect(result.candidates[0]?.id).toBe(returnZone.id);
        expect(result.candidates[0]?.evidence[0]).toMatchObject({
          token: request.code,
          consecutiveTokens: 2,
        });
      },
    );
    it.each([
      { condition: '공백', code: 'return zone' },
      { condition: '개행', code: 'return\nZone' },
      { condition: '한글', code: 'return한글Zone' },
      { condition: '마침표', code: 'return.zone' },
    ])(
      '$condition가 토큰 사이에 있으면 복합 ID를 제외하고 각 단어의 후보를 반환한다',
      ({ code }) => {
        const returnOnly = {
          ...documentBase,
          path: 'return.yaml',
          id: 'return',
          name: 'return',
          observation: {
            path: 'return.yaml',
            parsed: {
              ...parsedBase,
              source:
                '{"id": "return", "name": "return", "domains": ["test"], "definition": "설명"}',
              data: {
                id: 'return',
                name: 'return',
                domains: ['test'],
                definition: '설명',
              },
            },
          },
        } satisfies CatalogDocument;
        const request = {
          catalog: {
            ...catalogBase,
            documents: new Map<string, CatalogDocument>([
              [returnZone.path, returnZone],
              [returnOnly.path, returnOnly],
              [zone.path, zone],
            ]),
          },
          code,
        };
        const result = matchCode(request);
        expect(result.candidates.map((candidate) => candidate.id)).toEqual([
          returnOnly.id,
          zone.id,
        ]);
      },
    );
  });
  describe('현재·이전 ID와 일치 길이에 따른 후보 우선순위', () => {
    it('현재 ID 후보가 여러 개면 연속 토큰 수가 많은 문서를 먼저 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [zone.path, zone],
            [returnZone.path, returnZone],
          ]),
        },
        code: 'returnZone',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        returnZone.id,
        zone.id,
      ]);
      expect(
        result.candidates.map((candidate) => candidate.evidence[0]?.kind),
      ).toEqual([matcherEvidenceKinds.current, matcherEvidenceKinds.current]);
    });
    it('짧은 현재 ID와 긴 이전 ID가 일치하면 현재 ID 문서를 먼저 반환한다', () => {
      const previous = {
        ...documentBase,
        path: 'legacy-holder.yaml',
        id: 'legacy-holder',
        name: 'legacy-holder',
        observation: {
          path: 'legacy-holder.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "legacy-holder", "name": "legacy-holder", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "return-zone"}]}',
            data: {
              id: 'legacy-holder',
              name: 'legacy-holder',
              domains: ['test'],
              definition: '설명',
              deprecatedAliases: [{ id: 'return-zone' }],
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [previous.path, previous],
            [zone.path, zone],
          ]),
        },
        code: 'returnZone',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        zone.id,
        previous.id,
      ]);
      expect(
        result.candidates.map((candidate) => candidate.evidence[0]?.kind),
      ).toEqual([matcherEvidenceKinds.current, matcherEvidenceKinds.previous]);
    });
    it('이전 ID 후보가 여러 개면 연속 토큰 수가 많은 문서를 먼저 반환한다', () => {
      const short = {
        ...documentBase,
        path: 'short-holder.yaml',
        id: 'short-holder',
        name: 'short-holder',
        observation: {
          path: 'short-holder.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "short-holder", "name": "short-holder", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "zone"}]}',
            data: {
              id: 'short-holder',
              name: 'short-holder',
              domains: ['test'],
              definition: '설명',
              deprecatedAliases: [{ id: 'zone' }],
            },
          },
        },
      } satisfies CatalogDocument;
      const long = {
        ...documentBase,
        path: 'long-holder.yaml',
        id: 'long-holder',
        name: 'long-holder',
        observation: {
          path: 'long-holder.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "long-holder", "name": "long-holder", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "return-zone"}]}',
            data: {
              id: 'long-holder',
              name: 'long-holder',
              domains: ['test'],
              definition: '설명',
              deprecatedAliases: [{ id: 'return-zone' }],
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [short.path, short],
            [long.path, long],
          ]),
        },
        code: 'returnZone',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        long.id,
        short.id,
      ]);
    });
    it('현재 ID의 토큰 수가 같으면 표기 일치를 단수화 일치보다 먼저 반환한다', () => {
      const exact = {
        ...documentBase,
        path: 'return-zones.yaml',
        id: 'return-zones',
        name: 'return-zones',
        observation: {
          path: 'return-zones.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "return-zones", "name": "return-zones", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'return-zones',
              name: 'return-zones',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [returnZone.path, returnZone],
            [exact.path, exact],
          ]),
        },
        code: 'returnZones',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        exact.path,
        returnZone.path,
      ]);
      expect(
        result.candidates.map((candidate) => candidate.evidence[0]?.comparison),
      ).toEqual([
        matcherComparisonKinds.exact,
        matcherComparisonKinds.singular,
      ]);
    });
    it('이전 ID의 토큰 수가 같으면 표기 일치를 단수화 일치보다 먼저 반환한다', () => {
      const singular = {
        ...documentBase,
        path: 'singular-holder.yaml',
        id: 'singular-holder',
        name: 'singular-holder',
        observation: {
          path: 'singular-holder.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "singular-holder", "name": "singular-holder", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "return-zone"}]}',
            data: {
              id: 'singular-holder',
              name: 'singular-holder',
              domains: ['test'],
              definition: '설명',
              deprecatedAliases: [{ id: 'return-zone' }],
            },
          },
        },
      } satisfies CatalogDocument;
      const exact = {
        ...documentBase,
        path: 'exact-holder.yaml',
        id: 'exact-holder',
        name: 'exact-holder',
        observation: {
          path: 'exact-holder.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "exact-holder", "name": "exact-holder", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "return-zones"}]}',
            data: {
              id: 'exact-holder',
              name: 'exact-holder',
              domains: ['test'],
              definition: '설명',
              deprecatedAliases: [{ id: 'return-zones' }],
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [singular.path, singular],
            [exact.path, exact],
          ]),
        },
        code: 'returnZones',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        exact.path,
        singular.path,
      ]);
      expect(
        result.candidates.map((candidate) => candidate.evidence[0]?.comparison),
      ).toEqual([
        matcherComparisonKinds.exact,
        matcherComparisonKinds.singular,
      ]);
    });
    it('ID 종류·토큰 수·비교 방식이 같으면 코드에 나타난 순서로 반환한다', () => {
      const alpha = {
        ...documentBase,
        path: 'alpha-zone.yaml',
        id: 'alpha-zone',
        name: 'alpha-zone',
        observation: {
          path: 'alpha-zone.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "alpha-zone", "name": "alpha-zone", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'alpha-zone',
              name: 'alpha-zone',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const zebra = {
        ...documentBase,
        path: 'zebra-item.yaml',
        id: 'zebra-item',
        name: 'zebra-item',
        observation: {
          path: 'zebra-item.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "zebra-item", "name": "zebra-item", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'zebra-item',
              name: 'zebra-item',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [alpha.path, alpha],
            [zebra.path, zebra],
          ]),
        },
        code: 'zebraItemAlphaZone',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        zebra.id,
        alpha.id,
      ]);
    });
  });
  describe('ID 충돌과 반복 매칭의 후보·근거 보존', () => {
    it.each(['정순', '역순'])(
      '문서를 %s으로 전달해도 같은 이전 ID 후보를 현재 ID 순서로 모두 반환한다',
      (order) => {
        const alpha = {
          ...documentBase,
          path: 'z-path.yaml',
          id: 'alpha-doc',
          name: 'alpha-doc',
          observation: {
            path: 'z-path.yaml',
            parsed: {
              ...parsedBase,
              source:
                '{"id": "alpha-doc", "name": "alpha-doc", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "return-zone"}]}',
              data: {
                id: 'alpha-doc',
                name: 'alpha-doc',
                domains: ['test'],
                definition: '설명',
                deprecatedAliases: [{ id: 'return-zone' }],
              },
            },
          },
        } satisfies CatalogDocument;
        const beta = {
          ...documentBase,
          path: 'a-path.yaml',
          id: 'beta-doc',
          name: 'beta-doc',
          observation: {
            path: 'a-path.yaml',
            parsed: {
              ...parsedBase,
              source:
                '{"id": "beta-doc", "name": "beta-doc", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "return-zone"}]}',
              data: {
                id: 'beta-doc',
                name: 'beta-doc',
                domains: ['test'],
                definition: '설명',
                deprecatedAliases: [{ id: 'return-zone' }],
              },
            },
          },
        } satisfies CatalogDocument;
        const documents =
          order === '정순'
            ? new Map([
                [alpha.path, alpha],
                [beta.path, beta],
              ])
            : new Map([
                [beta.path, beta],
                [alpha.path, alpha],
              ]);
        const request = {
          catalog: { ...catalogBase, documents },
          code: 'returnZone',
        };
        const result = matchCode(request);
        expect(result.candidates.map((candidate) => candidate.id)).toEqual([
          alpha.id,
          beta.id,
        ]);
      },
    );
    it('현재 ID가 중복되면 모든 문서를 경로순으로 반환한다', () => {
      const second = {
        ...documentBase,
        path: 'b.yaml',
        id: 'return-zone',
        name: 'return-zone',
        observation: {
          path: 'b.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "return-zone", "name": "return-zone", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'return-zone',
              name: 'return-zone',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const first = {
        ...documentBase,
        path: 'a.yaml',
        id: 'return-zone',
        name: 'return-zone',
        observation: {
          path: 'a.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "return-zone", "name": "return-zone", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'return-zone',
              name: 'return-zone',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [second.path, second],
            [first.path, first],
          ]),
        },
        code: 'returnZone',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        first.path,
        second.path,
      ]);
    });
    it('같은 범위가 현재·이전 ID에 모두 일치하면 한 문서에 두 근거를 보존한다', () => {
      const document = {
        ...documentBase,
        path: 'return-zone.yaml',
        id: 'return-zone',
        name: 'return-zone',
        observation: {
          path: 'return-zone.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "return-zone", "name": "return-zone", "domains": ["test"], "definition": "설명", "deprecatedAliases": [{"id": "return-zone", "message": "이전 ID"}]}',
            data: {
              id: 'return-zone',
              name: 'return-zone',
              domains: ['test'],
              definition: '설명',
              deprecatedAliases: [{ id: 'return-zone', message: '이전 ID' }],
            },
          },
        },
      } satisfies CatalogDocument;
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [document.path, document],
          ]),
        },
        code: 'returnZone',
      };
      const result = matchCode(request);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.evidence.map((item) => item.kind)).toEqual([
        matcherEvidenceKinds.current,
        matcherEvidenceKinds.previous,
      ]);
    });
    it('같은 ID가 코드에서 반복되면 각 일치 범위를 원문 순서로 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([[zone.path, zone]]),
        },
        code: 'zoneToZone',
      };
      const result = matchCode(request);
      // zone은 [0, 4), To 다음의 Zone은 [6, 10)에 있다.
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.evidence.map((item) => item.range)).toEqual([
        { start: 0, end: 4 },
        { start: 6, end: 10 },
      ]);
    });
  });
  describe('문서 오류와 불완전한 탐색 결과 전달', () => {
    it('ID 이외의 필드에 오류가 있으면 일치 후보와 문서 오류를 함께 반환한다', () => {
      const validDocument = {
        ...documentBase,
        path: 'bad.yaml',
        id: 'bad',
        name: 'bad',
        observation: {
          path: 'bad.yaml',
          parsed: {
            ...parsedBase,
            source:
              '{"id": "bad", "name": "bad", "domains": ["test"], "definition": "설명"}',
            data: {
              id: 'bad',
              name: 'bad',
              domains: ['test'],
              definition: '설명',
            },
          },
        },
      } satisfies CatalogDocument;
      const error = {
        code: schemaDiagnosticCodes.invalidFieldType,
        severity: diagnosticSeverities.error,
        message: '문자열이어야 합니다.',
        path: validDocument.path,
        fieldPath: ['definition'],
      };
      const document = {
        ...validDocument,
        observation: {
          ...validDocument.observation,
          parsed: {
            ...validDocument.observation.parsed,
            source: 'id: bad\nname: bad\ndomains: [test]\ndefinition: 42\n',
            data: { ...validDocument.observation.parsed.data, definition: 42 },
          },
        },
        documentDiagnostics: [error],
        diagnostics: [error],
      };
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([
            [document.path, document],
            [zone.path, zone],
          ]),
        },
        code: 'bad zone',
      };
      const result = matchCode(request);
      expect(result.partial).toBe(false);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        document.id,
        zone.id,
      ]);
      expect(result.candidates[0]?.errors).toEqual([error]);
      expect(result.diagnostics).toEqual([error]);
    });
    it('부분 탐색에서 확인한 ID를 조회하면 후보와 부분 탐색 상태를 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([[zone.path, zone]]),
          status: scanStatuses.partial,
        },
        code: 'zone',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        zone.id,
      ]);
      expect(result.partial).toBe(true);
      expect(result.status).toBe(request.catalog.status);
    });
    it('파일 읽기 실패가 있으면 일치 후보와 실패 경로를 함께 반환한다', () => {
      const request = {
        catalog: {
          ...catalogBase,
          documents: new Map<string, CatalogDocument>([[zone.path, zone]]),
          failures: [{ kind: catalogFailureKinds.file, path: 'missing.yaml' }],
        },
        code: 'zone',
      };
      const result = matchCode(request);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        zone.id,
      ]);
      expect(result.failures).toEqual(request.catalog.failures);
      expect(result.partial).toBe(true);
    });
  });
});
