/** 반복 후보의 종류다. 정규화한 구절이 링크 목적지까지 같으면 완전 일치, 그 밖의 기준 통과는 유사 반복이다. @domainValues */
export const duplicateMatchKinds = {
  /** 정규화한 비교 문자열과 Markdown 링크 목적지가 모두 같다. */
  exact: 'exact',
  /** 4-gram Jaccard와 순서 유사도가 기준을 넘지만 완전 일치는 아니다. 점수가 1이어도 링크 목적지가 다르면 여기에 속한다. */
  similar: 'similar',
} as const;
/** 원본 상수에서 도출한 DuplicateMatchKind 타입이다. */
export type DuplicateMatchKind =
  (typeof duplicateMatchKinds)[keyof typeof duplicateMatchKinds];

/** 비교 구간으로 만들지 않고 제외한 본문의 사유다. @domainValues */
export const duplicateExclusionReasons = {
  /** Markdown 제목 줄이다. */
  heading: 'heading',
  /** 코드 펜스 줄과 그 안의 본문이다. */
  codeFence: 'code_fence',
  /** 표의 열 구분선 줄이다. */
  tableSeparator: 'table_separator',
  /** 정규화한 구절이 최소 길이(코드 포인트)보다 짧다. */
  tooShort: 'too_short',
  /** 정규화한 구절이 최대 비교 길이보다 길다. */
  tooLong: 'too_long',
} as const;
/** 원본 상수에서 도출한 DuplicateExclusionReason 타입이다. */
export type DuplicateExclusionReason =
  (typeof duplicateExclusionReasons)[keyof typeof duplicateExclusionReasons];

/** 문서 한 건을 비교에 쓰지 못한 사유다. 본문을 추측해 채우지 않고 입력 단위로 남긴다. @domainValues */
export const duplicateSkipReasons = {
  /** 파싱에 실패한 원문이라 definition·examples를 신뢰할 수 없다. */
  parseFailed: 'parse_failed',
  /** 준비 결과의 설정 버전이 이번 비교의 설정 버전과 다르다. */
  configVersionMismatch: 'config_version_mismatch',
} as const;
/** 원본 상수에서 도출한 DuplicateSkipReason 타입이다. */
export type DuplicateSkipReason =
  (typeof duplicateSkipReasons)[keyof typeof duplicateSkipReasons];

/** 비교 작업의 진행 상태다. @domainValues */
export const duplicateComparisonStatuses = {
  /** 아직 비교하지 않은 구간 쌍이 남아 있어 결과가 부분적이다. */
  partial: 'partial',
  /** 모든 구간 쌍을 비교했다. */
  complete: 'complete',
} as const;
/** 원본 상수에서 도출한 DuplicateComparisonStatus 타입이다. */
export type DuplicateComparisonStatus =
  (typeof duplicateComparisonStatuses)[keyof typeof duplicateComparisonStatuses];

/** 비교하는 본문 필드의 종류다. 필드 경로로 구분하며 다른 필드는 비교하지 않는다. @domainValues */
export const duplicateFieldNames = {
  /** 문서의 definition 문자열이다. */
  definition: 'definition',
  /** 문서의 examples 배열 원소 문자열이다. */
  examples: 'examples',
} as const;
