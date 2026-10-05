/** RenameRequestFailureCode의 원본 값과 의미다. @domainValues */
export const renameRequestFailureCodes = {
  /** 출처 문서가 열려 있지 않거나 작업 공간에 속하지 않는다. */
  workspaceNotFound: 'workspace_not_found',
  /** 연결된 작업 공간 세션이 이름 변경을 지원하지 않는다. */
  renameUnsupported: 'rename_unsupported',
} as const;

/** 원본 상수에서 도출한 이름 변경 요청 시작 실패 코드다. */
export type RenameRequestFailureCode =
  (typeof renameRequestFailureCodes)[keyof typeof renameRequestFailureCodes];
