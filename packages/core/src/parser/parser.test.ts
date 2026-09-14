import { describe, expect, it } from 'vitest';
import {
  getKeyRange,
  getPropertyRange,
  getValueRange,
  offsetToPosition,
  parseYaml,
  yamlDiagnosticCodes,
} from '../index.js';
import type { FieldPath, OffsetRange, YamlParseResult } from '../index.js';

/** 위치 범위가 있으면 원문을 잘라 반환하고, 원문이나 범위가 없으면 undefined를 반환한다. */
function slice(
  result: YamlParseResult,
  range: OffsetRange | undefined,
): string | undefined {
  return range && result.source !== undefined
    ? result.source.slice(range.start, range.end)
    : undefined;
}
/** 주어진 경로의 키, 값, 속성 전체를 원문에서 잘라 이 순서의 기대 문자열과 비교한다. */
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

describe('단일 YAML 매핑의 허용 구문과 오류 처리', /** 허용하는 입력의 해석 결과와 거부하는 입력의 진단·원문 보존을 확인한다. */ () => {
  it('매핑에 문서 시작 표시와 주석이 있으면 값을 해석하고 원문 범위를 보존한다', /** name의 값은 문자열로 해석하고, 원문 범위에는 따옴표와 같은 줄 주석을 각각 보존한다. */ () => {
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
  it('스키마에 맞지 않는 값이 있어도 YAML을 해석하고 누락된 속성을 추가하지 않는다', /** 파서는 YAML 값을 해석하며, 필수 속성·자료형·ID 형식 검사는 후속 스키마 검증에 맡긴다. */ () => {
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
    '%s가 있으면 unsupported_yaml_feature와 해당 구문의 위치를 반환한다',
    /** 오류 코드는 원인별 메시지·위치와 함께 반환한다. 실패해도 원문과 파일 경로는 보존하며 데이터와 필드 범위는 제공하지 않는다. */ (
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
          item.code === yamlDiagnosticCodes.unsupportedYamlFeature &&
          item.message.includes(cause),
      );
      expect(issue).toBeDefined();
      expect(slice(result, issue?.offsetRange)).toBe(expected);
      expect(issue?.filePath).toBe('bad.yaml');
      expect(getValueRange(result, ['name'])).toBeUndefined();
    },
  );
  it('중복 키가 있으면 두 번째 키 위치를 진단한다', /** CRLF 입력의 두 번째 줄 name은 원문 offset 13부터 17 직전까지다. 줄·문자 번호를 0부터 세므로 좌표는 (1, 0)부터 (1, 4) 직전까지다. */ () => {
    const result = parseYaml('name: first\r\nname: second\r\n');
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: yamlDiagnosticCodes.unsupportedYamlFeature,
      offsetRange: { start: 13, end: 17 },
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 4 },
      },
    });
  });
  it.each(['a: [1,', 'a: "끝', 'a:\n  b: [x\n'])(
    'YAML %s에 닫는 괄호나 따옴표가 없으면 invalid_yaml을 반환한다',
    /** YAML 라이브러리가 불완전한 입력에서 일부 구조를 복구하더라도 파싱 성공으로 처리하지 않는다. */ (
      source,
    ) => {
      const result = parseYaml(source);
      expect(result).toMatchObject({ success: false, source });
      expect(
        result.diagnostics.some(
          (item) => item.code === yamlDiagnosticCodes.invalidYaml,
        ),
      ).toBe(true);
      expect(result).not.toHaveProperty('data');
    },
  );
  it('닫는 대괄호 없이 원문이 끝나면 원문 끝을 문법 오류 위치로 진단한다', /** a: [😀의 끝은 UTF-16 offset 6이다. 누락된 문자의 위치를 나타내도록 시작과 끝이 모두 6인 범위와 좌표를 반환한다. */ () => {
    const result = parseYaml('a: [😀');
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: yamlDiagnosticCodes.invalidYaml,
      offsetRange: { start: 6, end: 6 },
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
      },
    });
  });
  it.each(['', '# 주석\n', '---\n', '- a\n', 'hello', 'null'])(
    '입력 %s에 최상위 매핑이 없으면 invalid_yaml을 반환한다',
    /** 빈 문서·주석만 있는 문서·배열·스칼라는 모두 실패하며, 빈 객체로 변환해 성공시키지 않는다. */ (
      source,
    ) => {
      expect(parseYaml(source)).toMatchObject({
        success: false,
        source,
        diagnostics: [{ code: yamlDiagnosticCodes.invalidYaml }],
      });
    },
  );
  it.each([null, undefined, 1, {}, []])(
    '입력 %s가 문자열이 아니면 위치 없는 invalid_yaml을 반환한다',
    /** null·undefined·숫자·객체·배열에는 YAML 원문이 없으므로 원문과 두 위치 범위 모두 undefined다. */ (
      input,
    ) => {
      expect(parseYaml(input)).toMatchObject({
        success: false,
        source: undefined,
        diagnostics: [
          {
            code: yamlDiagnosticCodes.invalidYaml,
            range: undefined,
            offsetRange: undefined,
          },
        ],
      });
    },
  );
  it('표준 문자열 태그나 따옴표 안의 YAML 기호가 있으면 오류 없이 값을 해석한다', /** !!str은 숫자 표기를 문자열로 해석한다. 따옴표 안의 기호와 키는 앵커·별칭·태그·병합·문서 구문으로 처리하지 않는다. */ () => {
    expect(
      parseYaml('a: !!str 1\nb: "&x *x !tag << ---"\n"<<": literal\n'),
    ).toMatchObject({
      success: true,
      data: { a: '1', b: '&x *x !tag << ---', '<<': 'literal' },
      diagnostics: [],
    });
  });
  it('사용자 태그의 접두사를 선언해도 태그를 사용하면 unsupported_yaml_feature를 반환한다', /** %TAG로 !e! 접두사를 선언한 경우에도 !e!thing 사용은 지원하지 않는 사용자 태그로 진단한다. */ () => {
    const result = parseYaml(
      '%TAG !e! tag:example.com,2026:\n---\na: !e!thing 1\n',
    );
    expect(result.success).toBe(false);
    const issue = result.diagnostics.find((item) =>
      item.message.includes('사용자 태그'),
    );
    expect(issue).toMatchObject({
      code: yamlDiagnosticCodes.unsupportedYamlFeature,
    });
  });
  it.each([
    ['앵커', 'a: [{b: &x 1}]\n', '&x'],
    ['중복 매핑 키', 'a: {b: 1, b: 2}\n', 'b'],
  ])(
    '중첩된 flow 구조 안에 %s가 있으면 unsupported_yaml_feature를 반환한다',
    /** 중첩 매핑과 flow 표기 자체는 허용한다. 배열 안 객체의 &x와 객체 안에서 두 번째로 등장하는 b가 각각 오류의 원인이다. */ (
      cause,
      source,
      expected,
    ) => {
      const result = parseYaml(source);
      expect(result.success).toBe(false);
      const issue = result.diagnostics.find((item) =>
        item.message.includes(cause),
      );
      expect(issue).toMatchObject({
        code: yamlDiagnosticCodes.unsupportedYamlFeature,
      });
      expect(slice(result, issue?.offsetRange)).toBe(expected);
    },
  );
});

