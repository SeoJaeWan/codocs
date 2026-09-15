/** WorkspaceDocumentStatus의 원본 값과 의미다. @domainValues */
export const workspaceDocumentStatuses = {
  /** 문서 파싱과 검증을 통과했다. */
  valid: 'valid',
  /** YAML 파싱에 실패했다. */
  parseError: 'parseError',
  /** 파싱했으나 문서 검증에 실패했다. */
  validationError: 'validationError',
} as const;
/** 원본 상수에서 도출한 WorkspaceDocumentStatus 타입이다. */
export type WorkspaceDocumentStatus =
  (typeof workspaceDocumentStatuses)[keyof typeof workspaceDocumentStatuses];
