import { describe, expect, it } from 'vitest';
import type { OffsetRange } from '../diagnostics/index.js';
import type { YamlParseResult } from '../parser/index.js';
import { parseYaml } from '../parser/index.js';
import {
  createDuplicateComparison,
  detectDuplicates,
  duplicatePreparationKey,
  prepareDuplicateDocument,
  type DuplicateCandidate,
  type DuplicateDocumentInput,
} from './index.js';
import { duplicateDetectionConfig } from './config.js';
import { jaccard, orderedSimilarity } from './similarity.js';
import {
  duplicateComparisonStatuses,
  duplicateMatchKinds,
  duplicateSkipReasons,
} from './domain-values.js';
// 아래 fixture는 COD-30 고정 사례(.github/workplans/evidence/COD-30-duplicate-cases.json)의 원문 YAML이다.
// 각 파일은 `git show <커밋>:<경로>`로 한 번 추출해 커밋했으며, 테스트는 git을 호출하지 않는다.
// 출처 커밋과 경로는 사례마다 아래 fixtureSources 주석에 적었다.
import duplicateIdBeforeASource from './fixtures/duplicate-id-response/before-a.yaml?raw';
import duplicateIdBeforeBSource from './fixtures/duplicate-id-response/before-b.yaml?raw';
import duplicateIdAfterASource from './fixtures/duplicate-id-response/after-a.yaml?raw';
import duplicateIdAfterBSource from './fixtures/duplicate-id-response/after-b.yaml?raw';
import guideScopeBeforeASource from './fixtures/guide-scope/before-a.yaml?raw';
import guideScopeBeforeBSource from './fixtures/guide-scope/before-b.yaml?raw';
import guideScopeAfterASource from './fixtures/guide-scope/after-a.yaml?raw';
import guideScopeAfterBSource from './fixtures/guide-scope/after-b.yaml?raw';
import statusBeforeASource from './fixtures/status-meaning/before-a.yaml?raw';
import statusBeforeBSource from './fixtures/status-meaning/before-b.yaml?raw';
import statusAfterASource from './fixtures/status-meaning/after-a.yaml?raw';
import statusAfterBSource from './fixtures/status-meaning/after-b.yaml?raw';
import redundantReferenceSource from './fixtures/redundant-reference-guidance/before.yaml?raw';
import fieldPathBeforeASource from './fixtures/field-path-definition/before-a.yaml?raw';
import fieldPathBeforeBSource from './fixtures/field-path-definition/before-b.yaml?raw';
import leftoverASource from './fixtures/leftover-after-split/after-a.yaml?raw';
import leftoverBSource from './fixtures/leftover-after-split/after-b.yaml?raw';
import contextualASource from './fixtures/contextual-reference-navigation/snapshot-a.yaml?raw';
import contextualBSource from './fixtures/contextual-reference-navigation/snapshot-b.yaml?raw';

/** fixture 원문의 줄바꿈을 LF로 맞춘다. 사례의 위치는 LF 원문 기준이고 Windows 체크아웃은 CRLF로 바뀔 수 있다. */
function lf(source: string): string {
  return source.replace(/\r\n/gu, '\n');
}

const duplicateIdBeforeA = lf(duplicateIdBeforeASource);
const duplicateIdBeforeB = lf(duplicateIdBeforeBSource);
const duplicateIdAfterA = lf(duplicateIdAfterASource);
const duplicateIdAfterB = lf(duplicateIdAfterBSource);
const guideScopeBeforeA = lf(guideScopeBeforeASource);
const guideScopeBeforeB = lf(guideScopeBeforeBSource);
const guideScopeAfterA = lf(guideScopeAfterASource);
const guideScopeAfterB = lf(guideScopeAfterBSource);
const statusBeforeA = lf(statusBeforeASource);
const statusBeforeB = lf(statusBeforeBSource);
const statusAfterA = lf(statusAfterASource);
const statusAfterB = lf(statusAfterBSource);
const redundantReference = lf(redundantReferenceSource);
const fieldPathBeforeA = lf(fieldPathBeforeASource);
const fieldPathBeforeB = lf(fieldPathBeforeBSource);
const leftoverA = lf(leftoverASource);
const leftoverB = lf(leftoverBSource);
const contextualA = lf(contextualASource);
const contextualB = lf(contextualBSource);

/** 원문 YAML을 문서 입력으로 만든다. 파싱은 호출자 몫이라는 계약대로 테스트가 한 번 파싱해 넘긴다. */
function input(
  path: string,
  source: string,
  extra: { id?: string; revision?: string } = {},
): DuplicateDocumentInput {
  return {
    path,
    revision: extra.revision ?? `${path}-r1`,
    ...(extra.id !== undefined ? { id: extra.id } : {}),
    parsed: parseYaml(source),
  };
}

