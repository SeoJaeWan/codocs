import { describe, expect, it } from 'vitest';
import {
  getKeyRange,
  getPropertyRange,
  getValueRange,
  offsetToPosition,
  parseYaml,
} from './index.js';
import type { FieldPath, OffsetRange, YamlParseResult } from './index.js';

/** 확인된 범위로 원문 조각을 반환하며 없는 범위는 그대로 유지한다. */
function slice(
  result: YamlParseResult,
  range: OffsetRange | undefined,
): string | undefined {
  return range && result.source !== undefined
    ? result.source.slice(range.start, range.end)
    : undefined;
}
/** 속성의 키·값·전체 범위를 원문으로 비교한다. */
function expectSlices(
  result: YamlParseResult,
  path: FieldPath,
  expected: (string | undefined)[],
): void {
  expect([
    slice(result, getKeyRange(result, path)),
    slice(result, getValueRange(result, path)),
    slice(result, getPropertyRange(result, path)),
  ]).toEqual(expected);
}

describe('단일 YAML 매핑 파서', /** 정상 데이터와 실패 원문의 경계를 검증한다. */ () => {
  it('문서 시작과 주석을 허용하고 원문·데이터·진단을 전달한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const source = '---\n# 설명\nid: term-a\nname: "한글 😀" # 끝\n';
    const result = parseYaml(source, 'terms.yaml');
    expect(result).toMatchObject({
      success: true,
      source,
      data: { id: 'term-a', name: '한글 😀' },
      diagnostics: [],
    });
    expectSlices(
      result,
      ['name'],
      ['name', '"한글 😀"', 'name: "한글 😀" # 끝\n'],
    );
  });
  it('필수 속성을 보충하거나 자료형·ID·비유한 수를 스키마 검증하지 않는다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    expect(parseYaml('id: 7\nvalue: .inf\n')).toMatchObject({
      success: true,
      data: { id: 7, value: Infinity },
    });
    const result = parseYaml('id: wrong-id\n');
    if (!result.success) throw new Error('정상 매핑이어야 한다');
    expect(Object.hasOwn(result.data, 'name')).toBe(false);
  });
  it.each([
    ['앵커', 'a: &anchor 1\n', '&anchor'],
    ['별칭', 'a: *unknown\n', '*unknown'],
    ['병합 키', '<<: {a: 1}\n', '<<'],
    ['사용자 태그', 'a: !custom hello\n', '!custom'],
    ['복수 YAML 문서', '---\na: 1\n---\nb: 2\n', '---'],
    ['중복 매핑 키', 'name: first\nname: second\n', 'name'],
  ])(
    '%s를 원인별 오류와 실제 위치로 거부한다',
    /** 금지 구문의 실제 위치와 실패 경계를 확인한다. */ (
      cause,
      source,
      expected,
    ) => {
      const result = parseYaml(source, 'bad.yaml');
      expect(result.success).toBe(false);
      expect(result.source).toBe(source);
      expect(result).not.toHaveProperty('data');
      const issue = result.diagnostics.find(
        (item) =>
          item.code === 'unsupported_yaml_feature' &&
          item.message.includes(cause),
      );
      expect(issue).toBeDefined();
      expect(slice(result, issue?.offsetRange)).toBe(expected);
      expect(issue?.filePath).toBe('bad.yaml');
      expect(getValueRange(result, ['name'])).toBeUndefined();
    },
  );
  it('중복 키는 뒤의 키의 0 기반 좌표를 지목한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('name: first\r\nname: second\r\n');
    expect(result.diagnostics[0]).toMatchObject({
      offsetRange: { start: 13, end: 17 },
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 4 },
      },
    });
  });
  it.each(['a: [1,', 'a: "끝', 'a:\n  b: [x\n'])(
    '잘린 YAML %s는 복구 AST가 있어도 실패한다',
    /** 원문을 유지하면서 실패 계약을 확인한다. */ (source) => {
      const result = parseYaml(source);
      expect(result).toMatchObject({ success: false, source });
      expect(
        result.diagnostics.some((item) => item.code === 'invalid_yaml'),
      ).toBe(true);
      expect(result).not.toHaveProperty('data');
    },
  );
  it('잘린 flow 값의 EOF 진단은 임의 위치를 만들지 않고 끝 좌표를 보존한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('a: [😀');
    expect(result.diagnostics[0]).toMatchObject({
      offsetRange: { start: 6, end: 6 },
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
      },
    });
  });
  it.each(['', '# 주석\n', '---\n', '- a\n', 'hello', 'null'])(
    '비매핑 원문 %s를 정상 매핑으로 위장하지 않는다',
    /** 원문을 유지하면서 실패 계약을 확인한다. */ (source) => {
      expect(parseYaml(source)).toMatchObject({
        success: false,
        source,
        diagnostics: [{ code: 'invalid_yaml' }],
      });
    },
  );
  it.each([null, undefined, 1, {}, []])(
    '문자열이 아닌 외부 입력 %s는 위치 없는 오류다',
    /** 비문자열 입력의 위치 없는 진단을 확인한다. */ (input) => {
      expect(parseYaml(input)).toMatchObject({
        success: false,
        source: undefined,
        diagnostics: [
          { code: 'invalid_yaml', range: undefined, offsetRange: undefined },
        ],
      });
    },
  );
  it('표준 태그와 금지 구문처럼 보이는 문자열은 실제 구문으로 오인하지 않는다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    expect(
      parseYaml('a: !!str 1\nb: "&x *x !tag << ---"\n"<<": literal\n'),
    ).toMatchObject({
      success: true,
      data: { a: '1', b: '&x *x !tag << ---', '<<': 'literal' },
    });
  });
  it('정의된 사용자 태그도 경고 유무와 무관하게 거부한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    expect(
      parseYaml('%TAG !e! tag:example.com,2026:\n---\na: !e!thing 1\n').success,
    ).toBe(false);
  });
  it('중첩 매핑과 flow 안의 금지 구문도 거부한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    expect(parseYaml('a: [{b: &x 1}]\n').success).toBe(false);
    expect(parseYaml('a: {b: 1, b: 2}\n').diagnostics[0]?.code).toBe(
      'unsupported_yaml_feature',
    );
  });
});

