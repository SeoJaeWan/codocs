import { readFile } from 'node:fs/promises';
import {
  diagnosticSeverities,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
} from '@codocs/core';
import { parseGuideInput } from '../tool-input/index.js';
import { guideTopics, type GuideTopic } from './domain-values.js';
export { guideTopics, type GuideTopic } from './domain-values.js';

/** 선택한 배포 원문과 사용 가능한 주제를 그대로 제공하는 결과다. */
export type CodocsGuideResponse =
  | {
      success: true;
      topic: GuideTopic;
      topics: readonly GuideTopic[];
      content: string;
    }
  | {
      success: false;
      error: {
        code:
          | typeof queryDiagnosticCodes.invalidInput
          | typeof queryDiagnosticCodes.fileAccessFailed;
        severity: typeof diagnosticSeverities.error;
        message: string;
      };
    };

const topicFiles: Record<GuideTopic, string> = {
  [guideTopics.overview]: 'README.md',
  [guideTopics.schema]: 'schema.md',
  [guideTopics.writing]: 'writing.md',
  [guideTopics.examples]: 'examples.md',
  [guideTopics.updating]: 'updating.md',
  [guideTopics.validation]: 'validation.md',
};

/** 색인이나 cwd에 접근하지 않고 배포 원문을 읽는 handler를 만든다.
 * @param assetRoot 기본값은 빌드 모듈 기준 배포 경로다. 테스트에서는 별도 원문 디렉터리를 명시할 수 있다.
 */
export function createCodocsGuideHandler(
  assetRoot: URL = new URL('../docs/guide/', import.meta.url),
): (input?: unknown) => Promise<CodocsGuideResponse> {
  /** 입력을 검증하고 선택 주제 원문을 반환한다. 파일 실패는 빈 성공으로 바꾸지 않는다. */
  async function codocsGuide(input?: unknown): Promise<CodocsGuideResponse> {
    const parsed = parseGuideInput(arguments.length === 0 ? {} : input);
    if (!parsed)
      return {
        success: false,
        error: {
          code: queryDiagnosticCodes.invalidInput,
          severity: diagnosticSeverities.error,
          message: queryDiagnosticMessages.invalidInput,
        },
      };
    const topic = parsed.topic ?? guideTopics.overview;
    try {
      const content = await readFile(
        new URL(topicFiles[topic], assetRoot),
        'utf8',
      );
      return {
        success: true,
        topic,
        topics: Object.values(guideTopics),
        content,
      };
    } catch {
      return {
        success: false,
        error: {
          code: queryDiagnosticCodes.fileAccessFailed,
          severity: diagnosticSeverities.error,
          message: queryDiagnosticMessages.guideFileAccessFailed,
        },
      };
    }
  }
  return codocsGuide;
}
