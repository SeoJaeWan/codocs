import { describe, expect, it } from 'vitest';
import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  yamlDiagnosticCodes,
} from '../diagnostics/index.js';
import type { YamlParseResult } from '../parser/index.js';
import type {
  CatalogObservation,
  CatalogScan,
  RenameRequest,
} from './index.js';
import { buildCatalog, planRename, resolveReference } from './index.js';
import {
  catalogConfirmations,
  catalogFailureKinds,
  referenceResolutionStatuses,
  renameBlockingReasons,
  renameImpactReasons,
  renamePlanStatuses,
  scanStatuses,
} from './domain-values.js';

/** 모든 성공 파싱 결과에 공통인 빈 속성이다. 각 테스트는 source·data·strings를 직접 지정한다. */
const parsedBase = {
  success: true,
  fields: [],
  strings: [],
  diagnostics: [],
} satisfies Pick<
  Extract<YamlParseResult, { success: true }>,
  'success' | 'fields' | 'strings' | 'diagnostics'
>;

const orderDocument = {
  path: 'a.yaml',
  parsed: {
    ...parsedBase,
    source: '{"name":"주문","domains":["판매"],"definition":"설명","id":"a"}',
    data: {
      name: '주문',
      domains: ['판매'],
      definition: '설명',
      id: 'a',
    },
    strings: [
      {
        fieldPath: ['name'],
        value: '주문',
        sourceRanges: Array.from({ length: 2 }, (_, index) => ({
          start: 9 + index,
          end: 10 + index,
        })),
      },
    ],
  },
} satisfies CatalogObservation;

const sourceRefersToOrder = {
  path: 's.yaml',
  parsed: {
    ...parsedBase,
    source:
      '{"name":"출처","domains":["판매"],"definition":"[[주문]]","id":"s"}',
    data: {
      name: '출처',
      domains: ['판매'],
      definition: '[[주문]]',
      id: 's',
    },
    strings: [
      {
        fieldPath: ['definition'],
        value: '[[주문]]',
        sourceRanges: Array.from({ length: 6 }, (_, index) => ({
          start: 44 + index,
          end: 45 + index,
        })),
      },
    ],
  },
} satisfies CatalogObservation;

const documentA = {
  path: 'a.yaml',
  parsed: {
    ...parsedBase,
    source: '{"name":"A","domains":["판매"],"definition":"설명","id":"a"}',
    data: {
      name: 'A',
      domains: ['판매'],
      definition: '설명',
      id: 'a',
    },
  },
} satisfies CatalogObservation;

const purchaseOrder = {
  path: 'b.yaml',
  parsed: {
    ...parsedBase,
    source: '{"name":"주문","domains":["구매"],"definition":"설명","id":"b"}',
    data: {
      name: '주문',
      domains: ['구매'],
      definition: '설명',
      id: 'b',
    },
  },
} satisfies CatalogObservation;

