import { diagnosticSeverities } from '@codocs/core';
import {
  workspaceDiagnosticCodes,
  workspaceLifecycleStates,
} from '@codocs/workspace';
import type { WorkspacePathDocumentResult } from '@codocs/workspace';
import { describe, expect, it } from 'vitest';
import {
  createEmptyHover,
  createStatusHover,
  detailLabel,
  escapeMarkdown,
} from './index.js';

function markdown(hover: ReturnType<typeof createStatusHover>): string {
  const contents = hover.contents;
  return typeof contents === 'object' &&
    !Array.isArray(contents) &&
    'value' in contents
    ? contents.value
    : (JSON.stringify(contents) ?? '');
}

describe('Hover 상태: 부분 결과·준비·실패·없음', () => {
  it('완전한 관측에서 표시할 내용이 없으면 null이고 부분 관측이면 누락 안내를 반환한다', () => {
    expect(createEmptyHover(false)).toBeNull();
    const partial = createEmptyHover(true);
    expect(partial).toMatchObject({ contents: { kind: 'markdown' } });
    expect(markdown(partial!)).toContain('후보가 누락될 수 있습니다');
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
});

describe('Hover Markdown 이스케이프', () => {
  it('사용자 제공 텍스트의 링크·명령·서식 문자를 이스케이프하면 서식으로 해석되지 않는다', () => {
    expect(escapeMarkdown('[x](command:evil) *b*')).toBe(
      '\\[x\\]\\(command:evil\\) \\*b\\*',
    );
  });
});

describe('동명 후보 경로 표시', () => {
  /** 이름이 같은 후보 결과를 경로만 바꿔 만든다. */
  function candidate(documentPath: string): WorkspacePathDocumentResult {
    return {
      path: documentPath,
      found: true,
      source: { path: documentPath, uri: `file:///${documentPath}` },
    } as unknown as WorkspacePathDocumentResult;
  }

  it('루트 .codocs 문서는 .codocs/를 뺀 경로를 보여준다', () => {
    const peers = [
      candidate('.codocs/payment/reservation.yaml'),
      candidate('.codocs/shipping/reservation.yaml'),
    ];
    expect(detailLabel(peers[0]!, peers)).toBe(
      'reservation.yaml — payment/reservation.yaml',
    );
  });

  it('하위 .codocs 문서는 프로젝트 기준 전체 경로를 `/`로 보여준다', () => {
    const peers = [
      candidate('.codocs/a.yaml'),
      candidate('packages/core/.codocs/a.yaml'),
    ];
    expect(detailLabel(peers[0]!, peers)).toBe('a.yaml — a.yaml');
    expect(detailLabel(peers[1]!, peers)).toBe(
      'a.yaml — packages/core/.codocs/a.yaml',
    );
  });
});
