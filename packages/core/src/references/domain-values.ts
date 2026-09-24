/** ReferenceSyntaxStatus의 원본 값과 의미다. @domainValues */
export const referenceSyntaxStatuses = {
  /** 참조 표기가 지원 문법에 맞는다. */
  valid: 'valid',
  /** 참조 표기가 지원 문법에 맞지 않는다. */
  invalid: 'invalid',
} as const;
/** 원본 상수에서 도출한 ReferenceSyntaxStatus 타입이다. */
export type ReferenceSyntaxStatus =
  (typeof referenceSyntaxStatuses)[keyof typeof referenceSyntaxStatuses];
