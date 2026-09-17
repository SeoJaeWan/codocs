/* eslint-disable codocs/korean-jsdoc -- Vitest의 인라인 콜백은 선언 함수가 아니다. */
import { describe, expect, it } from 'vitest';
import {
  getStringMapping,
  getStringRange,
  parseYaml,
} from '../parser/index.js';
import { referenceSyntaxStatuses } from '../references/domain-values.js';
import { extractReferences } from '../references/index.js';

describe('getStringMapping: 확인된 문자열의 원문 위치 조회', () => {
  it('문자열 필드의 매핑을 조회하면 해석값과 코드 단위별 원문 범위를 반환한다', () => {
    const parsed = {
      success: true as const,
      source: 'definition: "abc"\n',
      data: { definition: 'abc' },
      fields: [],
      strings: [
        {
          fieldPath: ['definition'],
          value: 'abc',
          sourceRanges: [
            { start: 13, end: 14 },
            { start: 14, end: 15 },
            { start: 15, end: 16 },
          ],
        },
      ],
      diagnostics: [],
    };
    expect(getStringMapping(parsed, ['definition'])).toEqual(parsed.strings[0]);
  });

  it('매핑되지 않은 필드를 조회하면 위치를 반환하지 않는다', () => {
    const parsed = {
      success: true as const,
      source: 'definition: 7\n',
      data: { definition: 7 },
      fields: [],
      strings: [],
      diagnostics: [],
    };
    expect(getStringMapping(parsed, ['definition'])).toBeUndefined();
  });
});

describe('getStringRange: 해석 문자열 범위의 원문 위치 조회', () => {
  it('해석 문자열의 일부를 조회하면 대응하는 원문 범위를 반환한다', () => {
    const parsed = {
      success: true as const,
      source: 'definition: "abc"\n',
      data: { definition: 'abc' },
      fields: [],
      strings: [
        {
          fieldPath: ['definition'],
          value: 'abc',
          sourceRanges: [
            { start: 13, end: 14 },
            { start: 14, end: 15 },
            { start: 15, end: 16 },
          ],
        },
      ],
      diagnostics: [],
    };
    expect(
      getStringRange(parsed, ['definition'], { start: 1, end: 3 }),
    ).toEqual({ start: 14, end: 16 });
  });
});

