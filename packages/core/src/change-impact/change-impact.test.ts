import { describe, expect, it } from 'vitest';
import { codeReferenceDestinationKinds } from '../code-reference/index.js';
import {
  calculateChangeImpact,
  changeImpactCertainties,
  changeImpactReasons,
  changeImpactStatuses,
  type ChangeImpactInput,
} from './index.js';
import { changeImpactDiagnosticMessages } from '../diagnostics/index.js';

describe('calculateChangeImpact 참조 구간과 원문 차이', () => {
  it.each([
    {
      name: '동일 원문',
      before: 'a\nb\nc\nd',
      after: 'a\nb\nc\nd',
      start: 2,
      end: 3,
      reasons: [],
    },
    {
      name: '구간 뒤 수정',
      before: 'a\nb\nc\nd',
      after: 'a\nb\nc\nz',
      start: 2,
      end: 3,
      reasons: [],
    },
    {
      name: '구간 뒤 삭제',
      before: 'a\nb\nc\nd',
      after: 'a\nb\nc',
      start: 2,
      end: 3,
      reasons: [],
    },
    {
      name: '구간 뒤 삽입',
      before: 'a\nb\nc\nd',
      after: 'a\nb\nc\nx\nd',
      start: 2,
      end: 3,
      reasons: [],
    },
    {
      name: '앞부분 같은 행수 수정',
      before: 'a\nb\nc\nd',
      after: 'z\nb\nc\nd',
      start: 2,
      end: 3,
      reasons: [],
    },
    {
      name: '구간 내부 수정',
      before: 'a\nb\nc\nd',
      after: 'a\nz\nc\nd',
      start: 2,
      end: 3,
      reasons: [changeImpactReasons.regionChanged],
    },
    {
      name: '구간 내부 삭제',
      before: 'a\nb\nc\nd',
      after: 'a\nc\nd',
      start: 2,
      end: 3,
      reasons: [changeImpactReasons.regionChanged],
    },
    {
      name: '구간 내부 삽입',
      before: 'a\nb\nc\nd',
      after: 'a\nb\nx\nc\nd',
      start: 2,
      end: 3,
      reasons: [changeImpactReasons.regionChanged],
    },
    {
      name: '앞부분 삽입',
      before: 'a\nb\nc\nd',
      after: 'a\nx\nb\nc\nd',
      start: 2,
      end: 3,
      reasons: [changeImpactReasons.precedingLineShift],
    },
    {
      name: '앞부분 삭제',
      before: 'a\nb\nc\nd',
      after: 'b\nc\nd',
      start: 2,
      end: 3,
      reasons: [changeImpactReasons.precedingLineShift],
    },
    {
      name: '끝 행 삭제',
      before: 'a\nb\nc\nd',
      after: 'a\nb\nc',
      start: 4,
      end: 4,
      reasons: [changeImpactReasons.regionChanged],
    },
    {
      name: '마지막 빈 행 삭제',
      before: 'a\nb\n',
      after: 'a\nb',
      start: 3,
      end: 3,
      reasons: [changeImpactReasons.regionChanged],
    },
  ])(
    '$name 조건으로 반영하면 해당 구간의 확인 사유를 구분한다',
    ({ before, after, start, end, reasons }) => {
      const input: ChangeImpactInput = {
        before: { raw: before, name: '문서', domains: ['업무'] },
        after: { raw: after, name: '문서', domains: ['업무'] },
        references: [
          {
            occurrenceId: 'source:10',
            destination: {
              kind: codeReferenceDestinationKinds.rows,
              startLine: start,
              endLine: end,
            },
          },
        ],
      };
      const result = calculateChangeImpact(input);
      expect(result.status).toBe(changeImpactStatuses.complete);
      expect(result.failures).toEqual([]);
      expect(result.impacts).toEqual(
        reasons.length
          ? [
              {
                occurrenceId: 'source:10',
                destination: input.references[0]!.destination,
                certainty: changeImpactCertainties.confirmed,
                reasons,
              },
            ]
          : [],
      );
    },
  );

  it('문서 전체의 주석 원문만 변경해도 전체 참조를 안내한다', () => {
    const input: ChangeImpactInput = {
      before: { raw: '# before\nbody', name: '문서', domains: ['업무'] },
      after: { raw: '# after\nbody', name: '문서', domains: ['업무'] },
      references: [
        {
          occurrenceId: 'whole',
          destination: { kind: codeReferenceDestinationKinds.document },
        },
      ],
    };
    expect(calculateChangeImpact(input).impacts).toEqual([
      {
        occurrenceId: 'whole',
        destination: input.references[0]!.destination,
        certainty: changeImpactCertainties.confirmed,
        reasons: [changeImpactReasons.documentChanged],
      },
    ]);
  });
});

