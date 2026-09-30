import {
  catalogConfirmations,
  diagnosticSeverities,
  matcherComparisonKinds,
  matcherEvidenceKinds,
  scanStatuses,
  schemaDiagnosticCodes,
  schemaDiagnosticMessages,
} from '@codocs/core';
import {
  workspaceDiagnosticCodes,
  workspaceLifecycleStates,
  type WorkspacePathDocumentResult,
  type WorkspacePathGetSuccess,
} from '@codocs/workspace';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  createEmptyHover,
  createHover,
  createStatusHover,
  hoverCandidatePaths,
  hoverDetailPaths,
  isOpenSourceCommandArgument,
  openSourceCommand,
  selectHover,
  type HoverMatchCandidate,
  type HoverMatchEvidence,
  type HoverMatchSnapshot,
} from './index.js';

const ready = { state: workspaceLifecycleStates.ready, ready: true } as const;

function document(text: string): TextDocument {
  return TextDocument.create(
    'file:///workspace/source.ts',
    'typescript',
    1,
    text,
  );
}

function evidence(input: {
  start: number;
  end: number;
  sourceId: string;
  kind?: HoverMatchEvidence['kind'];
  comparison?: HoverMatchEvidence['comparison'];
  consecutiveTokens?: number;
  message?: string;
}): HoverMatchEvidence {
  return {
    kind: input.kind ?? matcherEvidenceKinds.current,
    comparison: input.comparison ?? matcherComparisonKinds.exact,
    token: input.sourceId,
    offsetRange: { start: input.start, end: input.end },
    range: {
      start: { line: 0, character: input.start },
      end: { line: 0, character: input.end },
    },
    sourceId: input.sourceId,
    consecutiveTokens: input.consecutiveTokens ?? 1,
    ...(input.message === undefined ? {} : { message: input.message }),
  };
}

function candidate(input: {
  path: string;
  id?: string;
  name?: string;
  evidence: readonly HoverMatchEvidence[];
}): HoverMatchCandidate {
  return {
    ...(input.id ? { id: input.id, documentId: input.id } : {}),
    path: input.path,
    ...(input.name ? { name: input.name } : {}),
    domains: ['테스트'],
    confirmation: catalogConfirmations.confirmed,
    evidence: input.evidence,
    diagnostics: [],
    errors: [],
  };
}

function snapshot(
  candidates: readonly HoverMatchCandidate[],
  partial = false,
): HoverMatchSnapshot {
  return { catalogVersion: 7, candidates, partial, workspaceState: ready };
}

function detail(input: {
  path: string;
  id?: string;
  name?: string;
  definition?: string;
  domains?: readonly string[];
  conflictPaths?: readonly string[];
  references?: WorkspacePathDocumentResult['references'];
  referencedBy?: WorkspacePathDocumentResult['referencedBy'];
  diagnostics?: WorkspacePathDocumentResult['diagnostics'];
}): WorkspacePathDocumentResult {
  return {
    path: input.path,
    found: true,
    source: {
      path: input.path,
      uri: `file:///workspace/${encodeURIComponent(input.path)}`,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 4, character: 0 },
      },
    },
    confirmation: catalogConfirmations.confirmed,
    ...(input.id ? { id: input.id } : {}),
    ...(input.conflictPaths ? { conflictPaths: input.conflictPaths } : {}),
    document: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.definition ? { definition: input.definition } : {}),
      ...(input.domains ? { domains: [...input.domains] } : {}),
    },
    ...(input.references ? { references: input.references } : {}),
    ...(input.referencedBy ? { referencedBy: input.referencedBy } : {}),
    diagnostics: input.diagnostics ?? [],
  };
}

function details(
  results: readonly WorkspacePathDocumentResult[],
  scanStatus: WorkspacePathGetSuccess['scanStatus'] = scanStatuses.complete,
): WorkspacePathGetSuccess {
  return { success: true, scanStatus, catalogVersion: 7, results };
}

function markdown(hover: ReturnType<typeof createHover>): string {
  const contents = hover.contents;
  return typeof contents === 'object' &&
    !Array.isArray(contents) &&
    'value' in contents
    ? contents.value
    : (JSON.stringify(contents) ?? '');
}

