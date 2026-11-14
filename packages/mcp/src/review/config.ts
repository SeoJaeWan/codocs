import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  defaultReviewModel,
  defaultReviewProvider,
  reviewConfigFileName,
  reviewEnvironmentKeys,
  reviewProviders,
  type ReviewProvider,
} from './domain-values.js';

/** 탐지에 쓰는 설정이다. 키는 서버 시작 때 따로 읽는다. */
export interface ReviewSettings {
  provider: ReviewProvider;
  model: string;
  /** 프로젝트 루트 기준 `.gitignore` 문법의 제외 경로다. */
  exclude: readonly string[];
}

/** 설정을 읽은 결과다. 실패하면 원인 문장을 담는다. */
export type ReviewSettingsResult =
  | { success: true; settings: ReviewSettings }
  | { success: false; message: string };

/** 설정 파일을 읽는 경계다. 파일이 없으면 undefined를 돌려준다. 테스트에서 바꿔 끼운다. */
export type ReviewConfigReader = (
  projectRoot: string,
) => Promise<string | undefined>;

const providerSchema = z.enum(Object.values(reviewProviders));
/** 설정 파일의 형식이다. 모르는 항목은 거부하며 API 키 항목도 받지 않는다. */
const configSchema = z
  .strictObject({
    review: z
      .strictObject({
        provider: providerSchema.optional(),
        model: z.string().min(1).optional(),
        exclude: z.array(z.string().min(1)).optional(),
      })
      .optional(),
  })
  .nullable();

/** 프로젝트 루트의 설정 파일을 읽는다. 없으면 undefined이고 그 밖의 읽기 오류는 던진다. */
export const readReviewConfigFile: ReviewConfigReader = async (projectRoot) => {
  try {
    return await readFile(path.join(projectRoot, reviewConfigFileName), 'utf8');
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return undefined;
    throw error;
  }
};

/** 비어 있지 않은 환경 변수 값이다. 빈 문자열은 설정하지 않은 것으로 본다. */
function environmentValue(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** zod 오류를 항목 경로와 함께 한 문장으로 만든다. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map(
      /** 오류 하나를 `경로: 원인`으로 쓴다. */ (issue) =>
        `${issue.path.length ? issue.path.join('.') : '(전체)'}: ${issue.message}`,
    )
    .join('; ');
}

/**
 * 탐지 설정을 정한다. 항목마다 MCP 설정의 환경 변수 → 프로젝트 루트의 codocs.config.yaml → 기본값 순서로 쓴다.
 * 제외 경로는 두 목록을 합치지 않고 환경 변수 값이 파일 값을 대신한다.
 * 파일을 해석할 수 없거나 모르는 항목·잘못된 값이 있거나 환경 변수의 제공자가 지원하지 않는 값이면 실패한다.
 * @param env 환경 변수다.
 * @param projectRoot 프로젝트 루트의 실제 경로다.
 * @param read 설정 파일을 읽는 경계다.
 */
export async function loadReviewSettings(
  env: Readonly<Record<string, string | undefined>>,
  projectRoot: string,
  read: ReviewConfigReader = readReviewConfigFile,
): Promise<ReviewSettingsResult> {
  let text: string | undefined;
  try {
    text = await read(projectRoot);
  } catch (error: unknown) {
    return {
      success: false,
      message: `${reviewConfigFileName}을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let file: z.infer<typeof configSchema> = null;
  if (text !== undefined) {
    let data: unknown;
    try {
      data = parse(text);
    } catch (error: unknown) {
      return {
        success: false,
        message: `${reviewConfigFileName}을 YAML로 해석하지 못했습니다: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      };
    }
    const checked = configSchema.safeParse(data ?? null);
    if (!checked.success)
      return {
        success: false,
        message: `${reviewConfigFileName}의 설정이 올바르지 않습니다(${describeIssues(checked.error)}). API 키는 파일에 넣지 않고 MCP 설정의 ${reviewEnvironmentKeys.apiKey}로 지정합니다.`,
      };
    file = checked.data;
  }
  const providerText = environmentValue(env, reviewEnvironmentKeys.provider);
  const provider = providerSchema.safeParse(providerText);
  if (providerText !== undefined && !provider.success)
    return {
      success: false,
      message: `${reviewEnvironmentKeys.provider}의 값 ${providerText}은 지원하지 않는 제공자입니다. 지원: ${Object.values(reviewProviders).join(', ')}`,
    };
  const excludeText = environmentValue(env, reviewEnvironmentKeys.exclude);
  return {
    success: true,
    settings: {
      provider: provider.success
        ? provider.data
        : (file?.review?.provider ?? defaultReviewProvider),
      model:
        environmentValue(env, reviewEnvironmentKeys.model) ??
        file?.review?.model ??
        defaultReviewModel,
      exclude:
        excludeText === undefined
          ? (file?.review?.exclude ?? [])
          : excludeText
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
    },
  };
}