/** 블록 스칼라 definition과 선택 examples를 가진 YAML 원문을 만든다. */
function yamlOf(
  definition: string,
  examples: readonly string[] = [],
  eol = '\n',
): string {
  const indent = (text: string): string =>
    text
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join(eol);
  const exampleLines = examples.map((example) => `  - '${example}'`);
  return [
    'id: sample',
    "name: '문서'",
    'definition: |',
    indent(definition),
    ...(examples.length ? ['examples:', ...exampleLines] : []),
    '',
  ].join(eol);
}

/** 재귀적으로 동결해 입력 변경 시 예외가 나게 한다. */
function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

/** 성공한 파싱 결과의 원문을 꺼낸다. */
function sourceOf(document: DuplicateDocumentInput): string {
  const parsed: YamlParseResult = document.parsed;
  if (!parsed.success || parsed.source === undefined)
    throw new Error('성공한 파싱 결과가 필요합니다.');
  return parsed.source;
}

/** 후보 한쪽이 지정한 경로의 원문 범위와 겹치는지 확인한다. */
function touches(
  candidate: DuplicateCandidate,
  path: string,
  range: OffsetRange,
): boolean {
  return [candidate.a, candidate.b].some(
    (side) =>
      side.path === path &&
      side.offsetRange !== undefined &&
      side.offsetRange.start < range.end &&
      range.start < side.offsetRange.end,
  );
}

const first =
  '중복 ID 조회는 모든 충돌 경로만 반환하고 대표 문서를 선택하지 않는다.';
const second =
  '같은 요청의 다른 정상 ID 결과는 계속 반환하며 실패로 바꾸지 않는다.';
const third =
  '저장 전에 후보를 검증하고 실패하면 원문을 그대로 유지한다고 안내한다.';
const orderSentence =
  '주문을 생성하면 재고를 차감하고 결제 대기 상태로 기록한다.';
const shipSentence =
  '배송이 시작되면 송장 번호를 발급해 고객에게 알림을 보낸다.';

/**
 * 고정 사례의 fixture 출처다. 위치·행·점수는 사례 JSON의 관측값이다(행은 1 기반 시작 행).
 * 정리 후 파일은 e347e2d에서 경로가 바뀌어 있어 아래 경로를 쓴다.
 * - duplicate-id-response: .codocs/integration/error-document-access.yaml, query.yaml(1989759)
 *   → 정리 후(e347e2d)에는 두 파일이 삭제되고 .codocs/mcp/error-document-access.yaml, .codocs/mcp/query.yaml로 이동했다.
 * - guide-scope: .codocs/document-model/document.yaml, explanation-separation.yaml(1989759)
 *   → 정리 후(e347e2d)에는 .codocs/writing-guide/ 아래로 이동했다(rename).
 * - status-meaning: .codocs/document-model/document.yaml, .codocs/index.yaml(0c1f0a4) → 정리 후(4c415b2) 같은 경로.
 * - redundant-reference-guidance: .codocs/core/parser/yaml-parsing.yaml(5238ff2)
 * - field-path-definition: .codocs/core/parser/yaml-parsing.yaml, .codocs/core/diagnostics/diagnostics.yaml(61b801b)
 * - leftover-after-split: .codocs/core/change-plan/document-change-plan.yaml, .codocs/workspace/storage.yaml(97d140c)
 * - contextual-reference-navigation: .codocs/core/query/query-projection.yaml,
 *   .codocs/mcp/validation/document-validation-request.yaml(5238ff2)
 * 이동한 파일은 확인 범위를 fixture 파일 쌍으로 한정한다. 전체 corpus 검사는 재현하지 않는다.
 */
const fixtureCases = {
  duplicateId: {
    a: {
      path: 'integration/error-document-access.yaml',
      start: 829,
      end: 979,
      line: 33,
    },
    b: { path: 'integration/query.yaml', start: 3116, end: 3273, line: 51 },
    jaccard: 0.7682926829268293,
    ordered: 0.9315960912052117,
  },
  guideScope: {
    a: { path: 'document-model/document.yaml', start: 805, end: 850, line: 30 },
    b: {
      path: 'document-model/explanation-separation.yaml',
      start: 512,
      end: 562,
      line: 20,
    },
    jaccard: 0.6792452830188679,
    ordered: 0.8631578947368421,
  },
  statusMeaning: {
    a: { path: 'document-model/document.yaml', start: 789, end: 832, line: 31 },
    b: { path: 'index.yaml', start: 630, end: 665, line: 31 },
    jaccard: 0.7142857142857143,
    ordered: 0.8974358974358975,
  },
} as const;

