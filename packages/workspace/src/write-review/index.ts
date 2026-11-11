import type {
  Catalog,
  ChangePlanMode,
  Diagnostic,
  Document,
  WriteOverlap,
} from '@codocs/core';
import ignore from 'ignore';

/** 저장 전 탐지에 넘기는 계획 항목 하나다. 내용이 바뀌는 항목만 담는다. */
export interface WorkspaceWriteReviewItem {
  /** 입력 배열에서의 위치다. 단일 요청은 0이다. */
  index: number;
  mode: ChangePlanMode;
  /** 반영 뒤 경로다. delete는 지워지는 경로, move는 새 경로다. */
  path: string;
  /** move의 원래 경로다. */
  previousPath?: string;
  /** create·update·replace가 반영된 뒤의 문서 데이터다. */
  data?: Document;
  /** 반영할 원문이다. delete에는 없다. */
  raw?: string;
}

/** 저장 전 탐지 요청이다. 기존 검증을 모두 통과해 저장될 수 있는 요청에만 만든다. */
export interface WorkspaceWriteReviewRequest {
  /** 프로젝트 루트의 실제 경로다. 설정 파일을 읽는 기준이다. */
  projectRoot: string;
  /** 요청을 반영하기 전의 카탈로그다. */
  catalog: Catalog;
  items: readonly WorkspaceWriteReviewItem[];
  /** changes 요청이면 true다. 응답의 겹침에 항목 위치를 담을지 정한다. */
  batch: boolean;
}

/** 저장 전 탐지 결과다. blocked가 있으면 저장하지 않는다. */
export interface WorkspaceWriteReviewResult {
  /** 저장을 막는 오류 진단이다. */
  blocked?: Diagnostic<string>;
  /** 겹치는 문장 쌍이다. 막았을 때와 저장하고 알릴 때 담는다. */
  overlaps?: readonly WriteOverlap[];
  /** 막았을 때 같은 요청에 붙여 다시 보내면 탐지 없이 저장하는 확인 값이다. */
  reviewToken?: string;
  /** 탐지하지 못한 이유 같은 경고다. 저장 결과의 warnings·diagnostics에 더한다. */
  warnings?: readonly Diagnostic<string>[];
}

/**
 * 검증을 통과한 저장 계획을 파일을 쓰기 전에 검토한다. 호출자가 제공하며 예외를 던지지 않아야 한다.
 * 제공하지 않으면 저장 흐름은 탐지 없이 그대로 진행한다.
 */
export type WorkspaceWriteReview = (
  request: WorkspaceWriteReviewRequest,
) => Promise<WorkspaceWriteReviewResult>;

/** write 결과에 탐지가 더하는 필드다. 탐지가 없거나 알릴 것이 없으면 담지 않는다. */
export interface WorkspaceWriteReviewFields {
  overlaps?: readonly WriteOverlap[];
  reviewToken?: string;
}

/** 탐지 결과에서 응답에 더할 필드만 꺼낸다. 비어 있는 값은 담지 않는다. */
export function reviewFields(
  result: WorkspaceWriteReviewResult | undefined,
): WorkspaceWriteReviewFields {
  return {
    ...(result?.overlaps?.length ? { overlaps: result.overlaps } : {}),
    ...(result?.reviewToken === undefined
      ? {}
      : { reviewToken: result.reviewToken }),
  };
}

/**
 * 탐지 제외 경로 판정 함수를 만든다. 패턴은 프로젝트 루트 기준의 `.gitignore` 문법이며(예: `.codocs/discussions/`),
 * `!`로 시작하는 패턴은 앞에서 제외한 경로를 다시 포함한다. 패턴이 없으면 아무 경로도 제외하지 않는다.
 * @param patterns 제외 경로 패턴 목록이다.
 * @returns 프로젝트 기준 상대 경로(`/` 구분)를 받아 제외 대상이면 true를 돌려준다.
 */
export function createReviewExclusion(
  patterns: readonly string[],
): (path: string) => boolean {
  if (!patterns.length) return /** 제외 경로가 없다. */ () => false;
  const matcher = ignore().add([...patterns]);
  return /** 상대 경로가 제외 패턴에 걸리는지 확인한다. */ (path) =>
    matcher.ignores(path);
}
