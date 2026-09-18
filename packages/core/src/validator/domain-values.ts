/** DocumentKind의 원본 값과 의미다. @domainValues */
export const documentKinds = {
  /** 지켜야 할 정책을 설명한다. */
  policy: 'policy',
  /** 수행 절차를 설명한다. */
  procedure: 'procedure',
  /** 선택한 결정과 근거를 설명한다. */
  decision: 'decision',
  /** 논의 중인 내용을 설명한다. */
  discussion: 'discussion',
} as const;
/** 원본 상수에서 도출한 DocumentKind 타입이다. */
export type DocumentKind = (typeof documentKinds)[keyof typeof documentKinds];

/** DocumentStatus의 원본 값과 의미다. @domainValues */
export const documentStatuses = {
  /** 제안된 문서 내용이다. */
  proposed: 'proposed',
  /** 확정된 문서 내용이다. 스캔 확인 상태와 별개다. */
  confirmed: 'confirmed',
  /** 더 이상 권장하지 않는 문서 내용이다. */
  deprecated: 'deprecated',
} as const;
/** 원본 상수에서 도출한 DocumentStatus 타입이다. */
export type DocumentStatus =
  (typeof documentStatuses)[keyof typeof documentStatuses];
