import type { Diagnostic, ScanStatus } from '@codocs/core';
import type { DuplicatePageSuccess } from './checker.js';
import type {
  workspaceDuplicateStatuses,
  WorkspaceDuplicateExpiryReason,
  WorkspaceDuplicateStatus,
} from './domain-values.js';

export * from './domain-values.js';
export {
  resolveDuplicateCheckOptions,
  workspaceDuplicateCheckDefaults,
  type WorkspaceDuplicateCheckOptions,
} from './config.js';
export { DuplicatePreparationCache } from './preparation-cache.js';
export {
  WorkspaceDuplicateChecker,
  type DuplicateCheckerOutcome,
  type DuplicateDraftInput,
  type DuplicatePageSuccess,
  type DuplicateSnapshot,
} from './checker.js';
export { classifyDuplicateInput } from './input.js';
export type {
  WorkspaceDuplicateCandidate,
  WorkspaceDuplicateDraftInfo,
  WorkspaceDuplicateExactGroup,
  WorkspaceDuplicateLocation,
  WorkspaceDuplicateReport,
} from './results.js';
export type { WorkspaceDuplicateUncheckedItem } from './runner.js';

/** 중복 검사 요청이다. 생략하거나 빈 객체면 전체 검사, cursor만 있으면 다음 페이지, mode가 있으면 생성·수정 초안 검사다. */
export type WorkspaceDuplicatesInput =
  undefined | { cursor: string } | Record<string, unknown>;

/** 취소 신호를 전달하는 호출 옵션이다. */
export interface WorkspaceDuplicatesOptions {
  signal?: AbortSignal;
}

/** complete 또는 partial 검사 결과와 후보 한 페이지다. partial은 중복 없음으로 읽으면 안 된다. */
export type WorkspaceDuplicateSuccess = DuplicatePageSuccess & {
  success: true;
  /** 검사 결과를 만드는 동안이 아니라 응답 시점에 색인이 갱신 중이었는지다. */
  refreshing: boolean;
};

/** 검사를 수행하지 못했거나 취소·만료된 응답이다. 후보 목록을 포함하지 않는다. */
export interface WorkspaceDuplicateFailure {
  success: false;
  status: Exclude<
    WorkspaceDuplicateStatus,
    | typeof workspaceDuplicateStatuses.complete
    | typeof workspaceDuplicateStatuses.partial
  >;
  scanStatus: ScanStatus;
  error: Diagnostic<string>;
  /** 초안 변경 계획이 실패했을 때 계획의 진단 전체다. */
  diagnostics?: readonly Diagnostic<string>[];
  /** status가 expired일 때 만료 이유다. */
  expiryReason?: WorkspaceDuplicateExpiryReason;
}

/** 중복 검사 응답이다. */
export type WorkspaceDuplicateResponse =
  WorkspaceDuplicateSuccess | WorkspaceDuplicateFailure;
