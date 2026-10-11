/** WorkspaceScopeKind의 원본 값과 의미다. @domainValues */
export const workspaceScopeKinds = {
  /** 논리 지식 루트가 부여한 접근 범위다. */
  workspace: 'workspace',
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

/** 하위 .codocs 위치를 .gitignore·루트 .codocsignore로 판정한 결과다. @domainValues */
export const codocsLocationStates = {
  /** 루트 .codocs이거나 규칙을 통과한 위치라 문서를 탐색하고 저장할 수 있다. */
  recognized: 'recognized',
  /** .gitignore 또는 .codocsignore가 제외한 위치라 탐색하지 않고 저장을 거부한다. */
  excluded: 'excluded',
  /** ignore 규칙을 확인하지 못해 인정 여부를 정하지 못했다. 탐색하지 않고 저장을 거부한다. */
  unknown: 'unknown',
} as const;
/** 원본 상수에서 도출한 CodocsLocationState 타입이다. */
export type CodocsLocationState =
  (typeof codocsLocationStates)[keyof typeof codocsLocationStates];
