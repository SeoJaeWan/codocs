import { describe, expect, it } from 'vitest';
import {
  extractReferences,
  parseYaml,
  referenceDiagnosticCodes,
  referenceDiagnosticMessages,
} from '../index.js';
import { referenceSyntaxStatuses } from './domain-values.js';

describe('본문의 참조 문법과 오류 복구', /** 문자열 자료형을 확인한 본문만 추출한다. */ () => {
  it('공개 진단 상수를 조회하면 고정 코드와 한국어 문구를 반환한다', /** 공개 문자열 호환성은 구현 상수 참조와 별도로 검증한다. */ () => {
    expect(referenceDiagnosticCodes.invalidReference).toBe('invalid_reference');
    expect(referenceDiagnosticMessages.invalidReference).toBe(
      '참조 구문이 올바르지 않습니다.',
    );
  });
  it('문서 본문에 잘못된 원소와 다른 필드가 있으면 정상 본문 원소만 추출한다', /** 스키마 오류와 ID 누락은 정상 문자열을 버리지 않는다. */ () => {
    const parsed = parseYaml(
      'name: "[[제외]]"\ndefinition: "[[정의]]"\nexamples: [7, "[[예시]]", null, {definition: "[[제외]]"}]\nbody: "[[제외]]"\n',
    );
    expect(
      extractReferences(parsed).occurrences.map((item) => [
        item.fieldPath,
        item.text,
      ]),
    ).toEqual([
      [['definition'], '[[정의]]'],
      [['examples', 1], '[[예시]]'],
    ]);
  });
  it('이름과 소속이 없어도 확인한 본문에서 참조를 추출한다', /** 전체 문서의 유효성과 본문 문자열의 추출 가능성을 구분한다. */ () => {
    const result = extractReferences(parseYaml('definition: "[[대상]]"\n'));
    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences.map((item) => item.text)).toEqual(['[[대상]]']);
  });
  it.each([
    'definition: 7\nexamples: "[[제외]]"\n',
    'definition: false\ncustom: "[[제외]]"\n',
    'type: other\nbody: "[[제외]]"\n',
    'custom: "[[제외]]"\n',
    'definition: ["[[제외]]"\n',
  ])(
    '본문 자료형이나 파싱에 실패한 %s이면 참조를 추측하지 않는다',
    /** 잘못된 값을 문자열로 변환하지 않는다. */ (source) => {
      expect(extractReferences(parseYaml(source))).toEqual({
        occurrences: [],
        diagnostics: [],
      });
    },
  );
  it('백슬래시 홀짝과 콜론 이스케이프를 쓰면 리터럴을 제외하고 정확한 이름을 유지한다', /** 공백·대소문자·ID와 무관한 이름을 보정하지 않는다. */ () => {
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
  it('빈 구성과 중첩 및 미완성 참조가 있으면 앞 오류를 유지하고 다음 참조를 복구한다', /** 모든 오류에 실제 원문 범위와 동일한 책임 계층 상수를 반환한다. */ () => {
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
  it('참조를 반복 추출하면 모든 위치와 입력을 변경하지 않는다', /** 같은 표기의 반복은 별도 등장이다. */ () => {
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
  it('해석 문자열의 백슬래시 escape 개수가 홀짝이면 YAML 원문 개수로 판정하지 않는다', /** double quote의 두 원문 백슬래시는 해석값에서 하나의 리터럴 escape가 된다. */ () => {
    const source = String.raw`definition: "\\[[제외]] \\\\[[포함]]"` + '\n';
    expect(
      extractReferences(parseYaml(source)).occurrences.map((item) => item.text),
    ).toEqual(['[[포함]]']);
  });
  it('대괄호 구성 오류와 연속 참조가 있으면 오류와 다음 정상 참조를 모두 유지한다', /** 이름의 단일 대괄호와 추가 콜론을 정상으로 추측하지 않는다. */ () => {
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
  it('콜론 앞 백슬래시가 홀짝이면 첫 실제 구분자와 escape 콜론을 구별한다', /** escape 제거는 콜론에 붙은 백슬래시 하나만 제거하며 나머지는 유지한다. */ () => {
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
