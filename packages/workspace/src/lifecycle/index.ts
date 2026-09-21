/** 파일 감시와 색인 갱신의 현재 준비 상태다. */
export const workspaceLifecycleStates = {
  starting: 'starting',
  ready: 'ready',
  refreshing: 'refreshing',
  recovering: 'recovering',
  failed: 'failed',
  closed: 'closed',
} as const;

/** 공개 lifecycle 상태 값이다. */
export type WorkspaceLifecycleState =
  (typeof workspaceLifecycleStates)[keyof typeof workspaceLifecycleStates];

/** 실패 원인과 수동 복구 안내를 포함한 현재 상태다. */
export interface WorkspaceReadiness {
  state: WorkspaceLifecycleState;
  ready: boolean;
  cause?: string;
  guidance?: string;
}