describe('calculateChangeImpact 대상 해석과 반복 내용', () => {
  it('이름과 한정 도메인을 변경하면 같은 출현의 사유를 한 항목에 보존한다', () => {
    const input: ChangeImpactInput = {
      before: { raw: 'a', name: '이전', domains: ['업무'] },
      after: { raw: 'a', name: '현재', domains: ['개발'] },
      references: [
        {
          occurrenceId: 'named',
          domain: '업무',
          destination: { kind: codeReferenceDestinationKinds.document },
        },
      ],
    };
    expect(calculateChangeImpact(input).impacts).toEqual([
      {
        occurrenceId: 'named',
        destination: input.references[0]!.destination,
        certainty: changeImpactCertainties.confirmed,
        reasons: [
          changeImpactReasons.nameChanged,
          changeImpactReasons.domainChanged,
        ],
      },
    ]);
  });
  it('도메인 한정이 없는 출현은 이름과 원문이 같으면 도메인 변경만으로 안내하지 않는다', () => {
    const input: ChangeImpactInput = {
      before: { raw: 'a', name: '문서', domains: ['업무'] },
      after: { raw: 'a', name: '문서', domains: ['개발'] },
      references: [
        {
          occurrenceId: 'whole',
          destination: { kind: codeReferenceDestinationKinds.document },
        },
      ],
    };
    expect(calculateChangeImpact(input).impacts).toEqual([]);
  });
  it.each([
    {
      name: '같은 행 중 하나 삭제',
      before: 'a\nx\nx\nb',
      after: 'a\nx\nb',
      start: 2,
    },
    {
      name: '같은 행 앞 삽입',
      before: 'a\nx\nb',
      after: 'a\nx\nx\nb',
      start: 2,
    },
    {
      name: '반복 블록 중 하나 삭제',
      before: 'a\nx\ny\nx\ny\nb',
      after: 'a\nx\ny\nb',
      start: 4,
    },
  ])(
    '$name 조건으로 반영하면 기존 숫자를 유지하며 영향 가능성으로 안내한다',
    ({ before, after, start }) => {
      const input: ChangeImpactInput = {
        before: { raw: before, name: '문서', domains: ['업무'] },
        after: { raw: after, name: '문서', domains: ['업무'] },
        references: [
          {
            occurrenceId: 'repeated',
            destination: {
              kind: codeReferenceDestinationKinds.rows,
              startLine: start,
              endLine: start,
            },
          },
        ],
      };
      const original = JSON.parse(JSON.stringify(input)) as ChangeImpactInput;
      expect(calculateChangeImpact(input).impacts).toEqual([
        {
          occurrenceId: 'repeated',
          destination: original.references[0]!.destination,
          certainty: changeImpactCertainties.possible,
          reasons: [changeImpactReasons.ambiguousCorrespondence],
        },
      ]);
      expect(input).toEqual(original);
    },
  );
  it('구간 뒤 반복 행만 줄이면 앞의 유일한 구간을 영향으로 만들지 않는다', () => {
    const input: ChangeImpactInput = {
      before: { raw: 'a\nb\nx\nx', name: '문서', domains: [] },
      after: { raw: 'a\nb\nx', name: '문서', domains: [] },
      references: [
        {
          occurrenceId: 'stable',
          destination: {
            kind: codeReferenceDestinationKinds.rows,
            startLine: 2,
            endLine: 2,
          },
        },
      ],
    };
    expect(calculateChangeImpact(input).impacts).toEqual([]);
  });
  it('행 대응이 크기 한도를 넘으면 전체 참조 안내와 불완전 사유를 함께 보존한다', () => {
    const input: ChangeImpactInput = {
      before: { raw: 'a\n'.repeat(2100), name: '문서', domains: [] },
      after: { raw: 'b\n'.repeat(2100), name: '문서', domains: [] },
      references: [
        {
          occurrenceId: 'rows',
          destination: {
            kind: codeReferenceDestinationKinds.rows,
            startLine: 1,
            endLine: 1,
          },
        },
        {
          occurrenceId: 'whole',
          destination: { kind: codeReferenceDestinationKinds.document },
        },
      ],
    };
    const result = calculateChangeImpact(input);
    expect(result.status).toBe(changeImpactStatuses.incomplete);
    expect(result.failures).toEqual([
      changeImpactDiagnosticMessages.correspondenceLimit,
    ]);
    expect(result.impacts).toEqual([
      {
        occurrenceId: 'whole',
        destination: input.references[1]!.destination,
        certainty: changeImpactCertainties.confirmed,
        reasons: [changeImpactReasons.documentChanged],
      },
    ]);
  });
});
