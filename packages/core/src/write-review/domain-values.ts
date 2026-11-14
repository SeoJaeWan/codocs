/** 겹치는 문장 쌍에서 어느 쪽이 내용을 옮겨 적었는지 링크로 판단한 결과다. @domainValues */
export const reviewCopiedBy = {
  /** 새로 쓴 문장만 상대 문서로 가는 링크를 담았다. 새 글이 상대 문서를 옮겨 적었다. */
  new: 'new',
  /** 상대 문서의 문장만 이 문서로 가는 링크를 담았다. 상대 문서가 이 내용을 옮겨 적고 있다. */
  existing: 'existing',
  /** 링크가 없거나 양쪽 모두 링크가 있거나 인용이 든 문장을 찾지 못해 방향을 정하지 못했다. */
  unknown: 'unknown',
} as const;
/** 원본 상수에서 도출한 방향 판단 타입이다. */
export type ReviewCopiedBy =
  (typeof reviewCopiedBy)[keyof typeof reviewCopiedBy];

/** 탐지 결과로 정한 요청 처리다. @domainValues */
export const reviewDecisions = {
  /** 겹치는 문장이 없어 그대로 저장한다. */
  save: 'save',
  /** 겹치는 문장이 모두 상대 문서가 옮겨 적은 것이라 저장하고 겹침을 알린다. */
  saveWithOverlaps: 'save_with_overlaps',
  /** 새 글이 옮겨 적었거나 방향을 모르는 겹침이 하나라도 있어 저장하지 않는다. */
  block: 'block',
} as const;
/** 원본 상수에서 도출한 처리 결정 타입이다. */
export type ReviewDecision =
  (typeof reviewDecisions)[keyof typeof reviewDecisions];
