import { duplicateSkipReasons } from '@codocs/core';

/** 중복 검사 응답의 상태다. success가 true인 응답은 complete 또는 partial뿐이며 partial·failed는 중복 없음으로 읽지 않는다. @domainValues */
export const workspaceDuplicateStatuses = {
  /** 색인의 모든 대상 문서를 확인하고 모든 구간 쌍을 비교했다. */
  complete: 'complete',
  /** 확인한 범위의 결과만 있다. 중단 이유·미확인 범위를 함께 제공한다. */
  partial: 'partial',
  /** 검사를 수행하지 못했다. 초안 검증 실패·입력 오류·탐색 실패·계산 오류를 포함한다. */
  failed: 'failed',
  /** 호출자의 AbortSignal로 계산을 멈췄다. 결과를 보관하지 않는다. */
  cancelled: 'cancelled',
  /** 색인이 갱신 중이거나 사용할 관측이 없어 검사를 시작하지 않았다. */
  notReady: 'not_ready',
  /** 다음 페이지 커서를 더 이상 사용할 수 없다. expiryReason으로 이유를 구분한다. */
  expired: 'expired',
} as const;
/** 원본 상수에서 도출한 중복 검사 응답 상태 타입이다. */
export type WorkspaceDuplicateStatus =
  (typeof workspaceDuplicateStatuses)[keyof typeof workspaceDuplicateStatuses];

/** 결과가 complete가 아닌 이유다. 여러 이유가 함께 있을 수 있다. @domainValues */
export const workspaceDuplicateIncompleteReasons = {
  /** 시간 제한에 도달해 남은 준비·비교를 하지 않았다. */
  timeLimit: 'time_limit',
  /** 문서 탐색이 partial이거나 감시 실패로 색인을 최신으로 보장하지 못한다. */
  discoveryPartial: 'discovery_partial',
  /** 본문을 읽지 못했거나 준비·비교하지 못한 문서가 있다. */
  uncheckedDocuments: 'unchecked_documents',
} as const;
/** 원본 상수에서 도출한 미완료 이유 타입이다. */
export type WorkspaceDuplicateIncompleteReason =
  (typeof workspaceDuplicateIncompleteReasons)[keyof typeof workspaceDuplicateIncompleteReasons];

/** 계산을 멈춘 이유다. 결과 개수 제한(nextCursor)과 구분한다. @domainValues */
export const workspaceDuplicateStopReasons = {
  /** 설정한 시간 제한을 넘었다. */
  timeLimit: 'time_limit',
} as const;
/** 원본 상수에서 도출한 중단 이유 타입이다. */
export type WorkspaceDuplicateStopReason =
  (typeof workspaceDuplicateStopReasons)[keyof typeof workspaceDuplicateStopReasons];

/** 검사하지 못한 범위의 이유다. core의 건너뜀 이유를 같은 값으로 공유한다. @domainValues */
export const workspaceDuplicateUncheckedReasons = {
  /** 파싱에 실패한 원문이다. */
  parseFailed: duplicateSkipReasons.parseFailed,
  /** 준비 결과의 설정 버전이 비교 설정과 다르다. */
  configVersionMismatch: duplicateSkipReasons.configVersionMismatch,
  /** 이번 탐색에서 다시 확인하지 못한 이전 관측이라 이전 자료로 대신하지 않았다. */
  unconfirmed: 'unconfirmed',
  /** 파일·폴더를 읽지 못해 본문을 얻지 못했다. */
  readFailed: 'read_failed',
  /** 문서의 원문 버전을 알 수 없어 준비 자료를 식별할 수 없다. */
  revisionUnavailable: 'revision_unavailable',
  /** 문서 준비 중 오류가 발생했다. 이전 버전 자료로 대신하지 않았다. */
  preparationFailed: 'preparation_failed',
  /** 시간 제한에 도달해 준비하지 못했다. */
  timeLimit: 'time_limit',
} as const;
/** 원본 상수에서 도출한 검사하지 못한 이유 타입이다. */
export type WorkspaceDuplicateUncheckedReason =
  (typeof workspaceDuplicateUncheckedReasons)[keyof typeof workspaceDuplicateUncheckedReasons];

