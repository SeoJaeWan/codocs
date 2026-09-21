/** DocumentUpdateRejection의 원본 값과 의미다. @domainValues */
export const documentUpdateRejections = {
  /** 아직 열리지 않은 문서 URI에 변경이 도착했다. */
  notOpen: 'not_open',
  /** 현재 문서보다 같거나 오래된 버전의 변경이 도착했다. */
  staleVersion: 'stale_version',
  /** 전체 원문이 아닌 증분 범위 변경이 도착했다. */
  incrementalChange: 'incremental_change',
} as const;

/** 원본 상수에서 도출한 문서 갱신 거부 사유다. */
export type DocumentUpdateRejection =
  (typeof documentUpdateRejections)[keyof typeof documentUpdateRejections];
