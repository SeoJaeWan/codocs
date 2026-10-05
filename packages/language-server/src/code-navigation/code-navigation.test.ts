import { describe, expect, it, vi } from 'vitest';
import { CodeNavigation, type CodeOwner, type CodeSession } from './index.js';
import { codeCollectionStatuses, codeFileReasons } from '@codocs/workspace';
import type { WorkspaceCodeReferenceQuery } from '@codocs/workspace';
import { codeCollectionMessages } from './domain-values.js';
const ownerBase = {
  uri: 'file:///fixture/.codocs/target.yaml',
  path: '.codocs/target.yaml',
  rootPath: '/fixture',
  version: 1,
  text: '_codocs:\n  id: target\n  name: 대상\n',
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
  it('수집 중 확인 1개는 클릭 명령 없이 개수 Hint와 개별 tooltip 링크를 제공한다', async () => {
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
    ).toBeUndefined();
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

/** 섹션 키가 있는 문서 원문이다. */
const sectionText =
  '_codocs:\n  id: target\n  name: 대상\n환불정책:\n  본문: 값\n';
const nameOffset = sectionText.indexOf('대상');
const keyOffset = sectionText.indexOf('환불정책');
/** 단일 출현 fixture다. */
const codeOccurrence = {
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
};
/** 상태와 출현 목록을 정한 역참조 session과 호출 기록을 만든다. */
function reverseSession(
  fields: Partial<WorkspaceCodeReferenceQuery>,
  occurrences: unknown[],
  sections: Record<string, unknown[]> = {},
) {
  /** 출현 목록으로 질의 결과를 만든다. */
  const queryOf = (items: unknown[]) => ({
    status: codeCollectionStatuses.complete,
    hasCompletedCollection: true,
    codeGeneration: 1,
    documentGeneration: 1,
    occurrences: items,
    confirmedCount: items.length,
    failures: [],
    unique: false,
    absent: items.length === 0,
    ...fields,
  });
  const session = {
    setCodeReferenceOwner: vi.fn(),
    updateCodeBuffer: vi.fn(),
    codeReferenceSnapshot: vi.fn().mockResolvedValue(queryOf(occurrences)),
    codeReferencesForSection: vi
      .fn()
      .mockImplementation((_path: string, section: string) =>
        Promise.resolve(queryOf(sections[section] ?? occurrences)),
      ),
    codeReferencesForDocument: vi.fn().mockResolvedValue(queryOf(occurrences)),
    getByPaths: vi
      .fn()
      .mockResolvedValue({ success: true, scanStatus: 'complete' }),
    captureCodeReference: vi.fn().mockResolvedValue('workspace-token'),
  };
  return { session: session as unknown as CodeSession, raw: session };
}
describe('섹션 키와 name 값의 역참조 호버', () => {
  /** 같은 형식의 목록에서 항목 줄만 센다. */
  const itemLines = (text: string) =>
    text.split('\n').filter((line) => line.startsWith('- ['));
  it.each([1, 3])(
    '섹션 키 위 호버는 출현 %i개를 같은 목록 형식으로 보여준다',
    async (count) => {
      const items = Array.from({ length: count }, (_, index) => ({
        ...codeOccurrence,
        occurrenceId: String(index),
      }));
      const { session, raw } = reverseSession({}, [], { 환불정책: items });
      const text = await new CodeNavigation().reverseHover(
        { ...ownerBase, text: sectionText, session },
        keyOffset,
      );
      expect(raw.codeReferencesForSection).toHaveBeenCalledWith(
        '.codocs/target.yaml',
        '환불정책',
      );
      expect(text.split('\n')[0]).toBe(`연결된 코드 · ${count}곳`);
      expect(itemLines(text)).toHaveLength(count);
      expect(text).toContain('command:codocs.openSource?');
    },
  );
  it('name 값 위 호버는 문서 전체 참조 목록을 보여준다', async () => {
    const { session, raw } = reverseSession({}, [codeOccurrence]);
    const text = await new CodeNavigation().reverseHover(
      { ...ownerBase, text: sectionText, session },
      nameOffset,
    );
    expect(raw.codeReferencesForDocument).toHaveBeenCalled();
    expect(raw.codeReferencesForSection).not.toHaveBeenCalled();
    expect(itemLines(text)).toHaveLength(1);
  });
  it('섹션 키와 name 값이 아닌 위치의 호버는 조회 없이 비어 있다', async () => {
    const { session, raw } = reverseSession({}, [codeOccurrence]);
    const text = await new CodeNavigation().reverseHover(
      { ...ownerBase, text: sectionText, session },
      sectionText.indexOf('값'),
    );
    expect(text).toBe('');
    expect(raw.codeReferencesForSection).not.toHaveBeenCalled();
    expect(raw.codeReferencesForDocument).not.toHaveBeenCalled();
  });
  it('섹션 키 위인데 참조 항목이 없으면 빈 문자열이다', async () => {
    const { session } = reverseSession({}, [], { 환불정책: [] });
    expect(
      await new CodeNavigation().reverseHover(
        { ...ownerBase, text: sectionText, session },
        keyOffset,
      ),
    ).toBe('');
  });
});
describe('개수 Hint', () => {
  it('섹션 키 끝에 클릭 명령 없는 코드 N곳 Hint를 표시한다', async () => {
    const items = [codeOccurrence, { ...codeOccurrence, occurrenceId: 'two' }];
    const { session } = reverseSession({}, [], { 환불정책: items });
    const hints = await new CodeNavigation().hints({
      ...ownerBase,
      text: sectionText,
      session,
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      position: { line: 3, character: '환불정책'.length },
      label: [{ value: '코드 2곳' }],
    });
    expect(
      (hints[0]!.label as { command?: unknown }[])[0]!.command,
    ).toBeUndefined();
  });
  it('문서 전체 참조가 있으면 첫 행에 코드 N곳 Hint를 표시한다', async () => {
    const { session } = reverseSession({}, [codeOccurrence], { 환불정책: [] });
    const hints = await new CodeNavigation().hints({
      ...ownerBase,
      text: sectionText,
      session,
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      position: { line: 0, character: 0 },
      label: [{ value: '코드 1곳' }],
    });
  });
  it('참조가 없는 섹션에는 Hint를 표시하지 않는다', async () => {
    const { session } = reverseSession({}, [], { 환불정책: [] });
    expect(
      await new CodeNavigation().hints({
        ...ownerBase,
        text: sectionText,
        session,
      }),
    ).toEqual([]);
  });
});

describe('최초 수집 중의 표현', () => {
  const initial = {
    status: codeCollectionStatuses.collecting,
    hasCompletedCollection: false,
  };
  it('최초 수집 중에는 @ 링크와 진단을 만들지 않는다', async () => {
    const { session, raw } = reverseSession(initial, [codeOccurrence]);
    const owner: CodeOwner = {
      ...ownerBase,
      path: '.codocs/target.yaml',
      session,
    };
    const navigation = new CodeNavigation();
    expect(await navigation.forward(owner)).toEqual({
      links: [],
      diagnostics: [],
    });
    expect(raw.captureCodeReference).not.toHaveBeenCalled();
  });
  it('최초 수집 중 호버와 상단 Hint는 개별 링크 없이 수집 중 안내만 보인다', async () => {
    const { session, raw } = reverseSession(initial, [codeOccurrence]);
    const navigation = new CodeNavigation();
    const owner: CodeOwner = { ...ownerBase, text: sectionText, session };
    expect(await navigation.reverseHover(owner, keyOffset)).toBe(
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
      [codeOccurrence],
    );
    const text = await new CodeNavigation().reverseHover(
      { ...ownerBase, text: sectionText, session },
      keyOffset,
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
      [codeOccurrence],
    );
    const text = await new CodeNavigation().reverseHover(
      { ...ownerBase, text: sectionText, session },
      keyOffset,
    );
    expect(text).toContain('command:codocs.openSource?');
    expect(text).toContain('수집 불완전');
    expect(text).toContain('읽기 거부');
  });
});