describe('detectDuplicates: 고정 사례 회귀', () => {
  /** 사례 하나의 정리 전 후보에서 두 쪽의 위치·행·점수를 확인한다. */
  function expectFixtureCandidate(
    candidate: DuplicateCandidate | undefined,
    expected: (typeof fixtureCases)[keyof typeof fixtureCases],
    sources: readonly [string, string],
  ): void {
    expect(candidate?.kind).toBe(duplicateMatchKinds.similar);
    if (!candidate) return;
    expect(candidate.a.offsetRange).toEqual({
      start: expected.a.start,
      end: expected.a.end,
    });
    expect(candidate.b.offsetRange).toEqual({
      start: expected.b.start,
      end: expected.b.end,
    });
    // 행은 core 좌표 규약(0 기반)이고 사례 JSON은 1 기반이다.
    expect(candidate.a.range?.start.line).toBe(expected.a.line - 1);
    expect(candidate.b.range?.start.line).toBe(expected.b.line - 1);
    expect(candidate.a.fieldPath).toEqual(['definition']);
    expect(candidate.scores.jaccard).toBeCloseTo(expected.jaccard, 10);
    expect(candidate.scores.ordered).toBeCloseTo(expected.ordered, 10);
    expect(candidate.configVersion).toBe(duplicateDetectionConfig.version);
    // 원문 범위로 자른 값은 구절과 공백 정규화 전 문자열이 같다(접힌 줄의 들여쓰기만 다르다).
    const flat = (text: string): string => text.replace(/\s+/gu, ' ');
    expect(
      flat(
        sources[0].slice(
          candidate.a.offsetRange?.start,
          candidate.a.offsetRange?.end,
        ),
      ),
    ).toBe(flat(candidate.a.passage));
    expect(
      flat(
        sources[1].slice(
          candidate.b.offsetRange?.start,
          candidate.b.offsetRange?.end,
        ),
      ),
    ).toBe(flat(candidate.b.passage));
  }

  it('중복 ID 응답 규칙이 정리 전 문서에 있으면 두 문서를 잇는 후보와 기록된 위치·점수를 반환한다', () => {
    const result = detectDuplicates([
      input(fixtureCases.duplicateId.a.path, duplicateIdBeforeA),
      input(fixtureCases.duplicateId.b.path, duplicateIdBeforeB),
    ]);
    expect(result.candidates).toHaveLength(1);
    expectFixtureCandidate(result.candidates[0], fixtureCases.duplicateId, [
      duplicateIdBeforeA,
      duplicateIdBeforeB,
    ]);
  });

  it('작성 권장 사항의 비강제성 반복이 정리 전 문서에 있으면 후보로 반환한다', () => {
    const result = detectDuplicates([
      input(fixtureCases.guideScope.a.path, guideScopeBeforeA),
      input(fixtureCases.guideScope.b.path, guideScopeBeforeB),
    ]);
    expect(result.candidates).toHaveLength(1);
    expectFixtureCandidate(result.candidates[0], fixtureCases.guideScope, [
      guideScopeBeforeA,
      guideScopeBeforeB,
    ]);
  });

  it('status 의미 요약 반복이 정리 전 문서에 있으면 후보로 반환한다', () => {
    const result = detectDuplicates([
      input(fixtureCases.statusMeaning.a.path, statusBeforeA),
      input(fixtureCases.statusMeaning.b.path, statusBeforeB),
    ]);
    expect(result.candidates).toHaveLength(1);
    expectFixtureCandidate(result.candidates[0], fixtureCases.statusMeaning, [
      statusBeforeA,
      statusBeforeB,
    ]);
  });

  it('정리 전 세 쌍의 정리 후 파일을 검사하면 해당 문서 쌍의 후보가 없다', () => {
    expect(
      detectDuplicates([
        input('mcp/error-document-access.yaml', duplicateIdAfterA),
        input('mcp/query.yaml', duplicateIdAfterB),
      ]).candidates,
    ).toEqual([]);
    expect(
      detectDuplicates([
        input('writing-guide/document.yaml', guideScopeAfterA),
        input('writing-guide/explanation-separation.yaml', guideScopeAfterB),
      ]).candidates,
    ).toEqual([]);
    expect(
      detectDuplicates([
        input('document-model/document.yaml', statusAfterA),
        input('index.yaml', statusAfterB),
      ]).candidates,
    ).toEqual([]);
  });

  it('문서 분리 뒤 남은 동일 규칙을 검사하면 완전 일치와 두 발생 위치를 반환한다', () => {
    const result = detectDuplicates([
      input('core/change-plan/document-change-plan.yaml', leftoverA),
      input('workspace/storage.yaml', leftoverB),
    ]);
    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate?.kind).toBe(duplicateMatchKinds.exact);
    expect(candidate?.a.offsetRange).toEqual({ start: 335, end: 382 });
    expect(candidate?.b.offsetRange).toEqual({ start: 918, end: 965 });
    expect(candidate?.a.range?.start.line).toBe(11);
    expect(candidate?.b.range?.start.line).toBe(25);
    expect(candidate?.scores).toEqual({ jaccard: 1, ordered: 1 });
    expect(result.exactGroups).toHaveLength(1);
    expect(result.exactGroups[0]?.occurrences.map((item) => item.path)).toEqual(
      ['core/change-plan/document-change-plan.yaml', 'workspace/storage.yaml'],
    );
  });

  it('미탐지로 기록된 참조 안내 구절을 검사하면 그 구절을 가리키는 후보가 없다', () => {
    const path = 'core/parser/yaml-parsing.yaml';
    const result = detectDuplicates([input(path, redundantReference)]);
    // 두 구절이 이어진 문단이라도 같은 문서 안 반복으로 묶이지 않아야 한다.
    expect(
      result.candidates.some((candidate) =>
        touches(candidate, path, { start: 1009, end: 1113 }),
      ),
    ).toBe(false);
  });

  it('표현이 달라진 필드 경로 정의를 검사하면 해당 구절을 가리키는 후보가 없다', () => {
    const result = detectDuplicates([
      input('core/parser/yaml-parsing.yaml', fieldPathBeforeA),
      input('core/diagnostics/diagnostics.yaml', fieldPathBeforeB),
    ]);
    expect(
      result.candidates.some(
        (candidate) =>
          touches(candidate, 'core/parser/yaml-parsing.yaml', {
            start: 1101,
            end: 1136,
          }) ||
          touches(candidate, 'core/diagnostics/diagnostics.yaml', {
            start: 880,
            end: 926,
          }),
      ),
    ).toBe(false);
  });

  it('문맥별 참조 안내를 검사하면 후보로 반환하되 삭제 대상으로 분류하지 않고 점수만 남긴다', () => {
    const result = detectDuplicates([
      input('core/query/query-projection.yaml', contextualA),
      input('mcp/validation/document-validation-request.yaml', contextualB),
    ]);
    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate?.kind).toBe(duplicateMatchKinds.similar);
    expect(candidate?.a.offsetRange).toEqual({ start: 1581, end: 1640 });
    expect(candidate?.b.offsetRange).toEqual({ start: 504, end: 555 });
    expect(candidate?.scores.jaccard).toBeCloseTo(0.6833333333333333, 10);
    expect(candidate?.scores.ordered).toBeCloseTo(0.8727272727272727, 10);
    // 참조 표기 때문에 제외하지 않으며 구절에 참조 표기가 그대로 남는다.
    expect(candidate?.a.passage).toContain(
      '[[검증 오류가 있는 문서를 조회하고 수정하는 절차]]',
    );
  });
});

