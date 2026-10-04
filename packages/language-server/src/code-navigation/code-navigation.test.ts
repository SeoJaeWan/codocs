import { describe, expect, it, vi } from 'vitest';
import { CodeNavigation, type CodeOwner, type CodeSession } from './index.js';
import { codeCollectionStatuses, codeFileReasons } from '@codocs/workspace';
import type { WorkspaceCodeReferenceQuery } from '@codocs/workspace';
import { codeCollectionMessages } from './domain-values.js';
import type { DocumentLink } from 'vscode-languageserver/node.js';
const ownerBase = {
  uri: 'file:///fixture/.codocs/target.yaml',
  path: '.codocs/target.yaml',
  rootPath: '/fixture',
  version: 1,
  text: 'id: target',
};
describe('완료되지 않은 코드 수집 표현', () => {
  it.each([
    codeCollectionStatuses.collecting,
    codeCollectionStatuses.incomplete,
  ])('수집 상태 %s의 확인 0개는 Hint를 제거하지 않는다', async (status) => {
    const query: WorkspaceCodeReferenceQuery = {
      status,
      codeGeneration: 1,
      documentGeneration: 1,
      occurrences: [],
      confirmedCount: 0,
      failures: [],
      unique: false,
      absent: false,
      hasCompletedCollection: true,
    };
    const session = {
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'complete' }),
      setCodeReferenceOwner: vi.fn(),
      codeReferenceSnapshot: vi
        .fn()
        .mockResolvedValue({ hasCompletedCollection: true }),
      updateCodeBuffer: vi.fn(),
      codeReferencesForDocument: vi.fn().mockResolvedValue(query),
    } as unknown as CodeSession;
    const owner: CodeOwner = { ...ownerBase, session };
    const navigation = new CodeNavigation();
    const hints = await navigation.hints(owner);
    expect(hints).toHaveLength(1);
    expect(hints[0]!.label).toEqual([
      {
        value:
          status === codeCollectionStatuses.collecting
            ? '확인된 코드 0곳 · 수집 중'
            : '확인된 코드 0곳 · 수집 불완전',
      },
    ]);
  });
  it('수집 불완전의 실패 이유는 확인한 위치와 별도로 안내한다', async () => {
    const query: WorkspaceCodeReferenceQuery = {
      status: codeCollectionStatuses.incomplete,
      codeGeneration: 1,
      documentGeneration: 1,
      occurrences: [],
      confirmedCount: 0,
      failures: [
        { path: 'locked', reason: codeFileReasons.read, message: '읽기 거부' },
      ],
      unique: false,
      absent: false,
      hasCompletedCollection: true,
    };
    const session = {
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'complete' }),
      setCodeReferenceOwner: vi.fn(),
      codeReferenceSnapshot: vi
        .fn()
        .mockResolvedValue({ hasCompletedCollection: true }),
      updateCodeBuffer: vi.fn(),
      codeReferencesForDocument: vi.fn().mockResolvedValue(query),
    } as unknown as CodeSession;
    const owner: CodeOwner = { ...ownerBase, session };
    const navigation = new CodeNavigation();
    const hints = await navigation.hints(owner);
    expect((hints[0]!.tooltip as { value: string }).value).toContain(
      '읽기 거부',
    );
  });
});