describe('parseYaml과 getStringMapping: YAML 표기별 문자열 위치 연결', () => {
  it.each([
    [
      'plain',
      'definition: 앞 😀 [[이름]] 뒤\n',
      '앞 😀 [[이름]] 뒤',
      '[[이름]]',
      17,
      23,
    ],
    [
      'single',
      "definition: 'it''s 😀 [[이름]]'\n",
      "it's 😀 [[이름]]",
      '[[이름]]',
      22,
      28,
    ],
    [
      'double escape',
      String.raw`definition: "\U0001f600 \u005b\u005b이름\u005d\u005d"` + '\n',
      '😀 [[이름]]',
      String.raw`\u005b\u005b이름\u005d\u005d`,
      24,
      50,
    ],
    [
      'folded',
      'definition: >-\n  앞\n  [[이름]]\n  뒤\n',
      '앞 [[이름]] 뒤',
      '[[이름]]',
      21,
      27,
    ],
    [
      'literal',
      'definition: |\r\n  앞😀\r\n  [[이름]]\r\n',
      '앞😀\n[[이름]]\n',
      '[[이름]]',
      24,
      30,
    ],
    [
      'multiline plain',
      'definition: 앞\n  [[이름]]\n  뒤\n',
      '앞 [[이름]] 뒤',
      '[[이름]]',
      16,
      22,
    ],
    [
      'multiline single',
      "definition: '앞\n  [[이름]]\n  뒤'\n",
      '앞 [[이름]] 뒤',
      '[[이름]]',
      17,
      23,
    ],
    [
      'escaped newline',
      'definition: "앞\\\r\n  [[이름]]"\r\n',
      '앞[[이름]]',
      '[[이름]]',
      19,
      25,
    ],
    [
      'explicit indent',
      'definition: >2- # 설명\n  앞\n    [[이름]]\n  뒤\n',
      '앞\n  [[이름]]\n뒤',
      '[[이름]]',
      29,
      35,
    ],
  ])(
    '%s 문자열을 해석하면 원문 표기와 실제 위치를 유지한다',
    /** 매핑 재구성은 AST 문자열과 같고 참조의 시작·끝은 고정 원문 offset이다. */ (
      _label,
      body,
      value,
      raw,
      start,
      end,
    ) => {
      const source = body;
      const parsed = parseYaml(source);
      expect(parsed.success).toBe(true);
      const mapping = getStringMapping(parsed, ['definition']);
      expect(mapping?.value).toBe(value);
      expect(mapping?.sourceRanges).toHaveLength(value.length);
      const item = extractReferences(parsed).occurrences[0];
      expect(item?.offsetRange).toEqual({ start, end });
      expect(
        item && source.slice(item.offsetRange.start, item.offsetRange.end),
      ).toBe(raw);
      expect(
        getStringRange(parsed, ['definition'], {
          start: value.indexOf('[['),
          end: value.indexOf('[[') + 6,
        }),
      ).toEqual({ start, end });
    },
  );
  it.each(['|', '|-', '|+', '>', '>-', '>+'])(
    '블록 %s에 빈 줄과 추가 들여쓰기가 있으면 해석값과 모든 참조 위치를 유지한다',
    /** chomping과 들여쓰기 변환 뒤에도 반복 참조를 각각 원문 위치로 반환한다. */ (
      header,
    ) => {
      const source = `definition: ${header}\r\n  \r\n  [[첫째]]\r\n\r\n    [[둘째]]\r\n  [[셋째]]\r\n\r\n`;
      const parsed = parseYaml(source);
      expect(parsed.success).toBe(true);
      const mapping = getStringMapping(parsed, ['definition']);
      if (!parsed.success) throw new Error('파싱 성공이어야 한다');
      expect(mapping?.value).toBe(parsed.data.definition);
      expect(
        extractReferences(parsed).occurrences.map((item) =>
          source.slice(item.offsetRange.start, item.offsetRange.end),
        ),
      ).toEqual(['[[첫째]]', '[[둘째]]', '[[셋째]]']);
    },
  );
  it('파싱에 실패한 원문을 조회하면 문자열 매핑을 반환하지 않는다', () => {
    const parsed = {
      success: false as const,
      source: 'definition: "끝',
      diagnostics: [],
    };
    expect(getStringMapping(parsed, ['definition'])).toBeUndefined();
  });

  it.each([
    ['음수 시작점', { start: -1, end: 1 }],
    ['문자열 길이를 넘는 끝점', { start: 0, end: 4 }],
    ['역순 범위', { start: 2, end: 1 }],
    ['소수 시작점', { start: 0.5, end: 1 }],
  ])('%s을 조회하면 원문 위치를 반환하지 않는다', (_condition, range) => {
    const parsed = {
      success: true as const,
      source: 'name: "abc"\n',
      data: { name: 'abc' },
      fields: [],
      strings: [
        {
          fieldPath: ['name'],
          value: 'abc',
          sourceRanges: [
            { start: 7, end: 8 },
            { start: 8, end: 9 },
            { start: 9, end: 10 },
          ],
        },
      ],
      diagnostics: [],
    };
    expect(getStringRange(parsed, ['name'], range)).toBeUndefined();
  });
  it.each([
    ['plain LF', 'definition: 앞  \n  \n  [[이름]]  \n  뒤\n'],
    ['single CRLF', "definition: '앞  \r\n  \r\n  [[이름]]  \r\n  뒤'\r\n"],
    ['double LF', 'definition: "앞  \n  \n  [[이름]]  \n  뒤"\n'],
    ['double CRLF', 'definition: "앞  \r\n  \r\n  [[이름]]  \r\n  뒤"\r\n'],
    ['single apostrophes', "definition: 'it''''s [[이름]]'\n"],
    [
      'double controls',
      String.raw`definition: "\0\a\b\e\f\n\r\t\v\N\_\L\P\ \"\/\\ \x5b\u005b이름]]"` +
        '\n',
    ],
    ['EOF literal', 'definition: |\n  [[이름]]'],
    ['EOF folded', 'definition: >\n  [[이름]]'],
    ['empty literal', 'definition: |\n'],
    ['empty keep', 'definition: |+\n  \n  \n'],
    ['empty folded keep', 'definition: >+\r\n  \r\n  \r\n'],
    ['folded tab', 'definition: >-\n  앞\n  \t[[이름]]\n  뒤\n'],
    ['more indented trailing', 'definition: >+\n  [[이름]]\n    \n  \n'],
    ['explicit leading blanks', 'definition: |2-\n    \n  [[이름]]\n'],
    ['header comment CRLF', 'definition: >- # 😀 주석\r\n  [[이름]]\r\n'],
  ])(
    '%s의 변환 문자가 있으면 전체 매핑이 AST 해석값과 일치한다',
    /** 줄 접기와 escape·EOF·빈 블록에서도 확인된 전체 매핑을 제공한다. */ (
      _label,
      body,
    ) => {
      const source = body;
      const parsed = parseYaml(source);
      if (!parsed.success) throw new Error('정상 스칼라이어야 한다');
      const mapping = getStringMapping(parsed, ['definition']);
      expect(mapping?.value).toBe(parsed.data.definition);
      expect(mapping?.sourceRanges).toHaveLength(
        String(parsed.data.definition).length,
      );
      if (body.includes('이름'))
        expect(
          extractReferences(parsed).occurrences.map(
            (item) =>
              item.syntax === referenceSyntaxStatuses.valid && item.name,
          ),
        ).toEqual(['이름']);
    },
  );
  it('Unicode escape와 작은따옴표가 문자를 생성하면 각 해석 코드 단위에 전체 원문 기여 범위를 제공한다', /** 이모지 두 코드 단위와 escape 대괄호는 실제 escape 구간을 공유한다. */ () => {
    const source =
      String.raw`definition: "\U0001f600 \u005b\u005bA]]"` +
      "\nname: 'it''s'\n";
    const parsed = parseYaml(source);
    expect(
      getStringMapping(parsed, ['definition'])?.sourceRanges.slice(0, 5),
    ).toEqual([
      { start: 13, end: 23 },
      { start: 13, end: 23 },
      { start: 23, end: 24 },
      { start: 24, end: 30 },
      { start: 30, end: 36 },
    ]);
    expect(getStringRange(parsed, ['name'], { start: 2, end: 3 })).toEqual({
      start: 50,
      end: 52,
    });
  });
  it('조회한 매핑 복사본을 변경하면 파싱 결과의 위치를 변경하지 않는다', /** 반환 복사본은 입력 매핑 객체를 재사용하지 않는다. */ () => {
    const parsed = parseYaml('definition: "abc"\n');
    const mapping = getStringMapping(parsed, ['definition']);
    if (!mapping?.sourceRanges[0]) throw new Error('매핑이 있어야 한다');
    mapping.sourceRanges[0].start = 0;
    expect(
      getStringRange(parsed, ['definition'], { start: 0, end: 1 }),
    ).toEqual({
      start: 13,
      end: 14,
    });
  });
  it.each(['plain', 'single', 'literal', 'folded'])(
    '%s의 긴 본문을 추출하면 인수 개수 상한 없이 마지막 위치를 유지한다',
    /** 대량 코드 단위를 배열 인수로 확장하지 않는다. */ (mode) => {
      const prefix = 'a'.repeat(150_000);
      const value = prefix + ' [[이름]]';
      const body =
        mode === 'plain'
          ? `definition: ${value}\n`
          : mode === 'single'
            ? `definition: '${value}'\n`
            : `definition: ${mode === 'literal' ? '|' : '>'}-\n  ${value}\n`;
      const parsed = parseYaml(body);
      expect(getStringMapping(parsed, ['definition'])?.value).toBe(value);
      expect(extractReferences(parsed).occurrences[0]?.text).toBe('[[이름]]');
    },
  );
  it.each(['|', '|-', '|+', '>', '>-', '>+'])(
    '블록 %s의 EOF 공백을 해석하면 모든 문자열 코드 단위를 매핑한다',
    /** 실제 끝 개행이 없고 공백만 있는 블록도 확인된 해석값을 유지한다. */ (
      header,
    ) => {
      for (const content of [
        '  ',
        '  \n  ',
        '  [[이름]]\n    ',
        '  [[이름]]\n    \n   ',
      ]) {
        const source = `definition: ${header}\n${content}`;
        const parsed = parseYaml(source);
        if (!parsed.success) throw new Error('정상 블록이어야 한다');
        expect(getStringMapping(parsed, ['definition'])?.value).toBe(
          parsed.data.definition,
        );
        expect(
          getStringMapping(parsed, ['definition'])?.sourceRanges.length,
        ).toBe(String(parsed.data.definition).length);
        if (content.includes('이름'))
          expect(
            extractReferences(parsed).occurrences.map((item) => item.text),
          ).toEqual(['[[이름]]']);
      }
    },
  );
});
