import { describe, expect, it } from 'vitest';
import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import type { SourcePosition } from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import {
  schemaDiagnosticCodes,
  schemaDiagnosticMessages,
} from '../diagnostics/index.js';
import { validateDocument, type SchemaDiagnostic } from './index.js';

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

/** 외부 줄 좌표를 원문 offset으로 변환하여 실제 slice를 검사한다. */
function positionOffset(source: string, position: SourcePosition): number {
  let offset = 0;
  for (let line = 0; line < position.line; line++)
    offset = source.indexOf('\n', offset) + 1;
  return offset + position.character;
}

/** 확인된 외부 범위의 원문을 추출한다. */
function issueSlice(source: string, issue: SchemaDiagnostic): string {
  if (!issue.range) throw new Error('진단 범위가 없습니다.');
  return source.slice(
    positionOffset(source, issue.range.start),
    positionOffset(source, issue.range.end),
  );
}

describe('validateDocument: 문서 스키마 검증', () => {
  it('필수 필드를 모두 가진 문서를 검증하면 원래 값으로 성공한다', () => {
    const data = {
      id: 'order',
      name: '주문',
      definition: '설명',
      domains: ['판매'],
    };

    const result = validateDocument({ data });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    if (result.success) expect(result.data).toEqual(data);
  });

  it('복수 도메인과 모든 선택 속성을 함께 검사하면 종류 구분 없이 원문을 보존한다', /** 단일 문서에 예문·이전 명칭·정책 상태를 함께 허용한다. */ () => {
    const data = {
      ...term,
      domains: ['판매', '배송'],
      examples: ['[[주문 처리]]'],
      deprecatedAliases: [{ id: 'previous-order' }],
      kind: 'policy',
      status: 'confirmed',
    };
    const result = validateDocument({ data });
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
    const result = validateDocument({ data: legacy });
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
    const accepted = validateDocument({ data: valid });
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
      const result = validateDocument({ data });
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
    const result = validateDocument({ data });
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    if (result.success) expect(result.data).toEqual(data);
  });

  it('현재 ID와 같은 이전 ID는 값을 삭제하지 않고 해당 id 경로에 경고한다', /** 직접 YAML 편집으로 생긴 중복의 자동 정리를 수행하지 않는다. */ () => {
    const data = {
      ...term,
      deprecatedAliases: [{ id: term.id, message: '기존 안내' }],
    };
    const result = validateDocument({ data });
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
      const result = validateDocument({ data: { ...term, [key]: value } });
      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ fieldPath: [key], code }),
      );
      if (message !== undefined)
        expect(result.errors).toContainEqual(
          expect.objectContaining({ fieldPath: [key], message }),
        );
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
      const result = validateDocument({ data });
      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ fieldPath: path, code }),
      );
    },
  );

  describe('수정 후보 검증과 입력 보존', () => {
    it('이름을 수정한 전체 문서를 검증하면 새 이름을 보존하고 기본 속성을 채우지 않는다', () => {
      const data = { ...knowledge, name: ' New Title ' };

      const result = validateDocument({ data });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.name).toBe(data.name);
      expect(result.data).not.toHaveProperty('status');
      expect(result.data).not.toHaveProperty('saveAllowed');
    });

    it('수정 후보에서 필수 정의를 제거하면 정의 누락 오류를 반환한다', () => {
      const data = {
        id: knowledge.id,
        name: knowledge.name,
        domains: knowledge.domains,
      };

      const result = validateDocument({ data });

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          fieldPath: ['definition'],
          code: schemaDiagnosticCodes.missingRequiredField,
        }),
      );
    });

    it('중첩 사용자 값을 가진 수정 후보를 검증하면 원래 입력 객체를 변경하지 않는다', () => {
      const original = { ...knowledge, custom: { nested: [null, ' Value '] } };
      const data = { ...original, name: ' New Title ' };
      const before = snapshot(data);

      const result = validateDocument({ data });

      expect(result.success).toBe(true);
      expect(data).toEqual(before);
      expect(original.custom).toEqual({ nested: [null, ' Value '] });
    });
  });

  it('필수 필드를 생략하면 missing 오류와 안전한 사용자 경고를 함께 반환한다', /** 오류가 있어도 aliases 경고를 별도로 수집한다. */ () => {
    const { name: omitted, ...rest } = term;
    expect(omitted).toBeDefined();
    const result = validateDocument({
      data: { ...rest, aliases: ['이전 이름'] },
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        fieldPath: ['name'],
        code: schemaDiagnosticCodes.missingRequiredField,
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        fieldPath: ['aliases'],
        code: schemaDiagnosticCodes.unknownField,
      }),
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
    const result = validateDocument({ data });
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
      const result = validateDocument({
        data: { ...term, custom: { 'a.b': [null, { value: number }] } },
      });
      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          fieldPath: ['custom', 'a.b', 1, 'value'],
          code: schemaDiagnosticCodes.invalidFieldValue,
          message: schemaDiagnosticMessages.nonFiniteNumber,
        }),
      );
    },
  );

  it.each(['.nan', '.inf', '-.inf'])(
    '실제 YAML %s를 파싱해 검사하면 비유한 수의 원문을 지목한다',
    /** 파서 성공은 스키마 성공을 보장하지 않는다. */ (value) => {
      const source = `id: order\nname: 이름\ndefinition: 정의\ndomains: [영역]\ncustom:\n  nested: [${value}]\n`;
      const parsed = parseYaml(source, 'terms.yaml');
      if (!parsed.success) throw new Error('파싱이 실패했습니다.');
      const result = validateDocument({
        data: parsed.data,
        source: parsed.source,
        fields: parsed.fields,
        ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
        path: 'terms.yaml',
      });
      expect(result.success).toBe(false);
      const issue = result.errors.find(
        (candidate) =>
          JSON.stringify(candidate.fieldPath) ===
          JSON.stringify(['custom', 'nested', 0]),
      );
      expect(issue).toBeDefined();
      if (issue) expect(issueSlice(source, issue)).toBe(value);
    },
  );

  describe('JSON으로 표현할 수 없는 사용자 값', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    it.each([
      {
        name: 'undefined',
        custom: undefined,
        message: schemaDiagnosticMessages.jsonValueRequired,
      },
      {
        name: '순환 객체',
        custom: cyclic,
        message: schemaDiagnosticMessages.cyclicReference,
      },
      {
        name: 'Date 객체',
        custom: new Date(),
        message: schemaDiagnosticMessages.jsonObjectRequired,
      },
      {
        name: 'Map 객체',
        custom: new Map(),
        message: schemaDiagnosticMessages.jsonObjectRequired,
      },
      {
        name: 'BigInt',
        custom: 1n,
        message: schemaDiagnosticMessages.jsonValueRequired,
      },
      {
        name: '함수',
        custom: /** JSON으로 표현할 수 없는 함수 값이다. */ () => true,
        message: schemaDiagnosticMessages.jsonValueRequired,
      },
      {
        name: '희소 배열',
        custom: [, 'hole'],
        message: schemaDiagnosticMessages.missingArrayElement,
      },
      {
        name: '추가 속성이 있는 배열',
        custom: Object.assign([], { extra: 1 }),
        message: schemaDiagnosticMessages.jsonDataPropertyRequired,
      },
      {
        name: 'Symbol 키 객체',
        custom: { [Symbol('key')]: 'value' },
        message: schemaDiagnosticMessages.jsonDataPropertyRequired,
      },
    ])(
      '$name을 사용자 값으로 검사하면 해당 JSON 오류를 반환한다',
      ({ custom, message }) => {
        const data = { ...term, custom };
        const result = validateDocument({ data });

        expect(result.success).toBe(false);
        expect(result).not.toHaveProperty('data');
        expect(result.errors).toContainEqual(
          expect.objectContaining({ message }),
        );
        expect(data.custom).toBe(custom);
      },
    );

    it('사용자 객체의 getter를 검사하면 실행하지 않고 자료 속성 오류를 반환한다', () => {
      let calls = 0;
      const custom = Object.defineProperty({}, 'value', {
        enumerable: true,
        /** 접근자 실행 여부를 관찰한다. */
        get: /** 접근자 실행 여부를 관찰한다. */ () => {
          calls++;
          return 'value';
        },
      });
      const data = { ...term, custom };

      const result = validateDocument({ data });

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: schemaDiagnosticMessages.jsonDataPropertyRequired,
        }),
      );
      expect(calls).toBe(0);
    });

    it.each([
      { name: 'examples', data: { ...term, examples: undefined } },
      { name: 'status', data: { ...knowledge, status: undefined } },
    ])('$name에 명시적 undefined를 전달하면 검증에 실패한다', ({ data }) => {
      const result = validateDocument({ data });
      expect(result.success).toBe(false);
    });
  });

  it('JSON 특수 키를 검사하면 __proto__와 constructor도 원래 값으로 유지한다', /** Zod 구조 검사 출력의 키 보호에 의해 사용자 데이터가 삭제되지 않는다. */ () => {
    const data: unknown = JSON.parse(
      JSON.stringify(term).slice(0, -1) +
        ',"__proto__":{"x":1},"constructor":null}',
    );
    const result = validateDocument({ data });
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
      const result = validateDocument({ data });
      expect(result.success).toBe(false);
    },
  );
});

