/** 파일 반영 결과에서 항목별로 보고하는 실제 상태다. 이름 변경과 여러 파일 반영이 같은 원본을 쓴다. @domainValues */
export const workspaceFileStates = {
  /** 새 내용으로 반영했고 그대로 남아 있다. */
  changed: 'changed',
  /** 중간 실패 뒤 원래 상태로 되돌렸다. */
  restored: 'restored',
  /** 중간 실패 뒤 원래 상태로 되돌리지 못해 새 상태가 남아 있을 수 있다. */
  restoreFailed: 'restore_failed',
  /** 이 요청이 바꾸지 않았다. */
  unchanged: 'unchanged',
} as const;
/** 원본 상수에서 도출한 파일 반영 상태 타입이다. */
export type WorkspaceFileState =
  (typeof workspaceFileStates)[keyof typeof workspaceFileStates];

/** 여러 파일 반영 엔진이 받는 연산의 종류다. @domainValues */
export const workspaceFileOperationKinds = {
  /** 없는 경로에 새 파일을 만들고 필요한 폴더도 만든다. */
  create: 'create',
  /** 기준 revision이 같은 기존 파일의 내용을 바꾼다. */
  replace: 'replace',
  /** 기준 revision이 같은 기존 파일을 지운다. */
  delete: 'delete',
  /** 기준 revision이 같은 기존 파일을 없는 경로로 옮긴다. */
  move: 'move',
} as const;
/** 원본 상수에서 도출한 파일 연산 종류 타입이다. */
export type WorkspaceFileOperationKind =
  (typeof workspaceFileOperationKinds)[keyof typeof workspaceFileOperationKinds];
