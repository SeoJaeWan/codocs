/** 반복 탐지의 고정 기준선이다. 값을 바꾸면 version을 올려 이전 준비 결과와 구분한다. */
export const duplicateDetectionConfig = {
  /** 설정 버전이다. 준비 결과와 후보에 그대로 연결한다. */
  version: 1,
  /** 정규화한 구절의 최소 길이(코드 포인트)다. 미만은 비교 구간이 아니다. */
  minCodePoints: 30,
  /** 정규화한 구절의 최대 길이(코드 포인트)다. 초과는 비교 구간이 아니다. */
  maxCodePoints: 1200,
  /** 문자 n-gram의 길이다. */
  gramSize: 4,
  /** 유사 반복으로 보는 4-gram Jaccard의 하한이다(이상). */
  minJaccard: 0.65,
  /** 유사 반복으로 보는 순서 유사도의 하한이다(이상). */
  minOrdered: 0.7,
  /** 문단 안에서 함께 비교하는 연속 문장의 최대 수다. */
  maxSentenceWindow: 3,
} as const;

/** 준비·비교 결과가 어느 기준선으로 만들어졌는지 나타내는 설정 버전이다. */
export type DuplicateConfigVersion = typeof duplicateDetectionConfig.version;