describe('buildCatalog: 문서 색인', () => {
  describe('문서 경로·이름 색인과 참조 문서 간 연결', () => {
    it('문서 하나를 색인하면 발견 경로와 이름으로 조회할 수 있다', () => {
      const observation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"주문","domains":["판매"],"definition":"설명","id":"a"}',
          data: {
            name: '주문',
            domains: ['판매'],
            definition: '설명',
            id: 'a',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observation],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(catalog.documents.get(observation.path)?.name).toBe(
        observation.parsed.data.name,
      );
      expect([
        ...(catalog.namePaths.get(observation.parsed.data.name) ?? []),
      ]).toEqual([observation.path]);
    });

    it('다른 문서를 한 번 참조하면 대상과 출처를 서로 연결한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents
          .get(sourceRefersToOrder.path)
          ?.references.map((reference) => reference.path),
      ).toEqual([orderDocument.path]);
      expect(
        catalog.documents
          .get(orderDocument.path)
          ?.referencedBy.map((reference) => reference.path),
      ).toEqual([sourceRefersToOrder.path]);
    });

    it('서로 참조하는 두 문서를 색인하면 직접 연결만 반환한다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"A","domains":["판매"],"definition":"[[B]]","id":"a"}',
          data: {
            name: 'A',
            domains: ['판매'],
            definition: '[[B]]',
            id: 'a',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[B]]',
              sourceRanges: Array.from({ length: 5 }, (_, index) => ({
                start: 43 + index,
                end: 44 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"B","domains":["판매"],"definition":"[[A]] [[C]]","id":"b"}',
          data: {
            name: 'B',
            domains: ['판매'],
            definition: '[[A]] [[C]]',
            id: 'b',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]] [[C]]',
              sourceRanges: Array.from({ length: 11 }, (_, index) => ({
                start: 43 + index,
                end: 44 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const observationC = {
        path: 'c.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"C","domains":["판매"],"definition":"설명","id":"c"}',
          data: {
            name: 'C',
            domains: ['판매'],
            definition: '설명',
            id: 'c',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observationA, observationB, observationC],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents
          .get(observationA.path)
          ?.references.map((reference) => reference.path),
      ).toEqual([observationB.path]);
      expect(
        catalog.documents
          .get(observationB.path)
          ?.references.map((reference) => reference.path),
      ).toEqual([observationA.path, observationC.path]);
    });
  });

  describe('이름·도메인별 문서 구분과 중복 이름 검사', () => {
    it('서로 다른 도메인에 같은 이름을 색인하면 이름 충돌 진단을 추가하지 않는다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        [...catalog.documents.values()].flatMap(
          (document) => document.diagnostics,
        ),
      ).toEqual([]);
    });

    it('여러 도메인에 속한 문서는 후보로 한 번만 센다', () => {
      const observation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"주문","domains":["판매","구매","판매"],"definition":"설명","id":"a"}',
          data: {
            name: '주문',
            domains: ['판매', '구매', '판매'],
            definition: '설명',
            id: 'a',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observation],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const reference = { name: observation.parsed.data.name };
      expect(
        resolveReference(catalog, reference).candidates.map(
          (candidate) => candidate.path,
        ),
      ).toEqual([observation.path]);
      const domainReference = {
        name: observation.parsed.data.name,
        domain: '판매',
      };
      expect(
        resolveReference(catalog, domainReference).candidates.map(
          (candidate) => candidate.path,
        ),
      ).toEqual([observation.path]);
    });

    it('ID와 실제 경로가 같아도 발견 경로가 다르면 두 문서를 따로 색인한다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"A","domains":["판매"],"definition":"설명","id":"shared"}',
          data: {
            name: 'A',
            domains: ['판매'],
            definition: '설명',
            id: 'shared',
          },
        },
        realPath: '/same',
      } satisfies CatalogObservation;
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"B","domains":["판매"],"definition":"설명","id":"shared"}',
          data: {
            name: 'B',
            domains: ['판매'],
            definition: '설명',
            id: 'shared',
          },
        },
        realPath: '/same',
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observationA, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect([...catalog.documents.keys()]).toEqual([
        observationA.path,
        observationB.path,
      ]);
      expect([...(catalog.idPaths.get('shared') ?? [])]).toEqual([
        observationA.path,
        observationB.path,
      ]);
    });

    it('같은 도메인에 같은 이름의 문서가 둘이면 양쪽에 충돌 진단을 추가한다', () => {
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"주문","domains":["판매"],"definition":"설명","id":"b"}',
          data: {
            name: '주문',
            domains: ['판매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      for (const path of [orderDocument.path, observationB.path])
        expect(catalog.documents.get(path)?.diagnostics).toContainEqual(
          expect.objectContaining({
            code: catalogDiagnosticCodes.duplicateName,
            message: catalogDiagnosticMessages.duplicateName,
            severity: diagnosticSeverities.error,
            path,
            relatedPaths: [orderDocument.path, observationB.path],
            domain: '판매',
          }),
        );
    });

    it('ID가 같은 문서를 둘 색인하면 두 문서에 ID 충돌 진단을 추가한다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"A","domains":["판매"],"definition":"설명","id":"shared"}',
          data: {
            name: 'A',
            domains: ['판매'],
            definition: '설명',
            id: 'shared',
          },
        },
      } satisfies CatalogObservation;
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"B","domains":["판매"],"definition":"설명","id":"shared"}',
          data: {
            name: 'B',
            domains: ['판매'],
            definition: '설명',
            id: 'shared',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observationA, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      for (const path of [observationA.path, observationB.path])
        expect(catalog.documents.get(path)?.documentDiagnostics).toContainEqual(
          expect.objectContaining({
            code: catalogDiagnosticCodes.duplicateId,
            relatedPaths: [observationA.path, observationB.path],
          }),
        );
    });
  });

  describe('반복 참조의 원문 순서 보존과 문서 연결 중복 제거', () => {
    it('참조가 여러 번 나오면 추출기가 제공한 순서와 위치를 그대로 보존한다', () => {
      const definition = '[[Z]] [[A]] [[Z]]';
      const source = JSON.stringify({
        name: '출처',
        domains: ['판매'],
        definition,
        id: 's',
      });
      const observationB = {
        path: 'z.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"Z","domains":["판매"],"definition":"설명","id":"z"}',
          data: {
            name: 'Z',
            domains: ['판매'],
            definition: '설명',
            id: 'z',
          },
        },
      } satisfies CatalogObservation;
      const observationC = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[Z]] [[A]] [[Z]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[Z]] [[A]] [[Z]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[Z]] [[A]] [[Z]]',
              sourceRanges: Array.from({ length: 17 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [documentA, observationB, observationC],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents
          .get(observationC.path)
          ?.occurrences.map(({ occurrence }) => [
            occurrence.text,
            occurrence.offsetRange.start,
          ]),
      ).toEqual([
        ['[[Z]]', source.indexOf('[[Z]]')],
        ['[[A]]', source.indexOf('[[A]]')],
        ['[[Z]]', source.lastIndexOf('[[Z]]')],
      ]);
    });

    it('같은 대상을 반복해 참조하면 직접 연결을 경로별로 한 번 반환한다', () => {
      const observationB = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[A]] [[A]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[A]] [[A]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]] [[A]]',
              sourceRanges: Array.from({ length: 11 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [documentA, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents
          .get(observationB.path)
          ?.references.map((reference) => reference.path),
      ).toEqual([documentA.path]);
    });

    it('한 문서가 같은 대상을 반복해 참조하면 역참조에는 출처를 한 번 반환한다', () => {
      const observationB = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[A]] [[A]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[A]] [[A]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]] [[A]]',
              sourceRanges: Array.from({ length: 11 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [documentA, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents
          .get(documentA.path)
          ?.referencedBy.map((reference) => reference.path),
      ).toEqual([observationB.path]);
    });
  });

  describe('연결할 수 없는 참조의 후보와 진단 반환', () => {
    it('같은 이름의 후보가 여러 도메인에 있으면 모든 후보를 반환하고 대상을 확정하지 않는다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const source = catalog.documents.get(sourceRefersToOrder.path);
      expect(source?.occurrences[0]?.resolution).toMatchObject({
        status: referenceResolutionStatuses.ambiguous,
        candidates: [
          { path: orderDocument.path },
          { path: purchaseOrder.path },
        ],
      });
      expect(source?.occurrences[0]?.resolution.target).toBeUndefined();
      expect(source?.references).toEqual([]);
    });

    it('유효하지 않은 참조가 전달되면 후보를 조회하지 않고 연결하지 않는다', () => {
      const observation = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[]]',
              sourceRanges: Array.from({ length: 4 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observation],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents.get(observation.path)?.occurrences[0]?.resolution
          .status,
      ).toBe(referenceResolutionStatuses.invalid);
      expect(catalog.documents.get(observation.path)?.references).toEqual([]);
    });

    it('다른 소속 도메인으로 자신을 참조하면 자기 참조로 판정하고 연결하지 않는다', () => {
      const observation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"A","domains":["판매","구매"],"definition":"[[구매:A]]","id":"a"}',
          data: {
            name: 'A',
            domains: ['판매', '구매'],
            definition: '[[구매:A]]',
            id: 'a',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[구매:A]]',
              sourceRanges: Array.from({ length: 8 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observation],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents.get(observation.path)?.occurrences[0]?.resolution
          .status,
      ).toBe(referenceResolutionStatuses.self);
      expect(catalog.documents.get(observation.path)?.references).toEqual([]);
      expect(
        catalog.documents
          .get(observation.path)
          ?.diagnostics.map((diagnostic) => diagnostic.code),
      ).toContain(catalogDiagnosticCodes.selfReference);
    });

    it('같은 참조가 여러 번 나오면 나온 위치마다 따로 진단한다', () => {
      const observation = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[없음]] [[없음]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[없음]] [[없음]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[없음]] [[없음]]',
              sourceRanges: Array.from({ length: 13 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const catalog = buildCatalog({
        status: scanStatuses.complete,
        observations: [observation],
      });
      const missing =
        catalog.documents
          .get(observation.path)
          ?.diagnostics.filter(
            (diagnostic) =>
              diagnostic.code === catalogDiagnosticCodes.missingReference,
          ) ?? [];
      expect(missing.map((diagnostic) => diagnostic.range)).toEqual([
        {
          start: { line: 0, character: 44 },
          end: { line: 0, character: 50 },
        },
        {
          start: { line: 0, character: 51 },
          end: { line: 0, character: 57 },
        },
      ]);
    });

    it.each<[string, CatalogObservation[]]>([
      ['대상이 없는', []],
      ['대상이 모호한', [orderDocument, purchaseOrder]],
    ])('%s 참조는 연결도 역참조도 만들지 않는다', (_case, candidates) => {
      const catalog = buildCatalog({
        status: scanStatuses.complete,
        observations: [...candidates, sourceRefersToOrder],
      });
      expect(
        catalog.documents.get(sourceRefersToOrder.path)?.references,
      ).toEqual([]);
      for (const candidate of candidates)
        expect(catalog.documents.get(candidate.path)?.referencedBy).toEqual([]);
    });
  });

  describe('문서 오류가 있을 때 이름·참조 정보 보존', () => {
    it.each<[string, Record<string, unknown>, CatalogObservation[]]>([
      [
        'ID가 없어도',
        { name: '주문', domains: ['판매'], definition: '설명' },
        [],
      ],
      [
        '다른 속성에 오류가 있어도',
        { id: 'a', name: '주문', domains: ['판매'], definition: 42 },
        [],
      ],
      [
        'ID가 다른 문서와 중복돼도',
        { id: 'shared', name: '주문', domains: ['판매'], definition: '설명' },
        [
          {
            path: 'other.yaml',
            parsed: {
              ...parsedBase,
              source:
                '{"id":"shared","name":"다른 문서","domains":["판매"],"definition":"설명"}',
              data: {
                id: 'shared',
                name: '다른 문서',
                domains: ['판매'],
                definition: '설명',
              },
            },
          },
        ],
      ],
    ])('대상 문서에 %s 이름으로 확정되면 연결한다', (_case, data, others) => {
      const observation = {
        path: 'a.yaml',
        parsed: { ...parsedBase, source: JSON.stringify(data), data },
      } satisfies CatalogObservation;
      const catalog = buildCatalog({
        status: scanStatuses.complete,
        observations: [observation, ...others, sourceRefersToOrder],
      });
      expect(
        catalog.documents
          .get(observation.path)
          ?.documentDiagnostics.some(
            (diagnostic) => diagnostic.severity === diagnosticSeverities.error,
          ),
      ).toBe(true);
      expect(
        catalog.documents
          .get(sourceRefersToOrder.path)
          ?.references.map((reference) => reference.path),
      ).toEqual([observation.path]);
    });

    it('오류가 있는 문서를 참조하면 참조 대상 오류를 경고한다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source: '{"name":"주문","domains":[],"definition":"설명","id":"a"}',
          data: {
            name: '주문',
            domains: [],
            definition: '설명',
            id: 'a',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observationA, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        catalog.documents.get(sourceRefersToOrder.path)?.diagnostics,
      ).toContainEqual(
        expect.objectContaining({
          code: catalogDiagnosticCodes.referenceTargetError,
          severity: 'warning',
        }),
      );
    });

    it('파싱 실패 결과를 색인하면 이름과 참조를 추측하지 않는다', () => {
      const observation = {
        path: 'bad.yaml',
        parsed: {
          success: false,
          source: 'name: "잘림',
          diagnostics: [
            {
              code: yamlDiagnosticCodes.invalidYaml,
              severity: diagnosticSeverities.error,
              message: 'YAML 오류',
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observation],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(catalog.documents.get(observation.path)?.name).toBeUndefined();
      expect(catalog.documents.get(observation.path)?.occurrences).toEqual([]);
      expect(catalog.namePaths.size).toBe(0);
    });
  });
});