describe('detectDuplicates: 반복 후보 계산', () => {
  it('두 문서에 같은 문단이 있으면 겹치는 구간을 하나로 병합한 완전 일치 후보를 반환한다', () => {
    const paragraph = [first, second, third].join('\n');
    const result = detectDuplicates([
      input('a.yaml', yamlOf(paragraph)),
      input(
        'b.yaml',
        yamlOf(`다른 설명을 먼저 적는다. ${orderSentence}\n\n${paragraph}`),
      ),
    ]);
    expect(result.status).toBe(duplicateComparisonStatuses.complete);
    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate?.kind).toBe(duplicateMatchKinds.exact);
    expect(candidate?.a.path).toBe('a.yaml');
    expect(candidate?.b.path).toBe('b.yaml');
    expect(candidate?.a.fieldPath).toEqual(['definition']);
    expect(candidate?.a.passage).toBe(paragraph);
    expect(candidate?.configVersion).toBe(1);
  });

  it('한 문서 안의 두 문단이 같으면 문서 내부 반복 후보를 반환하고 같은 위치는 자기 자신과 비교하지 않는다', () => {
    const single = detectDuplicates([input('a.yaml', yamlOf(first))]);
    expect(single.candidates).toEqual([]);
    const result = detectDuplicates([
      input('a.yaml', yamlOf(`${first}\n\n${orderSentence}\n\n${first}`)),
    ]);
    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate?.a.path).toBe('a.yaml');
    expect(candidate?.b.path).toBe('a.yaml');
    // @codocs [[본문 중복 탐지]]#L18-L19
    expect(candidate?.a.offsetRange?.start).toBeLessThan(
      candidate?.b.offsetRange?.start ?? 0,
    );
  });

  it('definition과 examples 항목에 같은 문장이 있으면 fieldPath로 구분한 후보를 반환한다', () => {
    const result = detectDuplicates([input('a.yaml', yamlOf(first, [first]))]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.a.fieldPath).toEqual(['definition']);
    expect(result.candidates[0]?.b.fieldPath).toEqual(['examples', 0]);
  });

  it('definition과 examples 밖의 문자열이 같으면 비교하지 않는다', () => {
    const shared = `name: '${first}'\ndomains:\n  - '${first}'\n`;
    const result = detectDuplicates([
      input('a.yaml', `${shared}definition: 서로 다른 첫 번째 정의다.\n`),
      input('b.yaml', `${shared}definition: 서로 다른 두 번째 정의다.\n`),
    ]);
    expect(result.candidates).toEqual([]);
  });

  it('공백과 줄바꿈만 다른 문단이면 정규화 뒤 같으므로 완전 일치로 반환한다', () => {
    const result = detectDuplicates([
      input('a.yaml', yamlOf(first)),
      input(
        'b.yaml',
        yamlOf(
          '중복 ID 조회는   모든 충돌 경로만\n반환하고 대표 문서를\n선택하지   않는다.',
        ),
      ),
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.kind).toBe(duplicateMatchKinds.exact);
    expect(result.candidates[0]?.b.passage).toContain('\n');
  });

  it('일부만 고친 문장이면 유사 반복으로 반환하고 Jaccard와 순서 유사도를 담는다', () => {
    const edited = first.replace('선택하지 않는다', '고르지 않는다');
    const result = detectDuplicates([
      input('a.yaml', yamlOf(first)),
      input('b.yaml', yamlOf(edited)),
    ]);
    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate?.kind).toBe(duplicateMatchKinds.similar);
    expect(candidate?.scores.jaccard).toBeGreaterThanOrEqual(0.65);
    expect(candidate?.scores.jaccard).toBeLessThan(1);
    expect(candidate?.scores.ordered).toBeGreaterThanOrEqual(0.7);
    expect(result.exactGroups).toEqual([]);
  });

  it('최소 길이보다 짧은 공통 문구만 겹치면 후보로 만들지 않고 제외 수에 센다', () => {
    const result = detectDuplicates([
      input('a.yaml', yamlOf(`${orderSentence} 참고용 문서다.`)),
      input('b.yaml', yamlOf(`${shipSentence} 참고용 문서다.`)),
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.exclusions.too_short).toBeGreaterThan(0);
  });

  it('제목·코드 펜스·표 구분선이 같아도 후보로 만들지 않고 제외 수에 센다', () => {
    const shared = [
      '## 매우 긴 제목이 서른 글자를 넘도록 이어지는 공통 제목입니다',
      '',
      '```',
      'const sharedCode = createVeryLongSharedIdentifier(argumentOne);',
      '```',
      '',
      '| ------------------------------ | ------------------------------ |',
    ];
    const result = detectDuplicates([
      input('a.yaml', yamlOf([...shared, '', orderSentence].join('\n'))),
      input('b.yaml', yamlOf([...shared, '', shipSentence].join('\n'))),
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.exclusions.heading).toBe(2);
    expect(result.exclusions.code_fence).toBe(6);
    expect(result.exclusions.table_separator).toBe(2);
  });

  it('표 행은 한 줄을 한 구간으로 비교하고 구분선 줄은 뺀다', () => {
    const row =
      '| fieldPath | 해당 시 | 속성 이름과 배열 인덱스로 구성한 경로 배열 |';
    const table = `| 속성 | 필수 | 의미 |\n| --- | --- | --- |\n${row}`;
    const result = detectDuplicates([
      input('a.yaml', yamlOf(table)),
      input('b.yaml', yamlOf(`${orderSentence}\n\n${table}`)),
    ]);
    expect(result.candidates.map((candidate) => candidate.a.passage)).toEqual([
      row,
    ]);
  });

  it('세 문서에 같은 문장이 있으면 쌍별 후보 셋과 발생 위치 셋의 완전 일치 묶음을 반환한다', () => {
    const result = detectDuplicates([
      input('a.yaml', yamlOf(first)),
      input('b.yaml', yamlOf(first)),
      input('c.yaml', yamlOf(first)),
    ]);
    expect(result.candidates).toHaveLength(3);
    expect(
      result.candidates.every((candidate) => candidate.groupIndex === 0),
    ).toBe(true);
    expect(result.exactGroups).toHaveLength(1);
    expect(result.exactGroups[0]?.occurrences.map((item) => item.path)).toEqual(
      ['a.yaml', 'b.yaml', 'c.yaml'],
    );
  });

  it('ID가 충돌하는 두 문서에도 경로와 필드와 위치로 구분한 후보를 반환한다', () => {
    const result = detectDuplicates([
      input('x/a.yaml', yamlOf(first), { id: 'same-id' }),
      input('y/b.yaml', yamlOf(first), { id: 'same-id' }),
    ]);
    expect(result.candidates).toHaveLength(1);
    const [candidate] = result.candidates;
    expect([candidate?.a.id, candidate?.b.id]).toEqual(['same-id', 'same-id']);
    expect([candidate?.a.path, candidate?.b.path]).toEqual([
      'x/a.yaml',
      'y/b.yaml',
    ]);
    expect(candidate?.a.revision).toBe('x/a.yaml-r1');
  });

  it('숫자와 부정 표현은 정규화에서 지우지 않는다', () => {
    const sentence =
      '결제는 30분 안에 완료하지 않으면 자동으로 취소되지 않는다.';
    const prepared = prepareDuplicateDocument(
      input('a.yaml', yamlOf(sentence)),
    );
    // @codocs [[본문 중복 탐지]]#L26
    expect(prepared.fields[0]?.segments[0]?.text).toBe(sentence);
    const negated = detectDuplicates([
      input('a.yaml', yamlOf(sentence)),
      input('b.yaml', yamlOf(sentence.replace('않는다', '한다'))),
    ]);
    expect(negated.candidates[0]?.kind).toBe(duplicateMatchKinds.similar);
  });

  it('링크 표시 문구가 같고 목적지만 다르면 점수는 1이어도 유사 후보로 두고 목적지 차이를 남긴다', () => {
    const withLink = (destination: string): string =>
      `자세한 절차는 [오류 수정 절차](${destination})에서 확인하고 결과를 기록한다.`;
    const result = detectDuplicates([
      input('a.yaml', yamlOf(withLink('./one.md'))),
      input('b.yaml', yamlOf(withLink('./two.md'))),
      input('c.yaml', yamlOf(withLink('./one.md'))),
    ]);
    const byPair = new Map(
      result.candidates.map((candidate) => [
        `${candidate.a.path}|${candidate.b.path}`,
        candidate,
      ]),
    );
    expect(byPair.get('a.yaml|c.yaml')?.kind).toBe(duplicateMatchKinds.exact);
    expect(byPair.get('a.yaml|c.yaml')?.linkDestinations.differ).toBe(false);
    const differing = byPair.get('a.yaml|b.yaml');
    expect(differing?.kind).toBe(duplicateMatchKinds.similar);
    // @codocs [[본문 중복 탐지]]#L27
    expect(differing?.scores).toEqual({ jaccard: 1, ordered: 1 });
    expect(differing?.linkDestinations).toEqual({
      a: ['./one.md'],
      b: ['./two.md'],
      differ: true,
    });
    expect(differing?.a.passage).toContain('](./one.md)');
  });

  it('파싱에 실패한 문서는 본문을 추측하지 않고 이유와 함께 건너뛰며 나머지는 계속 비교한다', () => {
    const result = detectDuplicates([
      input('broken.yaml', 'definition: [\n'),
      input('a.yaml', yamlOf(first)),
      input('b.yaml', yamlOf(first)),
    ]);
    // @codocs [[본문 중복 탐지]]#L15
    expect(result.skippedInputs).toEqual([
      {
        path: 'broken.yaml',
        revision: 'broken.yaml-r1',
        reason: duplicateSkipReasons.parseFailed,
      },
    ]);
    expect(result.candidates).toHaveLength(1);
  });

  it('설정 버전이 다른 준비 결과는 비교에서 빼고 이유를 남긴다', () => {
    const stale = {
      ...prepareDuplicateDocument(input('a.yaml', yamlOf(first))),
      configVersion: 0,
    };
    const comparison = createDuplicateComparison([
      stale,
      prepareDuplicateDocument(input('b.yaml', yamlOf(first))),
    ]);
    comparison.step(Number.POSITIVE_INFINITY);
    const result = comparison.snapshot();
    expect(result.candidates).toEqual([]);
    expect(result.skippedInputs.map((item) => item.reason)).toEqual([
      duplicateSkipReasons.configVersionMismatch,
    ]);
  });

  it('입력 파싱 결과를 동결해도 예외 없이 계산하며 입력을 바꾸지 않는다', () => {
    const documents = [
      input('a.yaml', yamlOf(first, [second])),
      input('b.yaml', yamlOf(`${first}\n${second}`)),
    ];
    deepFreeze(documents);
    const before = JSON.stringify(documents);
    expect(detectDuplicates(documents).candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(documents)).toBe(before);
  });
});

