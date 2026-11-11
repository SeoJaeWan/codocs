import {
  decideReview,
  diagnosticSeverities,
  judgeOverlap,
  planReviewTargets,
  reviewDecisions,
  reviewDiagnosticCodes,
  reviewDiagnosticMessages,
  reviewTokenPayload,
  toWriteOverlap,
  type Diagnostic,
  type ReviewOverlap,
  type ReviewTarget,
  type WriteOverlap,
} from '@codocs/core';
import {
  createReviewExclusion,
  type WorkspaceWriteReviewRequest,
  type WorkspaceWriteReviewResult,
} from '@codocs/workspace';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createAnthropicReviewProvider } from './anthropic.js';
import {
  loadReviewSettings,
  readReviewConfigFile,
  type ReviewConfigReader,
} from './config.js';
import {
  reviewConcurrency,
  reviewEnvironmentKeys,
  reviewProviders,
  type ReviewProvider,
} from './domain-values.js';
import {
  buildReviewPrompt,
  reviewSystemPrompt,
  type ReviewModelProvider,
} from './prompt.js';

export * from './config.js';
export * from './domain-values.js';
export * from './prompt.js';

/** codocs_write에 붙는 저장 전 중복 탐지다. API 키가 있을 때만 만든다. */
export interface CodocsWriteReviewer {
  /**
   * 검증을 통과한 저장 계획을 검토한다. 예외를 던지지 않고, 탐지하지 못하면 경고와 함께 저장을 진행시킨다.
   * @param request workspace가 넘긴 저장 계획이다.
   * @param reviewToken 요청에 붙은 확인 값이다. 같은 내용으로 이 서버가 만든 값이면 모델을 부르지 않고 저장한다.
   */
  review(
    request: WorkspaceWriteReviewRequest,
    reviewToken: string | undefined,
  ): Promise<WorkspaceWriteReviewResult>;
}

/** 탐지를 만드는 데 필요한 값과 테스트용 경계다. */
export interface CodocsWriteReviewerOptions {
  /** 환경 변수다. 키가 없으면 탐지를 만들지 않는다. */
  env: Readonly<Record<string, string | undefined>>;
  /** 제공자 어댑터를 만든다. 테스트는 가짜 제공자로 바꾼다. */
  createProvider?: (
    provider: ReviewProvider,
    apiKey: string,
  ) => ReviewModelProvider;
  /** 설정 파일을 읽는 경계다. */
  readConfig?: ReviewConfigReader;
}

/** 지원하는 제공자 이름으로 어댑터를 만든다. */
function defaultProvider(
  provider: ReviewProvider,
  apiKey: string,
): ReviewModelProvider {
  if (provider === reviewProviders.anthropic)
    return createAnthropicReviewProvider(apiKey);
  throw new Error(`지원하지 않는 제공자입니다: ${String(provider)}`);
}

/** 탐지하지 못했다는 경고 진단이다. 원인은 suggestion에 담는다. */
function reviewFailed(cause: string): Diagnostic<string> {
  return {
    code: reviewDiagnosticCodes.reviewFailed,
    severity: diagnosticSeverities.warning,
    message: reviewDiagnosticMessages.reviewFailed,
    suggestion: cause,
  };
}

