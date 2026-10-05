import { describe, expect, it } from 'vitest';
import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  yamlDiagnosticCodes,
} from '../diagnostics/index.js';
import { parseYaml, type YamlParseResult } from '../parser/index.js';
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
    source: '{"_codocs":{"id":"a","name":"주문"},"definition":"설명"}',
    data: { _codocs: { id: 'a', name: '주문' }, definition: '설명' },
    strings: [
      {
        fieldPath: ['_codocs', 'name'],
        value: '주문',
        sourceRanges: Array.from({ length: 2 }, (_, index) => ({
          start: 29 + index,
          end: 30 + index,
        })),
      },
    ],
  },
} satisfies CatalogObservation;

const sourceRefersToOrder = {
  path: 's.yaml',
  parsed: {
    ...parsedBase,
    source: '{"_codocs":{"id":"s","name":"출처"},"definition":"[[주문]]"}',
    data: { _codocs: { id: 's', name: '출처' }, definition: '[[주문]]' },
    strings: [
      {
        fieldPath: ['definition'],
        value: '[[주문]]',
        sourceRanges: Array.from({ length: 6 }, (_, index) => ({
          start: 48 + index,
          end: 49 + index,
        })),
      },
    ],
  },
} satisfies CatalogObservation;

const documentA = {
  path: 'a.yaml',
  parsed: {
    ...parsedBase,
    source: '{"_codocs":{"id":"a","name":"A"},"definition":"설명"}',
    data: { _codocs: { id: 'a', name: 'A' }, definition: '설명' },
  },
} satisfies CatalogObservation;

const purchaseOrder = {
  path: 'b.yaml',
  parsed: {
    ...parsedBase,
    source: '{"_codocs":{"id":"b","name":"주문"},"definition":"설명"}',
    data: { _codocs: { id: 'b', name: '주문' }, definition: '설명' },
  },
} satisfies CatalogObservation;

