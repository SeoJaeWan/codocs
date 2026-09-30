import {
  createDuplicateComparison,
  duplicateComparisonStatuses,
  prepareDuplicateDocument,
  type DuplicateDetectionResult,
  type DuplicateDocumentInput,
  type PreparedDuplicateDocument,
} from '@codocs/core';
import type { resolveDuplicateCheckOptions } from './config.js';
import type { DuplicatePreparationCache } from './preparation-cache.js';
import {
  workspaceDuplicateUncheckedReasons,
  type WorkspaceDuplicateUncheckedReason,
} from './domain-values.js';

/** 실행 시점에 확정한 설정이다. */
export type ResolvedDuplicateCheckOptions = ReturnType<
  typeof resolveDuplicateCheckOptions
>;

/** 검사하지 못한 문서 또는 범위와 이유다. */
export interface WorkspaceDuplicateUncheckedItem {
  path?: string;
  revision?: string;
  reason: WorkspaceDuplicateUncheckedReason;
}

/** 한 번의 검사 실행 요청이다. 문서 목록은 시작 시점에 고정한 관측이다. */
export interface DuplicateRunRequest {
  /** 저장 문서다. 각 문서의 파싱 결과와 revision은 같은 관측에서 왔다. */
  documents: readonly DuplicateDocumentInput[];
  /** 미저장 초안이다. 캐시에 넣지 않는다. */
  draft?: DuplicateDocumentInput;
  cache: DuplicatePreparationCache;
  options: ResolvedDuplicateCheckOptions;
  signal?: AbortSignal;
}

/** 실행 결과다. cancelled면 다른 값은 없다. */
export type DuplicateRunOutcome =
  | { cancelled: true }
  | {
      cancelled: false;
      /** 비교를 시작하지 못하고 멈췄으면 없다. */
      result?: DuplicateDetectionResult;
      /** 시간 제한으로 준비나 비교를 끝내지 못했다. */
      stopped: boolean;
      /** 준비 단계와 core가 남긴 검사하지 못한 문서다. */
      unchecked: WorkspaceDuplicateUncheckedItem[];
      preparedCount: number;
      reusedCount: number;
      /** 비교에 실제 참여한 문서 수다. 건너뛴 문서와 비교하지 못한 문서는 세지 않는다. */
      comparedDocumentCount: number;
      /** 비교하지 못했으면 totalUnits는 null이다. */
      progress: { completedUnits: number; totalUnits: number | null };
    };

/** 다른 요청·파일 변경 반영·취소가 실행되도록 이벤트 루프에 양보한다. */
function yieldToEventLoop(): Promise<void> {
  return new Promise(
    /** 다음 macrotask에서 재개한다. */ (resolve) => setImmediate(resolve),
  );
}

/**
 * 문서 준비와 core 비교를 짧은 조각으로 나눠 실행한다. 조각 사이마다 양보하고 취소·시간 제한을 확인한다.
 * 파일을 읽거나 쓰지 않으며 세션 상태를 바꾸지 않는다. 준비 캐시만 갱신한다.
 */
export async function runDuplicateCheck(
  request: DuplicateRunRequest,
): Promise<DuplicateRunOutcome> {
  const { cache, options, signal } = request;
  const deadline = options.now() + options.timeLimitMs;
  /** 시간 제한에 도달했는지 확인한다. */
  const expired = (): boolean => options.now() >= deadline;
  const unchecked: WorkspaceDuplicateUncheckedItem[] = [];
  const prepared: PreparedDuplicateDocument[] = [];
  let preparedCount = 0;
  let reusedCount = 0;
  let stopped = false;

  await yieldToEventLoop();
  if (signal?.aborted) return { cancelled: true };

  let sliceStart = options.now();
  for (const [index, document] of request.documents.entries()) {
    if (signal?.aborted) return { cancelled: true };
    if (expired()) {
      stopped = true;
      for (const rest of request.documents.slice(index))
        unchecked.push({
          path: rest.path,
          revision: rest.revision,
          reason: workspaceDuplicateUncheckedReasons.timeLimit,
        });
      break;
    }
    try {
      const lookup = cache.obtain(document);
      if (lookup.reused) reusedCount++;
      else {
        preparedCount++;
        options.onPrepare?.(document.path);
      }
      prepared.push(lookup.prepared);
    } catch {
      cache.discard(document.path);
      unchecked.push({
        path: document.path,
        revision: document.revision,
        reason: workspaceDuplicateUncheckedReasons.preparationFailed,
      });
    }
    if (options.now() - sliceStart >= options.sliceMs) {
      await yieldToEventLoop();
      if (signal?.aborted) return { cancelled: true };
      sliceStart = options.now();
    }
  }
  if (request.draft && !stopped) {
    try {
      prepared.push(prepareDuplicateDocument(request.draft));
    } catch {
      unchecked.push({
        path: request.draft.path,
        revision: request.draft.revision,
        reason: workspaceDuplicateUncheckedReasons.preparationFailed,
      });
    }
  } else if (request.draft)
    unchecked.push({
      path: request.draft.path,
      revision: request.draft.revision,
      reason: workspaceDuplicateUncheckedReasons.timeLimit,
    });
  if (!stopped && expired()) stopped = true;
  if (stopped)
    return {
      cancelled: false,
      stopped,
      unchecked,
      preparedCount,
      reusedCount,
      comparedDocumentCount: 0,
      progress: { completedUnits: 0, totalUnits: null },
    };

  // 비교 자료 구성은 단계 분할이 되지 않으므로 앞뒤로 양보한다.
  await yieldToEventLoop();
  if (signal?.aborted) return { cancelled: true };
  const comparison = createDuplicateComparison(prepared);
  await yieldToEventLoop();
  if (signal?.aborted) return { cancelled: true };

  while (
    comparison.getProgress().status !== duplicateComparisonStatuses.complete
  ) {
    if (signal?.aborted) return { cancelled: true };
    if (expired()) {
      stopped = true;
      break;
    }
    sliceStart = options.now();
    let progress = comparison.step(1);
    while (
      progress.status !== duplicateComparisonStatuses.complete &&
      options.now() - sliceStart < options.sliceMs
    )
      progress = comparison.step(1);
    await options.onSlice?.({
      completedUnits: progress.completedUnits,
      totalUnits: progress.totalUnits,
    });
    await yieldToEventLoop();
  }
  if (signal?.aborted) return { cancelled: true };
  const result = comparison.snapshot();
  return {
    cancelled: false,
    result,
    stopped,
    unchecked,
    preparedCount,
    reusedCount,
    comparedDocumentCount: prepared.length - result.skippedInputs.length,
    progress: {
      completedUnits: result.completedUnits,
      totalUnits: result.totalUnits,
    },
  };
}