/** 예외를 원인 문장으로 바꾼다. */
function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 작업 목록을 최대 limit개씩 동시에 실행하고 입력 순서로 결과를 모은다. */
async function runLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  /** 남은 작업을 하나씩 가져가 실행한다. */
  async function worker(): Promise<void> {
    while (next < items.length) {
      const at = next++;
      results[at] = await run(items[at]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** 섹션 하나의 탐지 결과다. 실패하면 원인을 담는다. */
type TargetOutcome =
  | { target: ReviewTarget; overlaps: ReviewOverlap[] }
  | { target: ReviewTarget; failure: string };

/**
 * 환경 변수에 API 키가 있으면 codocs_write의 저장 전 중복 탐지를 만든다. 키가 없으면 undefined이며 codocs_write는 지금과 같다.
 * 확인 값에 섞는 비밀값은 여기서 한 번 만들며, 서버를 다시 시작하면 이전 확인 값은 맞지 않는다.
 */
export function createCodocsWriteReviewer(
  options: CodocsWriteReviewerOptions,
): CodocsWriteReviewer | undefined {
  const apiKey = options.env[reviewEnvironmentKeys.apiKey]?.trim();
  if (!apiKey) return undefined;
  const createProvider = options.createProvider ?? defaultProvider;
  const readConfig = options.readConfig ?? readReviewConfigFile;
  const secret = randomBytes(32);
  /** 저장 계획 원문에 비밀값을 섞은 확인 값이다. */
  const sign = (payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('base64url');
  /** 확인 값이 이 계획으로 만든 값과 같은지 일정 시간에 비교한다. */
  const verify = (token: string, payload: string): boolean => {
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(token);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  };
  return {
    /** 확인 값 → 설정 → 새 문장·후보 → 모델 → 방향·처리 순서로 검토한다. */
    async review(request, reviewToken) {
      const payload = reviewTokenPayload(request.items);
      if (reviewToken !== undefined && verify(reviewToken, payload)) return {};
      const loaded = await loadReviewSettings(
        options.env,
        request.projectRoot,
        readConfig,
      );
      if (!loaded.success) return { warnings: [reviewFailed(loaded.message)] };
      const settings = loaded.settings;
      const targets = planReviewTargets(
        request.catalog,
        request.items,
        createReviewExclusion(settings.exclude),
      ).filter((target) => target.candidates.length > 0);
      if (!targets.length) return {};
      let provider: ReviewModelProvider;
      try {
        provider = createProvider(settings.provider, apiKey);
      } catch (error: unknown) {
        return { warnings: [reviewFailed(causeOf(error))] };
      }
      const outcomes = await runLimited<ReviewTarget, TargetOutcome>(
        targets,
        reviewConcurrency,
        /** 섹션 하나를 모델에 보내고 방향을 정한다. 실패는 원인으로 남긴다. */ async (
          target,
        ) => {
          const [first, ...rest] = target.candidates.map(
            (candidate) => candidate.address,
          );
          try {
            const findings = await provider.findOverlaps({
              model: settings.model,
              system: reviewSystemPrompt,
              prompt: buildReviewPrompt(target),
              addresses: [first!, ...rest],
            });
            return {
              target,
              overlaps: findings.map((finding) =>
                judgeOverlap(target, finding),
              ),
            };
          } catch (error: unknown) {
            return { target, failure: causeOf(error) };
          }
        },
      );
      const overlaps: ReviewOverlap[] = [];
      const items: WriteOverlap[] = [];
      const warnings: Diagnostic<string>[] = [];
      let blockedPath: string | undefined;
      for (const outcome of outcomes) {
        if ('failure' in outcome) {
          warnings.push({
            ...reviewFailed(outcome.failure),
            path: outcome.target.documentPath,
          });
          continue;
        }
        for (const overlap of outcome.overlaps) {
          overlaps.push(overlap);
          items.push(toWriteOverlap(outcome.target, overlap, request.batch));
          if (
            blockedPath === undefined &&
            decideReview([overlap]) === reviewDecisions.block
          )
            blockedPath = outcome.target.documentPath;
        }
      }
      const decision = decideReview(overlaps);
      if (decision === reviewDecisions.block)
        return {
          blocked: {
            code: reviewDiagnosticCodes.duplicateContent,
            severity: diagnosticSeverities.error,
            message: reviewDiagnosticMessages.duplicateContent,
            ...(blockedPath === undefined ? {} : { path: blockedPath }),
            suggestion:
              'overlaps의 두 문장을 읽고, 새 글을 원본 문서로 가는 [[링크]]와 관계 설명으로 바꿀 수 있는지 먼저 보세요. 지금 쓰는 글이 원본이거나 겹치지 않는다고 판단하면 같은 요청에 reviewToken을 붙여 다시 보내세요.',
          },
          overlaps: items,
          reviewToken: sign(payload),
        };
      return {
        ...(decision === reviewDecisions.saveWithOverlaps
          ? { overlaps: items }
          : {}),
        ...(warnings.length ? { warnings } : {}),
      };
    },
  };
}