describe('코드 변경 감시 실패의 표현', () => {
  const watchFailure = {
    path: '',
    reason: codeFileReasons.watch,
    message: 'EPERM: operation not permitted, watch',
  };
  const readFailure = {
    path: 'locked',
    reason: codeFileReasons.read,
    message: '읽기 거부',
  };
  /** 실패 목록을 가진 미완료 수집의 Hint를 만든다. */
  async function present(failures: WorkspaceCodeReferenceQuery['failures']) {
    const query: WorkspaceCodeReferenceQuery = {
      status: codeCollectionStatuses.incomplete,
      codeGeneration: 1,
      documentGeneration: 1,
      occurrences: [],
      confirmedCount: 0,
      failures,
      unique: false,
      absent: false,
      hasCompletedCollection: true,
    };
    const session = {
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'complete' }),
      setCodeReferenceOwner: vi.fn(),
      codeReferenceSnapshot: vi
        .fn()
        .mockResolvedValue({ hasCompletedCollection: true }),
      updateCodeBuffer: vi.fn(),
      codeReferencesForDocument: vi.fn().mockResolvedValue(query),
    } as unknown as CodeSession;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hints = await new CodeNavigation().hints({ ...ownerBase, session });
    const logged = error.mock.calls.flat().join(' ');
    error.mockRestore();
    return {
      label: (hints[0]!.label as { value: string }[])[0]!.value,
      tooltip: (hints[0]!.tooltip as { value: string }).value,
      logged,
    };
  }
  it('감시 실패만 있으면 상단 표시가 감시 재연결 중이 된다', async () => {
    const { label } = await present([watchFailure]);
    expect(label).toBe(
      `확인된 코드 0곳 · ${codeCollectionMessages.reconnectingLabel}`,
    );
  });
  it('감시 실패만 있으면 호버에 재연결 안내를 두고 원문 오류를 숨긴다', async () => {
    const { tooltip } = await present([watchFailure]);
    expect(tooltip).toContain(codeCollectionMessages.reconnectingGuidance);
    expect(tooltip).not.toContain('EPERM');
  });
  it('감시 실패의 원문 메시지는 콘솔 오류로 남긴다', async () => {
    const { logged } = await present([watchFailure]);
    expect(logged).toContain('EPERM');
  });
  it('읽기 실패가 함께 있으면 상단 표시가 수집 불완전을 유지한다', async () => {
    const { label } = await present([watchFailure, readFailure]);
    expect(label).toBe('확인된 코드 0곳 · 수집 불완전');
  });
  it('읽기 실패가 함께 있으면 호버에 읽기 실패와 재연결 안내를 함께 둔다', async () => {
    const { tooltip } = await present([watchFailure, readFailure]);
    expect(tooltip).toContain('읽기 거부');
    expect(tooltip).toContain(codeCollectionMessages.reconnectingGuidance);
    expect(tooltip).not.toContain('EPERM');
  });
});

describe('미완료 단일 출현과 저장 문서 탐색', () => {
  it('수집 중 확인 1개는 이전 결과처럼 개별 tooltip 링크와 단일 command를 제공한다', async () => {
    const occurrence = {
      occurrenceId: 'one',
      sourcePath: 'source.ts',
      sourceRevision: 'disk:1',
      marker: {
        range: {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 20 },
        },
      },
    };
    const query = {
      status: codeCollectionStatuses.collecting,
      codeGeneration: 1,
      documentGeneration: 1,
      occurrences: [occurrence],
      confirmedCount: 1,
      failures: [],
      unique: false,
      absent: false,
      hasCompletedCollection: true,
    };
    const session = {
      setCodeReferenceOwner: vi.fn(),
      codeReferenceSnapshot: vi
        .fn()
        .mockResolvedValue({ hasCompletedCollection: true }),
      updateCodeBuffer: vi.fn(),
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'complete' }),
      codeReferencesForDocument: vi.fn().mockResolvedValue(query),
      captureCodeReference: vi.fn().mockResolvedValue('workspace-token'),
    } as unknown as CodeSession;
    const owner: CodeOwner = { ...ownerBase, session };
    const navigation = new CodeNavigation();
    const hints = await navigation.hints(owner);
    expect((hints[0]!.label as { value: string }[])[0]!.value).toBe(
      '확인된 코드 1곳 · 수집 중',
    );
    expect((hints[0]!.tooltip as { value: string }).value).toContain(
      'source\\.ts:1:4',
    );
    expect((hints[0]!.tooltip as { value: string }).value).toContain(
      'command:codocs.openSource?',
    );
    expect(
      (hints[0]!.label as { command?: unknown }[])[0]!.command,
    ).toBeDefined();
  });
  it('코드 수집 완료여도 저장 문서 탐색이 partial이면 0개를 연결 없음으로 확정하지 않는다', async () => {
    const query: WorkspaceCodeReferenceQuery = {
      status: codeCollectionStatuses.complete,
      codeGeneration: 1,
      documentGeneration: 1,
      occurrences: [],
      confirmedCount: 0,
      failures: [],
      unique: false,
      absent: false,
      hasCompletedCollection: true,
    };
    const session = {
      setCodeReferenceOwner: vi.fn(),
      codeReferenceSnapshot: vi
        .fn()
        .mockResolvedValue({ hasCompletedCollection: true }),
      updateCodeBuffer: vi.fn(),
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'partial' }),
      codeReferencesForDocument: vi.fn().mockResolvedValue(query),
    } as unknown as CodeSession;
    const owner: CodeOwner = { ...ownerBase, session };
    const navigation = new CodeNavigation();
    const hints = await navigation.hints(owner);
    expect(hints[0]!.label).toEqual([
      { value: '확인된 코드 0곳 · 문서 탐색 미확인' },
    ]);
  });
});

