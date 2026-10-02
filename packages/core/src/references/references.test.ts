import { describe, expect, it } from 'vitest';
import {
  referenceDiagnosticCodes,
  referenceDiagnosticMessages,
} from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import { referenceSyntaxStatuses } from './domain-values.js';
import { extractReferences } from './index.js';

describe('extractReferences: 본문 문자열에서 참조 추출', () => {
  it('정의에 참조가 하나 있으면 이름과 실제 원문 위치를 반환한다', () => {
    const source = 'definition: "[[대상]]"\nname: 출처\ndomains: [업무]\n';
    const parsed = {
      success: true as const,
      source,
      data: { definition: '[[대상]]', name: '출처', domains: ['업무'] },
      fields: [],
      strings: [
        {
          fieldPath: ['definition'],
          value: '[[대상]]',
          sourceRanges: Array.from({ length: 6 }, (_, index) => ({
            start: 13 + index,
            end: 14 + index,
          })),
        },
      ],
      diagnostics: [],
    };
    const result = extractReferences(parsed);
    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences).toEqual([
      expect.objectContaining({
        syntax: referenceSyntaxStatuses.valid,
        name: '대상',
        text: '[[대상]]',
        offsetRange: { start: 13, end: 19 },
      }),
    ]);
  });

  it('이름과 도메인이 없는 문서의 정의를 확인하면 참조를 추출한다', () => {
    const parsed = {
      success: true as const,
      source: 'definition: "[[대상]]"\n',
      data: { definition: '[[대상]]' },
      fields: [],
      strings: [
        {
          fieldPath: ['definition'],
          value: '[[대상]]',
          sourceRanges: Array.from({ length: 6 }, (_, index) => ({
            start: 13 + index,
            end: 14 + index,
          })),
        },
      ],
      diagnostics: [],
    };
    const result = extractReferences(parsed);
    expect(result.occurrences.map((item) => item.text)).toEqual(['[[대상]]']);
  });

  it('정의와 예문에 참조가 있으면 다른 필드는 제외하고 본문 순서로 반환한다', () => {
    const parsed = {
      success: true as const,
      source:
        'definition: "[[정의]]"\nexamples: [7, "[[예시]]"]\nname: "[[제외]]"\nbody: "[[제외]]"\n',
      data: {
        name: '[[제외]]',
        definition: '[[정의]]',
        examples: [7, '[[예시]]'],
        body: '[[제외]]',
      },
      fields: [],
      strings: [
        {
          fieldPath: ['definition'],
          value: '[[정의]]',
          sourceRanges: Array.from({ length: 6 }, (_, index) => ({
            start: 13 + index,
            end: 14 + index,
          })),
        },
        {
          fieldPath: ['examples', 1],
          value: '[[예시]]',
          sourceRanges: Array.from({ length: 6 }, (_, index) => ({
            start: 36 + index,
            end: 37 + index,
          })),
        },
      ],
      diagnostics: [],
    };
    const result = extractReferences(parsed);
    expect(
      result.occurrences.map((item) => [item.fieldPath, item.text]),
    ).toEqual([
      [['definition'], '[[정의]]'],
      [['examples', 1], '[[예시]]'],
    ]);
  });

  it.each([
    ['숫자 정의', 'definition: 7\n', { definition: 7 }],
    ['문자열 예문', 'examples: "[[제외]]"\n', { examples: '[[제외]]' }],
    ['사용자 속성', 'custom: "[[제외]]"\n', { custom: '[[제외]]' }],
  ])(
    '%s에서 참조처럼 보이는 값을 만나면 본문 참조로 추측하지 않는다',
    (_condition, source, data) => {
      const parsed = {
        success: true as const,
        source,
        data,
        fields: [],
        strings: [],
        diagnostics: [],
      };
      expect(extractReferences(parsed)).toEqual({
        occurrences: [],
        diagnostics: [],
      });
    },
  );

  it('파싱에 실패한 입력을 전달하면 참조를 반환하지 않는다', () => {
    const parsed = {
      success: false as const,
      source: 'definition: ["[[제외]]"\n',
      diagnostics: [],
    };
    expect(extractReferences(parsed)).toEqual({
      occurrences: [],
      diagnostics: [],
    });
  });
});