describe('selectHover: 커서 근거 우선순위와 식별자 범위', () => {
  it('현재 ID와 이전 ID가 함께 걸리면 짧은 현재 ID 후보를 선택한다', () => {
    const source = document('returnZones');
    const current = candidate({
      path: '.codocs/zone.yaml',
      id: 'zone',
      evidence: [evidence({ start: 6, end: 11, sourceId: 'zone' })],
    });
    const previous = candidate({
      path: '.codocs/return-zone.yaml',
      id: 'new-return-zone',
      evidence: [
        evidence({
          start: 0,
          end: 11,
          sourceId: 'return-zone',
          kind: matcherEvidenceKinds.previous,
          consecutiveTokens: 2,
        }),
      ],
    });

    const selected = selectHover(source, snapshot([previous, current]), {
      line: 0,
      character: 8,
    });

    expect(selected?.top.map((item) => item.candidate.path)).toEqual([
      current.path,
    ]);
  });

  it('같은 현재 ID 근거에서는 연속 토큰 수가 긴 후보를 선택한다', () => {
    const source = document('returnZones');
    const short = candidate({
      path: '.codocs/zone.yaml',
      evidence: [evidence({ start: 6, end: 11, sourceId: 'zone' })],
    });
    const long = candidate({
      path: '.codocs/return-zone.yaml',
      evidence: [
        evidence({
          start: 0,
          end: 11,
          sourceId: 'return-zone',
          consecutiveTokens: 2,
        }),
      ],
    });

    const selected = selectHover(source, snapshot([short, long]), {
      line: 0,
      character: 8,
    });

    expect(selected?.top.map((item) => item.candidate.path)).toEqual([
      long.path,
    ]);
  });

  it('현재 구분과 토큰 수가 같으면 exact 후보를 singular 후보보다 먼저 선택한다', () => {
    const source = document('zones');
    const singular = candidate({
      path: '.codocs/zone.yaml',
      evidence: [
        evidence({
          start: 0,
          end: 5,
          sourceId: 'zone',
          comparison: matcherComparisonKinds.singular,
        }),
      ],
    });
    const exact = candidate({
      path: '.codocs/zones.yaml',
      evidence: [evidence({ start: 0, end: 5, sourceId: 'zones' })],
    });

    const selected = selectHover(source, snapshot([singular, exact]), {
      line: 0,
      character: 2,
    });

    expect(selected?.top.map((item) => item.candidate.path)).toEqual([
      exact.path,
    ]);
  });

  it('세 의미 기준이 같은 최상위 후보는 모두 선택한다', () => {
    const source = document('zone');
    const first = candidate({
      path: '.codocs/a.yaml',
      evidence: [evidence({ start: 0, end: 4, sourceId: 'zone' })],
    });
    const second = candidate({
      path: '.codocs/b.yaml',
      evidence: [evidence({ start: 0, end: 4, sourceId: 'zone' })],
    });

    const selected = selectHover(source, snapshot([second, first]), {
      line: 0,
      character: 2,
    });

    expect(selected?.top.map((item) => item.candidate.path)).toEqual([
      first.path,
      second.path,
    ]);
  });

  it('반복 발생 범위를 보존하고 다른 식별자의 후보를 같은 묶음에서 제외한다', () => {
    const source = document('alpha alpha beta');
    const alpha = candidate({
      path: '.codocs/alpha.yaml',
      evidence: [
        evidence({ start: 0, end: 5, sourceId: 'alpha' }),
        evidence({ start: 6, end: 11, sourceId: 'alpha' }),
      ],
    });
    const beta = candidate({
      path: '.codocs/beta.yaml',
      evidence: [evidence({ start: 12, end: 16, sourceId: 'beta' })],
    });

    const selected = selectHover(source, snapshot([alpha, beta]), {
      line: 0,
      character: 7,
    });

    expect(selected?.range).toEqual({
      start: { line: 0, character: 6 },
      end: { line: 0, character: 11 },
    });
    expect(selected?.groupedCandidates.map((item) => item.path)).toEqual([
      alpha.path,
    ]);
    expect(selected?.groupedCandidates[0]?.evidence).toEqual([
      alpha.evidence[1],
    ]);
  });
});

