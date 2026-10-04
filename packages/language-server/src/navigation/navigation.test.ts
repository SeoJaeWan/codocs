import { describe, expect, it, vi } from 'vitest';
import { catalogConfirmations } from '@codocs/core';
import type { WorkspacePathDocumentResult } from '@codocs/workspace';
import {
  SourceSelections,
  selectionTarget,
  type CandidateSession,
} from './index.js';

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
  it('인코딩만 다른 출처도 같은 토큰으로 확인하거나 resolve하지 않는다', async () => {
    const session: CandidateSession = {
      captureCandidate: () => 'workspace-token',
      confirmCandidate: vi.fn(),
      releaseCandidate: vi.fn(),
    };
    const selections = new SourceSelections();
    const selected = selections.capture(
      'file:///c%3A/space%20/source.ts',
      1,
      session,
      { reference: { name: 'target' }, sourcePath: '.codocs/source.yaml' },
      target,
      1,
    )!;
    const altered = {
      ...selected,
      sourceUri: decodeURIComponent(selected.sourceUri),
    };
    expect(selections.has(altered)).toBe(false);
    expect(await selections.confirm(altered, () => true)).toBeNull();
    expect(session.confirmCandidate).not.toHaveBeenCalled();
  });
  it('같은 관측의 반복 Hover는 같은 토큰을 재사용하고 공개 API로 최신 후보를 확인한다', async () => {
    const session: CandidateSession = {
      captureCandidate: vi.fn(() => 'workspace-token'),
      confirmCandidate: vi.fn(() =>
        Promise.resolve({ catalogVersion: 2, result: target }),
      ),
      releaseCandidate: vi.fn(),
    };
    const selections = new SourceSelections();
    const origin = {
      reference: { name: 'target' },
      sourcePath: '.codocs/source.yaml',
    };
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
      { reference: { name: 'target' }, sourcePath: '.codocs/source.yaml' },
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

describe('selectionTarget', () => {
  it.each([
    'file:///c%3A/Work%20space/source.ts',
    'file:///C:/%ED%95%9C%EA%B8%80/%E6%96%87%E6%9B%B8.ts',
    'file:///c%3A/work/percent%25%23source.ts',
    'file:///c%3A/work/literal%2520%2523%25ED%2595%259C.ts',
  ])(
    '출처 %s와 토큰을 서버 resolve와 Host 디코딩에서 그대로 복원한다',
    (uri) => {
      const selected = { sourceUri: uri, token: 'a'.repeat(32) };
      const target = selectionTarget(selected);
      const query = target.slice(target.indexOf('?') + 1);
      expect(JSON.parse(decodeURIComponent(query))).toEqual([selected]);
      // VS Code 1.139.1 URI.parse의 query 디코딩 뒤 CommandOpener가 다시 디코딩한다.
      // 실제 마우스 클릭 경계는 설치한 VSIX의 양 OS CI가 별도로 확인한다.
      expect(JSON.parse(decodeURIComponent(decodeURIComponent(query)))).toEqual(
        [selected],
      );
      expect(target.startsWith('command:codocs.openSource?')).toBe(true);
    },
  );
});
