import { describe, expect, it } from 'vitest';
import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import type {
  DocumentValidationResult,
  FieldPath,
  SchemaDiagnostic,
  SourcePosition,
  ValidateDocumentInput,
} from '../index.js';
import {
  parseYaml,
  schemaDiagnosticCodes,
  schemaDiagnosticMessages,
  validateDocument,
} from '../index.js';

const term = {
  id: 'sample-order',
  name: ' 가상 주문 😀 ',
  definition: '정의 [[sample-fulfillment]]',
  domains: ['Sample Sales'],
};
const knowledge = {
  id: 'sample-fulfillment',
  name: '제목',
  definition: '본문 [[sample-order]]',
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
  expect(
    result.errors.every(
      (issue) => issue.severity === diagnosticSeverities.error,
    ),
  ).toBe(true);
  expect(
    result.warnings.every(
      (issue) => issue.severity === diagnosticSeverities.warning,
    ),
  ).toBe(true);
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
  it('복수 도메인과 모든 선택 속성을 함께 검사하면 종류 구분 없이 원문을 보존한다', /** 단일 문서에 예문·이전 명칭·정책 상태를 함께 허용한다. */ () => {
    const data = {
      ...term,
      domains: ['판매', '배송'],
      examples: ['[[주문 처리]]'],
      deprecatedAliases: [{ id: 'previous-order' }],
      kind: 'policy',
      status: 'confirmed',
    };
    const result = validateUnchanged({ data });
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    if (result.success) {
      expect(result.data).toEqual(data);
      expect(result.data).not.toHaveProperty('type');
    }
  });

  it('이전 형식을 검사하면 새 필수 필드를 대신 채우지 않고 이전 속성을 경고한다', /** 호환 변환 없이 사용자 속성으로 보존하며 필수 속성 누락을 진단한다. */ () => {
    const legacy = {
      type: 'knowledge',
      id: 'legacy',
      title: '이름',
      body: '본문',
      domain: '업무',
    };
    const result = validateUnchanged({ data: legacy });
    expect(result.success).toBe(false);
    expect(result.errors.map((issue) => issue.fieldPath)).toEqual([
      ['name'],
      ['definition'],
      ['domains'],
    ]);
    expect(result.warnings.map((issue) => issue.fieldPath)).toEqual([
      ['type'],
      ['title'],
      ['body'],
      ['domain'],
    ]);
    const valid = { ...legacy, ...term };
    const accepted = validateUnchanged({ data: valid });
    expect(accepted.success).toBe(true);
    if (accepted.success) expect(accepted.data).toEqual(valid);
  });

  it.each([
    term,
    { ...term, examples: [], deprecatedAliases: [] },
    {
      ...term,
      examples: [' 예시 '],
      deprecatedAliases: [
        { id: 'previous-name' },
        { id: 'previous-title', message: ' 안내 ' },
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

  it('이전 ID 중복은 작성 순서와 값을 유지한 채 정상 문서로 반환한다', /** 변경 이력 항목을 검증 과정에서 임의로 합치지 않는다. */ () => {
    const data = {
      ...term,
      deprecatedAliases: [
        { id: 'previous-order', message: '첫 변경' },
        { id: 'previous-order', message: '두 번째 변경' },
      ],
    };
    const result = validateUnchanged({ data });
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    if (result.success) expect(result.data).toEqual(data);
  });

  it('현재 ID와 같은 이전 ID는 값을 삭제하지 않고 해당 id 경로에 경고한다', /** 직접 YAML 편집으로 생긴 중복의 자동 정리를 수행하지 않는다. */ () => {
    const data = {
      ...term,
      deprecatedAliases: [{ id: term.id, message: '기존 안내' }],
    };
    const result = validateUnchanged({ data });
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: schemaDiagnosticCodes.invalidFieldValue,
        severity: diagnosticSeverities.warning,
        message: schemaDiagnosticMessages.deprecatedAliasMatchesCurrentId,
        fieldPath: ['deprecatedAliases', 0, 'id'],
      }),
    ]);
    if (result.success) expect(result.data).toEqual(data);
  });

  it('이전 name 입력은 호환 변환 없이 unknown 경고와 id 누락 오류를 함께 반환한다', /** 이름은 문서 링크 정체성이며 이전 코드 ID를 대신하지 않는다. */ () => {
    const data = {
      ...term,
      deprecatedAliases: [{ name: 'old-order' }],
    };
    const result = validateUnchanged({ data });
    expect(result.success).toBe(false);
    expect(at(result.errors, ['deprecatedAliases', 0, 'id']).code).toBe(
      schemaDiagnosticCodes.missingRequiredField,
    );
    expect(at(result.warnings, ['deprecatedAliases', 0, 'name']).code).toBe(
      schemaDiagnosticCodes.unknownField,
    );
    expect(result.warnings).toHaveLength(1);
  });

  it.each([
    [
      'name',
      '',
      schemaDiagnosticCodes.invalidFieldValue,
      schemaDiagnosticMessages.blankString,
    ],
    [
      'definition',
      ' \t\r\n',
      schemaDiagnosticCodes.invalidFieldValue,
      schemaDiagnosticMessages.blankString,
    ],
    ['domains', null, schemaDiagnosticCodes.invalidFieldType, undefined],
    [
      'id',
      'Bad-ID',
      schemaDiagnosticCodes.invalidFieldValue,
      schemaDiagnosticMessages.invalidId,
    ],
    [
      'id',
      'a--b',
      schemaDiagnosticCodes.invalidFieldValue,
      schemaDiagnosticMessages.invalidId,
    ],
    [
      'id',
      'a\n',
      schemaDiagnosticCodes.invalidFieldValue,
      schemaDiagnosticMessages.invalidId,
    ],
    ['id', 7, schemaDiagnosticCodes.invalidFieldType, undefined],
    ['examples', null, schemaDiagnosticCodes.invalidFieldType, undefined],
    [
      'deprecatedAliases',
      null,
      schemaDiagnosticCodes.invalidFieldType,
      undefined,
    ],
  ])(
    '알려진 %s 속성에 %j를 넣으면 약속한 오류로 실패한다',
    /** 빈 문자열·null·ID·자료형을 구분한다. */ (key, value, code, message) => {
      const result = validateUnchanged({ data: { ...term, [key]: value } });
      expect(result.success).toBe(false);
      expect(at(result.errors, [key]).code).toBe(code);
      if (message !== undefined)
        expect(at(result.errors, [key]).message).toBe(message);
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
      { ...term, deprecatedAliases: [{ id: 'old', message: '' }] },
      ['deprecatedAliases', 0, 'message'],
      schemaDiagnosticCodes.invalidFieldValue,
    ],
    [
      { ...term, deprecatedAliases: [{ id: 'Bad-ID' }] },
      ['deprecatedAliases', 0, 'id'],
      schemaDiagnosticCodes.invalidFieldValue,
    ],
    [
      { ...term, deprecatedAliases: [{}] },
      ['deprecatedAliases', 0, 'id'],
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

  it('기존 문서와 수정 후보를 병합해 검사하면 같은 필수 계약을 적용하고 원본을 유지한다', /** 호출자가 만든 전체 후보에 기본값이나 저장 허용을 추가하지 않는다. */ () => {
    const original = { ...knowledge, custom: { nested: [null, ' Value '] } };
    const originalBefore = snapshot(original);
    const candidate = { ...original, name: ' New Title ' };
    const accepted = validateUnchanged({ data: candidate });
    expect(accepted.success).toBe(true);
    if (accepted.success) {
      expect(accepted.data.name).toBe(' New Title ');
      expect(accepted.data).not.toHaveProperty('status');
      expect(accepted.data).not.toHaveProperty('saveAllowed');
    }
    const { definition: omitted, ...incomplete } = candidate;
    expect(omitted).toBeDefined();
    const rejected = validateUnchanged({ data: incomplete });
    expect(rejected.success).toBe(false);
    expect(at(rejected.errors, ['definition']).code).toBe(
      schemaDiagnosticCodes.missingRequiredField,
    );
    expect(original).toEqual(originalBefore);
  });

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
      deprecatedAliases: [{ id: 'old', custom: shared }],
    };
    const result = validateUnchanged({ data });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(data);
    expect(result.warnings.map((issue) => issue.fieldPath)).toEqual([
      ['aliases'],
      ['custom'],
      ['deprecatedAliases', 0, 'custom'],
    ]);
    expect(result.warnings.map((issue) => issue.message)).toEqual([
      schemaDiagnosticMessages.unknownField,
      schemaDiagnosticMessages.unknownField,
      schemaDiagnosticMessages.unknownField,
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
      expect(at(result.errors, ['custom', 'a.b', 1, 'value']).message).toBe(
        schemaDiagnosticMessages.nonFiniteNumber,
      );
    },
  );

  it.each(['.nan', '.inf', '-.inf'])(
    '실제 YAML %s를 파싱해 검사하면 비유한 수의 원문을 지목한다',
    /** 파서 성공은 스키마 성공을 보장하지 않는다. */ (value) => {
      const source = `id: order\nname: 이름\ndefinition: 정의\ndomains: [영역]\ncustom:\n  nested: [${value}]\n`;
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
      [undefined, schemaDiagnosticMessages.jsonValueRequired],
      [cyclic, schemaDiagnosticMessages.cyclicReference],
      [new Date(), schemaDiagnosticMessages.jsonObjectRequired],
      [new Map(), schemaDiagnosticMessages.jsonObjectRequired],
      [1n, schemaDiagnosticMessages.jsonValueRequired],
      [
        /** 비JSON 함수를 입력하는 사례다. */ () => true,
        schemaDiagnosticMessages.jsonValueRequired,
      ],
      [getter, schemaDiagnosticMessages.jsonDataPropertyRequired],
      [[, 'hole'], schemaDiagnosticMessages.missingArrayElement],
      [
        Object.assign([], { extra: 1 }),
        schemaDiagnosticMessages.jsonDataPropertyRequired,
      ],
      [
        { [Symbol('key')]: 'value' },
        schemaDiagnosticMessages.jsonDataPropertyRequired,
      ],
    ] as const;
    for (const [custom, message] of values) {
      const data = { ...term, custom };
      const result = validateDocument({ data });
      expect(result.success).toBe(false);
      expect(data.custom).toBe(custom);
      expect(result).not.toHaveProperty('data');
      expect(result.warnings).toHaveLength(1);
      expect(result.errors.some((issue) => issue.message === message)).toBe(
        true,
      );
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
    /** 문서 객체와 필수 속성 계약을 검사한다. */ (data) => {
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

        'id: Bad-ID # 값 뒤 주석',
        'name: 이름',
        'definition: 정의',
        'domains: [영역]',
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
        start: { line: 6, character: 17 },
        end: { line: 6, character: 22 },
      });
      expect(
        issueSlice(source, at(result.errors, ['deprecatedAliases', 0, 'id'])),
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
      '# 앞\n---\n{id: order, definition: 정의, domains: [영역]} # 뒤\n';
    const result = validateSource(source);
    expect(issueSlice(source, at(result.errors, ['name']))).toBe(
      '{id: order, definition: 정의, domains: [영역]}',
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