describe('검색 제외 후 같은 buffer의 재포함', () => {
  it('정책상 제외된 등록은 캐시하지 않고 재포함 후 현재 dirty 원문을 등록한다', async () => {
    const updateCodeBuffer = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const session = {
      setCodeReferenceOwner: vi.fn(),
      codeReferenceSnapshot: vi
        .fn()
        .mockResolvedValue({ hasCompletedCollection: true }),
      updateCodeBuffer,
    } as unknown as CodeSession;
    const owner: CodeOwner = { ...ownerBase, text: '현재 dirty 원문', session };
    const navigation = new CodeNavigation();
    await navigation.prepare(owner);
    await navigation.prepare(owner);
    await navigation.prepare(owner);
    expect(updateCodeBuffer).toHaveBeenCalledTimes(2);
    expect(updateCodeBuffer).toHaveBeenLastCalledWith({
      sourcePath: owner.path,
      text: owner.text,
      documentVersion: owner.version,
    });
  });
});

/** 한 행 범위를 가진 단일 출현 fixture다. */
const rowOccurrence = {
  occurrenceId: 'one',
  sourcePath: 'source.ts',
  sourceRevision: 'disk:1',
  marker: {
    range: {
      start: { line: 0, character: 3 },
      end: { line: 0, character: 20 },
    },
  },
  target: { path: '.codocs/target.yaml' },
  destination: { kind: 'rows', startLine: 1, endLine: 4 },
};
/** 상태와 출현 수를 정한 역참조 session과 호출 기록을 만든다. */
function reverseSession(
  fields: Partial<WorkspaceCodeReferenceQuery>,
  occurrences: unknown[],
) {
  const query = {
    status: codeCollectionStatuses.complete,
    hasCompletedCollection: true,
    codeGeneration: 1,
    documentGeneration: 1,
    occurrences,
    confirmedCount: occurrences.length,
    failures: [],
    unique: false,
    absent: false,
    ...fields,
  };
  const session = {
    setCodeReferenceOwner: vi.fn(),
    updateCodeBuffer: vi.fn(),
    codeReferenceSnapshot: vi.fn().mockResolvedValue(query),
    codeReferencesForRows: vi.fn().mockResolvedValue(query),
    codeReferencesForDocument: vi.fn().mockResolvedValue(query),
    getByPaths: vi
      .fn()
      .mockResolvedValue({ success: true, scanStatus: 'complete' }),
    captureCodeReference: vi.fn().mockResolvedValue('workspace-token'),
  };
  return { session: session as unknown as CodeSession, raw: session };
}
/** [start, end) 열 범위의 YAML 링크 fixture를 만든다. */
function yamlLink(line: number, start: number, end: number): DocumentLink {
  return {
    range: {
      start: { line, character: start },
      end: { line, character: end },
    },
  };
}
describe('역참조 밑줄의 공백 제외', () => {
  const text = '  본문 하나  \n\t\n  [[A]]  [[B]]  \na [[A]] b';
  it('들여쓰기·링크 사이·행 끝 공백에는 링크를 만들지 않고 본문 구간은 유지한다', async () => {
    const { session } = reverseSession({}, [rowOccurrence]);
    const links = await new CodeNavigation().reverseLinks(
      { ...ownerBase, text, session },
      [yamlLink(2, 2, 7), yamlLink(2, 9, 14), yamlLink(3, 2, 7)],
    );
    expect(links.map((link) => link.range)).toEqual([
      { start: { line: 0, character: 2 }, end: { line: 0, character: 7 } },
      { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } },
      { start: { line: 3, character: 8 }, end: { line: 3, character: 9 } },
    ]);
  });
  it.each([
    codeCollectionStatuses.incomplete,
    codeCollectionStatuses.collecting,
  ])(
    '상태 %s의 단일 출현도 완료처럼 밑줄 직접 링크를 만든다',
    async (status) => {
      const { session } = reverseSession({ status }, [rowOccurrence]);
      const links = await new CodeNavigation().reverseLinks(
        { ...ownerBase, text, session },
        [],
      );
      expect(links.length).toBeGreaterThan(0);
    },
  );
  it('출현이 둘이면 밑줄 링크를 만들지 않는다', async () => {
    const { session } = reverseSession({}, [
      rowOccurrence,
      { ...rowOccurrence, occurrenceId: 'two' },
    ]);
    expect(
      await new CodeNavigation().reverseLinks(
        { ...ownerBase, text, session },
        [],
      ),
    ).toEqual([]);
  });
});