describe('buildCatalog: 문서 색인', () => {
  describe('문서 경로·이름 색인과 참조 문서 간 연결', () => {
    it('문서 하나를 색인하면 발견 경로와 이름으로 조회할 수 있다', () => {
      const observation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"a","name":"주문"},"definition":"설명"}',
          data: { _codocs: { id: 'a', name: '주문' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [observation],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(catalog.documents.get(observation.path)?.name).toBe(
        observation.parsed.data._codocs.name,
      );
      expect([
        ...(catalog.namePaths.get(observation.parsed.data._codocs.name) ?? []),
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
          source: '{"_codocs":{"id":"a","name":"A"},"definition":"[[B]]"}',
          data: { _codocs: { id: 'a', name: 'A' }, definition: '[[B]]' },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[B]]',
              sourceRanges: Array.from({ length: 5 }, (_, index) => ({
                start: 47 + index,
                end: 48 + index,
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
            '{"_codocs":{"id":"b","name":"B"},"definition":"[[A]] [[C]]"}',
          data: { _codocs: { id: 'b', name: 'B' }, definition: '[[A]] [[C]]' },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]] [[C]]',
              sourceRanges: Array.from({ length: 11 }, (_, index) => ({
                start: 47 + index,
                end: 48 + index,
              })),
            },
          ],
        },
      } satisfies CatalogObservation;
      const observationC = {
        path: 'c.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"c","name":"C"},"definition":"설명"}',
          data: { _codocs: { id: 'c', name: 'C' }, definition: '설명' },
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

  describe('프로젝트 전체 이름 유일성 검사', () => {
    it('서로 다른 파일에 같은 이름을 색인하면 양쪽에 이름 충돌 진단을 추가한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, purchaseOrder],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      expect(
        [...catalog.documents.values()].flatMap((document) =>
          document.diagnostics.map((diagnostic) => diagnostic.code),
        ),
      ).toEqual([
        catalogDiagnosticCodes.duplicateName,
        catalogDiagnosticCodes.duplicateName,
      ]);
    });

    it('ID와 실제 경로가 같아도 발견 경로가 다르면 두 문서를 따로 색인한다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"shared","name":"A"},"definition":"설명"}',
          data: { _codocs: { id: 'shared', name: 'A' }, definition: '설명' },
        },
        realPath: '/same',
      } satisfies CatalogObservation;
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"shared","name":"B"},"definition":"설명"}',
          data: { _codocs: { id: 'shared', name: 'B' }, definition: '설명' },
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

    it('같은 이름의 문서가 둘이면 양쪽 name 필드에 충돌 진단을 추가한다', () => {
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"b","name":"주문"},"definition":"설명"}',
          data: { _codocs: { id: 'b', name: '주문' }, definition: '설명' },
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
          }),
        );
    });

    it('ID가 같은 문서를 둘 색인하면 두 문서에 ID 충돌 진단을 추가한다', () => {
      const observationA = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"shared","name":"A"},"definition":"설명"}',
          data: { _codocs: { id: 'shared', name: 'A' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"shared","name":"B"},"definition":"설명"}',
          data: { _codocs: { id: 'shared', name: 'B' }, definition: '설명' },
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
        _codocs: { id: 's', name: '출처' },
        definition,
      });
      const observationB = {
        path: 'z.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"z","name":"Z"},"definition":"설명"}',
          data: { _codocs: { id: 'z', name: 'Z' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const observationC = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"_codocs":{"id":"s","name":"출처"},"definition":"[[Z]] [[A]] [[Z]]"}',
          data: {
            _codocs: { id: 's', name: '출처' },
            definition: '[[Z]] [[A]] [[Z]]',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[Z]] [[A]] [[Z]]',
              sourceRanges: Array.from({ length: 17 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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
            '{"_codocs":{"id":"s","name":"출처"},"definition":"[[A]] [[A]]"}',
          data: {
            _codocs: { id: 's', name: '출처' },
            definition: '[[A]] [[A]]',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]] [[A]]',
              sourceRanges: Array.from({ length: 11 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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
            '{"_codocs":{"id":"s","name":"출처"},"definition":"[[A]] [[A]]"}',
          data: {
            _codocs: { id: 's', name: '출처' },
            definition: '[[A]] [[A]]',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]] [[A]]',
              sourceRanges: Array.from({ length: 11 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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
          source: '{"_codocs":{"id":"s","name":"출처"},"definition":"[[]]"}',
          data: { _codocs: { id: 's', name: '출처' }, definition: '[[]]' },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[]]',
              sourceRanges: Array.from({ length: 4 }, (_, index) => ({
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
      ).toBe(referenceResolutionStatuses.invalid);
      expect(catalog.documents.get(observation.path)?.references).toEqual([]);
    });

    it('같은 문서를 가리키는 참조를 쓰면 자기 참조로 판정하고 연결하지 않는다', () => {
      const observation = {
        path: 'a.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"a","name":"A"},"definition":"[[A]]"}',
          data: { _codocs: { id: 'a', name: 'A' }, definition: '[[A]]' },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]]',
              sourceRanges: Array.from({ length: 5 }, (_, index) => ({
                start: 47 + index,
                end: 48 + index,
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
            '{"_codocs":{"id":"s","name":"출처"},"definition":"[[없음]] [[없음]]"}',
          data: {
            _codocs: { id: 's', name: '출처' },
            definition: '[[없음]] [[없음]]',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[없음]] [[없음]]',
              sourceRanges: Array.from({ length: 13 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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
          start: { line: 0, character: 48 },
          end: { line: 0, character: 54 },
        },
        {
          start: { line: 0, character: 55 },
          end: { line: 0, character: 61 },
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
      ['ID가 없어도', { _codocs: { name: '주문' }, definition: '설명' }, []],
      [
        '다른 속성에 오류가 있어도',
        { _codocs: { id: 'a', name: '주문' }, definition: 42 },
        [],
      ],
      [
        'ID가 다른 문서와 중복돼도',
        { _codocs: { id: 'shared', name: '주문' }, definition: '설명' },
        [
          {
            path: 'other.yaml',
            parsed: {
              ...parsedBase,
              source:
                '{"_codocs":{"id":"shared","name":"다른 문서"},"definition":"설명"}',
              data: {
                _codocs: { id: 'shared', name: '다른 문서' },
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
          source: '{"_codocs":{"id":"a","name":"주문"},"definition":""}',
          data: { _codocs: { id: 'a', name: '주문' }, definition: '' },
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
          source: '{"_codocs":{"id":"b","name":"A"},"definition":"설명"}',
          data: { _codocs: { id: 'b', name: 'A' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.complete,
        observations: [nextObservation],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.documents.has(documentA.path)).toBe(false);
      expect([
        ...(next.namePaths.get(nextObservation.parsed.data._codocs.name) ?? []),
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
      expect(next.namePaths.has(documentA.parsed.data._codocs.name)).toBe(
        false,
      );
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
          source: '{"_codocs":{"id":"a","name":"새A"},"definition":"설명"}',
          data: { _codocs: { id: 'a', name: '새A' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.complete,
        observations: [nextObservation],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.namePaths.has(documentA.parsed.data._codocs.name)).toBe(
        false,
      );
      expect([
        ...(next.namePaths.get(nextObservation.parsed.data._codocs.name) ?? []),
      ]).toEqual([nextObservation.path]);
    });

    it('완료 스캔에서 참조 본문이 바뀌면 이전 연결을 지우고 새 대상으로 연결한다', () => {
      const previousObservationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"b","name":"B"},"definition":"설명"}',
          data: { _codocs: { id: 'b', name: 'B' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const previousObservationC = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"s","name":"출처"},"definition":"[[A]]"}',
          data: { _codocs: { id: 's', name: '출처' }, definition: '[[A]]' },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[A]]',
              sourceRanges: Array.from({ length: 5 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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
          source: '{"_codocs":{"id":"b","name":"B"},"definition":"설명"}',
          data: { _codocs: { id: 'b', name: 'B' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const nextObservationC = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"s","name":"출처"},"definition":"[[B]]"}',
          data: { _codocs: { id: 's', name: '출처' }, definition: '[[B]]' },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[B]]',
              sourceRanges: Array.from({ length: 5 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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
          source: '{"_codocs":{"id":"a","name":"변경"},"definition":"설명"}',
          data: { _codocs: { id: 'a', name: '변경' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const nextScan = {
        status: scanStatuses.failed,
        observations: [nextObservation],
        failures: [{ kind: catalogFailureKinds.unknown }],
      } satisfies CatalogScan;
      const next = buildCatalog(nextScan, previous);
      expect(next.documents.get(nextObservation.path)?.name).toBe(
        documentA.parsed.data._codocs.name,
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
      expect(next.namePaths.has(documentA.parsed.data._codocs.name)).toBe(
        false,
      );
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

    it('도메인을 적은 참조는 도메인이 없으므로 후보를 찾지 않고 부재로 판정한다', () => {
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const result = resolveReference(catalog, {
        name: '주문',
        domain: '판매',
      });
      expect(result.status).toBe(referenceResolutionStatuses.missing);
      expect(result.candidates).toEqual([]);
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
          source: `{"_codocs":{"id":"a","name":"${name}"},"definition":"설명"}`,
          data: { _codocs: { id: 'a', name: name }, definition: '설명' },
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
          fieldPath: ['_codocs', 'name'],
          oldText: orderDocument.parsed.data._codocs.name,
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
        _codocs: { id: 's', name: '출처' },
        definition,
      });
      const observationB = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"_codocs":{"id":"s","name":"출처"},"definition":"[[주문]] [[주문]]"}',
          data: {
            _codocs: { id: 's', name: '출처' },
            definition: '[[주문]] [[주문]]',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[주문]] [[주문]]',
              sourceRanges: Array.from({ length: 13 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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

    it('도메인을 적은 참조는 대상이 아니므로 이름을 변경해도 수정하지 않는다', () => {
      const observationB = {
        path: 's.yaml',
        parsed: {
          ...parsedBase,
          source:
            '{"_codocs":{"id":"s","name":"출처"},"definition":"[[판매:주문]]"}',
          data: {
            _codocs: { id: 's', name: '출처' },
            definition: '[[판매:주문]]',
          },
          strings: [
            {
              fieldPath: ['definition'],
              value: '[[판매:주문]]',
              sourceRanges: Array.from({ length: 9 }, (_, index) => ({
                start: 48 + index,
                end: 49 + index,
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
        plan.changes.some((change) => change.path === observationB.path),
      ).toBe(false);
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

  describe('복수 후보의 대상 선택에 따른 참조 수정', () => {
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
  });

  describe('이름 변경의 충돌 검사와 참조 선택·표기 오류 처리', () => {
    it('프로젝트의 다른 문서가 새 이름을 쓰면 변경 계획을 차단한다', () => {
      const observationB = {
        path: 'b.yaml',
        parsed: {
          ...parsedBase,
          source: '{"_codocs":{"id":"b","name":"새주문"},"definition":"설명"}',
          data: { _codocs: { id: 'b', name: '새주문' }, definition: '설명' },
        },
      } satisfies CatalogObservation;
      const scan = {
        status: scanStatuses.complete,
        observations: [orderDocument, observationB],
      } satisfies CatalogScan;
      const catalog = buildCatalog(scan);
      const request = {
        targetPath: orderDocument.path,
        newName: observationB.parsed.data._codocs.name,
      } satisfies RenameRequest;
      const plan = planRename(catalog, request);
      expect(plan).toMatchObject({
        status: renamePlanStatuses.blocked,
        blockingReason: renameBlockingReasons.nameConflict,
        changes: [],
      });
      expect(plan.conflicts[0]).toMatchObject({
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
          source: '{"_codocs":{"id":"s","name":"출처"},"definition":"설명"}',
          data: { _codocs: { id: 's', name: '출처' }, definition: '설명' },
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
      '_codocs:\r\n  id: s\r\n  name: S\r\ndefinition: "\\u005B\\u005B없음]] [[없음]]"\r\n';
    const escaped = source.indexOf('\\u005B');
    const plain = source.indexOf('[[없음]]');
    const observation = {
      path: 's.yaml',
      parsed: {
        ...parsedBase,
        source,
        data: {
          _codocs: { id: 's', name: 'S' },
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
    const source = '_codocs:\n  id: a\n  name: "\\uC8FC문"\ndefinition: 설명\n';
    const nameStart = source.indexOf('\\uC8FC');
    const observation = {
      path: 'a.yaml',
      parsed: {
        ...parsedBase,
        source,
        data: { _codocs: { id: 'a', name: '주문' }, definition: '설명' },
        strings: [
          {
            fieldPath: ['_codocs', 'name'],
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
      '_codocs:\n  id: s\n  name: S\ndefinition: >-\n  [[주문]]\n  [[주문]]\n';
    const first = source.indexOf('[[주문]]');
    const second = source.lastIndexOf('[[주문]]');
    const observationB = {
      path: 's.yaml',
      parsed: {
        ...parsedBase,
        source,
        data: {
          _codocs: { id: 's', name: 'S' },
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

/** 원문을 파싱한 관측을 만든다. 위치가 필요한 parent·section 검증에서 실제 YAML 위치를 사용한다. */
function observe(path: string, source: string): CatalogObservation {
  const parsed = parseYaml(source, path);
  return { path, parsed };
}

describe('buildCatalog: parent 관계 검사', () => {
  const root = observe(
    'root.yaml',
    '_codocs:\n  id: root\n  name: 루트\n개요: 설명\n',
  );

  it('존재하는 문서를 parent로 지정하면 오류 없이 색인한다', () => {
    const child = observe(
      'child.yaml',
      '_codocs:\n  id: child\n  name: 하위\n  parent: [루트]\n개요: 설명\n',
    );

    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [root, child],
    });

    expect(catalog.documents.get('child.yaml')?.parent).toEqual(['루트']);
    expect(catalog.documents.get('child.yaml')?.documentDiagnostics).toEqual(
      [],
    );
    expect(catalog.documents.get('root.yaml')?.referencedBy).toEqual([]);
  });

  it('없는 문서를 parent로 지정하면 해당 항목에 parent_not_found를 추가한다', () => {
    const child = observe(
      'child.yaml',
      '_codocs:\n  id: child\n  name: 하위\n  parent:\n    - 루트\n    - 없음\n개요: 설명\n',
    );

    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [root, child],
    });

    expect(catalog.documents.get('child.yaml')?.documentDiagnostics).toEqual([
      expect.objectContaining({
        code: catalogDiagnosticCodes.parentNotFound,
        message: catalogDiagnosticMessages.parentNotFound,
        severity: diagnosticSeverities.error,
        fieldPath: ['_codocs', 'parent', 1],
      }),
    ]);
  });

  it('불완전한 탐색에서는 없는 parent를 오류로 확정하지 않는다', () => {
    const child = observe(
      'child.yaml',
      '_codocs:\n  id: child\n  name: 하위\n  parent: [없음]\n개요: 설명\n',
    );

    const catalog = buildCatalog({
      status: scanStatuses.partial,
      observations: [child],
    });

    expect(catalog.documents.get('child.yaml')?.documentDiagnostics).toEqual(
      [],
    );
  });

  it('두 문서가 서로를 parent로 지정하면 양쪽에 parent_cycle을 추가한다', () => {
    const a = observe(
      'a.yaml',
      '_codocs:\n  id: a\n  name: A\n  parent: [B]\n개요: 설명\n',
    );
    const b = observe(
      'b.yaml',
      '_codocs:\n  id: b\n  name: B\n  parent: [A]\n개요: 설명\n',
    );

    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [a, b, root],
    });

    for (const path of ['a.yaml', 'b.yaml'])
      expect(catalog.documents.get(path)?.documentDiagnostics).toContainEqual(
        expect.objectContaining({
          code: catalogDiagnosticCodes.parentCycle,
          message: catalogDiagnosticMessages.parentCycle,
          relatedPaths: ['a.yaml', 'b.yaml'],
          fieldPath: ['_codocs', 'parent', 0],
        }),
      );
    expect(catalog.documents.get('root.yaml')?.documentDiagnostics).toEqual([]);
  });

  it('자기 자신을 parent로 지정하면 parent_cycle을 추가한다', () => {
    const self = observe(
      'self.yaml',
      '_codocs:\n  id: self\n  name: 나\n  parent: [나]\n개요: 설명\n',
    );

    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [self],
    });

    expect(catalog.documents.get('self.yaml')?.documentDiagnostics).toEqual([
      expect.objectContaining({ code: catalogDiagnosticCodes.parentCycle }),
    ]);
  });
});

describe('buildCatalog: 모든 section의 참조 추출', () => {
  it('개요와 환불정책 section의 참조를 모두 연결하고 역참조에 한 번 반영한다', () => {
    const target = observe(
      'pay.yaml',
      '_codocs:\n  id: pay\n  name: 결제\n개요: 설명\n',
    );
    const source = observe(
      'refund.yaml',
      '_codocs:\n  id: refund\n  name: 환불\n개요: "[[결제]] 개요"\n환불정책: "[[결제]] 정책 [[x:결제]]"\n',
    );

    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [target, source],
    });
    const document = catalog.documents.get('refund.yaml');

    expect(
      document?.occurrences.map((item) => item.occurrence.fieldPath),
    ).toEqual([['개요'], ['환불정책'], ['환불정책']]);
    expect(document?.references.map((item) => item.path)).toEqual(['pay.yaml']);
    expect(
      catalog.documents.get('pay.yaml')?.referencedBy.map((item) => item.path),
    ).toEqual(['refund.yaml']);
    expect(document?.occurrences[2]?.resolution.status).toBe(
      referenceResolutionStatuses.missing,
    );
  });
});

describe('planRename: parent 항목 수정', () => {
  const target = observe(
    'pay.yaml',
    '_codocs:\n  id: pay\n  name: 결제\n개요: 설명\n',
  );

  it('이름을 바꾸면 다른 문서의 parent 항목을 위치 기반 수정안으로 함께 만든다', () => {
    const child = observe(
      'child.yaml',
      "_codocs:\n  id: child\n  name: 하위\n  parent:\n    - '결제'\n    - 다른\n개요: 설명\n",
    );
    const other = observe(
      'other.yaml',
      '_codocs:\n  id: other\n  name: 다른\n개요: 설명\n',
    );
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [target, child, other],
    });

    const plan = planRename(catalog, {
      targetPath: 'pay.yaml',
      newName: '결제 처리',
    });

    expect(plan.status).toBe(renamePlanStatuses.ready);
    const change = plan.changes.find((item) => item.path === 'child.yaml');
    expect(change).toMatchObject({
      fieldPath: ['_codocs', 'parent', 0],
      oldText: '결제',
      newText: '결제 처리',
      targetPath: 'pay.yaml',
    });
    expect(change).not.toHaveProperty('occurrenceIndex');
    const source = child.parsed.success ? child.parsed.source : '';
    expect(
      change && source.slice(change.offsetRange.start, change.offsetRange.end),
    ).toBe('결제');
  });

  it('새 이름을 이미 쓰는 문서가 있으면 이름 충돌로 차단한다', () => {
    const other = observe(
      'other.yaml',
      '_codocs:\n  id: other\n  name: 결제 처리\n개요: 설명\n',
    );
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [target, other],
    });

    const plan = planRename(catalog, {
      targetPath: 'pay.yaml',
      newName: '결제 처리',
    });

    expect(plan).toMatchObject({
      status: renamePlanStatuses.blocked,
      blockingReason: renameBlockingReasons.nameConflict,
    });
  });

  it('이름 변경으로 기존의 끊어진 parent가 연결되며 순환이 생기면 차단한다', () => {
    const loop = observe(
      'loop.yaml',
      '_codocs:\n  id: loop\n  name: 순환\n  parent: [결제 처리]\n개요: 설명\n',
    );
    const pay = observe(
      'pay.yaml',
      '_codocs:\n  id: pay\n  name: 결제\n  parent: [순환]\n개요: 설명\n',
    );
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [pay, loop],
    });

    const plan = planRename(catalog, {
      targetPath: 'pay.yaml',
      newName: '결제 처리',
    });

    expect(plan).toMatchObject({
      status: renamePlanStatuses.blocked,
      blockingReason: renameBlockingReasons.nameConflict,
    });
  });
});
