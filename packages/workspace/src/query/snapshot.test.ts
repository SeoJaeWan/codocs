import { scanStatuses, referenceResolutionStatuses } from '@codocs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { loadWorkspace, type WorkspaceLoadResult } from '../loader/index.js';
import { WorkspaceQuerySession } from './index.js';
import { workspaceTargetKinds } from '../paths/domain-values.js';

const watcher = vi.hoisted(() => ({
  subscribe: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  settle: vi.fn().mockResolvedValue(undefined),
  drain: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  readiness: { state: 'ready', ready: true },
}));
vi.mock('../watcher/index.js', () => {
  const exportName = 'WorkspaceWatcher';
  return {
    [exportName]: vi.fn(function () {
      return watcher;
    }),
  };
});
vi.mock('../loader/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../loader/index.js')>()),
  loadWorkspace: vi.fn(),
}));

const root = {
  startCwd: process.cwd(),
  projectRoot: process.cwd(),
  realPath: process.cwd(),
  codocsPath: path.join(process.cwd(), '.codocs'),
};
const complete: WorkspaceLoadResult = {
  status: scanStatuses.complete,
  root,
  documents: [],
  observations: [],
  failures: [],
  skippedLinks: [],
  diagnostics: [],
};
let session: WorkspaceQuerySession;

beforeEach(() => {
  vi.mocked(loadWorkspace).mockReset().mockResolvedValue(complete);
  session = new WorkspaceQuerySession();
});
afterEach(async () => {
  await session.close();
});

describe('조회 세션 완료 관측 게시: 로더·감시를 격리한 경합', () => {
  it('갱신 중 조회하면 이전 완료 버전과 refreshing을 함께 반환한다', async () => {
    await session.refresh();
    const version = session.catalogVersion;
    let finish!: (scan: WorkspaceLoadResult) => void;
    vi.mocked(loadWorkspace).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const refreshing = session.refresh();
    await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2), {
      timeout: 5_000,
    });
    const result = await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[없음]]"',
      documentVersion: 1,
    });
    expect(result).toMatchObject({
      success: true,
      catalogVersion: version,
      refreshing: true,
    });
    finish({ ...complete, status: scanStatuses.partial });
    await refreshing;
    expect(session.catalogVersion).toBeGreaterThan(version);
  });

  it('partial 완료 관측이면 빈 후보를 확인된 부재로 반환하지 않는다', async () => {
    vi.mocked(loadWorkspace).mockResolvedValue({
      ...complete,
      status: scanStatuses.partial,
      failures: [
        {
          kind: workspaceTargetKinds.file,
          path: '.codocs/unread.yaml',
          diagnostics: [],
        },
      ],
    });
    const result = await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[없음]]"',
      documentVersion: 1,
    });
    expect(result).toMatchObject({
      success: true,
      scanStatus: scanStatuses.partial,
      occurrences: [
        {
          resolution: {
            status: referenceResolutionStatuses.unconfirmed,
            candidates: [],
          },
        },
      ],
    });
  });

  it('완료 뒤 로더가 실패하면 실패 알림과 실패 응답을 반환한다', async () => {
    await session.refresh();
    const listener = vi.fn();
    session.onDidChangeSnapshot(listener);
    vi.mocked(loadWorkspace).mockRejectedValueOnce(new Error('scan failed'));
    expect(await session.refresh()).toMatchObject({ success: false });
    expect(listener).toHaveBeenLastCalledWith({
      catalogVersion: session.catalogVersion,
      scanStatus: scanStatuses.failed,
    });
    expect(
      await session.references({
        sourcePath: '.codocs/source.yaml',
        text: 'definition: "[[없음]]"',
        documentVersion: 1,
      }),
    ).toMatchObject({ success: false, scanStatus: scanStatuses.failed });
  });

  it('명시 갱신 중 닫으면 버전을 게시하지 않고 실패 결과를 반환한다', async () => {
    let finish!: (scan: WorkspaceLoadResult) => void;
    vi.mocked(loadWorkspace).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = session.refresh();
    await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledOnce(), {
      timeout: 5_000,
    });
    await session.close();
    finish(complete);
    expect(await pending).toMatchObject({ success: false });
    expect(session.catalogVersion).toBe(0);
  });

  it('보유 관측의 live 요청을 반복해도 로더를 다시 호출하지 않는다', async () => {
    await session.refresh();
    await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: 설명',
      documentVersion: 1,
    });
    await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: 추가',
      documentVersion: 2,
    });
    await session.diagnostics();
    await session.diagnostics();
    expect(loadWorkspace).toHaveBeenCalledTimes(1);
  });
});
