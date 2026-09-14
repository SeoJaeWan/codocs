import { describe, expect, it } from 'vitest';
import {
  parseYaml,
  schemaDiagnosticCodes,
  validateDocument,
} from '../index.js';
import type {
  DocumentValidationResult,
  FieldPath,
  SchemaDiagnostic,
  SourcePosition,
  ValidateDocumentInput,
} from '../index.js';

const term = {
  type: 'term',
  id: 'sample-order',
  name: ' 가상 주문 😀 ',
  definition: '정의 [[sample-fulfillment]]',
  domain: 'Sample Sales',
};
const knowledge = {
  type: 'knowledge',
  id: 'sample-fulfillment',
  title: '제목',
  body: '본문 [[sample-order]]',
  domains: [' Sample Sales '],
};

/** JSON 직렬화가 잃는 undefined·비유한 수도 유지하는 검사 전 스냅샷이다. */
function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshot);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(
        /** 자체 속성과 원래 원시 값을 보존한다. */ ([key, child]) => [
          key,
          snapshot(child),
        ],
      ),
    );
  return value;
}

/** 성공과 실패 모두에서 입력 데이터·원문·위치의 깊은 동등성을 확인한다. */
function validateUnchanged(
  input: ValidateDocumentInput,
): DocumentValidationResult {
  const before = snapshot(input);
  const result = validateDocument(input);
  expect(input).toEqual(before);
  expect(result.errors.every((issue) => issue.severity === 'error')).toBe(true);
  expect(result.warnings.every((issue) => issue.severity === 'warning')).toBe(
    true,
  );
  if (!result.success) expect(result).not.toHaveProperty('data');
  return result;
}

/** 깊은 경로에 해당하는 진단을 찾는다. */
function at(
  issues: readonly SchemaDiagnostic[],
  path: FieldPath,
): SchemaDiagnostic {
  const issue = issues.find(
    /** 문자열 키와 숫자 인덱스를 그대로 비교한다. */ (candidate) =>
      JSON.stringify(candidate.fieldPath) === JSON.stringify(path),
  );
  expect(issue).toBeDefined();
  if (!issue) throw new Error('진단 경로가 없습니다.');
  return issue;
}

/** 외부 줄 좌표를 원문 offset으로 변환하여 실제 slice를 검사한다. */
function positionOffset(source: string, position: SourcePosition): number {
  let offset = 0;
  for (let line = 0; line < position.line; line++)
    offset = source.indexOf('\n', offset) + 1;
  return offset + position.character;
}

/** parser가 제공한 위치를 전체 검증기에 연결한다. */
function validateSource(source: string): DocumentValidationResult {
  const parsed = parseYaml(source, 'terms.yaml');
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('파싱이 실패했습니다.');
  return validateUnchanged({
    data: parsed.data,
    source: parsed.source,
    fields: parsed.fields,
    ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
    path: 'terms.yaml',
  });
}

/** 확인된 외부 범위의 원문을 추출한다. */
function issueSlice(source: string, issue: SchemaDiagnostic): string {
  if (!issue.range) throw new Error('진단 범위가 없습니다.');
  return source.slice(
    positionOffset(source, issue.range.start),
    positionOffset(source, issue.range.end),
  );
}

