import type { ReviewFinding, ReviewTarget } from '@codocs/core';
import { z } from 'zod';

/**
 * 모델에게 주는 중복 판정 기준이다. 2026-11-11 프로토타입(flow2)에서 정확도를 잰 문구를 그대로 쓴다.
 * 문구를 바꾸면 정확도를 다시 재야 한다.
 */
export const reviewSystemPrompt = `프로젝트 문서의 중복을 검토한다. 문서의 한 섹션에 방금 새로 쓴 글과, 다른 문서에서 고른 후보 섹션 몇 개를 받는다.

중복의 기준:
- 하나의 정의·규칙·판단 기준·사실은 담당 문서 한 곳에 적고, 다른 문서는 그것이 필요한 상황과 관계만 적어 참조한다.
- 문장을 바꾸거나 일부만 요약해도, 후보 섹션이 규정한 조건·기준·예외·구체적인 값을 새로 쓴 글이 다시 규정하면 중복이다. 옆에 [[참조]]를 달았더라도 내용을 다시 적었으면 중복이다.
- 같은 대상을 언급하더라도 두 글이 서로 다른 질문에 답하면 중복이 아니다. 같은 이름이나 식별자가 나온다는 것만으로는 중복이 아니다.
- 다른 문서를 가리키며 관계와 목적만 적은 문장은 중복이 아니다. 한쪽이 다른 쪽의 사실을 전제로 다른 규칙을 정하는 것도 중복이 아니다.

새로 쓴 글과 후보 섹션이 같은 내용을 함께 규정한 곳만 findings에 담는다. 어느 쪽이 원본이든 담는다.
항목 하나는 실제 중복 하나다. 중복이 아니라고 판단한 후보는 항목으로 만들지 않는다. 항목마다 두 글에서 같은 내용을 적은 문장을 각각 그대로 인용한다. 두 인용이 같은 조건·기준·값을 말하지 않으면 중복이 아니다.
가장 분명한 중복부터 최대 3개만 담고, 같은 후보 섹션은 한 번만 담는다. restated는 20자 안팎으로 짧게 쓴다. 인용은 문장 하나만 옮긴다. 중복이 없으면 findings는 빈 배열이다. 확실하지 않은 것은 담지 않는다.`;

/**
 * 모델 출력 스키마다. 후보 주소는 enum으로 고정해 모델이 주소를 바꿔 쓰거나 자기 섹션을 짚지 못하게 한다.
 * 2026-11-11 프로토타입(flow2)의 스키마를 그대로 쓴다.
 * @param addresses 후보 섹션의 주소다. 하나 이상이어야 한다.
 */
export function reviewOutputSchema(
  addresses: readonly [string, ...string[]],
): z.ZodObject<{
  findings: z.ZodArray<
    z.ZodObject<{
      candidate: z.ZodEnum<{ [key: string]: string }>;
      restated: z.ZodString;
      newQuote: z.ZodString;
      candidateQuote: z.ZodString;
    }>
  >;
}> {
  return z.object({
    findings: z.array(
      z.object({
        candidate: z.enum(addresses),
        restated: z.string(),
        newQuote: z
          .string()
          .describe(
            '새로 쓴 글에서 그 내용을 적은 문장. 글자를 바꾸지 않고 그대로 옮긴다.',
          ),
        candidateQuote: z
          .string()
          .describe(
            '후보 섹션에서 같은 내용을 적은 문장. 글자를 바꾸지 않고 그대로 옮긴다.',
          ),
      }),
    ),
  });
}

/**
 * 모델에게 보낼 사용자 메시지를 만든다. 새로 쓴 글과 들어갈 곳, 후보 섹션의 주소와 본문을 담는다.
 * @param target 새 문장이 있는 섹션과 그 후보다.
 */
export function buildReviewPrompt(target: ReviewTarget): string {
  return [
    `# 새로 쓴 글\n들어갈 곳: ${target.address}\n\n${target.sentences.join('\n')}`,
    '# 후보 섹션',
    ...target.candidates.map(
      /** 후보 섹션 하나를 주소 제목과 본문으로 쓴다. */ (candidate) =>
        `## ${candidate.address}\n\n${candidate.body}`,
    ),
  ].join('\n\n');
}

/** 모델 하나에 보내는 탐지 요청이다. 제공자와 상관없는 형태다. */
export interface ReviewModelRequest {
  model: string;
  system: string;
  prompt: string;
  /** 후보 섹션의 주소다. 출력의 candidate는 이 가운데 하나다. */
  addresses: readonly [string, ...string[]];
}

/**
 * 제공자 어댑터다. 새 글과 후보 섹션을 주면 겹치는 문장 쌍 목록을 돌려준다.
 * 호출 오류·시간 초과·거부·출력 해석 실패는 예외로 알린다.
 */
export interface ReviewModelProvider {
  findOverlaps(request: ReviewModelRequest): Promise<ReviewFinding[]>;
}
