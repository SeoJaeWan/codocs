/** 저장 전 후보 계산의 세 가지 결과다. @domainValues */
export const changePlanStatuses = {
  /** 요청 또는 후보 검증이 실패했다. */
  failed: 'failed',
  /** 전체 검증을 통과했으나 원문 변경이 없다. */
  unchanged: 'unchanged',
  /** 전체 검증을 통과한 미저장 YAML 후보가 있다. */
  candidate: 'candidate',
} as const;