/** 페이지 커서의 만료 이유다. 원문·기준 변경과 보관 결과 교체를 구분한다. @domainValues */
export const workspaceDuplicateExpiryReasons = {
  /** 비교한 문서들의 원문 버전 목록 또는 비교 설정이 바뀌었다. */
  sourceChanged: 'source_changed',
  /** 다른 검사 결과가 보관된 결과를 대체했다. 원문과 기준이 그대로여도 다음 페이지는 없다. */
  resultReplaced: 'result_replaced',
  /** 서명이 맞지 않거나 이 세션이 발급하지 않은 커서다. */
  unrecognized: 'unrecognized',
} as const;
/** 원본 상수에서 도출한 커서 만료 이유 타입이다. */
export type WorkspaceDuplicateExpiryReason =
  (typeof workspaceDuplicateExpiryReasons)[keyof typeof workspaceDuplicateExpiryReasons];

/** 결과에 포함한 위치의 기준 원문이다. @domainValues */
export const workspaceDuplicateLocationOrigins = {
  /** 저장된 파일의 원문 위치다. */
  saved: 'saved',
  /** 미저장 초안 원문 기준의 위치이며 파일 위치가 아니다. */
  draft: 'draft',
} as const;
/** 원본 상수에서 도출한 위치 출처 타입이다. */
export type WorkspaceDuplicateLocationOrigin =
  (typeof workspaceDuplicateLocationOrigins)[keyof typeof workspaceDuplicateLocationOrigins];

/** 검사 범위다. @domainValues */
export const workspaceDuplicateScopes = {
  /** 현재 색인 전체의 문서 간·문서 내부 반복이다. */
  all: 'all',
  /** 초안 후보와 기존 문서의 비교이며 초안 내부 반복을 포함한다. */
  draft: 'draft',
} as const;
/** 원본 상수에서 도출한 검사 범위 타입이다. */
export type WorkspaceDuplicateScope =
  (typeof workspaceDuplicateScopes)[keyof typeof workspaceDuplicateScopes];

/** 초안 검사가 본 본문 범위다. 이번 변경으로 새로 생긴 반복만 찾는 검사가 아니다. @domainValues */
export const workspaceDuplicateDraftCoverages = {
  /** 변경 후 후보 본문 전체의 반복 후보다. */
  candidateFullText: 'candidate_full_text',
} as const;
/** 원본 상수에서 도출한 초안 검사 범위 타입이다. */
export type WorkspaceDuplicateDraftCoverage =
  (typeof workspaceDuplicateDraftCoverages)[keyof typeof workspaceDuplicateDraftCoverages];

/** 중복 검사가 추가하는 진단 코드다. 목록 커서 만료와 입력 오류는 기존 조회 코드를 사용한다. @domainValues */
export const workspaceDuplicateDiagnosticCodes = {
  /** 계산 중 예기치 않은 오류가 발생했다. */
  checkFailed: 'duplicate_check_failed',
} as const;

/** 중복 검사 진단의 고정 문구다. */
export const workspaceDuplicateDiagnosticMessages = {
  checkFailed: '중복 검사 중 오류가 발생했습니다.',
  expiredSourceChanged:
    '비교한 문서의 원문 또는 비교 설정이 바뀌어 결과 커서가 만료되었습니다. 커서 없이 검사를 다시 실행하세요.',
  expiredResultReplaced:
    '더 최근의 검사 결과가 보관되어 이 커서의 결과는 더 이상 제공하지 않습니다. 필요한 검사를 다시 실행하세요.',
  expiredUnrecognized:
    '이 세션에서 발급하지 않았거나 손상된 커서입니다. 커서 없이 검사를 다시 실행하세요.',
} as const;