describe('원문 범위와 UTF-16 좌표', /** 원문 정규화 없이 고정 기대값을 확인한다. */ () => {
  it('중첩 블록 뒤 내부 주석을 포함하되 들여쓰기 없는 독립 주석은 제외한다', /** collection 끝에 붙은 CST 주석의 실제 들여쓰기를 확인한다. */ () => {
    const result = parseYaml('a:\n  b: |\n    x\n  # 내부\n# 독립\nc: 1\n');
    expectSlices(
      result,
      ['a'],
      ['a', 'b: |\n    x\n', 'a:\n  b: |\n    x\n  # 내부\n'],
    );
    expectSlices(result, ['a', 'b'], ['b', '|\n    x\n', 'b: |\n    x\n']);
  });
  it('명시적인 표준 병합 태그 키도 거부한다', /** 표준 태그 표기 두 가지의 병합 키 거부를 확인한다. */ () => {
    expect(parseYaml('!!merge <<: {a: 1}\n').diagnostics[0]?.message).toContain(
      '병합 키',
    );
    expect(parseYaml('!<tag:yaml.org,2002:merge> <<: {a: 1}\n').success).toBe(
      false,
    );
  });
  it('첫 문서 시작이 암시적이어도 다음 문서 시작 토큰을 지목한다', /** 다음 문서의 실제 시작 범위를 비교한다. */ () => {
    const result = parseYaml('a: 1\n---\nb: 2\n');
    expect(result.diagnostics[0]?.offsetRange).toEqual({ start: 5, end: 8 });
  });
  it('따옴표 escape의 실제 값과 원문을 분리한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml("a: \"줄\\n다음\"\nb: 'it''s'\n");
    expect(result).toMatchObject({
      success: true,
      data: { a: '줄\n다음', b: "it's" },
    });
    expectSlices(result, ['a'], ['a', '"줄\\n다음"', 'a: "줄\\n다음"\n']);
    expectSlices(result, ['b'], ['b', "'it''s'", "b: 'it''s'\n"]);
  });
  it.each([
    ['|', '첫째\n둘째\n'],
    ['|-', '첫째\n둘째'],
    ['|+', '첫째\n둘째\n\n'],
    ['>', '첫째 둘째\n'],
  ])(
    '블록 %s의 실제 값과 끝 개행을 정확히 보존한다',
    /** 블록 값과 개행의 고정 기대값을 비교한다. */ (header, expected) => {
      const source = `a: ${header}\n  첫째\n  둘째\n\nb: 1\n`;
      const result = parseYaml(source);
      expect(result).toMatchObject({ success: true, data: { a: expected } });
      const block =
        header === '|+'
          ? `${header}\n  첫째\n  둘째\n\n`
          : `${header}\n  첫째\n  둘째\n`;
      expectSlices(result, ['a'], ['a', block, 'a: ' + block]);
    },
  );
  it('중첩 속성 전체에는 내부 주석을 포함하고 다음 독립 주석은 제외한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('# 앞\na:\n  # 안\n  b: x # 옆\n# 다음\nc: 1\n');
    expectSlices(
      result,
      ['a'],
      ['a', 'b: x # 옆\n', 'a:\n  # 안\n  b: x # 옆\n'],
    );
    expectSlices(result, ['a', 'b'], ['b', 'x', 'b: x # 옆\n']);
    expectSlices(result, ['c'], ['c', '1', 'c: 1\n']);
    expectSlices(result, ['missing'], [undefined, undefined, undefined]);
  });
  it('flow의 중첩 배열·객체 범위에는 주변 쉼표를 넣지 않는다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('a: [{b: "값", c: [1, 2]}]\n');
    expectSlices(result, ['a', 0, 'b'], ['b', '"값"', 'b: "값"']);
    expectSlices(result, ['a', 0, 'c'], ['c', '[1, 2]', 'c: [1, 2]']);
    expectSlices(result, ['a', 0, 'c', 1], [undefined, '2', undefined]);
  });
  it('flow의 같은 줄 주석과 다음 독립 주석의 CST 소유 범위를 구분한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('{a: 1, # 같은 줄\n # 독립\n b: 2 # 값 옆\n}\n');
    expectSlices(result, ['a'], ['a', '1', 'a: 1, # 같은 줄\n']);
    expectSlices(result, ['b'], ['b', '2', 'b: 2 # 값 옆\n']);
  });
  it('빈 값은 확인된 0 길이 범위이고 전체에는 주석을 포함한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('a: # 빈 값\nb: null\n');
    expectSlices(result, ['a'], ['a', '', 'a: # 빈 값\n']);
  });
  it('LF·CRLF·한글·이모지·EOF는 고정 UTF-16 offset과 좌표다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const source = '한: 😀\r\n끝: x\n';
    const result = parseYaml(source);
    expect(getValueRange(result, ['한'])).toEqual({ start: 3, end: 5 });
    expect(getKeyRange(result, ['끝'])).toEqual({ start: 7, end: 8 });
    expect(getPropertyRange(result, ['한'])).toEqual({ start: 0, end: 7 });
    expect(offsetToPosition(source, 4)).toEqual({ line: 0, character: 4 });
    expect(offsetToPosition(source, 6)).toEqual({ line: 0, character: 6 });
    expect(offsetToPosition(source, 7)).toEqual({ line: 1, character: 0 });
    expect(offsetToPosition(source, 12)).toEqual({ line: 2, character: 0 });
    for (const offset of [-1, 13, 0.5, NaN])
      expect(offsetToPosition(source, offset)).toBeUndefined();
  });
  it('CRLF 블록의 실제 줄바꿈 값과 원문 범위는 각각 보존한다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('a: |\r\n  한😀\r\nb: 1\r\n');
    expect(result).toMatchObject({ success: true, data: { a: '한😀\n' } });
    expectSlices(result, ['a'], ['a', '|\r\n  한😀\r\n', 'a: |\r\n  한😀\r\n']);
  });
  it('경로 문자열 안의 점은 구분자가 아니라 실제 키다', /** 해당 입력의 데이터와 원문 위치 계약을 확인한다. */ () => {
    const result = parseYaml('"a.b": {"0": x}\n');
    expect(slice(result, getValueRange(result, ['a.b', '0']))).toBe('x');
    expect(getValueRange(result, ['a', 'b'])).toBeUndefined();
  });
});
