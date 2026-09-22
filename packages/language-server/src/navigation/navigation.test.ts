import { describe, expect, it, vi } from 'vitest';
import { catalogConfirmations } from '@codocs/core';
import type { WorkspacePathDocumentResult } from '@codocs/workspace';
import { SourceSelections, type CandidateSession } from './index.js';

const target: WorkspacePathDocumentResult = {
  path: '.codocs/target.yaml',
  found: true,
  source: {
    path: '.codocs/target.yaml',
    uri: 'file:///root/.codocs/target.yaml',
  },
  confirmation: catalogConfirmations.confirmed,
  document: { id: 'target', name: '대상' },
  diagnostics: [],
};
const sourceUri = 'file:///root/source.ts';

describe('SourceSelections', () => {
  it('같은 관측의 반복 Hover는 같은 토큰을 재사용하고 공개 API로 최신 후보를 확인한다', async () => {
    const session: CandidateSession = {
      captureCandidate: vi.fn(() => 'workspace-token'),
      confirmCandidate: vi.fn(() =>
        Promise.resolve({ catalogVersion: 2, result: target }),
      ),
      releaseCandidate: vi.fn(),
    };
    const selections = new SourceSelections();
    const origin = { text: 'target' };
    const selected = selections.capture(
      sourceUri,
      1,
      session,
      origin,
      target,
      1,
    );
    expect(
      selections.capture(sourceUri, 1, session, origin, target, 1),
    ).toEqual(selected);
    expect(session.captureCandidate).toHaveBeenCalledTimes(1);
    expect(await selections.confirm(selected, () => true)).toEqual({
      uri: target.source.uri,
    });
    expect(session.confirmCandidate).toHaveBeenCalledWith('workspace-token');
  });

  it('확인 중 출처가 닫히면 늦게 완료된 후보를 열지 않는다', async () => {
    let finish!: (value: {
      catalogVersion: number;
      result: WorkspacePathDocumentResult;
    }) => void;
    const pending = new Promise<{
      catalogVersion: number;
      result: WorkspacePathDocumentResult;
    }>((resolve) => {
      finish = resolve;
    });
    const session: CandidateSession = {
      captureCandidate: () => 'workspace-token',
      confirmCandidate: () => pending,
      releaseCandidate: vi.fn(),
    };
    const selections = new SourceSelections();
    const selected = selections.capture(
      sourceUri,
      1,
      session,
      { text: 'target' },
      target,
      1,
    );
    const result = selections.confirm(selected, () => true);
    selections.release(sourceUri);
    finish({ catalogVersion: 1, result: target });
    expect(await result).toBeNull();
    expect(session.releaseCandidate).toHaveBeenCalledWith('workspace-token');
  });

  it('관계 출처를 확인할 API가 없으면 실행 불가능한 링크 토큰을 발급하지 않는다', async () => {
    const session: CandidateSession = {
      captureCandidate: vi.fn(),
      confirmCandidate: vi.fn(),
      releaseCandidate: vi.fn(),
    };
    const selections = new SourceSelections();
    const selected = selections.capture(
      sourceUri,
      1,
      session,
      undefined,
      target,
      1,
    );
    expect(selected).toBeUndefined();
    expect(selections.has(selected)).toBe(false);
    expect(await selections.confirm(selected, () => true)).toBeNull();
    expect(session.confirmCandidate).not.toHaveBeenCalled();
  });
});
