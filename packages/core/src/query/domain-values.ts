/** ReferenceIdFailureReason의 원본 값과 의미다. @domainValues */
export const referenceIdFailureReasons = {
  /** 확정한 대상에 ID가 없다. */
  missingId: 'missing_id',
  /** 대상 ID가 문서 규칙을 만족하지 않는다. */
  invalidId: 'invalid_id',
  /** 대상 ID를 여러 문서가 사용한다. */
  duplicateId: 'duplicate_id',
} as const;
/** 원본 상수에서 도출한 ReferenceIdFailureReason 타입이다. */
export type ReferenceIdFailureReason =
  (typeof referenceIdFailureReasons)[keyof typeof referenceIdFailureReasons];