describe('문서 스키마 검증', /** 정상·오류·사용자 값과 입력 보존을 검사한다. */ () => {
  it.each([
    term,
    { ...term, examples: [], deprecatedAliases: [] },
    {
      ...term,
      examples: [' 예시 '],
      deprecatedAliases: [
        { name: '이전 이름' },
        { name: '이름', message: ' 안내 ' },
      ],
    },
    knowledge,
    { ...knowledge, kind: 'policy', status: 'proposed' },
    { ...knowledge, kind: 'procedure', status: 'confirmed' },
    { ...knowledge, kind: 'decision', status: 'deprecated' },
    { ...knowledge, kind: 'discussion' },
  ])(
    '정상 문서와 선택 속성을 검사하면 원래 값으로 성공한다: %j',
    /** 선택 누락과 빈 선택 배열에 기본값을 넣지 않는다. */ (data) => {
      const result = validateUnchanged({ data });
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      if (result.success) expect(result.data).toEqual(data);
      if (!Object.hasOwn(data, 'status') && result.success)
        expect(result.data).not.toHaveProperty('status');
    },
  );

  it.each([
    ['name', '', schemaDiagnosticCodes.invalidFieldValue],
    ['definition', ' \t\r\n', schemaDiagnosticCodes.invalidFieldValue],
    ['domain', null, schemaDiagnosticCodes.invalidFieldType],
    ['id', 'Bad-ID', schemaDiagnosticCodes.invalidFieldValue],
    ['id', 'a--b', schemaDiagnosticCodes.invalidFieldValue],
    ['id', 'a\n', schemaDiagnosticCodes.invalidFieldValue],
    ['id', 7, schemaDiagnosticCodes.invalidFieldType],
    ['type', 'other', schemaDiagnosticCodes.invalidFieldValue],
    ['type', null, schemaDiagnosticCodes.invalidFieldType],
    ['examples', null, schemaDiagnosticCodes.invalidFieldType],
    ['deprecatedAliases', null, schemaDiagnosticCodes.invalidFieldType],
  ])(
    '알려진 %s 속성에 %j를 넣으면 약속한 오류로 실패한다',
    /** 빈 문자열·null·ID·자료형을 구분한다. */ (key, value, code) => {
      const result = validateUnchanged({ data: { ...term, [key]: value } });
      expect(result.success).toBe(false);
      expect(at(result.errors, [key]).code).toBe(code);
      expect(
        result.errors.every((issue) => !Object.hasOwn(issue, 'range')),
      ).toBe(true);
    },
  );

  it.each([
    [
      { ...knowledge, domains: [] },
      ['domains'],
      schemaDiagnosticCodes.invalidFieldValue,
    ],
    [
      { ...knowledge, domains: [''] },
      ['domains', 0],
      schemaDiagnosticCodes.invalidFieldValue,
    ],
    [
      { ...knowledge, domains: [null] },
      ['domains', 0],
      schemaDiagnosticCodes.invalidFieldType,
    ],
    [
      { ...knowledge, kind: 'Policy' },
      ['kind'],
      schemaDiagnosticCodes.invalidFieldValue,
    ],
    [
      { ...knowledge, status: null },
      ['status'],
      schemaDiagnosticCodes.invalidFieldType,
    ],
    [
      { ...term, examples: [false] },
      ['examples', 0],
      schemaDiagnosticCodes.invalidFieldType,
    ],
    [
      { ...term, deprecatedAliases: [{ name: 'old', message: '' }] },
      ['deprecatedAliases', 0, 'message'],
      schemaDiagnosticCodes.invalidFieldValue,
    ],
    [
      { ...term, deprecatedAliases: [{}] },
      ['deprecatedAliases', 0, 'name'],
      schemaDiagnosticCodes.missingRequiredField,
    ],
    [
      { ...term, deprecatedAliases: [null] },
      ['deprecatedAliases', 0],
      schemaDiagnosticCodes.invalidFieldType,
    ],
  ] as const)(
    '배열 원소·별칭·열거 값을 검사하면 정확한 경로에서 실패한다: %j',
    /** 중첩 오류의 부모와 원소를 구분한다. */ (data, path, code) => {
      const result = validateUnchanged({ data });
      expect(result.success).toBe(false);
      expect(at(result.errors, path).code).toBe(code);
    },
  );

  it('필수 필드를 생략하면 missing 오류와 안전한 사용자 경고를 함께 반환한다', /** 오류가 있어도 aliases 경고를 별도로 수집한다. */ () => {
    const { name: omitted, ...rest } = term;
    expect(omitted).toBeDefined();
    const result = validateUnchanged({
      data: { ...rest, aliases: ['이전 이름'] },
    });
    expect(result.success).toBe(false);
    expect(at(result.errors, ['name']).code).toBe(
      schemaDiagnosticCodes.missingRequiredField,
    );
    expect(at(result.warnings, ['aliases']).code).toBe(
      schemaDiagnosticCodes.unknownField,
    );
  });

  it('사용자 JSON 값과 업무 별칭의 사용자 속성을 검사하면 모든 값과 키를 보존한다', /** 사용자 객체 내부의 name·status는 업무 스키마로 해석하지 않는다. */ () => {
    const shared = {
      name: null,
      status: '',
      'key.with.dot': [null, true, false, 1.5, ' Mixed Case '],
    };
    const data = {
      ...term,
      aliases: ['old'],
      custom: { a: shared, b: shared },
      deprecatedAliases: [{ name: 'old', custom: shared }],
    };
    const result = validateUnchanged({ data });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(data);
    expect(result.warnings.map((issue) => issue.fieldPath)).toEqual([
      ['aliases'],
      ['custom'],
      ['deprecatedAliases', 0, 'custom'],
    ]);
  });

  it.each([NaN, Infinity, -Infinity])(
    '중첩 비유한 수 %j를 검사하면 값 오류의 정확한 경로를 반환한다',
    /** JSON 문자열 키의 점과 배열 인덱스를 혼동하지 않는다. */ (number) => {
      const result = validateUnchanged({
        data: { ...term, custom: { 'a.b': [null, { value: number }] } },
      });
      expect(result.success).toBe(false);
      expect(at(result.errors, ['custom', 'a.b', 1, 'value']).code).toBe(
        schemaDiagnosticCodes.invalidFieldValue,
      );
    },
  );

  it.each(['.nan', '.inf', '-.inf'])(
    '실제 YAML %s를 파싱해 검사하면 비유한 수의 원문을 지목한다',
    /** 파서 성공은 스키마 성공을 보장하지 않는다. */ (value) => {
      const source = `type: term\nid: order\nname: 이름\ndefinition: 정의\ndomain: 영역\ncustom:\n  nested: [${value}]\n`;
      const result = validateSource(source);
      expect(result.success).toBe(false);
      expect(
        issueSlice(source, at(result.errors, ['custom', 'nested', 0])),
      ).toBe(value);
    },
  );

  it('명시적 undefined와 비JSON 객체·순환을 검사하면 제거하거나 변환하지 않고 실패한다', /** getter는 실행하지 않고 공유 객체는 순환과 구분한다. */ () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let calls = 0;
    const getter = Object.defineProperty({}, 'value', {
      enumerable: true,
      /** 실행 여부를 관찰하는 접근자다. */
      get: /** 실행 여부를 관찰하는 접근자다. */ () => {
        calls++;
        return 'value';
      },
    });
    const values = [
      undefined,
      cyclic,
      new Date(),
      new Map(),
      1n,
      /** 비JSON 함수를 입력하는 사례다. */ () => true,
      getter,
      [, 'hole'],
      Object.assign([], { extra: 1 }),
      { [Symbol('key')]: 'value' },
    ];
    for (const custom of values) {
      const data = { ...term, custom };
      const result = validateDocument({ data });
      expect(result.success).toBe(false);
      expect(data.custom).toBe(custom);
      expect(result).not.toHaveProperty('data');
      expect(result.warnings).toHaveLength(1);
    }
    expect(calls).toBe(0);
    expect(
      validateUnchanged({ data: { ...term, examples: undefined } }).success,
    ).toBe(false);
    expect(
      validateUnchanged({ data: { ...knowledge, status: undefined } }).success,
    ).toBe(false);
  });

  it('JSON 특수 키를 검사하면 __proto__와 constructor도 원래 값으로 유지한다', /** Zod 구조 검사 출력의 키 보호에 의해 사용자 데이터가 삭제되지 않는다. */ () => {
    const data: unknown = JSON.parse(
      JSON.stringify(term).slice(0, -1) +
        ',"__proto__":{"x":1},"constructor":null}',
    );
    const result = validateUnchanged({ data });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.hasOwn(result.data, '__proto__')).toBe(true);
      expect(result.data).toEqual(data);
    }
    expect(result.warnings).toHaveLength(2);
  });

  it.each([null, [], 'term', 1, false, {}])(
    '전체 문서가 %j이면 성공 문서 타입을 제공하지 않는다',
    /** 문서 객체와 type 필수 계약을 검사한다. */ (data) => {
      const result = validateUnchanged({ data });
      expect(result.success).toBe(false);
    },
  );
});