describe('buildCatalog: 관측 갱신', () => {
  describe('전체 탐색 완료 시 이동·삭제·변경된 문서의 색인 갱신', () => {
    it('완료 스캔에서 문서를 이동하면 이전 경로를 지우고 새 경로를 색인한다', () => {
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextObservation = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"A","domains":["판매"],"definition":"설명","id":"b"}',
          data: {
            name: 'A',
            domains: ['판매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.complete,
        observations: [nextObservation],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.documents.has(documentA.path)).toBe(false);
      expect([
        ...(next.namePaths.get(nextObservation.parsed.data.name) ?? []),
      ]).toEqual([nextObservation.path]);
    });

    it('완료 스캔에서 문서를 삭제하면 이전 이름 후보에서 제외한다', () => {
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextScan = {
        status: scanStatuses.complete,
        observations: [],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.documents.has(documentA.path)).toBe(false);
      expect(next.namePaths.has(documentA.parsed.data.name)).toBe(false);
    });

    it('완료 스캔에서 문서 이름이 바뀌면 이전 이름을 지우고 새 이름으로 찾는다', () => {
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextObservation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"새A","domains":["판매"],"definition":"설명","id":"a"}',
          data: {
            name: '새A',
            domains: ['판매'],
            definition: '설명',
            id: 'a',
          },
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.complete,
        observations: [nextObservation],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.namePaths.has(documentA.parsed.data.name)).toBe(false);
      expect([
        ...(next.namePaths.get(nextObservation.parsed.data.name) ?? []),
      ]).toEqual([nextObservation.path]);
    });

    it('완료 스캔에서 소속 도메인이 바뀌면 이전 도메인에서는 찾지 않는다', () => {
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextObservation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"A","domains":["구매"],"definition":"설명","id":"a"}',
          data: {
            name: 'A',
            domains: ['구매'],
            definition: '설명',
            id: 'a',
          },
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.complete,
        observations: [nextObservation],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.domainNamePaths.get('판매')).toBeUndefined();
      expect([
        ...(next.domainNamePaths
          .get('구매')
          ?.get(nextObservation.parsed.data.name) ?? []),
      ]).toEqual([nextObservation.path]);
    });

    it('완료 스캔에서 참조 본문이 바뀌면 이전 연결을 지우고 새 대상으로 연결한다', () => {
      const previousObservationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"B","domains":["판매"],"definition":"설명","id":"b"}',
          data: {
            name: 'B',
            domains: ['판매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const previousObservationC = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[A]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[A]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]]',
              sourceRanges: Array.from({ length: 5 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA, previousObservationB, previousObservationC],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextObservationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"B","domains":["판매"],"definition":"설명","id":"b"}',
          data: {
            name: 'B',
            domains: ['판매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const nextObservationC = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[B]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[B]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[B]]',
              sourceRanges: Array.from({ length: 5 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.complete,
        observations: [documentA, nextObservationB, nextObservationC],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(
        next.documents
          .get(nextObservationC.path)
          ?.references.map((reference) => reference.path),
      ).toEqual([nextObservationB.path]);
      expect(next.documents.get(documentA.path)?.referencedBy).toEqual([]);
    });
  });

  describe('탐색·읽기 실패와 회복에 따른 문서 확인 상태 갱신', () => {
    it.each<[string, CatalogScan]>([
      [
        '파일을 읽지 못한 부분 탐색',
        {
          status: scanStatuses.partial,
          observations: [],
          failures: [{ kind: catalogFailureKinds.file, path: 'a.yaml' }],
        },
      ],
      [
        '폴더를 읽지 못한 부분 탐색',
        {
          status: scanStatuses.partial,
          observations: [],
          failures: [{ kind: catalogFailureKinds.folder, path: 'sub' }],
        },
      ],
      [
        '범위를 모르는 부분 탐색',
        {
          status: scanStatuses.partial,
          observations: [],
          failures: [{ kind: catalogFailureKinds.unknown }],
        },
      ],
      [
        '전체 탐색 실패',
        {
          status: scanStatuses.failed,
          observations: [],
          failures: [{ kind: catalogFailureKinds.unknown }],
        },
      ],
    ])(
      '다시 탐색이 %s이면 이전에 확인한 문서를 미확인 후보로 보존한다',
      (_case, scan) => {
        const previous = buildCatalog({
          status: scanStatuses.complete,
          observations: [documentA],
        });
        const next = buildCatalog(scan, previous);
        expect(next.documents.get(documentA.path)?.confirmation).toBe(
          catalogConfirmations.unconfirmed,
        );
        expect(
          resolveReference(next, { name: 'A' }).candidates.map(
            (candidate) => candidate.path,
          ),
        ).toEqual([documentA.path]);
      },
    );
    it('전체 스캔에 실패하면 새 관측을 채택하지 않고 이전 이름을 미확인으로 보존한다', () => {
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextObservation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"변경","domains":["판매"],"definition":"설명","id":"a"}',
          data: {
            name: '변경',
            domains: ['판매'],
            definition: '설명',
            id: 'a',
          },
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.failed,
        observations: [nextObservation],
        failures: [{ kind: catalogFailureKinds.unknown }],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.documents.get(nextObservation.path)?.name).toBe(
        documentA.parsed.data.name,
      );
      expect(next.documents.get(nextObservation.path)?.confirmation).toBe(
        catalogConfirmations.unconfirmed,
      );
    });

    it('미확인 상태에서 완료 스캔으로 회복하면 문서를 다시 확인한다', () => {
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const failedScan = {
        status: scanStatuses.failed,
        observations: [],
      } satisfies CatalogScan;
      const failed = buildCatalog(failedScan, previous);
      const recoveredScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const recovered = buildCatalog(recoveredScan, failed);
      expect(recovered.documents.get(documentA.path)?.confirmation).toBe(
        catalogConfirmations.confirmed,
      );
      expect(recovered.failures).toEqual([]);
    });

    it('같은 경로의 새 파싱이 실패하면 이전 이름을 최신 색인에 남기지 않는다', () => {
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextObservation = {
        path: 'a.yaml',
        parsed: {
          success: false,
          source: 'name: "잘림',
          diagnostics: [
            {
              code: yamlDiagnosticCodes.invalidYaml,
              severity: diagnosticSeverities.error,
              message: 'YAML 오류',
            },
          ],
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.partial,
        observations: [nextObservation],
        failures: [{ kind: catalogFailureKinds.folder, path: 'sub' }],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.documents.get(nextObservation.path)?.name).toBeUndefined();
      expect(next.namePaths.has(documentA.parsed.data.name)).toBe(false);
    });

    it('부분 스캔을 계산하면 이전 입력과 이전 색인을 변경하지 않는다', () => {
      const input = documentA;
      const before = JSON.stringify(input);
      const previousScan = {
        status: scanStatuses.complete,
        observations: [input],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const scan = {
        status: scanStatuses.partial,
        observations: [],
      } satisfies CatalogScan;
      buildCatalog(scan, previous);
      expect(JSON.stringify(input)).toBe(before);
      expect(previous.documents.get('a.yaml')?.confirmation).toBe(
        catalogConfirmations.confirmed,
      );
    });

    it('부분 스캔에 IO 실패 정보가 있으면 문서 진단과 구분해 보존한다', () => {
      const failure = {
        kind: catalogFailureKinds.file,
        path: 'a.yaml',
        diagnostics: [
          {
            code: 'read_failed',
            severity: diagnosticSeverities.error,
            message: '읽기 실패',
          },
        ],
      };
      const previousScan = {
        status: scanStatuses.complete,
        observations: [documentA],
      } satisfies CatalogScan;
      const previous = buildCatalog(previousScan);
      const nextScan = {
        status: scanStatuses.partial,
        observations: [],
        failures: [failure],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.failures[0]?.diagnostics).toEqual(failure.diagnostics);
      expect(next.documents.get(documentA.path)?.documentDiagnostics).toEqual(
        [],
      );
    });
  });
});

describe('resolveReference: 참조 대상 조회', () => {
  describe('이름과 도메인으로 참조 대상 조회', () => {
    it.each<
      [string, CatalogObservation[], string, string[], string | undefined]
    >([
      [
        '하나면 확정한다',
        [orderDocument],
        referenceResolutionStatuses.resolved,
        [orderDocument.path],
        orderDocument.path,
      ],
      [
        '없으면 부재로 안내한다',
        [],
        referenceResolutionStatuses.missing,
        [],
        undefined,
      ],
      [
        '여러 개면 모호함으로 안내하고 대표를 고르지 않는다',
        [purchaseOrder, orderDocument],
        referenceResolutionStatuses.ambiguous,
        [orderDocument.path, purchaseOrder.path],
        undefined,
      ],
    ])('후보가 %s', (_case, observations, status, paths, target) => {
      const catalog = buildCatalog({
        status: scanStatuses.complete,
        observations,
      });
      const result = resolveReference(catalog, { name: '주문' });
      expect(result.status).toBe(status);
      expect(result.candidates.map((candidate) => candidate.path)).toEqual(
        paths,
      );
      expect(result.target?.path).toBe(target);
    });

    it('도메인을 지정하면 같은 이름을 가진 다른 도메인의 문서를 제외한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const reference = {
        name: purchaseOrder.parsed.data.name,
        domain: '구매',
      };
      expect(
        resolveReference(catalog, reference).candidates.map(
          (candidate) => candidate.path,
        ),
      ).toEqual([purchaseOrder.path]);
    });

    it('대괄호 안의 이름과 name이 같은 문서를 후보로 찾는다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        resolveReference(catalog, { name: '주문' }).candidates.map(
          (candidate) => candidate.path,
        ),
      ).toEqual([orderDocument.path]);
    });

    it('도메인을 생략하면 참조한 문서의 도메인과 관계없이 모든 도메인에서 후보를 찾는다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        resolveReference(
          catalog,
          { name: '주문' },
          sourceRefersToOrder.path,
        ).candidates.map((candidate) => candidate.path),
      ).toEqual([orderDocument.path, purchaseOrder.path]);
    });
  });

  describe('공백·대소문자·콜론을 포함한 참조 이름 비교', () => {
    it.each([
      ['앞뒤 공백', ' 주문A! ', '주문A!'],
      ['대소문자', '주문A!', '주문a!'],
    ])('name과 %s만 달라도 후보로 찾지 않는다', (_case, name, reference) => {
      const observation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source: `{"name":"${name}","domains":["판매"],"definition":"설명","id":"a"}`,
          data: { name, domains: ['판매'], definition: '설명', id: 'a' },
        },
      } satisfies CatalogObservation;
      const catalog = buildCatalog({
        status: scanStatuses.complete,
        observations: [observation],
      });
      expect(resolveReference(catalog, { name: reference })).toMatchObject({
        status: referenceResolutionStatuses.missing,
        candidates: [],
      });
    });
  });
});

