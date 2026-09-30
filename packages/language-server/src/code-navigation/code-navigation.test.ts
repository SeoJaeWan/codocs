import { describe, expect, it, vi } from 'vitest';
import { CodeNavigation, type CodeOwner, type CodeSession } from './index.js';
import { codeCollectionStatuses, codeFileReasons } from '@codocs/workspace';
import type { WorkspaceCodeReferenceQuery } from '@codocs/workspace';
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