describe('detectDuplicates: UTF-16 원문 범위', () => {
  /** 후보 한쪽의 원문 범위로 자른 값을 반환한다. */
  function slice(
    document: DuplicateDocumentInput,
    location: DuplicateCandidate['a'],
  ): string | undefined {
    const range = location.offsetRange;
    return range ? sourceOf(document).slice(range.start, range.end) : undefined;
  }

  it('한글 구절을 CRLF 원문에서 찾으면 범위로 자른 값이 원문 구간과 같다', () => {
    const one = input(
      'a.yaml',
      `id: a\r\ndefinition: ${first}\r\nexamples:\r\n  - ${first}\r\n`,
    );
    const result = detectDuplicates([one]);
    const [candidate] = result.candidates;
    expect(slice(one, candidate!.a)).toBe(first);
    expect(slice(one, candidate!.b)).toBe(first);
    // CRLF 원문의 줄 좌표는 \n 기준이며 문자 위치는 줄 시작부터 UTF-16 단위다.
    expect(candidate?.a.range).toEqual({
      start: { line: 1, character: 'definition: '.length },
      end: { line: 1, character: 'definition: '.length + first.length + 0 },
    });
    expect(candidate?.b.range?.start).toEqual({ line: 3, character: 4 });
  });

  it('서로게이트 쌍 이모지가 있는 구절도 범위와 문자 위치를 UTF-16 코드 단위로 반환한다', () => {
    const emoji =
      '완료한 작업을 표시할 때 😀 이모지와 한글을 함께 쓰는 안내 문장이다.';
    const one = input('a.yaml', `definition: ${emoji}\n`);
    const two = input('b.yaml', `name: 문서\ndefinition: ${emoji}\n`);
    const [candidate] = detectDuplicates([one, two]).candidates;
    expect(slice(one, candidate!.a)).toBe(emoji);
    expect(slice(two, candidate!.b)).toBe(emoji);
    expect(emoji.length).toBeGreaterThan(Array.from(emoji).length);
    expect(candidate?.a.range?.end.character).toBe(
      'definition: '.length + emoji.length,
    );
  });

  it('escape가 있는 큰따옴표 스칼라는 해석된 구절을 원문 escape 표기 그대로의 범위로 되돌린다', () => {
    const raw =
      '중복 ID 조회는 \\"모든\\" 충돌\\u00b7경로만 반환하고 대표 문서를 선택하지 않는다.';
    const one = input('a.yaml', `definition: "${raw}"\n`);
    const two = input('b.yaml', `definition: "${raw}"\n`);
    const [candidate] = detectDuplicates([one, two]).candidates;
    expect(candidate?.a.passage).toBe(
      '중복 ID 조회는 "모든" 충돌·경로만 반환하고 대표 문서를 선택하지 않는다.',
    );
    expect(slice(one, candidate!.a)).toBe(raw);
    expect(slice(two, candidate!.b)).toBe(raw);
  });

  it('CRLF 블록 스칼라의 여러 문장 구간은 원문의 줄바꿈과 들여쓰기를 포함한 범위를 반환한다', () => {
    const one = input('a.yaml', yamlOf(`${first}\n${second}`, [], '\r\n'));
    const two = input('b.yaml', yamlOf(`${first}\n${second}`, [], '\r\n'));
    const [candidate] = detectDuplicates([one, two]).candidates;
    expect(slice(one, candidate!.a)).toBe(`${first}\r\n  ${second}`);
    expect(candidate?.a.passage).toBe(`${first}\n${second}`);
    expect(candidate?.a.range?.start.line).toBe(3);
    expect(candidate?.a.range?.end.line).toBe(4);
  });

  it('문자열 매핑으로 원문 위치를 확인할 수 없으면 후보는 남기되 범위와 행을 만들지 않는다', () => {
    const unmapped = (path: string): DuplicateDocumentInput => ({
      path,
      revision: 'r1',
      parsed: {
        success: true,
        source: `definition: ${first}\n`,
        data: { definition: first },
        fields: [],
        strings: [
          { fieldPath: ['definition'], value: first, sourceRanges: [] },
        ],
        diagnostics: [],
      },
    });
    const [candidate] = detectDuplicates([
      unmapped('a.yaml'),
      unmapped('b.yaml'),
    ]).candidates;
    expect(candidate?.a.passage).toBe(first);
    expect(candidate?.a).not.toHaveProperty('offsetRange');
    expect(candidate?.a).not.toHaveProperty('range');
    expect(candidate?.b).not.toHaveProperty('offsetRange');
  });
});

