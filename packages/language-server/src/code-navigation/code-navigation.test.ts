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
    };
    const session = {
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'complete' }),
      setCodeReferenceOwner: vi.fn(),
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
    };
    const session = {
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'complete' }),
      setCodeReferenceOwner: vi.fn(),
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
    };
    const session = {
      getByPaths: vi
        .fn()
        .mockResolvedValue({ success: true, scanStatus: 'complete' }),
      setCodeReferenceOwner: vi.fn(),
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
  it('수집 중 확인 1개는 개별 tooltip 링크만 제공하고 단일 command를 만들지 않는다', async () => {
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
    };
    const session = {
      setCodeReferenceOwner: vi.fn(),
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
    // @codocs [[IDE 지원]]#L51-L54
    expect(hints[0]!.label).toEqual([{ value: '확인된 코드 1곳 · 수집 중' }]);
    expect((hints[0]!.tooltip as { value: string }).value).toContain(
      'source\\.ts:1:4',
    );
    expect((hints[0]!.tooltip as { value: string }).value).toContain(
      'command:codocs.openSource?',
    );
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
    };
    const session = {
      setCodeReferenceOwner: vi.fn(),
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
