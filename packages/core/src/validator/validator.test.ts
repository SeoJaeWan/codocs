import { describe, expect, it } from 'vitest';
import type { SourcePosition } from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import {
  schemaDiagnosticCodes,
  schemaDiagnosticMessages,
} from '../diagnostics/index.js';
import {
  codocsKey,
  documentFields,
  metadataFields,
  validateDocument,
  type SchemaDiagnostic,
} from './index.js';

const term = {
  _codocs: { id: 'sample-order', name: ' 가상 주문 😀 ' },
  개요: '정의 [[sample-fulfillment]]',
};
const knowledge = {
  _codocs: { id: 'sample-fulfillment', name: '제목', parent: ['가상 주문'] },
  개요: '본문 [[sample-order]]',
  환불정책: '환불은 [[결제]]에서 처리한다.',
};

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

/** 원문을 파싱해 위치 정보와 함께 검증한다. */
function validateSource(source: string): ReturnType<typeof validateDocument> {
  const parsed = parseYaml(source, 'terms.yaml');
  if (!parsed.success) throw new Error('파싱이 실패했습니다.');
  return validateDocument({
    data: parsed.data,
    source: parsed.source,
    fields: parsed.fields,
    ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
    path: 'terms.yaml',
  });
}

describe('validateDocument: 문서 스키마 검증', () => {
  describe('_codocs 메타데이터와 section 구조', () => {
    it('_codocs와 section을 가진 문서를 검증하면 원래 값으로 성공한다', () => {
      const data = { _codocs: { id: 'order', name: '주문' }, 개요: '설명' };

      const result = validateDocument({ data });

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      if (result.success) expect(result.data).toEqual(data);
    });

    it.each([term, knowledge])(
      'parent가 없거나 있는 정상 문서를 검증하면 원래 값으로 성공한다: %j',
      (data) => {
        const result = validateDocument({ data });

        expect(result.success).toBe(true);
        expect(result.errors).toEqual([]);
        if (result.success) expect(result.data).toEqual(data);
      },
    );

    it('section을 여러 개 가진 문서를 검증하면 입력 키 순서를 바꾸지 않는다', () => {
      const data = { 환불정책: '환불', _codocs: term._codocs, 개요: '설명' };

      const result = validateDocument({ data });

      expect(result.success).toBe(true);
      if (result.success)
        expect(Object.keys(result.data)).toEqual([
          '환불정책',
          '_codocs',
          '개요',
        ]);
    });

    it('스키마에서 도출한 메타데이터 필드 경로는 _codocs 아래의 id·name·parent다', () => {
      expect(documentFields).toEqual({
        id: [codocsKey, metadataFields.id],
        name: [codocsKey, metadataFields.name],
        parent: [codocsKey, metadataFields.parent],
      });
      expect(documentFields.id).toEqual(['_codocs', 'id']);
    });

    it('_codocs가 없으면 루트에 필수 속성 누락 오류를 반환한다', () => {
      const source = '개요: 설명\n';

      const result = validateSource(source);

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          fieldPath: ['_codocs'],
          code: schemaDiagnosticCodes.missingRequiredField,
        }),
      );
      const issue = result.errors.find(
        (candidate) => candidate.fieldPath[0] === '_codocs',
      );
      if (issue) expect(issueSlice(source, issue)).toBe('개요: 설명\n');
    });

    it('_codocs.id가 없으면 _codocs 값 위치에 필수 속성 누락 오류를 반환한다', () => {
      const source = '_codocs:\n  name: 주문\n개요: 설명\n';

      const result = validateSource(source);

      expect(result.success).toBe(false);
      const issue = result.errors.find(
        (candidate) =>
          JSON.stringify(candidate.fieldPath) ===
          JSON.stringify(['_codocs', 'id']),
      );
      expect(issue?.code).toBe(schemaDiagnosticCodes.missingRequiredField);
      if (issue) expect(issueSlice(source, issue)).toBe('name: 주문\n');
    });

    it('_codocs가 객체가 아니면 자료형 오류를 반환한다', () => {
      const result = validateDocument({
        data: { _codocs: '주문', 개요: '설명' },
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          fieldPath: ['_codocs'],
          code: schemaDiagnosticCodes.invalidFieldType,
        }),
      );
    });

    it('section이 하나도 없으면 값 오류를 반환한다', () => {
      const result = validateDocument({ data: { _codocs: term._codocs } });

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          fieldPath: [],
          code: schemaDiagnosticCodes.invalidFieldValue,
          message: schemaDiagnosticMessages.sectionRequired,
        }),
      );
    });

    it('_codocs 외에 밑줄로 시작하는 루트 키가 있으면 그 키에 값 오류를 반환한다', () => {
      const source =
        '_codocs:\n  id: order\n  name: 주문\n개요: 설명\n_x: 값\n';

      const result = validateSource(source);

      expect(result.success).toBe(false);
      const issue = result.errors.find(
        (candidate) => candidate.fieldPath[0] === '_x',
      );
      expect(issue?.code).toBe(schemaDiagnosticCodes.invalidFieldValue);
      expect(issue?.message).toBe(schemaDiagnosticMessages.reservedRootKey);
      if (issue) expect(issueSlice(source, issue)).toBe('값');
    });

    it('_codocs 안에 정의되지 않은 키가 있으면 그 키에 값 오류를 반환한다', () => {
      const source =
        '_codocs:\n  id: order\n  name: 주문\n  domains: 업무\n개요: 설명\n';

      const result = validateSource(source);

      expect(result.success).toBe(false);
      const issue = result.errors.find(
        (candidate) =>
          JSON.stringify(candidate.fieldPath) ===
          JSON.stringify(['_codocs', 'domains']),
      );
      expect(issue?.code).toBe(schemaDiagnosticCodes.invalidFieldValue);
      expect(issue?.message).toBe(schemaDiagnosticMessages.unknownMetadataKey);
      if (issue) expect(issueSlice(source, issue)).toBe('업무');
    });

    it('문자열이 아닌 section은 그 section에 자료형 오류를 반환한다', () => {
      const source =
        '_codocs:\n  id: order\n  name: 주문\n개요: 설명\n목록: [a]\n';

      const result = validateSource(source);

      expect(result.success).toBe(false);
      const issue = result.errors.find(
        (candidate) => candidate.fieldPath[0] === '목록',
      );
      expect(issue?.code).toBe(schemaDiagnosticCodes.invalidFieldType);
      expect(issue?.fieldPath).toEqual(['목록']);
    });

    it.each(['', ' \t\r\n'])(
      '비었거나 공백뿐인 section %j는 값 오류를 반환한다',
      (value) => {
        const result = validateDocument({ data: { ...term, 개요: value } });

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            fieldPath: ['개요'],
            code: schemaDiagnosticCodes.invalidFieldValue,
            message: schemaDiagnosticMessages.blankString,
          }),
        );
      },
    );

    it.each([
      [
        ['_codocs', 'name'],
        { id: 'a', name: '' },
        schemaDiagnosticCodes.invalidFieldValue,
        schemaDiagnosticMessages.blankString,
      ],
      [
        ['_codocs', 'id'],
        { id: 'Bad-ID', name: 'a' },
        schemaDiagnosticCodes.invalidFieldValue,
        schemaDiagnosticMessages.invalidId,
      ],
      [
        ['_codocs', 'id'],
        { id: 'a--b', name: 'a' },
        schemaDiagnosticCodes.invalidFieldValue,
        schemaDiagnosticMessages.invalidId,
      ],
      [
        ['_codocs', 'id'],
        { id: 'a\n', name: 'a' },
        schemaDiagnosticCodes.invalidFieldValue,
        schemaDiagnosticMessages.invalidId,
      ],
      [
        ['_codocs', 'id'],
        { id: 7, name: 'a' },
        schemaDiagnosticCodes.invalidFieldType,
        undefined,
      ],
      [
        ['_codocs', 'parent'],
        { id: 'a', name: 'a', parent: '상위' },
        schemaDiagnosticCodes.invalidFieldType,
        undefined,
      ],
      [
        ['_codocs', 'parent', 0],
        { id: 'a', name: 'a', parent: [' '] },
        schemaDiagnosticCodes.invalidFieldValue,
        schemaDiagnosticMessages.blankString,
      ],
      [
        ['_codocs', 'parent', 1],
        { id: 'a', name: 'a', parent: ['상위', 3] },
        schemaDiagnosticCodes.invalidFieldType,
        undefined,
      ],
    ])(
      '_codocs 값이 약속과 다르면 %j에 약속한 오류를 반환한다: %j',
      (fieldPath, metadata, code, message) => {
        const result = validateDocument({
          data: { _codocs: metadata, 개요: '설명' },
        });

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ fieldPath, code }),
        );
        if (message !== undefined)
          expect(result.errors).toContainEqual(
            expect.objectContaining({ fieldPath, message }),
          );
        expect(
          result.errors.every((issue) => !Object.hasOwn(issue, 'range')),
        ).toBe(true);
      },
    );

    it('이전 형식 문서를 검증하면 변환하지 않고 _codocs 누락과 section 오류를 반환한다', () => {
      const legacy = {
        id: 'legacy',
        name: '이름',
        domains: ['업무'],
        definition: '본문',
      };

      const result = validateDocument({ data: legacy });

      expect(result.success).toBe(false);
      expect(result.errors.map((issue) => issue.fieldPath)).toEqual([
        ['_codocs'],
        ['domains'],
      ]);
      expect(result.warnings).toEqual([]);
    });

    it('id라는 이름의 section은 정상 section으로 받아들인다', () => {
      const result = validateDocument({
        data: { _codocs: term._codocs, id: '본문' },
      });

      expect(result.success).toBe(true);
    });

    it.each([null, [], 'term', 1, false, {}])(
      '전체 문서가 %j이면 성공 문서 타입을 제공하지 않는다',
      (data) => {
        const result = validateDocument({ data });

        expect(result.success).toBe(false);
      },
    );
  });

  describe('수정 후보 검증과 입력 보존', () => {
    it('이름을 수정한 전체 문서를 검증하면 새 이름을 보존한다', () => {
      const data = {
        ...knowledge,
        _codocs: { ...knowledge._codocs, name: ' New Title ' },
      };

      const result = validateDocument({ data });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data._codocs.name).toBe(' New Title ');
    });

    it('검증하면 입력 객체를 변경하지 않는다', () => {
      const data = JSON.parse(JSON.stringify(knowledge)) as typeof knowledge;

      validateDocument({ data });

      expect(data).toEqual(knowledge);
    });
  });
});