describe('검증 진단의 확인된 원문 위치', /** 값·원소·키·직접 부모와 UTF-16 좌표를 연결한다. */ () => {
  it.each(
    [
      { newlineName: 'LF', newline: '\n' },
      { newlineName: 'CRLF', newline: '\r\n' },
    ].flatMap(
      ({ newlineName, newline }) =>
        [
          {
            newlineName,
            newline,
            name: 'ID 값',
            fieldPath: ['id'],
            section: 'errors',
            expected: 'Bad-ID',
          },
          {
            newlineName,
            newline,
            name: '배열 원소',
            fieldPath: ['examples', 1],
            section: 'errors',
            expected: 'false',
          },
          {
            newlineName,
            newline,
            name: '누락된 중첩 ID의 부모',
            fieldPath: ['deprecatedAliases', 0, 'id'],
            section: 'errors',
            expected: '{message: "안내"}',
          },
          {
            newlineName,
            newline,
            name: '알 수 없는 키',
            fieldPath: ['aliases'],
            section: 'warnings',
            expected: 'aliases',
          },
        ] as const,
    ),
  )(
    '$newlineName 원문에서 $name을 검증하면 해당 원문 위치를 반환한다',
    ({ newline, fieldPath, section, expected }) => {
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
      const parsed = parseYaml(source, 'terms.yaml');
      if (!parsed.success) throw new Error('파싱이 실패했습니다.');
      const result = validateDocument({
        data: parsed.data,
        source: parsed.source,
        fields: parsed.fields,
        ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
        path: 'terms.yaml',
      });
      const issue = result[section].find(
        (candidate) =>
          JSON.stringify(candidate.fieldPath) === JSON.stringify(fieldPath),
      );

      expect(issue).toBeDefined();
      if (!issue) return;
      expect(issueSlice(source, issue)).toBe(expected);
      expect(issue.path).toBe('terms.yaml');
      if (fieldPath[0] === 'examples')
        expect(issue.range).toEqual({
          start: { line: 6, character: 17 },
          end: { line: 6, character: 22 },
        });
    },
  );

  it('최상위 필수 필드를 생략하면 문서 표시·독립 주석을 제외한 rootRange를 지목한다', /** 확인된 최상위 AST 매핑을 누락 속성의 부모로 사용한다. */ () => {
    const source =
      '# 앞\n---\n{id: order, definition: 정의, domains: [영역]} # 뒤\n';
    const parsed = parseYaml(source, 'terms.yaml');
    if (!parsed.success) throw new Error('파싱이 실패했습니다.');
    const result = validateDocument({
      data: parsed.data,
      source: parsed.source,
      fields: parsed.fields,
      ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
      path: 'terms.yaml',
    });
    const issue = result.errors.find(
      (candidate) =>
        JSON.stringify(candidate.fieldPath) === JSON.stringify(['name']),
    );
    expect(issue).toBeDefined();
    if (issue)
      expect(issueSlice(source, issue)).toBe(
        '{id: order, definition: 정의, domains: [영역]}',
      );
  });

  const invalidRangeData = { ...term, id: 'BAD', deprecatedAliases: [{}] };
  const invalidFields = [
    {
      fieldPath: ['id'],
      key: { start: 0, end: 2 },
      value: { start: 3, end: 99 },
      property: undefined,
    },
  ];
  it.each([
    {
      name: '원문 없음',
      input: {
        data: invalidRangeData,
        fields: invalidFields,
        rootRange: { start: 0, end: 2 },
      },
    },
    {
      name: '범위 밖 offset',
      input: {
        data: invalidRangeData,
        fields: invalidFields,
        source: 'id: BAD',
      },
    },
    {
      name: '직접 부모 범위 없음',
      input: { data: invalidRangeData, source: 'id: BAD' },
    },
    {
      name: '소수 offset',
      input: {
        data: invalidRangeData,
        fields: [{ ...invalidFields[0]!, value: { start: 4.5, end: 6 } }],
        source: 'id: BAD',
      },
    },
    {
      name: '역순 offset',
      input: {
        data: invalidRangeData,
        fields: [{ ...invalidFields[0]!, value: { start: 6, end: 4 } }],
        source: 'id: BAD',
      },
    },
  ])(
    '$name으로 진단 위치를 확인할 수 없으면 원문 범위를 만들지 않는다',
    ({ input }) => {
      const result = validateDocument(input);
      expect(
        result.errors.every((issue) => !Object.hasOwn(issue, 'range')),
      ).toBe(true);
    },
  );
});
