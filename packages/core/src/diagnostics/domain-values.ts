/** DiagnosticSeverity의 원본 값과 의미다. @domainValues */
export const diagnosticSeverities = {
  /** 계약을 만족하지 못한 오류다. */
  error: 'error',
  /** 주의가 필요하지만 해당 진단만으로 전체 처리를 실패시키지 않는다. */
  warning: 'warning',
} as const;
/** 원본 상수에서 도출한 DiagnosticSeverity 타입이다. */
export type DiagnosticSeverity =
  (typeof diagnosticSeverities)[keyof typeof diagnosticSeverities];