describe('planRename: 이름 변경 계획', () => {
  describe('문서 이름과 그 문서를 참조하는 표기의 수정안 생성', () => {
    it('참조가 없는 문서의 이름을 변경하면 이름 필드 수정안을 반환한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan.status).toBe(renamePlanStatuses.ready);
      expect(plan.changes).toEqual([
        expect.objectContaining({
          path: orderDocument.path,
          fieldPath: ['name'],
          oldText: orderDocument.parsed.data.name,
          newText: request.newName,
        }),
      ]);
    });

    it('참조된 문서의 이름을 변경하면 출처의 참조 표기도 변경한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan.status).toBe(renamePlanStatuses.ready);
      expect(
        plan.changes.find((change) => change.path === sourceRefersToOrder.path),
      ).toMatchObject({
        oldText: '[[주문]]',
        newText: '[[새주문]]',
        targetPath: orderDocument.path,
      });
    });

    it('반복된 참조의 이름을 변경하면 각 참조 위치에 수정안을 만든다', () => {
      const definition = '[[주문]] [[주문]]';
      const source = JSON.stringify({
        name: '출처',
        domains: ['판매'],
        definition,
        id: 's',
      });
      const observationB = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[주문]] [[주문]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[주문]] [[주문]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[주문]] [[주문]]',
              sourceRanges: Array.from({ length: 13 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(
        plan.changes
          .filter((change) => change.path === observationB.path)
          .map((change) => [change.offsetRange.start, change.newText]),
      ).toEqual([
        [source.indexOf('[[주문]]'), '[[새주문]]'],
        [source.lastIndexOf('[[주문]]'), '[[새주문]]'],
      ]);
    });

    it('도메인을 명시한 참조의 이름을 변경하면 기존 도메인을 유지한다', () => {
      const observationB = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"[[판매:주문]]","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '[[판매:주문]]',
            id: 's',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[판매:주문]]',
              sourceRanges: Array.from({ length: 9 }, (_, index) => ({
                start: 44 + index,
                end: 45 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(
        plan.changes.find((change) => change.path === observationB.path)
          ?.newText,
      ).toBe('[[판매:새주문]]');
    });

    it('새 이름이 다른 도메인의 문서와 같아지면 기존 대상의 도메인을 명시한다', () => {
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"새주문","domains":["구매"],"definition":"설명","id":"b"}',
          data: {
            name: '새주문',
            domains: ['구매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, observationB, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: observationB.parsed.data.name,
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(
        plan.changes.find((change) => change.path === sourceRefersToOrder.path)
          ?.newText,
      ).toBe('[[판매:새주문]]');
    });

    it('참조를 함께 변경하지 않으면 이름 필드만 수정하고 영향을 보고한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
        updateReferences: false,
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan.changes.map((change) => change.path)).toEqual([
        orderDocument.path,
      ]);
      expect(plan.impacts[0]?.reason).toBe(
        renameImpactReasons.referencesDisabled,
      );
    });
  });

  describe('복수 후보의 대상·도메인 선택에 따른 참조 수정', () => {
    it('모호한 참조에서 변경 대상을 선택하면 그 참조의 이름을 변경한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
        selections: [
          {
            sourcePath: sourceRefersToOrder.path,
            occurrenceIndex: 0,
            targetPath: orderDocument.path,
          },
        ],
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(
        plan.changes.find((change) => change.path === sourceRefersToOrder.path)
          ?.newText,
      ).toBe('[[새주문]]');
    });

    it('모호한 참조에서 다른 후보를 선택하면 변경 대상의 참조 수정안을 만들지 않는다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
        selections: [
          {
            sourcePath: sourceRefersToOrder.path,
            occurrenceIndex: 0,
            targetPath: purchaseOrder.path,
          },
        ],
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(
        plan.changes.filter(
          (change) => change.path === sourceRefersToOrder.path,
        ),
      ).toEqual([]);
    });

    it('모호한 참조를 선택하지 않으면 그 참조의 수정안을 만들지 않고 미해결로 보고한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan.status).toBe(renamePlanStatuses.unresolved);
      expect(
        plan.changes.filter(
          (change) => change.path === sourceRefersToOrder.path,
        ),
      ).toEqual([]);
    });

    it('다중 도메인 대상의 새 이름이 모호해지면 선택 전까지 영향을 미해결로 둔다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"주문","domains":["판매","물류"],"definition":"설명","id":"a"}',
          data: {
            name: '주문',
            domains: ['판매', '물류'],
            definition: '설명',
            id: 'a',
          },
          strings: [
            {
              fieldPath: ['name'],
              value: '주문',
              sourceRanges: Array.from({ length: 2 }, (_, index) => ({
                start: 9 + index,
                end: 10 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"새주문","domains":["구매"],"definition":"설명","id":"b"}',
          data: {
            name: '새주문',
            domains: ['구매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observationA, observationB, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: observationA.path,
        newName: observationB.parsed.data.name,
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan.status).toBe(renamePlanStatuses.unresolved);
      expect(plan.impacts[0]?.reason).toBe(renameImpactReasons.domainRequired);
    });

    it('다중 도메인 대상에서 소속 도메인을 선택하면 그 도메인을 참조에 넣는다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"주문","domains":["판매","물류"],"definition":"설명","id":"a"}',
          data: {
            name: '주문',
            domains: ['판매', '물류'],
            definition: '설명',
            id: 'a',
          },
          strings: [
            {
              fieldPath: ['name'],
              value: '주문',
              sourceRanges: Array.from({ length: 2 }, (_, index) => ({
                start: 9 + index,
                end: 10 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"새주문","domains":["구매"],"definition":"설명","id":"b"}',
          data: {
            name: '새주문',
            domains: ['구매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observationA, observationB, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: observationA.path,
        newName: observationB.parsed.data.name,
        selections: [
          {
            sourcePath: sourceRefersToOrder.path,
            occurrenceIndex: 0,
            targetPath: observationA.path,
            domain: '물류',
          },
        ],
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(
        plan.changes.find((change) => change.path === sourceRefersToOrder.path)
          ?.newText,
      ).toBe('[[물류:새주문]]');
    });
  });

  describe('이름 변경의 충돌 검사와 참조 선택·표기 오류 처리', () => {
    it('같은 도메인에 새 이름이 충돌하면 변경 계획을 차단한다', () => {
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"새주문","domains":["판매"],"definition":"설명","id":"b"}',
          data: {
            name: '새주문',
            domains: ['판매'],
            definition: '설명',
            id: 'b',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: observationB.parsed.data.name,
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan).toMatchObject({
        status: renamePlanStatuses.blocked,
        blockingReason: renameBlockingReasons.nameConflict,
        changes: [],
      });
      expect(plan.conflicts[0]).toMatchObject({
        domain: '판매',
        candidates: [{ path: observationB.path }],
      });
    });

    it('부분 색인에서 이름을 변경하면 충돌 부재를 확정할 수 없어 차단한다', () => {
      const scan = {
        status: scanStatuses.partial,
        observations: [orderDocument],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
      } satisfies RenameRequest;
      expect(planRename(catalog, request)).toMatchObject({
        status: renamePlanStatuses.blocked,
        blockingReason: renameBlockingReasons.unconfirmed,
        changes: [],
      });
    });

    it('존재하지 않는 참조 위치를 선택하면 계획을 차단한다', () => {
      const observationB = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"name":"출처","domains":["판매"],"definition":"설명","id":"s"}',
          data: {
            name: '출처',
            domains: ['판매'],
            definition: '설명',
            id: 's',
          },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const selection = {
        sourcePath: observationB.path,
        occurrenceIndex: 0,
        targetPath: orderDocument.path,
      };
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
        selections: [selection],
      } satisfies RenameRequest;
      expect(planRename(catalog, request)).toMatchObject({
        status: renamePlanStatuses.blocked,
        blockingReason: renameBlockingReasons.invalidSelection,
        invalidSelections: [selection],
      });
    });

    it('한 참조 위치에 서로 다른 후보를 중복 선택하면 계획을 차단한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const selections = [
        {
          sourcePath: sourceRefersToOrder.path,
          occurrenceIndex: 0,
          targetPath: orderDocument.path,
        },
        {
          sourcePath: sourceRefersToOrder.path,
          occurrenceIndex: 0,
          targetPath: purchaseOrder.path,
        },
      ];
      const request = {
        targetPath: orderDocument.path,
        newName: '새주문',
        selections,
      } satisfies RenameRequest;
      expect(planRename(catalog, request)).toMatchObject({
        status: renamePlanStatuses.blocked,
        blockingReason: renameBlockingReasons.invalidSelection,
        invalidSelections: selections,
      });
    });

    it('새 이름을 참조로 표현할 수 없으면 참조 변경 영향을 미해결로 남긴다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: '새[주문',
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan.impacts[0]?.reason).toBe(renameImpactReasons.unrepresentable);
    });
  });

  describe('이름 변경 계획 계산 시 기존 관측과 색인 보존', () => {
    it('이름 변경 계획을 계산하면 원래 관측과 색인을 변경하지 않는다', () => {
      const input = orderDocument;
      const source = sourceRefersToOrder;
      const scan = {
        status: scanStatuses.complete,
        observations: [input, source],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const before = JSON.stringify([input, source]);
      const request = {
        targetPath: 'a.yaml',
        newName: '새주문',
      } satisfies RenameRequest;
      planRename(catalog, request);
      expect(JSON.stringify([input, source])).toBe(before);
      expect(catalog.documents.get('a.yaml')?.name).toBe('주문');
    });
  });
});

describe('planRename: 참조 선택과 영향', () => {
  it('명시된 도메인과 다른 도메인을 선택하면 잘못된 선택으로 보고하고 이름 변경을 차단한다', () => {
    const observationA = {
      path: 'a.yaml',
      parsed: {
        ...parsedBase,
        source:
          '{"name":"A","domains":["판매","구매"],"definition":"설명","id":"a"}',
        data: {
          name: 'A',
          domains: ['판매', '구매'],
          definition: '설명',
          id: 'a',
        },
        strings: [
          {
            fieldPath: ['name'],
            value: 'A',
            sourceRanges: Array.from({ length: 1 }, (_, index) => ({
              start: 9 + index,
              end: 10 + index,
            })),
          },
        ],
      },
    } satisfies CatalogObservation;
    const observationB = {
      path: 's.yaml',
      parsed: {
        ...parsedBase,
        source:
          '{"name":"출처","domains":["판매"],"definition":"[[판매:A]]","id":"s"}',
        data: {
          name: '출처',
          domains: ['판매'],
          definition: '[[판매:A]]',
          id: 's',
        },
        strings: [
          {
            fieldPath: ['definition'],
            value: '[[판매:A]]',
            sourceRanges: Array.from({ length: 8 }, (_, index) => ({
              start: 44 + index,
              end: 45 + index,
            })),
          },
        ],
      },
    } satisfies CatalogObservation;
    const scan = {
      status: scanStatuses.complete,
      observations: [observationA, observationB],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    const request = {
      targetPath: observationA.path,
      newName: 'B',
      selections: [
        {
          sourcePath: observationB.path,
          occurrenceIndex: 0,
          targetPath: observationA.path,
          domain: '구매',
        },
      ],
    } satisfies RenameRequest;
    const plan = planRename(catalog, request);
    expect(plan.impacts[0]?.reason).toBe(renameImpactReasons.invalidSelection);
    expect(plan).toMatchObject({
      status: renamePlanStatuses.blocked,
      blockingReason: renameBlockingReasons.invalidSelection,
      changes: [],
      invalidSelections: request.selections,
    });
  });

  it('참조 후보에 없는 경로를 선택하면 잘못된 선택으로 보고하고 이름 변경을 차단한다', () => {
    const scan = {
      status: scanStatuses.complete,
      observations: [orderDocument, sourceRefersToOrder],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    const request = {
      targetPath: orderDocument.path,
      newName: '새주문',
      selections: [
        {
          sourcePath: sourceRefersToOrder.path,
          occurrenceIndex: 0,
          targetPath: 'none',
        },
      ],
    } satisfies RenameRequest;
    const plan = planRename(catalog, request);
    expect(plan.impacts[0]?.reason).toBe(renameImpactReasons.invalidSelection);
    expect(plan).toMatchObject({
      status: renamePlanStatuses.blocked,
      blockingReason: renameBlockingReasons.invalidSelection,
      changes: [],
      invalidSelections: request.selections,
    });
  });

  it('대상에 없는 도메인을 선택하면 잘못된 선택으로 보고하고 이름 변경을 차단한다', () => {
    const scan = {
      status: scanStatuses.complete,
      observations: [orderDocument, sourceRefersToOrder],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    const request = {
      targetPath: orderDocument.path,
      newName: '새주문',
      selections: [
        {
          sourcePath: sourceRefersToOrder.path,
          occurrenceIndex: 0,
          targetPath: orderDocument.path,
          domain: '구매',
        },
      ],
    } satisfies RenameRequest;
    const plan = planRename(catalog, request);
    expect(plan.impacts[0]?.reason).toBe(renameImpactReasons.invalidSelection);
    expect(plan).toMatchObject({
      status: renamePlanStatuses.blocked,
      blockingReason: renameBlockingReasons.invalidSelection,
      changes: [],
      invalidSelections: request.selections,
    });
  });

  it('모호한 참조를 선택하지 않고 후보 구성을 바꾸면 해결 결과 변화를 보고한다', () => {
    const scan = {
      status: scanStatuses.complete,
      observations: [orderDocument, purchaseOrder, sourceRefersToOrder],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    const request = {
      targetPath: orderDocument.path,
      newName: '새주문',
    } satisfies RenameRequest;
    const plan = planRename(catalog, request);
    expect(plan.status).toBe(renamePlanStatuses.unresolved);
    expect(plan.impacts[0]).toMatchObject({
      reason: renameImpactReasons.changedResolution,
      before: { status: referenceResolutionStatuses.ambiguous },
      after: {
        status: referenceResolutionStatuses.resolved,
        target: { path: purchaseOrder.path },
      },
    });
  });
});

describe('buildCatalog: 참조 진단의 원문 위치', () => {
  it('Unicode 이스케이프와 CRLF가 있는 참조를 색인하면 전달된 원문 위치에 진단을 붙인다', () => {
    const source =
      'id: s\r\nname: S\r\ndomains: [판매]\r\ndefinition: "\\u005B\\u005B없음]] [[없음]]"\r\n';
    const escaped = source.indexOf('\\u005B');
    const plain = source.indexOf('[[없음]]');
    const observation = {
      path: 's.yaml',
      parsed: {
        ...parsedBase,
        source,
        data: {
          id: 's',
          name: 'S',
          domains: ['판매'],
          definition: '[[없음]] [[없음]]',
        },
        strings: [
          {
            fieldPath: ['definition'],
            value: '[[없음]] [[없음]]',
            sourceRanges: [
              { start: escaped, end: escaped + 6 },
              { start: escaped + 6, end: escaped + 12 },
              ...Array.from({ length: 5 }, (_, index) => ({
                start: escaped + 12 + index,
                end: escaped + 13 + index,
              })),
              ...Array.from({ length: 6 }, (_, index) => ({
                start: plain + index,
                end: plain + index + 1,
              })),
            ],
          },
        ],
      },
    } satisfies CatalogObservation;
    const scan = {
      status: scanStatuses.complete,
      observations: [observation],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    expect(
      catalog.documents
        .get(observation.path)
        ?.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === catalogDiagnosticCodes.missingReference,
        )
        .map((diagnostic) => diagnostic.range),
    ).toEqual([
      { start: { line: 3, character: 13 }, end: { line: 3, character: 29 } },
      { start: { line: 3, character: 30 }, end: { line: 3, character: 36 } },
    ]);
  });
});

describe('planRename: 원문 위치와 참조 표기', () => {
  it('Unicode 이스케이프로 작성된 이름을 변경하면 이스케이프를 포함한 원문 범위를 수정한다', () => {
    const source =
      'id: a\nname: "\\uC8FC문"\ndomains: [판매]\ndefinition: 설명\n';
    const nameStart = source.indexOf('\\uC8FC');
    const observation = {
      path: 'a.yaml',
      parsed: {
        ...parsedBase,
        source,
        data: {
          id: 'a',
          name: '주문',
          domains: ['판매'],
          definition: '설명',
        },
        strings: [
          {
            fieldPath: ['name'],
            value: '주문',
            sourceRanges: [
              { start: nameStart, end: nameStart + 6 },
              { start: nameStart + 6, end: nameStart + 7 },
            ],
          },
        ],
      },
    } satisfies CatalogObservation;
    const scan = {
      status: scanStatuses.complete,
      observations: [observation],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    const request = {
      targetPath: observation.path,
      newName: '새주문',
    } satisfies RenameRequest;
    const plan = planRename(catalog, request);
    const nameChange = plan.changes.find(
      (change) => change.path === observation.path,
    );
    expect(
      nameChange &&
        source.slice(nameChange.offsetRange.start, nameChange.offsetRange.end),
    ).toBe('\\uC8FC문');
  });

  it('접힌 본문의 참조 이름을 변경하면 각 원문 참조 위치에 수정안을 만든다', () => {
    const source =
      'id: s\nname: S\ndomains: [판매]\ndefinition: >-\n  [[주문]]\n  [[주문]]\n';
    const first = source.indexOf('[[주문]]');
    const second = source.lastIndexOf('[[주문]]');
    const observationB = {
      path: 's.yaml',
      parsed: {
        ...parsedBase,
        source,
        data: {
          id: 's',
          name: 'S',
          domains: ['판매'],
          definition: '[[주문]] [[주문]]',
        },
        strings: [
          {
            fieldPath: ['definition'],
            value: '[[주문]] [[주문]]',
            sourceRanges: [
              ...Array.from({ length: 6 }, (_, index) => ({
                start: first + index,
                end: first + index + 1,
              })),
              { start: first + 6, end: second },
              ...Array.from({ length: 6 }, (_, index) => ({
                start: second + index,
                end: second + index + 1,
              })),
            ],
          },
        ],
      },
    } satisfies CatalogObservation;
    const scan = {
      status: scanStatuses.complete,
      observations: [orderDocument, observationB],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    const request = {
      targetPath: orderDocument.path,
      newName: '새주문',
    } satisfies RenameRequest;
    const plan = planRename(catalog, request);
    expect(
      plan.changes
        .filter((change) => change.path === observationB.path)
        .map((change) => [change.offsetRange.start, change.newText]),
    ).toEqual([
      [first, '[[새주문]]'],
      [second, '[[새주문]]'],
    ]);
  });
});

describe('planRename: 새 이름의 참조 표기', () => {
  it.each([
    { condition: '이름 중간에 백슬래시가 있는', newName: '새\\이름' },
    { condition: '이름 끝에 백슬래시가 있는', newName: '새이름\\' },
  ])(
    '$condition 이름으로 변경하면 백슬래시를 포함한 참조 수정안을 만든다',
    ({ newName }) => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, sourceRefersToOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName,
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan.status).toBe(renamePlanStatuses.ready);
      expect(
        plan.changes.find((change) => change.path === sourceRefersToOrder.path)
          ?.newText,
      ).toBe(`[[${newName}]]`);
    },
  );

  it('새 이름에 콜론이 있으면 참조 수정안에서 콜론을 이스케이프한다', () => {
    const scan = {
      status: scanStatuses.complete,
      observations: [orderDocument, sourceRefersToOrder],
    } satisfies CatalogScan;
    const catalog = buildCatalog(scan);
    const request = {
      targetPath: orderDocument.path,
      newName: '새:주문',
    } satisfies RenameRequest;
    const plan = planRename(catalog, request);
    expect(plan.status).toBe(renamePlanStatuses.ready);
    expect(
      plan.changes.find((change) => change.path === sourceRefersToOrder.path)
        ?.newText,
    ).toBe('[[새\\:주문]]');
  });
});

describe('status 속성의 참조 진단', () => {
  it('status가 deprecated인 문서를 참조해도 폐기 경고 없이 양방향 연결을 유지한다', () => {
    const target = {
      ...orderDocument,
      parsed: {
        ...orderDocument.parsed,
        data: { ...orderDocument.parsed.data, status: 'deprecated' },
      },
    };
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [target, sourceRefersToOrder],
    });
    const source = catalog.documents.get(sourceRefersToOrder.path)!;
    expect(source.diagnostics.map((item) => item.code)).not.toContain(
      'deprecated_reference',
    );
    expect(source.references.map((item) => item.path)).toEqual([target.path]);
    expect(
      catalog.documents.get(target.path)?.referencedBy.map((item) => item.path),
    ).toEqual([source.path]);
  });
});
