/** 코드 매칭 근거의 ID 종류다. @domainValues */
export const matcherEvidenceKinds = {
  /** 현재 문서 ID로 확인한 근거다. */
  current: 'current',
  /** 이전 문서 ID로 확인한 근거다. */
  previous: 'previous',
} as const;
/** 원본 상수에서 도출한 코드 매칭 근거 종류다. */
export type MatcherEvidenceKind =
  (typeof matcherEvidenceKinds)[keyof typeof matcherEvidenceKinds];

/** 코드 표기 비교의 종류다. @domainValues */
export const matcherComparisonKinds = {
  /** 대소문자와 구분자만 다른 표기 일치다. */
  exact: 'exact',
  /** 마지막 토큰만 pluralize로 단수화한 일치다. */
  singular: 'singular',
} as const;
/** 원본 상수에서 도출한 코드 비교 종류다. */
export type MatcherComparisonKind =
  (typeof matcherComparisonKinds)[keyof typeof matcherComparisonKinds];
