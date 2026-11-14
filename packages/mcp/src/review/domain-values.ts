/** 중복 탐지에 쓸 수 있는 모델 제공자다. @domainValues */
export const reviewProviders = {
  /** Anthropic API다. 공식 SDK로 호출한다. */
  anthropic: 'anthropic',
} as const;
/** 원본 상수에서 도출한 제공자 타입이다. */
export type ReviewProvider =
  (typeof reviewProviders)[keyof typeof reviewProviders];

/** MCP 설정의 환경 변수 이름이다. 사용자가 MCP 설정에 적는 외부 계약이다. */
export const reviewEnvironmentKeys = {
  /** API 키다. 있으면 탐지를 켠다. 파일로는 받지 않는다. */
  apiKey: 'CODOCS_REVIEW_API_KEY',
  provider: 'CODOCS_REVIEW_PROVIDER',
  model: 'CODOCS_REVIEW_MODEL',
  /** 쉼표로 구분한 제외 경로 목록이다. */
  exclude: 'CODOCS_REVIEW_EXCLUDE',
} as const;

/** 프로젝트 루트에 두는 선택 설정 파일의 이름이다. */
export const reviewConfigFileName = 'codocs.config.yaml';

/** 설정하지 않았을 때의 제공자다. */
export const defaultReviewProvider: ReviewProvider = reviewProviders.anthropic;
/** 설정하지 않았을 때의 모델이다. 출처: 2026-11-11 프로토타입의 측정 모델이다. */
export const defaultReviewModel = 'claude-haiku-5-5';
/** 모델 호출 하나의 제한 시간(밀리초)이다. 출처: 2026-11-11 프로토타입(평균 6.7초, 최대 19.6초)이다. */
export const reviewTimeoutMs = 60_000;
/** 동시에 보내는 모델 호출의 최대 개수다. */
export const reviewConcurrency = 4;