describe('키·값·속성의 원문 범위와 UTF-16 좌표', /** 실제로 잘라낸 원문과 고정 좌표를 비교해 주석·따옴표·개행의 포함 범위를 확인한다. */ () => {
  it('블록 문자열 뒤에 들여쓴 주석이 있으면 부모 속성의 전체 범위에 포함한다', /** 두 칸 들여쓴 # 내부는 a에 포함하고 블록 속성 b에는 포함하지 않는다. 들여쓰기가 없는 # 독립은 두 속성 모두에서 제외한다. */ () => {
    const result = parseYaml('a:\n  b: |\n    x\n  # 내부\n# 독립\nc: 1\n');
    expectSlices(
      result,
      ['a'],
      ['a', 'b: |\n    x\n', 'a:\n  b: |\n    x\n  # 내부\n'],
    );
    expectSlices(result, ['a', 'b'], ['b', '|\n    x\n', 'b: |\n    x\n']);
  });
  it.each(['!!merge', '!<tag:yaml.org,2002:merge>'])(
    '<< 키에 표준 병합 태그 %s를 붙이면 unsupported_yaml_feature를 반환한다',
    /** 표준 태그라도 병합 키를 나타내는 !!merge와 전체 URI 표기는 지원하지 않는 병합 기능으로 진단한다. */ (
      tag,
    ) => {
      const result = parseYaml(`${tag} <<: {a: 1}\n`);
      expect(result.success).toBe(false);
      const issue = result.diagnostics.find((item) =>
        item.message.includes('병합 키'),
      );
      expect(issue).toMatchObject({
        code: yamlDiagnosticCodes.unsupportedYamlFeature,
      });
    },
  );
  it('문서 중간에 ---가 있으면 두 번째 문서의 시작 위치를 진단한다', /** a: 1 다음 줄의 ---는 원문 offset 5부터 8 직전까지이며, 복수 문서 오류가 이 표시를 가리킨다. */ () => {
    const result = parseYaml('a: 1\n---\nb: 2\n');
    expect(result.success).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: yamlDiagnosticCodes.unsupportedYamlFeature,
      offsetRange: { start: 5, end: 8 },
    });
  });
  it('따옴표 안에 이스케이프가 있으면 값을 해석하고 원문 표기를 보존한다', /** 큰따옴표의 역슬래시 n은 실제 개행으로, 작은따옴표 두 개는 하나로 해석한다. 값·속성 범위에는 원래 따옴표와 이스케이프 표기가 남는다. */ () => {
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
    '블록 헤더가 %s이면 해당 규칙으로 줄바꿈을 해석하고 원문 범위를 보존한다',
    /** |는 끝 개행 하나, |-는 끝 개행 없음, |+는 빈 줄까지 유지한다. >는 본문 두 줄을 공백으로 연결한다. 해석한 값과 원문의 헤더·줄바꿈 범위를 따로 비교한다. */ (
      header,
      expected,
    ) => {
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
  it('속성 안팎에 주석이 있으면 내부 주석만 속성의 전체 범위에 포함한다', /** a에는 # 안과 b 옆의 # 옆을 포함하고 # 앞·# 다음은 제외한다. b의 값은 x만 포함하며, 없는 경로의 범위는 모두 undefined다. */ () => {
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
  it('중첩 배열과 객체를 flow 표기로 쓰면 값을 읽고 각 속성 범위에서 주변 쉼표를 제외한다', /** b와 c의 전체 범위는 각 속성만 포함한다. 배열의 두 번째 항목은 값 2의 범위만 있고 키·속성 전체 범위는 없다. */ () => {
    const result = parseYaml('a: [{b: "값", c: [1, 2]}]\n');
    expectSlices(result, ['a', 0, 'b'], ['b', '"값"', 'b: "값"']);
    expectSlices(result, ['a', 0, 'c'], ['c', '[1, 2]', 'c: [1, 2]']);
    expectSlices(result, ['a', 0, 'c', 1], [undefined, '2', undefined]);
  });
  it('flow 속성 뒤에 주석이 있으면 같은 줄 주석만 전체 범위에 포함한다', /** a는 쉼표 뒤 # 같은 줄까지, b는 # 값 옆까지 포함한다. 다음 줄의 # 독립은 제외하며, 각 값 범위에는 숫자만 포함한다. */ () => {
    const result = parseYaml('{a: 1, # 같은 줄\n # 독립\n b: 2 # 값 옆\n}\n');
    expectSlices(result, ['a'], ['a', '1', 'a: 1, # 같은 줄\n']);
    expectSlices(result, ['b'], ['b', '2', 'b: 2 # 값 옆\n']);
  });
  it('속성에 값 없이 주석만 있으면 빈 값 범위와 주석을 포함한 전체 범위를 반환한다', /** 값이 생략되어도 위치 범위는 존재해 빈 문자열을 반환한다. 속성 전체에는 a:와 # 빈 값, 끝 개행을 포함한다. */ () => {
    const result = parseYaml('a: # 빈 값\nb: null\n');
    expectSlices(result, ['a'], ['a', '', 'a: # 빈 값\n']);
  });
  it('원문에 한글·이모지·LF·CRLF가 있으면 UTF-16 기준으로 범위와 좌표를 계산한다', /** offset과 문자 번호는 UTF-16 코드 단위로 센다. CRLF 내부 위치도 보존하고 LF 다음에 줄 번호를 올린다. 원문 끝은 허용하며 범위 밖·비정수 offset은 거부한다. */ () => {
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
  it('블록 문자열에 CRLF가 있으면 값의 개행은 LF로 해석하고 원문의 CRLF는 보존한다', /** 해석한 값은 한😀 뒤 LF 하나로 끝난다. 원문에서 잘라낸 값·속성 전체에는 헤더와 원래 CRLF 줄바꿈이 남는다. */ () => {
    const result = parseYaml('a: |\r\n  한😀\r\nb: 1\r\n');
    expect(result).toMatchObject({ success: true, data: { a: '한😀\n' } });
    expectSlices(result, ['a'], ['a', '|\r\n  한😀\r\n', 'a: |\r\n  한😀\r\n']);
  });
  it('문자열 키 a.b와 0을 경로에 그대로 전달하면 중첩 값 x의 범위를 찾는다', /** 경로의 a.b를 a와 b로 나누지 않고, 문자열 0도 배열 인덱스로 바꾸지 않는다. a와 b를 별도 경로로 전달하면 범위가 없다. */ () => {
    const result = parseYaml('"a.b": {"0": x}\n');
    expect(slice(result, getValueRange(result, ['a.b', '0']))).toBe('x');
    expect(getValueRange(result, ['a', 'b'])).toBeUndefined();
  });
});
