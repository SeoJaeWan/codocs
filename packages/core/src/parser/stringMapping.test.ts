import { describe, expect, it } from 'vitest';
import {
  extractReferences,
  getStringMapping,
  getStringRange,
  parseYaml,
} from '../index.js';

describe('해석 문자열의 실제 YAML 원문 매핑', /** 해석 offset을 원문에 단순 가산하지 않고 실제 토큰 구간을 확인한다. */ () => {
  it.each([
    [
      'plain',
      'body: 앞 😀 [[이름]] 뒤\n',
      '앞 😀 [[이름]] 뒤',
      '[[이름]]',
      27,
      33,
    ],
    [
      'single',
      "body: 'it''s 😀 [[이름]]'\n",
      "it's 😀 [[이름]]",
      '[[이름]]',
      32,
      38,
    ],
    [
      'double escape',
      String.raw`body: "\U0001f600 \u005b\u005b이름\u005d\u005d"` + '\n',
      '😀 [[이름]]',
      String.raw`\u005b\u005b이름\u005d\u005d`,
      34,
      60,
    ],
    [
      'folded',
      'body: >-\n  앞\n  [[이름]]\n  뒤\n',
      '앞 [[이름]] 뒤',
      '[[이름]]',
      31,
      37,
    ],
    [
      'literal',
      'body: |\r\n  앞😀\r\n  [[이름]]\r\n',
      '앞😀\n[[이름]]\n',
      '[[이름]]',
      34,
      40,
    ],
    [
      'multiline plain',
      'body: 앞\n  [[이름]]\n  뒤\n',
      '앞 [[이름]] 뒤',
      '[[이름]]',
      26,
      32,
    ],
    [
      'multiline single',
      "body: '앞\n  [[이름]]\n  뒤'\n",
      '앞 [[이름]] 뒤',
      '[[이름]]',
      27,
      33,
    ],
    [
      'escaped newline',
      'body: "앞\\\r\n  [[이름]]"\r\n',
      '앞[[이름]]',
      '[[이름]]',
      29,
      35,
    ],
    [
      'explicit indent',
      'body: >2- # 설명\n  앞\n    [[이름]]\n  뒤\n',
      '앞\n  [[이름]]\n뒤',
      '[[이름]]',
      39,
      45,
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
      const source = 'type: knowledge\n' + body;
      const parsed = parseYaml(source);
      expect(parsed.success).toBe(true);
      const mapping = getStringMapping(parsed, ['body']);
      expect(mapping?.value).toBe(value);
      expect(mapping?.sourceRanges).toHaveLength(value.length);
      const item = extractReferences(parsed).occurrences[0];
      expect(item?.offsetRange).toEqual({ start, end });
      expect(
        item && source.slice(item.offsetRange.start, item.offsetRange.end),
      ).toBe(raw);
      expect(
        getStringRange(parsed, ['body'], {
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
      const source = `type: knowledge\r\nbody: ${header}\r\n  \r\n  [[첫째]]\r\n\r\n    [[둘째]]\r\n  [[셋째]]\r\n\r\n`;
      const parsed = parseYaml(source);
      expect(parsed.success).toBe(true);
      const mapping = getStringMapping(parsed, ['body']);
      if (!parsed.success) throw new Error('파싱 성공이어야 한다');
      expect(mapping?.value).toBe(parsed.data.body);
      expect(
        extractReferences(parsed).occurrences.map((item) =>
          source.slice(item.offsetRange.start, item.offsetRange.end),
        ),
      ).toEqual(['[[첫째]]', '[[둘째]]', '[[셋째]]']);
    },
  );
  it('실패·비문자열·잘못된 해석 범위를 조회하면 확인하지 않은 위치를 제공하지 않는다', /** 기존 값 범위를 문자열 위치로 대체하지 않는다. */ () => {
    const parsed = parseYaml('body: 7\nname: "abc"\n');
    expect(getStringMapping(parsed, ['body'])).toBeUndefined();
    expect(getStringMapping(parseYaml('body: "끝'), ['body'])).toBeUndefined();
    for (const range of [
      { start: -1, end: 1 },
      { start: 0, end: 4 },
      { start: 2, end: 1 },
      { start: 0.5, end: 1 },
    ])
      expect(getStringRange(parsed, ['name'], range)).toBeUndefined();
  });
  it.each([
    ['plain LF', 'body: 앞  \n  \n  [[이름]]  \n  뒤\n'],
    ['single CRLF', "body: '앞  \r\n  \r\n  [[이름]]  \r\n  뒤'\r\n"],
    ['double LF', 'body: "앞  \n  \n  [[이름]]  \n  뒤"\n'],
    ['double CRLF', 'body: "앞  \r\n  \r\n  [[이름]]  \r\n  뒤"\r\n'],
    ['single apostrophes', "body: 'it''''s [[이름]]'\n"],
    [
      'double controls',
      String.raw`body: "\0\a\b\e\f\n\r\t\v\N\_\L\P\ \"\/\\ \x5b\u005b이름]]"` +
        '\n',
    ],
    ['EOF literal', 'body: |\n  [[이름]]'],
    ['EOF folded', 'body: >\n  [[이름]]'],
    ['empty literal', 'body: |\n'],
    ['empty keep', 'body: |+\n  \n  \n'],
    ['empty folded keep', 'body: >+\r\n  \r\n  \r\n'],
    ['folded tab', 'body: >-\n  앞\n  \t[[이름]]\n  뒤\n'],
    ['more indented trailing', 'body: >+\n  [[이름]]\n    \n  \n'],
    ['explicit leading blanks', 'body: |2-\n    \n  [[이름]]\n'],
    ['header comment CRLF', 'body: >- # 😀 주석\r\n  [[이름]]\r\n'],
  ])(
    '%s의 변환 문자가 있으면 전체 매핑이 AST 해석값과 일치한다',
    /** 줄 접기와 escape·EOF·빈 블록에서도 확인된 전체 매핑을 제공한다. */ (
      _label,
      body,
    ) => {
      const source = 'type: knowledge\n' + body;
      const parsed = parseYaml(source);
      if (!parsed.success) throw new Error('정상 스칼라이어야 한다');
      const mapping = getStringMapping(parsed, ['body']);
      expect(mapping?.value).toBe(parsed.data.body);
      expect(mapping?.sourceRanges).toHaveLength(
        String(parsed.data.body).length,
      );
      if (body.includes('이름'))
        expect(
          extractReferences(parsed).occurrences.map(
            (item) => item.syntax === 'valid' && item.name,
          ),
        ).toEqual(['이름']);
    },
  );
  it('Unicode escape와 작은따옴표가 문자를 생성하면 각 해석 코드 단위에 전체 원문 기여 범위를 제공한다', /** 이모지 두 코드 단위와 escape 대괄호는 실제 escape 구간을 공유한다. */ () => {
    const source =
      String.raw`body: "\U0001f600 \u005b\u005bA]]"` + "\nname: 'it''s'\n";
    const parsed = parseYaml(source);
    expect(
      getStringMapping(parsed, ['body'])?.sourceRanges.slice(0, 5),
    ).toEqual([
      { start: 7, end: 17 },
      { start: 7, end: 17 },
      { start: 17, end: 18 },
      { start: 18, end: 24 },
      { start: 24, end: 30 },
    ]);
    expect(getStringRange(parsed, ['name'], { start: 2, end: 3 })).toEqual({
      start: 44,
      end: 46,
    });
  });
  it('조회한 매핑 복사본을 변경하면 파싱 결과의 위치를 변경하지 않는다', /** 반환 복사본은 입력 매핑 객체를 재사용하지 않는다. */ () => {
    const parsed = parseYaml('body: "abc"\n');
    const mapping = getStringMapping(parsed, ['body']);
    if (!mapping?.sourceRanges[0]) throw new Error('매핑이 있어야 한다');
    mapping.sourceRanges[0].start = 0;
    expect(getStringRange(parsed, ['body'], { start: 0, end: 1 })).toEqual({
      start: 7,
      end: 8,
    });
  });
  it.each(['plain', 'single', 'literal', 'folded'])(
    '%s의 긴 본문을 추출하면 인수 개수 상한 없이 마지막 위치를 유지한다',
    /** 대량 코드 단위를 배열 인수로 확장하지 않는다. */ (mode) => {
      const prefix = 'a'.repeat(150_000);
      const value = prefix + ' [[이름]]';
      const body =
        mode === 'plain'
          ? `body: ${value}\n`
          : mode === 'single'
            ? `body: '${value}'\n`
            : `body: ${mode === 'literal' ? '|' : '>'}-\n  ${value}\n`;
      const parsed = parseYaml('type: knowledge\n' + body);
      expect(getStringMapping(parsed, ['body'])?.value).toBe(value);
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
        const source = `type: knowledge\nbody: ${header}\n${content}`;
        const parsed = parseYaml(source);
        if (!parsed.success) throw new Error('정상 블록이어야 한다');
        expect(getStringMapping(parsed, ['body'])?.value).toBe(
          parsed.data.body,
        );
        expect(getStringMapping(parsed, ['body'])?.sourceRanges.length).toBe(
          String(parsed.data.body).length,
        );
        if (content.includes('이름'))
          expect(
            extractReferences(parsed).occurrences.map((item) => item.text),
          ).toEqual(['[[이름]]']);
      }
    },
  );
});