describe('parseYaml과 extractReferences: YAML 표기별 참조 위치', () => {
  /**
   * @codocs [[참조]]#L19
   * @codocs [[참조]]#L20
   */
  it('백슬래시 홀짝과 콜론 이스케이프를 쓰면 리터럴을 제외하고 정확한 이름을 유지한다', () => {
    const source = String.raw`definition: '\[[리터럴]] \\[[이름]] \\\[[리터럴]] \\\\[[도메인:이름\:콜론]] [[ 이름 😀 ]] [[이름]]'
`;
    const result = extractReferences(parseYaml(source));
    expect(result.diagnostics).toEqual([]);
    expect(
      result.occurrences.map((item) =>
        item.syntax === referenceSyntaxStatuses.valid
          ? [item.name, item.domain]
          : null,
      ),
    ).toEqual([
      ['이름', undefined],
      ['이름:콜론', '도메인'],
      [' 이름 😀 ', undefined],
      ['이름', undefined],
    ]);
    expect(
      result.occurrences.map((item) =>
        source.slice(item.offsetRange.start, item.offsetRange.end),
      ),
    ).toEqual([
      '[[이름]]',
      String.raw`[[도메인:이름\:콜론]]`,
      '[[ 이름 😀 ]]',
      '[[이름]]',
    ]);
  });
  /**
   * @codocs [[참조]]#L23
   * @codocs [[참조]]#L25
   * @codocs [[참조]]#L26
   */
  it('빈 구성과 중첩 및 미완성 참조가 있으면 앞 오류를 유지하고 다음 참조를 복구한다', () => {
    const source =
      'definition: "[[]] [[:이름]] [[도메인:]] [[a:b:c]] [[앞 [[정상]] [[끝"\n';
    const result = extractReferences(parseYaml(source), 'doc.yaml');
    expect(result.occurrences.map((item) => [item.syntax, item.text])).toEqual([
      ['invalid', '[[]]'],
      ['invalid', '[[:이름]]'],
      ['invalid', '[[도메인:]]'],
      ['invalid', '[[a:b:c]]'],
      ['invalid', '[[앞 '],
      ['valid', '[[정상]]'],
      ['invalid', '[[끝'],
    ]);
    expect(result.diagnostics).toHaveLength(6);
    for (const issue of result.diagnostics)
      expect(issue).toMatchObject({
        code: referenceDiagnosticCodes.invalidReference,
        message: referenceDiagnosticMessages.invalidReference,
        severity: 'error',
        path: 'doc.yaml',
        fieldPath: ['definition'],
      });
    expect(
      result.diagnostics.map((item) =>
        source.slice(item.offsetRange.start, item.offsetRange.end),
      ),
    ).toEqual([
      '[[]]',
      '[[:이름]]',
      '[[도메인:]]',
      '[[a:b:c]]',
      '[[앞 ',
      '[[끝',
    ]);
  });
  /**
   * @codocs [[참조]]#L27
   */
  it('참조를 반복 추출하면 모든 위치와 입력을 변경하지 않는다', () => {
    const source = 'definition: "😀 [[반복]] [[반복]]"\n';
    const parsed = parseYaml(source);
    const before = JSON.stringify(parsed);
    const result = extractReferences(parsed);
    expect(result.occurrences.map((item) => item.offsetRange)).toEqual([
      { start: 16, end: 22 },
      { start: 23, end: 29 },
    ]);
    expect(result.occurrences[0]?.range).toEqual({
      start: { line: 0, character: 16 },
      end: { line: 0, character: 22 },
    });
    expect(JSON.stringify(parsed)).toBe(before);
    expect(parsed.source).toBe(source);
  });
  it('YAML Unicode escape가 무효 참조를 만들면 해석 표기가 아닌 실제 escape 위치를 진단한다', /** 닫는 괄호와 미완성의 끝 위치도 실제 원문으로 계산한다. */ () => {
    const source =
      String.raw`definition: "\u005b\u005b\u005d\u005d \u005b\u005b끝"` +
      '\r\n';
    const result = extractReferences(parseYaml(source), '');
    expect(
      result.occurrences.map(
        /** 각 무효 등장과 위치를 비교한다. */ (item) => [
          item.syntax,
          item.text,
          item.offsetRange,
        ],
      ),
    ).toEqual([
      ['invalid', '[[]]', { start: 13, end: 37 }],
      ['invalid', '[[끝', { start: 38, end: 51 }],
    ]);
    expect(result.diagnostics.map((item) => item.range)).toEqual([
      { start: { line: 0, character: 13 }, end: { line: 0, character: 37 } },
      { start: { line: 0, character: 38 }, end: { line: 0, character: 51 } },
    ]);
    expect(result.diagnostics[0]?.path).toBe('');
  });
  /**
   * double quote의 두 원문 백슬래시는 해석값에서 하나의 리터럴 escape가 된다.
   * @codocs [[참조]]#L21
   */
  it('해석 문자열의 백슬래시 escape 개수가 홀짝이면 YAML 원문 개수로 판정하지 않는다', () => {
    const source = String.raw`definition: "\\[[제외]] \\\\[[포함]]"` + '\n';
    expect(
      extractReferences(parseYaml(source)).occurrences.map((item) => item.text),
    ).toEqual(['[[포함]]']);
  });
  /**
   * @codocs [[참조]]#L24
   * @codocs [[참조]]#L26
   */
  it('대괄호 구성 오류와 연속 참조가 있으면 오류와 다음 정상 참조를 모두 유지한다', () => {
    const source =
      'definition: "[[a[b]][[정상]][[a]b]][[다음]][[앞 [[중간 [[끝]]"\n';
    expect(
      extractReferences(parseYaml(source)).occurrences.map((item) => [
        item.syntax,
        item.text,
      ]),
    ).toEqual([
      ['invalid', '[[a[b]]'],
      ['valid', '[[정상]]'],
      ['invalid', '[[a]b]]'],
      ['valid', '[[다음]]'],
      ['invalid', '[[앞 '],
      ['invalid', '[[중간 '],
      ['valid', '[[끝]]'],
    ]);
  });
  /**
   * escape 제거는 콜론에 붙은 백슬래시 하나만 제거하며 나머지는 유지한다.
   * @codocs [[참조]]#L18
   * @codocs [[참조]]#L19
   */
  it('콜론 앞 백슬래시가 홀짝이면 첫 실제 구분자와 escape 콜론을 구별한다', () => {
    const source = String.raw`definition: '[[a\:b]] [[a\\:b]] [[a\\\:b]] [[도\:메인:이\:름]]'
`;
    expect(
      extractReferences(parseYaml(source)).occurrences.map((item) =>
        item.syntax === referenceSyntaxStatuses.valid
          ? [item.name, item.domain]
          : null,
      ),
    ).toEqual([
      ['a:b', undefined],
      ['b', String.raw`a\\`],
      [String.raw`a\\:b`, undefined],
      ['이:름', '도:메인'],
    ]);
  });
});

describe('참조 구문 오류의 공개 코드와 문구', () => {
  it('참조 구문 오류 상수를 조회하면 고정 코드와 한국어 문구를 반환한다', () => {
    expect(referenceDiagnosticCodes.invalidReference).toBe('invalid_reference');
    expect(referenceDiagnosticMessages.invalidReference).toBe(
      '참조 구문이 올바르지 않습니다.',
    );
  });
});
