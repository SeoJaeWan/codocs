/** WorkspaceScopeKind의 원본 값과 의미다. @domainValues */
export const workspaceScopeKinds = {
  /** 논리 지식 루트가 부여한 접근 범위다. */
  workspace: 'workspace',
  /** 명시적으로 연결된 파일의 접근 범위다. */
  linkedFile: 'linkedFile',
  /** 명시적으로 연결된 디렉터리의 접근 범위다. */
  linkedDirectory: 'linkedDirectory',
} as const;
/** 원본 상수에서 도출한 WorkspaceScopeKind 타입이다. */
export type WorkspaceScopeKind =
  (typeof workspaceScopeKinds)[keyof typeof workspaceScopeKinds];

/** WorkspaceTargetKind의 원본 값과 의미다. @domainValues */
export const workspaceTargetKinds = {
  /** 실제 대상이 일반 파일이다. */
  file: 'file',
  /** 실제 대상이 디렉터리다. */
  directory: 'directory',
  /** 파일과 디렉터리 외의 대상이다. */
  other: 'other',
} as const;
/** 원본 상수에서 도출한 WorkspaceTargetKind 타입이다. */
export type WorkspaceTargetKind =
  (typeof workspaceTargetKinds)[keyof typeof workspaceTargetKinds];

/** WorkspacePathFailureStatus의 원본 값과 의미다. @domainValues */
export const workspacePathFailureStatuses = {
  /** 허용된 경로 정책을 벗어났다. */
  denied: 'denied',
  /** 대상 경로가 없다. */
  missing: 'missing',
  /** 대상을 확인하거나 접근할 수 없다. */
  unavailable: 'unavailable',
} as const;
/** 원본 상수에서 도출한 WorkspacePathFailureStatus 타입이다. */
export type WorkspacePathFailureStatus =
  (typeof workspacePathFailureStatuses)[keyof typeof workspacePathFailureStatuses];