describe('최초 수집 중의 표현', () => {
  const initial = {
    status: codeCollectionStatuses.collecting,
    hasCompletedCollection: false,
  };
  it('최초 수집 중에는 밑줄·@ 링크·진단을 만들지 않는다', async () => {
    const { session, raw } = reverseSession(initial, [rowOccurrence]);
    const owner: CodeOwner = {
      ...ownerBase,
      path: '.codocs/target.yaml',
      session,
    };
    const navigation = new CodeNavigation();
    expect(await navigation.reverseLinks(owner, [])).toEqual([]);
    expect(await navigation.forward(owner)).toEqual({
      links: [],
      diagnostics: [],
    });
    expect(raw.captureCodeReference).not.toHaveBeenCalled();
  });
  it('최초 수집 중 호버와 상단 Hint는 개별 링크 없이 수집 중 안내만 보인다', async () => {
    const { session, raw } = reverseSession(initial, [rowOccurrence]);
    const navigation = new CodeNavigation();
    const owner: CodeOwner = { ...ownerBase, session };
    expect(await navigation.reverseHover(owner, 0)).toBe(
      codeCollectionMessages.initialLabel,
    );
    const hints = await navigation.hints(owner);
    expect(hints).toHaveLength(1);
    expect(hints[0]!.label).toEqual([
      { value: codeCollectionMessages.initialLabel },
    ]);
    expect((hints[0]!.tooltip as { value: string }).value).toBe(
      codeCollectionMessages.initialLabel,
    );
    expect(raw.captureCodeReference).not.toHaveBeenCalled();
  });
  it('최초 수집이 끝나지 않아도 준비 요청은 수집을 기다리지 않는다', async () => {
    const pending = new Promise<boolean>(() => undefined);
    const { raw } = reverseSession(initial, []);
    raw.updateCodeBuffer = vi.fn().mockReturnValue(pending);
    const navigation = new CodeNavigation();
    const owner: CodeOwner = {
      ...ownerBase,
      session: raw as unknown as CodeSession,
    };
    await navigation.prepare(owner);
    await navigation.prepare(owner);
    expect(raw.updateCodeBuffer).toHaveBeenCalledTimes(1);
    expect(await navigation.hints(owner)).toHaveLength(1);
  });
});

describe('재수집과 불완전 수집의 호버 표현', () => {
  it('완료 뒤 재수집 중에는 이전 결과 링크를 두고 수집 중을 덧붙인다', async () => {
    const { session } = reverseSession(
      { status: codeCollectionStatuses.collecting },
      [rowOccurrence],
    );
    const text = await new CodeNavigation().reverseHover(
      { ...ownerBase, session },
      0,
    );
    expect(text).toContain('command:codocs.openSource?');
    expect(text).toContain('수집 중');
  });
  it('수집 불완전에서도 수집한 출현 링크와 실패 이유를 함께 보인다', async () => {
    const { session } = reverseSession(
      {
        status: codeCollectionStatuses.incomplete,
        failures: [
          {
            path: 'locked',
            reason: codeFileReasons.read,
            message: '읽기 거부',
          },
        ],
      },
      [rowOccurrence],
    );
    const text = await new CodeNavigation().reverseHover(
      { ...ownerBase, session },
      0,
    );
    expect(text).toContain('command:codocs.openSource?');
    expect(text).toContain('수집 불완전');
    expect(text).toContain('읽기 거부');
  });
});
