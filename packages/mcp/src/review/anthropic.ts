import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ReviewFinding } from '@codocs/core';
import { reviewTimeoutMs } from './domain-values.js';
import {
  reviewOutputSchema,
  type ReviewModelProvider,
  type ReviewModelRequest,
} from './prompt.js';

/** 응답 한 번의 출력 토큰 상한이다. 출처: 2026-11-11 프로토타입이다. */
const maxOutputTokens = 16_000;

/** 모델이 판정을 내지 못한 경우다. 호출 오류와 구분해 원인을 알린다. */
export class ReviewModelError extends Error {}

/**
 * Anthropic 공식 SDK로 탐지하는 제공자를 만든다. 구조화 출력(messages.parse + zodOutputFormat)과 effort high를 쓴다.
 * 요청 하나는 재시도를 포함해 60초 안에 끝나지 않으면 중단한다.
 * @param apiKey 사용자가 MCP 설정에 넣은 API 키다.
 */
export function createAnthropicReviewProvider(
  apiKey: string,
): ReviewModelProvider {
  const client = new Anthropic({ apiKey });
  return {
    /** 새 글과 후보 섹션을 보내 겹치는 문장 쌍을 받는다. 거부·해석 실패는 예외다. */
    async findOverlaps(request: ReviewModelRequest): Promise<ReviewFinding[]> {
      const response = await client.messages.parse(
        {
          model: request.model,
          max_tokens: maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          output_config: {
            effort: 'high',
            format: zodOutputFormat(reviewOutputSchema(request.addresses)),
          },
        },
        { signal: AbortSignal.timeout(reviewTimeoutMs) },
      );
      if (response.stop_reason === 'refusal')
        throw new ReviewModelError('모델이 판정을 거부했습니다.');
      const findings = response.parsed_output?.findings;
      if (!findings)
        throw new ReviewModelError(
          `모델 출력을 해석하지 못했습니다(stop_reason: ${response.stop_reason ?? 'null'}).`,
        );
      return findings.map(
        /** 판정에 쓰는 필드만 남긴다. */ (finding) => ({
          candidate: finding.candidate,
          newQuote: finding.newQuote,
          candidateQuote: finding.candidateQuote,
        }),
      );
    },
  };
}
