/** 이름 변경 반영에서 파일별로 보고하는 실제 상태다. @domainValues */
export const workspaceRenameFileStates = {
  /** 새 내용으로 교체했고 그대로 남아 있다. */
  changed: 'changed',
  /** 중간 실패 뒤 원래 내용으로 되돌렸다. */
  restored: 'restored',
  /** 중간 실패 뒤 원래 내용으로 되돌리지 못해 새 내용이 남아 있을 수 있다. */
  restoreFailed: 'restore_failed',
  /** 이 요청이 바꾸지 않았다. */
  unchanged: 'unchanged',
} as const;
/** 원본 상수에서 도출한 이름 변경 파일 상태 타입이다. */
export type WorkspaceRenameFileState =
  (typeof workspaceRenameFileStates)[keyof typeof workspaceRenameFileStates];