describe('createHover: 대표 본문과 같은 식별자 보조 링크', () => {
  it('reservationReturnZones 양쪽 커서에서 대표 본문과 상대 용어 링크를 바꾼다', () => {
    const source = document('reservationReturnZones');
    const reservation = candidate({
      path: '.codocs/reservation.yaml',
      id: 'reservation',
      name: '예약',
      evidence: [evidence({ start: 0, end: 11, sourceId: 'reservation' })],
    });
    const returnZone = candidate({
      path: '.codocs/return-zone.yaml',
      id: 'return-zone',
      name: '반납 구역',
      evidence: [
        evidence({
          start: 11,
          end: 22,
          sourceId: 'return-zone',
          consecutiveTokens: 2,
        }),
      ],
    });
    const match = snapshot([reservation, returnZone]);
    const projected = details([
      detail({
        path: reservation.path,
        id: 'reservation',
        name: '예약',
        definition: '예약 본문',
        domains: ['운영'],
      }),
      detail({
        path: returnZone.path,
        id: 'return-zone',
        name: '반납 구역',
        definition: '반납 본문',
        domains: ['운영'],
      }),
    ]);

    const left = selectHover(source, match, { line: 0, character: 3 });
    const right = selectHover(source, match, { line: 0, character: 15 });
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    const leftMarkdown = markdown(createHover(left!, match, projected));
    const rightMarkdown = markdown(createHover(right!, match, projected));

    // @codocs [[코드 호버]]#L17-L18
    expect(leftMarkdown).toContain('예약 본문');
    expect(leftMarkdown).not.toContain('반납 본문');
    expect(leftMarkdown).toContain('반납 구역');
    expect(rightMarkdown).toContain('반납 본문');
    expect(rightMarkdown).not.toContain('예약 본문');
    expect(rightMarkdown).toContain('예약');
  });

  it('최상위 동률 후보는 각각 본문을 표시한다', () => {
    const source = document('zone');
    const first = candidate({
      path: '.codocs/a.yaml',
      evidence: [evidence({ start: 0, end: 4, sourceId: 'zone' })],
    });
    const second = candidate({
      path: '.codocs/b.yaml',
      evidence: [evidence({ start: 0, end: 4, sourceId: 'zone' })],
    });
    const match = snapshot([first, second]);
    const selected = selectHover(source, match, { line: 0, character: 1 });
    const projected = details([
      detail({ path: first.path, name: '첫째', definition: '첫 본문' }),
      detail({ path: second.path, name: '둘째', definition: '둘째 본문' }),
    ]);

    expect(markdown(createHover(selected!, match, projected))).toContain(
      '첫 본문',
    );
    expect(markdown(createHover(selected!, match, projected))).toContain(
      '둘째 본문',
    );
  });

  it('다른 발생 위치의 이전 ID 근거로 같은 식별자 보조 링크를 경고하지 않는다', () => {
    const source = document('reservationReturnZones oldReturnZone');
    const reservation = candidate({
      path: '.codocs/reservation.yaml',
      evidence: [evidence({ start: 0, end: 11, sourceId: 'reservation' })],
    });
    const returnZone = candidate({
      path: '.codocs/return-zone.yaml',
      evidence: [
        evidence({
          start: 11,
          end: 22,
          sourceId: 'return-zone',
          consecutiveTokens: 2,
        }),
        evidence({
          start: 23,
          end: 36,
          sourceId: 'old-return-zone',
          kind: matcherEvidenceKinds.previous,
          consecutiveTokens: 3,
        }),
      ],
    });
    const match = snapshot([reservation, returnZone]);
    const selected = selectHover(source, match, { line: 0, character: 3 });
    const projected = details([
      detail({ path: reservation.path, name: '예약', definition: '예약 본문' }),
      detail({
        path: returnZone.path,
        id: 'return-zone',
        name: '반납 구역',
        definition: '반납 본문',
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('반납 구역');
    expect(value).not.toContain('이전 ID입니다');
  });
});

describe('createHover: 이전 ID와 문서 오류 표현', () => {
  it('현재 ID 전체가 충돌해도 정상 보조 후보의 링크를 표시한다', () => {
    const source = document('reservationReturnZones');
    const a = candidate({
      path: '.codocs/a.yaml',
      id: 'reservation',
      evidence: [evidence({ start: 0, end: 11, sourceId: 'reservation' })],
    });
    const b = candidate({
      path: '.codocs/b.yaml',
      id: 'reservation',
      evidence: [evidence({ start: 0, end: 11, sourceId: 'reservation' })],
    });
    const helper = candidate({
      path: '.codocs/zone.yaml',
      id: 'return-zone',
      evidence: [evidence({ start: 11, end: 22, sourceId: 'return-zone' })],
    });
    const match = snapshot([a, b, helper]);
    const selected = selectHover(source, match, { line: 0, character: 1 });
    const projected = details([
      detail({ path: a.path, name: '예약', conflictPaths: [a.path, b.path] }),
      detail({ path: b.path, name: '예약', conflictPaths: [a.path, b.path] }),
      detail({ path: helper.path, name: '반납 구역' }),
    ]);
    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('함께 매칭된 용어');
    expect(value).toContain('[반납 구역](command:');
    expect(value).toContain('a\\.yaml');
    expect(value).toContain('b\\.yaml');
  });

  it.each([false, true])(
    '다른 위치 previous-only가 %s이면 그 근거만 보존한다',
    (otherPosition) => {
      const source = document('fooFoo');
      const current = evidence({ start: 0, end: 3, sourceId: 'foo' });
      const previous = evidence({
        start: otherPosition ? 3 : 0,
        end: otherPosition ? 6 : 3,
        sourceId: 'foo',
        kind: matcherEvidenceKinds.previous,
      });
      const matched = candidate({
        path: '.codocs/foo.yaml',
        id: 'foo',
        evidence: [previous, current],
      });
      const selected = selectHover(source, snapshot([matched]), {
        line: 0,
        character: 1,
      });
      expect(selected!.groupedCandidates[0]!.evidence).toEqual(
        otherPosition ? [previous, current] : [current],
      );
      const rendered = markdown(
        createHover(
          selected!,
          snapshot([matched]),
          details([
            detail({
              path: matched.path,
              id: 'foo',
              name: '문서',
              definition: '본문',
            }),
          ]),
        ),
      );
      if (otherPosition) {
        expect(rendered).toContain('같은 식별자의 다른 위치');
        expect(rendered).toContain('이전 ID입니다');
      } else expect(rendered).not.toContain('이전 ID입니다');
    },
  );

  it('현재 ID 별칭중복 원인만 숨기고 다른 invalid_field_value 진단은 보존한다', () => {
    const source = document('foo');
    const matched = candidate({
      path: '.codocs/foo.yaml',
      id: 'foo',
      evidence: [evidence({ start: 0, end: 3, sourceId: 'foo' })],
    });
    const match = snapshot([matched]);
    const selected = selectHover(source, match, { line: 0, character: 1 });
    const projected = details([
      detail({
        path: matched.path,
        name: '문서',
        diagnostics: [
          {
            code: schemaDiagnosticCodes.invalidFieldValue,
            severity: diagnosticSeverities.error,
            message: schemaDiagnosticMessages.deprecatedAliasMatchesCurrentId,
          },
          {
            code: schemaDiagnosticCodes.invalidFieldValue,
            severity: diagnosticSeverities.error,
            message: schemaDiagnosticMessages.blankString,
          },
        ],
      }),
    ]);
    const value = markdown(createHover(selected!, match, projected));
    expect(value).not.toContain('이전 ID가 현재 ID와 같습니다');
    expect(value).toContain('빈 문자열이나 공백뿐인 문자열');
  });
  it('유효한 이전 ID message가 있으면 현재 ID와 함께 표시한다', () => {
    const source = document('oldZone');
    const previous = candidate({
      path: '.codocs/new-zone.yaml',
      evidence: [
        evidence({
          start: 0,
          end: 7,
          sourceId: 'old-zone',
          kind: matcherEvidenceKinds.previous,
          message: 'newZone을 사용하세요.',
        }),
      ],
    });
    const match = snapshot([previous]);
    const selected = selectHover(source, match, { line: 0, character: 2 });
    const projected = details([
      detail({
        path: previous.path,
        id: 'new-zone',
        name: '새 구역',
        definition: '본문',
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('newZone을 사용하세요');
    expect(value).toContain('현재 ID: new\\-zone');
  });

  it('이전 ID message가 없으면 확인한 현재 ID를 기본 안내에 표시한다', () => {
    const source = document('oldZone');
    const previous = candidate({
      path: '.codocs/new-zone.yaml',
      evidence: [
        evidence({
          start: 0,
          end: 7,
          sourceId: 'old-zone',
          kind: matcherEvidenceKinds.previous,
        }),
      ],
    });
    const match = snapshot([previous]);
    const selected = selectHover(source, match, { line: 0, character: 2 });
    const projected = details([
      detail({
        path: previous.path,
        id: 'new-zone',
        name: '새 구역',
        definition: '본문',
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('이전 ID입니다');
    expect(value).toContain('현재 ID: new\\-zone');
  });

  it('잘못된 message는 기본 안내와 필드 오류를 함께 표시한다', () => {
    const source = document('oldZone');
    const previous = candidate({
      path: '.codocs/new-zone.yaml',
      evidence: [
        evidence({
          start: 0,
          end: 7,
          sourceId: 'old-zone',
          kind: matcherEvidenceKinds.previous,
        }),
      ],
    });
    const match = snapshot([previous]);
    const selected = selectHover(source, match, { line: 0, character: 2 });
    const projected = details([
      detail({
        path: previous.path,
        id: 'new-zone',
        name: '새 구역',
        definition: '본문',
        diagnostics: [
          {
            code: schemaDiagnosticCodes.invalidFieldType,
            severity: diagnosticSeverities.error,
            message: '문자열이어야 합니다.',
            fieldPath: ['deprecatedAliases', 0, 'message'],
          },
        ],
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('이전 ID입니다');
    expect(value).toContain('문자열이어야 합니다');
  });

  it('현재 ID와 정의를 확인할 수 없어도 이름·원문·각 진단을 유지한다', () => {
    const source = document('oldZone');
    const previous = candidate({
      path: '.codocs/broken.yaml',
      name: '오류 문서',
      evidence: [
        evidence({
          start: 0,
          end: 7,
          sourceId: 'old-zone',
          kind: matcherEvidenceKinds.previous,
        }),
      ],
    });
    const match = snapshot([previous]);
    const selected = selectHover(source, match, { line: 0, character: 2 });
    const projected = details([
      detail({
        path: previous.path,
        name: '오류 문서',
        diagnostics: [
          {
            code: schemaDiagnosticCodes.missingRequiredField,
            severity: diagnosticSeverities.error,
            message: '필수 필드 definition이 누락되었습니다.',
            fieldPath: ['definition'],
          },
          {
            code: schemaDiagnosticCodes.missingRequiredField,
            severity: diagnosticSeverities.error,
            message: '필수 필드 id가 누락되었습니다.',
            fieldPath: ['id'],
          },
        ],
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('오류 문서');
    expect(value).toContain('원문 열기');
    expect(value).toContain('현재 ID를 확인할 수 없습니다');
    expect(value).toContain('definition이 누락되었습니다');
    expect(value).toContain('id가 누락되었습니다');
  });

  it('중복 현재 ID는 대표 본문 대신 모든 충돌 문서 링크와 오류를 표시한다', () => {
    const source = document('zone');
    const first = candidate({
      path: '.codocs/a.yaml',
      evidence: [evidence({ start: 0, end: 4, sourceId: 'zone' })],
    });
    const second = candidate({
      path: '.codocs/b.yaml',
      evidence: [evidence({ start: 0, end: 4, sourceId: 'zone' })],
    });
    const match = snapshot([first, second]);
    const selected = selectHover(source, match, { line: 0, character: 1 });
    const conflictPaths = [first.path, second.path];
    const duplicateDiagnostic = {
      code: 'duplicate_id',
      severity: diagnosticSeverities.error,
      message: '같은 ID를 가진 발견 경로가 여러 개입니다.',
    } as const;
    const projected = details([
      detail({
        path: first.path,
        name: '첫 문서',
        definition: '표시하면 안 되는 첫 본문',
        conflictPaths,
        diagnostics: [duplicateDiagnostic],
      }),
      detail({
        path: second.path,
        name: '둘째 문서',
        definition: '표시하면 안 되는 둘째 본문',
        conflictPaths,
        diagnostics: [duplicateDiagnostic],
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('ID 충돌');
    expect(value).toContain('첫 문서');
    expect(value).toContain('둘째 문서');
    expect(value).not.toContain('표시하면 안 되는 첫 본문');
    expect(value).not.toContain('표시하면 안 되는 둘째 본문');
  });

  it('충돌 후보와 정상 후보가 최상위 동률이면 정상 후보 본문은 유지한다', () => {
    const source = document('a1');
    const duplicate = candidate({
      path: '.codocs/a1-first.yaml',
      evidence: [evidence({ start: 0, end: 2, sourceId: 'a1' })],
    });
    const duplicateOther = candidate({
      path: '.codocs/a1-second.yaml',
      evidence: [evidence({ start: 0, end: 2, sourceId: 'a1' })],
    });
    const normal = candidate({
      path: '.codocs/a-1.yaml',
      evidence: [evidence({ start: 0, end: 2, sourceId: 'a-1' })],
    });
    const match = snapshot([duplicate, duplicateOther, normal]);
    const selected = selectHover(source, match, { line: 0, character: 1 });
    const conflictPaths = [duplicate.path, duplicateOther.path];
    const projected = details([
      detail({
        path: duplicate.path,
        name: '중복 첫째',
        definition: '중복 본문 1',
        conflictPaths,
      }),
      detail({
        path: duplicateOther.path,
        name: '중복 둘째',
        definition: '중복 본문 2',
        conflictPaths,
      }),
      detail({
        path: normal.path,
        id: 'a-1',
        name: '정상 문서',
        definition: '정상 본문',
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('ID 충돌');
    expect(value).toContain('정상 본문');
    expect(value).not.toContain('중복 본문 1');
    expect(value).not.toContain('중복 본문 2');
  });
});

describe('createHover: 직접 관계와 안전한 원문 링크', () => {
  it('직접 참조와 역참조만 구분하고 빈 항목·연결 본문·전이 관계를 표시하지 않는다', () => {
    const source = document('source');
    const sourceCandidate = candidate({
      path: '.codocs/source.yaml',
      evidence: [evidence({ start: 0, end: 6, sourceId: 'source' })],
    });
    const match = snapshot([sourceCandidate]);
    const selected = selectHover(source, match, { line: 0, character: 2 });
    const direct = detail({
      path: '.codocs/direct.yaml',
      id: 'direct',
      name: '직접 대상',
      definition: '연결 본문은 펼치지 않음',
      references: [
        {
          path: '.codocs/transitive.yaml',
          id: 'transitive',
          uri: 'file:///workspace/.codocs/transitive.yaml',
        },
      ],
    });
    const reverse = detail({
      path: '.codocs/reverse.yaml',
      id: 'reverse',
      name: '역참조 문서',
      definition: '역참조 본문은 펼치지 않음',
    });
    const projected = details([
      detail({
        path: sourceCandidate.path,
        id: 'source',
        name: '출처',
        definition: '출처 본문',
        references: [
          { path: direct.path, id: 'direct', uri: direct.source.uri },
        ],
        referencedBy: [
          { path: reverse.path, id: 'reverse', uri: reverse.source.uri },
        ],
      }),
      direct,
      reverse,
      detail({
        path: '.codocs/transitive.yaml',
        id: 'transitive',
        name: '전이 대상',
        definition: '전이 본문',
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    expect(value).toContain('이 문서가 참조');
    expect(value).toContain('직접 대상');
    expect(value).toContain('이 문서를 참조');
    expect(value).toContain('역참조 문서');
    expect(value).not.toContain('연결 본문은 펼치지 않음');
    expect(value).not.toContain('역참조 본문은 펼치지 않음');
    expect(value).not.toContain('전이 대상');
    expect(value).not.toContain('함께 매칭된 용어');
  });

  it('사용자 Markdown은 이스케이프하고 생성한 codocs.openSource 명령만 링크로 둔다', () => {
    const source = document('source');
    const sourceCandidate = candidate({
      path: '.codocs/source.yaml',
      evidence: [evidence({ start: 0, end: 6, sourceId: 'source' })],
    });
    const match = snapshot([sourceCandidate]);
    const selected = selectHover(source, match, { line: 0, character: 2 });
    const projected = details([
      detail({
        path: sourceCandidate.path,
        id: 'source',
        name: '[실행](command:evil.run)',
        definition: '<script>evil()</script>',
      }),
    ]);

    const value = markdown(createHover(selected!, match, projected));
    // @codocs [[코드 호버]]#L45
    expect(value).not.toContain('](command:evil.run)');
    expect(value).toContain(`](command:${openSourceCommand}?`);
    expect(value).not.toContain('<script>');
  });

  it('원문 명령 인자는 file URI·catalogVersion·revision·범위를 검증한다', () => {
    expect(
      isOpenSourceCommandArgument({
        uri: 'file:///workspace/%ED%95%9C%EA%B8%80%20path.yaml',
        catalogVersion: 3,
        revision: 'a'.repeat(64),
        range: {
          start: { line: 0, character: 0 },
          end: { line: 4, character: 0 },
        },
      }),
    ).toBe(true);
    expect(
      isOpenSourceCommandArgument({
        uri: 'https://example.com/run',
        catalogVersion: 3,
      }),
    ).toBe(false);
    expect(
      isOpenSourceCommandArgument({
        uri: 'file:///workspace/source.yaml',
        catalogVersion: 3,
        revision: 'not-a-revision',
      }),
    ).toBe(false);
    expect(
      isOpenSourceCommandArgument({
        uri: 'file:///workspace/source.yaml',
        catalogVersion: 3,
        range: {
          start: { line: 2, character: 0 },
          end: { line: 1, character: 0 },
        },
      }),
    ).toBe(false);
  });

  it('첫 상세 조회의 직접·역참조와 충돌 경로를 같은 catalog 재조회 경로에 포함한다', () => {
    const candidatePaths = ['.codocs/source.yaml'];
    const projected = details([
      detail({
        path: candidatePaths[0]!,
        conflictPaths: ['.codocs/source.yaml', '.codocs/conflict.yaml'],
        references: [
          {
            path: '.codocs/direct.yaml',
            uri: 'file:///workspace/.codocs/direct.yaml',
          },
        ],
        referencedBy: [
          {
            path: '.codocs/reverse.yaml',
            uri: 'file:///workspace/.codocs/reverse.yaml',
          },
        ],
      }),
    ]);

    expect(hoverDetailPaths(candidatePaths, projected)).toEqual([
      '.codocs/source.yaml',
      '.codocs/conflict.yaml',
      '.codocs/direct.yaml',
      '.codocs/reverse.yaml',
    ]);
  });
});

describe('Hover 상태: 부분 결과·준비·실패·매칭 없음', () => {
  it('부분 결과에 대표 내용과 후보 누락 가능성을 함께 표시한다', () => {
    const source = document('zone');
    const zone = candidate({
      path: '.codocs/zone.yaml',
      evidence: [evidence({ start: 0, end: 4, sourceId: 'zone' })],
    });
    const match = snapshot([zone], true);
    const selected = selectHover(source, match, { line: 0, character: 1 });

    const value = markdown(
      createHover(
        selected!,
        match,
        details([
          detail({ path: zone.path, name: '구역', definition: '확인한 본문' }),
        ]),
      ),
    );
    expect(value).toContain('확인한 본문');
    expect(value).toContain('후보가 누락될 수 있습니다');
  });

  it('완전한 매칭 없음은 null이고 부분 매칭 없음은 누락 안내다', () => {
    expect(createEmptyHover(snapshot([]))).toBeNull();
    expect(createEmptyHover(snapshot([], true))).toMatchObject({
      contents: { kind: 'markdown' },
    });
  });

  it('준비 상태와 조회 실패를 서로 다른 안내로 표시한다', () => {
    const preparing = createStatusHover({
      state: workspaceLifecycleStates.starting,
      ready: false,
    });
    const failed = createStatusHover(
      { state: workspaceLifecycleStates.failed, ready: false },
      {
        code: workspaceDiagnosticCodes.readFailed,
        severity: diagnosticSeverities.error,
        message: 'fixture failure',
      },
    );

    expect(markdown(preparing)).toContain('준비');
    expect(markdown(failed)).toContain('불러오지 못했습니다');
    const rebuilding = createStatusHover(
      { state: workspaceLifecycleStates.refreshing, ready: false },
      {
        code: workspaceDiagnosticCodes.indexNotReady,
        severity: diagnosticSeverities.error,
        message: '문서 색인을 구성하는 중입니다.',
      },
    );
    expect(markdown(rebuilding)).toContain('준비');
  });

  it('선택 경로는 같은 식별자 후보만 중복 없이 유지한다', () => {
    const source = document('zone');
    const repeated = candidate({
      path: '.codocs/zone.yaml',
      evidence: [
        evidence({ start: 0, end: 4, sourceId: 'zone' }),
        evidence({ start: 0, end: 4, sourceId: 'zone' }),
      ],
    });
    const selected = selectHover(source, snapshot([repeated]), {
      line: 0,
      character: 1,
    });

    expect(hoverCandidatePaths(selected!)).toEqual([repeated.path]);
  });
});
