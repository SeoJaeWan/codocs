import { scanStatuses, referenceResolutionStatuses } from '@codocs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { loadWorkspace, type WorkspaceScanResult } from '../loader/index.js';
import { WorkspaceQuerySession } from './index.js';

const watcher = vi.hoisted(() => ({
  subscribe: vi.fn(),
  trackTargets: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  readiness: { state: 'ready', ready: true },
}));
vi.mock('../watcher/index.js', () => ({
  createWorkspaceWatcher: vi
    .fn()
    .mockImplementation(() => Promise.resolve(watcher)),
}));
vi.mock('../loader/index.js', () => ({ loadWorkspace: vi.fn() }));

const root = {
  startCwd: process.cwd(),
  projectRoot: process.cwd(),
  realPath: process.cwd(),
  codocsPath: path.join(process.cwd(), '.codocs'),
};
const complete: WorkspaceScanResult = {
  status: scanStatuses.complete,
  root,
  documents: [],
  failures: [],
  skippedCycles: [],
  diagnostics: [],
};
let session: WorkspaceQuerySession;

beforeEach(() => {
  vi.mocked(loadWorkspace).mockReset().mockResolvedValue(complete);
  watcher.trackTargets.mockReset().mockResolvedValue(undefined);
  session = new WorkspaceQuerySession();
});
afterEach(async () => {
  await session.close();
});

describe('조회 세션 완료 관측 게시: 로더·감시를 격리한 경합', () => {
  it('갱신 중 조회하면 이전 완료 버전과 refreshing을 함께 반환한다', async () => {
    await session.refresh();
    const version = session.catalogVersion;
    let finish!: (scan: WorkspaceScanResult) => void;
    vi.mocked(loadWorkspace).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const refreshing = session.refresh();
    await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2));
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

  it('관측 게시 전 대상 추적이 실패하면 이전 catalog 버전을 유지한다', async () => {
    await session.refresh();
    const version = session.catalogVersion;
    watcher.trackTargets.mockRejectedValueOnce(new Error('tracking failed'));
    expect(await session.refresh()).toMatchObject({ success: false });
    expect(session.catalogVersion).toBe(version);
  });

  it('명시 갱신 중 닫으면 버전을 게시하지 않고 실패 결과를 반환한다', async () => {
    let finish!: (scan: WorkspaceScanResult) => void;
    vi.mocked(loadWorkspace).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = session.refresh();
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
    expect(loadWorkspace).toHaveBeenCalledTimes(1);
  });
});