describe('문서별 준비와 예산 비교', () => {
  const documents = (): DuplicateDocumentInput[] => [
    input('a.yaml', guideScopeBeforeA),
    input('b.yaml', guideScopeBeforeB),
    input('c.yaml', statusBeforeA),
    input('d.yaml', statusBeforeB),
    input('e.yaml', leftoverA),
    input('f.yaml', leftoverB),
  ];

  it('문서를 준비하면 path·revision·설정 버전으로 식별하고 다른 문서와 무관한 결과를 만든다', () => {
    const one = prepareDuplicateDocument(
      input('a.yaml', yamlOf(first), { revision: 'rev-1' }),
    );
    expect(one.path).toBe('a.yaml');
    expect(one.revision).toBe('rev-1');
    expect(one.configVersion).toBe(duplicateDetectionConfig.version);
    expect(duplicatePreparationKey(one)).toBe(
      duplicatePreparationKey({ path: 'a.yaml', revision: 'rev-1' }),
    );
    expect(
      duplicatePreparationKey({ path: 'a.yaml', revision: 'rev-2' }),
    ).not.toBe(duplicatePreparationKey(one));
    expect(duplicatePreparationKey(one, 2)).not.toBe(
      duplicatePreparationKey(one),
    );
    expect(one.fields[0]?.segments).toHaveLength(1);
  });

  it('파싱 실패 문서를 준비하면 구간 없이 실패 이유만 남긴다', () => {
    const prepared = prepareDuplicateDocument(
      input('bad.yaml', 'definition: [\n'),
    );
    expect(prepared.skipReason).toBe(duplicateSkipReasons.parseFailed);
    expect(prepared.fields).toEqual([]);
  });

  it('예산을 나눠 step하면 부분 결과를 거쳐 한 번에 계산한 결과와 같은 완료 결과에 이른다', () => {
    const expected = detectDuplicates(documents());
    const comparison = createDuplicateComparison(
      documents().map(prepareDuplicateDocument),
    );
    expect(comparison.getProgress().status).toBe(
      duplicateComparisonStatuses.partial,
    );
    const budget = Math.ceil(comparison.getProgress().totalUnits / 4);
    let steps = 0;
    let lastCompleted = 0;
    let sawPartialCandidates = false;
    while (
      comparison.getProgress().status === duplicateComparisonStatuses.partial
    ) {
      const progress = comparison.step(budget);
      steps++;
      expect(progress.completedUnits).toBeGreaterThan(lastCompleted);
      expect(progress.completedUnits - lastCompleted).toBeLessThanOrEqual(
        budget,
      );
      lastCompleted = progress.completedUnits;
      if (progress.status === duplicateComparisonStatuses.partial) {
        const partial = comparison.snapshot();
        expect(partial.status).toBe(duplicateComparisonStatuses.partial);
        if (partial.candidates.length > 0) sawPartialCandidates = true;
      }
    }
    expect(steps).toBeGreaterThan(1);
    expect(sawPartialCandidates).toBe(true);
    expect(lastCompleted).toBe(comparison.getProgress().totalUnits);
    expect(comparison.snapshot()).toEqual(expected);
  });

  it('완료된 작업에 step을 다시 부르면 결과를 바꾸지 않는다', () => {
    const comparison = createDuplicateComparison(
      documents().map(prepareDuplicateDocument),
    );
    comparison.step(Number.POSITIVE_INFINITY);
    const done = comparison.snapshot();
    expect(comparison.step(10).status).toBe(
      duplicateComparisonStatuses.complete,
    );
    expect(comparison.snapshot()).toEqual(done);
  });

  it('예산이 0이거나 숫자가 아니어도 한 단위는 진행해 멈추지 않는다', () => {
    const comparison = createDuplicateComparison(
      documents().map(prepareDuplicateDocument),
    );
    expect(comparison.step(0).completedUnits).toBe(1);
    expect(comparison.step(Number.NaN).completedUnits).toBe(2);
  });

  it('같은 준비 결과로 비교 작업을 여러 번 만들어도 준비 결과는 변하지 않고 같은 결과를 낸다', () => {
    const prepared = documents().map(prepareDuplicateDocument);
    const snapshot = JSON.stringify(prepared.map((item) => item.fields));
    const run = (): unknown => {
      const comparison = createDuplicateComparison(prepared);
      comparison.step(Number.POSITIVE_INFINITY);
      return comparison.snapshot();
    };
    expect(run()).toEqual(run());
    expect(JSON.stringify(prepared.map((item) => item.fields))).toBe(snapshot);
  });

  it('스냅샷을 받은 뒤 step을 진행해도 이전 스냅샷은 바뀌지 않는다', () => {
    const comparison = createDuplicateComparison(
      documents().map(prepareDuplicateDocument),
    );
    comparison.step(100);
    const early = comparison.snapshot();
    const copy = JSON.stringify(early);
    comparison.step(Number.POSITIVE_INFINITY);
    expect(JSON.stringify(early)).toBe(copy);
  });
});