describe('검증 진단의 확인된 원문 위치', /** 값·원소·키·직접 부모와 UTF-16 좌표를 연결한다. */ () => {
  it.each(['\n', '\r\n'])(
    '실제 parser의 %j 원문을 검사하면 값·원소·키·중첩 부모를 지목한다',
    /** 이모지 뒤의 열 좌표도 UTF-16으로 센다. */ (newline) => {
      const source = [
        '# 앞 주석',
        '---',
        'type: term',
        'id: Bad-ID # 값 뒤 주석',
        'name: 이름',
        'definition: 정의',
        'domain: 영역',
        'examples: ["😀", false]',
        'deprecatedAliases: [{message: "안내"}]',
        'aliases: [old]',
        '# 뒤 주석',
        '',
      ].join(newline);
      const result = validateSource(source);
      expect(issueSlice(source, at(result.errors, ['id']))).toBe('Bad-ID');
      const element = at(result.errors, ['examples', 1]);
      expect(issueSlice(source, element)).toBe('false');
      expect(element.range).toEqual({
        start: { line: 7, character: 17 },
        end: { line: 7, character: 22 },
      });
      expect(
        issueSlice(source, at(result.errors, ['deprecatedAliases', 0, 'name'])),
      ).toBe('{message: "안내"}');
      expect(issueSlice(source, at(result.warnings, ['aliases']))).toBe(
        'aliases',
      );
      for (const issue of [...result.errors, ...result.warnings])
        expect(issue.path).toBe('terms.yaml');
    },
  );

  it('최상위 필수 필드를 생략하면 문서 표시·독립 주석을 제외한 rootRange를 지목한다', /** 확인된 최상위 AST 매핑을 누락 속성의 부모로 사용한다. */ () => {
    const source =
      '# 앞\n---\n{type: term, id: order, definition: 정의, domain: 영역} # 뒤\n';
    const result = validateSource(source);
    expect(issueSlice(source, at(result.errors, ['name']))).toBe(
      '{type: term, id: order, definition: 정의, domain: 영역}',
    );
  });

  it('범위나 원문을 확인할 수 없으면 원문 전체나 키 위치로 대체하지 않는다', /** source 없는 범위와 잘못된 offset 및 직접 부모 부재를 생략한다. */ () => {
    const data = { ...term, id: 'BAD', deprecatedAliases: [{}] };
    const fields = [
      {
        fieldPath: ['id'],
        key: { start: 0, end: 2 },
        value: { start: 3, end: 99 },
        property: undefined,
      },
    ];
    for (const input of [
      { data, fields, rootRange: { start: 0, end: 2 } },
      { data, fields, source: 'id: BAD' },
      { data, source: 'id: BAD' },
      {
        data,
        fields: [{ ...fields[0]!, value: { start: 4.5, end: 6 } }],
        source: 'id: BAD',
      },
      {
        data,
        fields: [{ ...fields[0]!, value: { start: 6, end: 4 } }],
        source: 'id: BAD',
      },
    ]) {
      const result = validateUnchanged(input);
      expect(
        result.errors.every((issue) => !Object.hasOwn(issue, 'range')),
      ).toBe(true);
    }
  });
});
