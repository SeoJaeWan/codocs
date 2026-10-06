/** 저장 전 후보 계산의 세 가지 결과다. @domainValues */
export const changePlanStatuses = {
  /** 요청 또는 후보 검증이 실패했다. */
  failed: 'failed',
  /** 전체 검증을 통과했으나 원문 변경이 없다. */
  unchanged: 'unchanged',
  /** 전체 검증을 통과한 미저장 YAML 후보가 있다. */
  candidate: 'candidate',
} as const;

/** 변경 계획 항목이 받는 요청 종류다. @domainValues */
export const changePlanModes = {
  /** 새 문서 파일을 만든다. */
  create: 'create',
  /** 최상위 값을 일부만 바꾼다. */
  update: 'update',
  /** 문서 전체를 교체한다. */
  replace: 'replace',
  /** 문서 파일을 지운다. */
  delete: 'delete',
  /** 문서 파일을 내용 변경 없이 다른 경로로 옮긴다. */
  move: 'move',
} as const;

/** 변경 계획 항목 종류의 원본 값에서 도출한 타입이다. */
export type ChangePlanMode =
  (typeof changePlanModes)[keyof typeof changePlanModes];
