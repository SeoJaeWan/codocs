/** 사용자 원문 이동이 완료되지 않은 경계별 사유다. @domainValues */
export const openSourceFailureReasons = {
  /** 명령 인자가 확인 가능한 출처와 서버 토큰이 아니다. */
  invalidSelection: 'invalid_selection',
  /** 확인 전후 출처·소유권·서버 세션이 무효화되었다. */
  sourceInvalidated: 'source_invalidated',
  /** 최신 서버 확인에서 실행 가능한 파일 대상을 반환하지 않았다. */
  confirmationRejected: 'confirmation_rejected',
  /** 최신 대상 확인 요청이 실패했다. */
  confirmationFailed: 'confirmation_failed',
  /** 확인된 파일의 현재 내용을 열거나 접근하지 못했다. */
  fileAccessFailed: 'file_access_failed',
  /** 확인된 문서를 편집기에 표시하지 못했다. */
  displayFailed: 'display_failed',
} as const;

/** 실패 경계의 원본 상수에서 도출한 사유다. */
export type OpenSourceFailureReason =
  (typeof openSourceFailureReasons)[keyof typeof openSourceFailureReasons];