describe('검증 진단의 확인된 원문 위치', () => {
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
            label: 'ID 값',
            fieldPath: ['_codocs', 'id'],
            expected: 'Bad-ID',
          },
          {
            newlineName,
            newline,
            label: 'parent 배열 원소',
            fieldPath: ['_codocs', 'parent', 1],
            expected: 'false',
          },
        ] as const,
    ),
  )(
    '$newlineName 원문에서 $label을 검증하면 해당 원문 위치를 반환한다',
    ({ newline, fieldPath, expected }) => {
      const source = [
        '# 앞 주석',
        '---',
        '_codocs:',
        '  id: Bad-ID # 값 뒤 주석',
        '  name: 이름',
        '  parent: ["😀", false]',
        '개요: 정의',
        '# 뒤 주석',
        '',
      ].join(newline);

      const result = validateSource(source);
      const issue = result.errors.find(
        (candidate) =>
          JSON.stringify(candidate.fieldPath) === JSON.stringify(fieldPath),
      );

      expect(issue).toBeDefined();
      if (!issue) return;
      expect(issueSlice(source, issue)).toBe(expected);
      expect(issue.path).toBe('terms.yaml');
      if (fieldPath[2] === 1)
        expect(issue.range).toEqual({
          start: { line: 5, character: 17 },
          end: { line: 5, character: 22 },
        });
    },
  );

  it('최상위 필수 필드를 생략하면 문서 표시·독립 주석을 제외한 rootRange를 지목한다', () => {
    const source = '# 앞\n---\n{ 개요: 정의 } # 뒤\n';

    const result = validateSource(source);

    const issue = result.errors.find(
      (candidate) =>
        JSON.stringify(candidate.fieldPath) === JSON.stringify(['_codocs']),
    );
    expect(issue).toBeDefined();
    if (issue) expect(issueSlice(source, issue)).toBe('{ 개요: 정의 }');
  });

  const invalidRangeData = {
    _codocs: { id: 'BAD', name: '이름' },
    개요: '설명',
  };
  const invalidFields = [
    {
      fieldPath: ['_codocs', 'id'],
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
