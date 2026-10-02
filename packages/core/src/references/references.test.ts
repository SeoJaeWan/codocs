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

/** 정의 문자열의 참조를 이름·도메인 쌍으로 바꾼다. 문법 오류는 null이다. */
function parts(definition: string): ([string, string | undefined] | null)[] {
  return extractReferences(
    parseYaml(`definition: ${definition}\n`),
  ).occurrences.map((item) =>
    item.syntax === referenceSyntaxStatuses.valid
      ? [item.name, item.domain]
      : null,
  );
}

describe('표기: 참조 이름과 도메인', () => {
  /**
   * @codocs [[참조]]#L18
   */
  it('이름 앞에 도메인과 콜론을 적으면 도메인과 이름으로 나눈다', () => {
    expect(parts("'[[도메인:이름]] [[이름]]'")).toEqual([
      ['이름', '도메인'],
      ['이름', undefined],
    ]);
  });
  /**
   * @codocs [[참조]]#L19
   */
  it('이름과 도메인에 `\\:`로 쓴 콜론은 콜론 글자로 읽는다', () => {
    expect(parts(String.raw`'[[a\:b]] [[도\:메인:이\:름]]'`)).toEqual([
      ['a:b', undefined],
      ['이:름', '도:메인'],
    ]);
  });
  /**
   * @codocs [[참조]]#L20
   */
  it.each([
    ['대괄호 앞 1개', String.raw`'\[[글자]]'`, []],
    ['대괄호 앞 2개', String.raw`'\\[[이름]]'`, [['이름', undefined]]],
    ['대괄호 앞 3개', String.raw`'\\\[[글자]]'`, []],
    ['콜론 앞 2개', String.raw`'[[a\\:b]]'`, [['b', String.raw`a\\`]]],
    ['콜론 앞 3개', String.raw`'[[a\\\:b]]'`, [[String.raw`a\\:b`, undefined]]],
  ])(
    '백슬래시가 %s이면 홀수 개는 글자로, 짝수 개는 원래 표기로 읽는다',
    (_count, definition, expected) => {
      expect(parts(definition)).toEqual(expected);
    },
  );
  /**
   * double quote의 두 원문 백슬래시는 해석값에서 하나의 리터럴 escape가 된다.
   * @codocs [[참조]]#L21
   */
  it('YAML 큰따옴표 문자열은 YAML이 바꾼 뒤의 백슬래시 개수로 판단한다', () => {
    expect(parts(String.raw`"\\[[제외]] \\\\[[포함]]"`)).toEqual([
      ['포함', undefined],
    ]);
  });
});

describe('표기: 문법 오류', () => {
  /**
   * @codocs [[참조]]#L22
   */
  it.each([
    ['빈 이름', '[[]]'],
    ['도메인 뒤 빈 이름', '[[도메인:]]'],
    ['빈 도메인', '[[:이름]]'],
    ['남은 여는 대괄호', '[[a[b]]'],
    ['남은 닫는 대괄호', '[[a]b]]'],
    ['두 번째 콜론', '[[a:b:c]]'],
  ])('대괄호 안이 다음이면 문법 오류다: %s', (_case, value) => {
    const result = extractReferences(
      parseYaml(`definition: "${value}"\n`),
      'doc.yaml',
    );
    expect(result.occurrences.map((item) => item.syntax)).toEqual([
      referenceSyntaxStatuses.invalid,
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: referenceDiagnosticCodes.invalidReference,
        message: referenceDiagnosticMessages.invalidReference,
        severity: 'error',
        path: 'doc.yaml',
        fieldPath: ['definition'],
      }),
    ]);
  });
  /**
   * @codocs [[참조]]#L26
   */
  it('닫지 않은 참조는 다음 `[[` 앞에서 문법 오류로 끝내고 다음 참조를 새로 읽는다', () => {
    const source = 'definition: "[[앞 [[중간 [[정상]] [[끝"\n';
    expect(
      extractReferences(parseYaml(source)).occurrences.map((item) => [
        item.syntax,
        item.text,
      ]),
    ).toEqual([
      [referenceSyntaxStatuses.invalid, '[[앞 '],
      [referenceSyntaxStatuses.invalid, '[[중간 '],
      [referenceSyntaxStatuses.valid, '[[정상]]'],
      [referenceSyntaxStatuses.invalid, '[[끝'],
    ]);
  });
  /**
   * @codocs [[참조]]#L27
   */
  it('같은 참조가 여러 번 나오면 나온 위치마다 따로 해석한다', () => {
    const source = 'definition: "😀 [[반복]] [[반복]]"\n';
    const result = extractReferences(parseYaml(source));
    expect(result.occurrences.map((item) => item.offsetRange)).toEqual([
      { start: 16, end: 22 },
      { start: 23, end: 29 },
    ]);
  });
});

describe('extractReferences: 원문 위치와 입력 보존', () => {
  it('escape와 이모지가 있어도 참조의 실제 원문 범위와 이름을 돌려준다', () => {
    const source = String.raw`definition: '\[[리터럴]] \\[[이름]] \\\\[[도메인:이름\:콜론]] [[ 이름 😀 ]]'
`;
    const result = extractReferences(parseYaml(source));
    expect(
      result.occurrences.map((item) =>
        source.slice(item.offsetRange.start, item.offsetRange.end),
      ),
    ).toEqual(['[[이름]]', String.raw`[[도메인:이름\:콜론]]`, '[[ 이름 😀 ]]']);
    expect(result.occurrences[2]).toMatchObject({ name: ' 이름 😀 ' });
  });
  it('문법 오류 진단은 오류 표기의 실제 원문 범위에 붙는다', () => {
    const source = 'definition: "[[]] [[앞 [[정상]] [[끝"\n';
    const result = extractReferences(parseYaml(source));
    expect(
      result.diagnostics.map((item) =>
        source.slice(item.offsetRange.start, item.offsetRange.end),
      ),
    ).toEqual(['[[]]', '[[앞 ', '[[끝']);
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
  it('참조를 추출해도 입력한 파싱 결과를 바꾸지 않는다', () => {
    const parsed = parseYaml('definition: "😀 [[반복]] [[반복]]"\n');
    const before = JSON.stringify(parsed);
    extractReferences(parsed);
    expect(JSON.stringify(parsed)).toBe(before);
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