describe('유사 후보 사전 필터', () => {
  /** 재현 가능한 의사 난수다. */
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  it('서로 무관한 문서가 많아도 비교 단위는 전체 쌍 수보다 훨씬 적고 결과는 전수 비교와 같다', () => {
    const next = random(7);
    const syllables = Array.from(
      '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허',
    );
    const word = (): string =>
      Array.from(
        { length: 2 + Math.floor(next() * 3) },
        () => syllables[Math.floor(next() * syllables.length)],
      ).join('');
    const sentences: string[] = [];
    for (let index = 0; index < 300; index++) {
      const previous = sentences[Math.floor(next() * sentences.length)];
      if (previous && next() < 0.25) {
        const words = previous.slice(0, -1).split(' ');
        if (next() < 0.5) words[Math.floor(next() * words.length)] = word();
        sentences.push(`${words.join(' ')}.`);
      } else sentences.push(`${Array.from({ length: 9 }, word).join(' ')}.`);
    }
    const prepared = sentences.map((sentence, index) =>
      prepareDuplicateDocument(input(`d${index}.yaml`, yamlOf(sentence))),
    );
    const comparison = createDuplicateComparison(prepared);
    const allPairs = (sentences.length * (sentences.length - 1)) / 2;
    expect(comparison.getProgress().totalUnits).toBeLessThan(allPairs / 20);
    comparison.step(Number.POSITIVE_INFINITY);
    const actual = comparison
      .snapshot()
      .candidates.map((candidate) =>
        [
          candidate.a.path,
          candidate.b.path,
          candidate.kind,
          candidate.scores.jaccard,
          candidate.scores.ordered,
        ].join('|'),
      )
      .sort();
    const segments = prepared.map((item) => item.fields[0]?.segments[0]);
    const expected: string[] = [];
    segments.forEach((left, i) => {
      segments.slice(i + 1).forEach((right, offset) => {
        if (!left || !right) return;
        const j = i + 1 + offset;
        const isExact = left.text === right.text;
        const score = isExact ? 1 : jaccard(left.grams, right.grams);
        if (score < duplicateDetectionConfig.minJaccard) return;
        const ordered = isExact
          ? 1
          : orderedSimilarity(Array.from(left.text), Array.from(right.text));
        if (ordered < duplicateDetectionConfig.minOrdered) return;
        expected.push(
          [
            `d${i}.yaml`,
            `d${j}.yaml`,
            isExact ? duplicateMatchKinds.exact : duplicateMatchKinds.similar,
            score,
            ordered,
          ].join('|'),
        );
      });
    });
    expect(expected.length).toBeGreaterThan(10);
    expect(actual).toEqual(expected.sort());
  });
});
