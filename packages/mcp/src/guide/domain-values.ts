/** 배포 가이드가 제공하는 주제와 안내 범위다. @domainValues */
export const guideTopics = {
  /** 작성부터 검증까지의 전체 순서와 주제 목록이다. */
  overview: 'overview',
  /** YAML 문서 속성과 허용 값이다. */
  schema: 'schema',
  /** 원문 책임과 이름·참조 작성 원칙이다. */
  writing: 'writing',
  /** 실행 가능한 가상 문서의 연결 예시다. */
  examples: 'examples',
  /** revision 기반 수정·폐기와 충돌 처리다. */
  updating: 'updating',
  /** 진단 확인과 색인 복구 절차다. */
  validation: 'validation',
} as const;

/** 가이드 원본 주제에서 도출한 요청 값이다. */
export type GuideTopic = (typeof guideTopics)[keyof typeof guideTopics];
