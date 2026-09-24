/** DocumentMatchErrorCode의 원본 값과 의미다. @domainValues */
export const documentMatchErrorCodes = {
  /** 요청한 문서가 현재 언어 서버에 열려 있지 않다. */
  documentNotOpen: 'document_not_open',
  /** 요청 버전이 현재 열린 문서 버전과 다르다. */
  staleDocumentVersion: 'stale_document_version',
  /** 문서 URI를 소유하는 작업 공간을 찾지 못했다. */
  workspaceNotFound: 'workspace_not_found',
  /** 작업 공간 catalog 조회가 실패했다. */
  workspaceQueryFailed: 'workspace_query_failed',
} as const;

/** 원본 상수에서 도출한 문서 매칭 실패 코드다. */
export type DocumentMatchErrorCode =
  (typeof documentMatchErrorCodes)[keyof typeof documentMatchErrorCodes];
