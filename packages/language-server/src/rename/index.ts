import {
  getStringRange,
  parseYaml,
  type OffsetRange,
  type RenameSelection,
} from '@codocs/core';
import type {
  WorkspaceRenamePreviewResult,
  WorkspaceRenameResult,
} from '@codocs/workspace';
import type { Position, Range } from 'vscode-languageserver/node.js';
import type { RenameRequestFailureCode } from './domain-values.js';
export {
  renameRequestFailureCodes,
  type RenameRequestFailureCode,
} from './domain-values.js';

/** 이름 바꾸기를 시작할 수 있는 위치와 현재 이름을 확인하는 요청의 메서드 이름이다. */
export const prepareRenameMethod = 'codocs/prepareRename';
/** 파일을 바꾸지 않고 이름 변경을 미리 계산하는 요청의 메서드 이름이다. */
export const planRenameMethod = 'codocs/planRename';
/** 미리보기와 같은 입력으로 이름 변경을 파일에 반영하는 요청의 메서드 이름이다. */
export const applyRenameMethod = 'codocs/applyRename';

/** 이름 바꾸기를 시작할 위치다. */
export interface PrepareRenameRequest {
  textDocument: { uri: string };
  position: Position;
}

/** 이름을 바꿀 수 있는 위치의 범위와 바꿀 문서의 현재 이름이다. */
export interface PrepareRenameResponse {
  /** 입력 창이 선택할 편집기 범위다. */
  range: Range;
  /** 바꿀 문서의 현재 이름이다. */
  placeholder: string;
  /** 이름을 바꿀 문서의 프로젝트 상대 발견 경로다. */
  targetPath: string;
}

/** 이름 변경 미리보기를 요청하는 출처 문서와 입력이다. */
export interface PlanRenameRequest {
  textDocument: { uri: string };
  targetPath: string;
  newName: string;
  selections?: readonly RenameSelection[];
}

/** 이름 변경 반영을 요청하는 입력이며 미리보기가 돌려준 파일별 revision을 포함한다. */
export interface ApplyRenameRequest extends PlanRenameRequest {
  revisions: Readonly<Record<string, string>>;
}

/** 서버가 요청을 시작하지 못한 이유다. */
export interface RenameRequestFailure {
  success: false;
  error: { code: RenameRequestFailureCode; message: string };
}

/** 결과에 나온 프로젝트 상대 경로의 file URI다. 클라이언트가 저장하지 않은 수정을 확인하는 데 쓴다. */
export interface RenameFileUris {
  fileUris: Readonly<Record<string, string>>;
}

/** 미리보기 응답이다. */
export type PlanRenameResponse =
  | (Extract<WorkspaceRenamePreviewResult, { success: true }> & RenameFileUris)
  | (Extract<WorkspaceRenamePreviewResult, { success: false }> & RenameFileUris)
  | RenameRequestFailure;

/** 반영 응답이다. */
export type ApplyRenameResponse =
  (WorkspaceRenameResult & RenameFileUris) | RenameRequestFailure;

/**
 * 문서 원문의 name 값 위치를 찾는다.
 * @param text 편집 중인 문서 원문이다.
 * @returns name이 비어 있지 않은 문자열이면 값의 UTF-16 offset 범위와 이름이며 아니면 undefined다.
 */
export function nameValueRange(
  text: string,
): { range: OffsetRange; name: string } | undefined {
  const parsed = parseYaml(text);
  if (!parsed.success) return undefined;
  const name = parsed.data['name'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const range = getStringRange(parsed, ['name'], {
    start: 0,
    end: name.length,
  });
  return range ? { range, name } : undefined;
}
