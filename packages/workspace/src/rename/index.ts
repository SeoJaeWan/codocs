import {
  applyRenameChanges,
  planRename,
  renameBlockingReasons,
  renamePlanStatuses,
  type Catalog,
  type Diagnostic,
  type FieldPath,
  type ReferenceCandidate,
  type ReferenceResolution,
  type ReferenceResolutionStatus,
  type RenameBlockingReason,
  type RenameChange,
  type RenameConflict,
  type RenameImpact,
  type RenamePlan,
  type RenamePlanStatus,
  type RenameRequest,
  type RenameSelection,
  type SourceRange,
} from '@codocs/core';
import { workspaceDocumentStatuses } from '../loader/domain-values.js';
import type { WorkspaceScanResult } from '../loader/index.js';
import type { WorkspaceRenameFileState } from './domain-values.js';
export * from './domain-values.js';

/** 이름 변경 결과에서 참조 후보를 식별하는 이름·경로다. */
export interface WorkspaceRenameCandidate {
  path: string;
  name?: string;
}

/** 참조가 가리키는 후보와 해석 상태다. */
export interface WorkspaceRenameResolution {
  status: ReferenceResolutionStatus;
  candidates: readonly WorkspaceRenameCandidate[];
}

/** 고칠 위치와 바꾸기 전후의 표기다. name과 parent 항목 변경은 occurrenceIndex가 없다. */
export interface WorkspaceRenameChange {
  path: string;
  fieldPath: FieldPath;
  range: SourceRange;
  oldText: string;
  newText: string;
  targetPath: string;
  occurrenceIndex?: number;
}

/** 자동으로 고치지 않은 참조와 그 후보다. 선택이 필요한 참조는 reason으로 구분한다. */
export interface WorkspaceRenameImpact {
  path: string;
  occurrenceIndex: number;
  text: string;
  range: SourceRange;
  reason: RenameImpact['reason'];
  before: WorkspaceRenameResolution;
  after: WorkspaceRenameResolution;
}

/** 프로젝트에서 새 이름과 겹치는 문서다. */
export interface WorkspaceRenameConflict {
  candidates: readonly WorkspaceRenameCandidate[];
}

/** 파일과 색인을 바꾸지 않고 계산한 이름 변경 미리보기다. */
export interface WorkspaceRenamePreview {
  status: RenamePlanStatus;
  targetPath: string;
  oldName?: string;
  newName: string;
  blockingReason?: RenameBlockingReason;
  changes: readonly WorkspaceRenameChange[];
  impacts: readonly WorkspaceRenameImpact[];
  conflicts: readonly WorkspaceRenameConflict[];
  invalidSelections: readonly RenameSelection[];
  /** 영향받는 파일(고칠 파일과 미해결 참조가 있는 파일)의 현재 revision이다. 반영 때 그대로 돌려준다. */
  revisions: Readonly<Record<string, string>>;
}

/** 파일별 반영 결과다. revision은 이 요청이 끝난 뒤 디스크에 있다고 믿는 내용의 revision이다. */
export interface WorkspaceRenameFileResult {
  path: string;
  state: WorkspaceRenameFileState;
  revision: string;
}

/** 반영 성공 결과다. unresolved는 고르지 않은 참조가 원문 그대로 남았다는 뜻이다. */
export interface WorkspaceRenameApplySuccess {
  success: true;
  status: Exclude<RenamePlanStatus, typeof renamePlanStatuses.blocked>;
  saved: boolean;
  changed: boolean;
  files: readonly WorkspaceRenameFileResult[];
  impacts: readonly WorkspaceRenameImpact[];
  diagnostics: readonly Diagnostic<string>[];
}

/**
 * 반영 실패 결과다. blocked는 preview를 함께 담고 파일을 바꾸지 않는다.
 * 중간 실패는 files에 실제 상태를 담으며 saved·changed는 새 내용이 남은 파일이 있는지를 뜻한다.
 */
export interface WorkspaceRenameApplyFailure {
  success: false;
  saved: boolean;
  changed: boolean;
  files: readonly WorkspaceRenameFileResult[];
  diagnostics: readonly Diagnostic<string>[];
  preview?: WorkspaceRenamePreview;
}

/** 이름 변경 반영의 성공 또는 실패 결과다. */
export type WorkspaceRenameApplyResult =
  WorkspaceRenameApplySuccess | WorkspaceRenameApplyFailure;

/** 파일 반영이 사용할 새 원문이다. */
export interface WorkspaceRenameEdit {
  path: string;
  raw: string;
  revision: string;
}

/** 미리보기와 같은 계산에서 얻은 파일별 새 원문이다. */
export interface WorkspaceRenamePreparation {
  preview: WorkspaceRenamePreview;
  edits: readonly WorkspaceRenameEdit[];
}

/** 입력 객체의 자체 데이터 속성만 읽는다. */
function ownValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** 외부 입력의 선택 하나를 검사한다. */
function selection(value: unknown): RenameSelection | undefined {
  const sourcePath = ownValue(value, 'sourcePath');
  const occurrenceIndex = ownValue(value, 'occurrenceIndex');
  const targetPath = ownValue(value, 'targetPath');
  if (
    typeof sourcePath !== 'string' ||
    typeof occurrenceIndex !== 'number' ||
    typeof targetPath !== 'string'
  )
    return undefined;
  return { sourcePath, occurrenceIndex, targetPath };
}

/**
 * 외부 이름 변경 입력의 대상·새 이름·선택을 검사한다.
 * @param input 미리보기와 반영이 공유하는 입력이다.
 * @returns 형식이 맞지 않으면 undefined다.
 */
export function parseRenameRequest(input: unknown): RenameRequest | undefined {
  const targetPath = ownValue(input, 'targetPath');
  const newName = ownValue(input, 'newName');
  const rawSelections = ownValue(input, 'selections');
  if (typeof targetPath !== 'string' || typeof newName !== 'string')
    return undefined;
  const selections: RenameSelection[] = [];
  if (rawSelections !== undefined) {
    if (!Array.isArray(rawSelections)) return undefined;
    for (let index = 0; index < rawSelections.length; index++) {
      const item = selection(
        Object.getOwnPropertyDescriptor(rawSelections, index)?.value,
      );
      if (!item) return undefined;
      selections.push(item);
    }
  }
  return { targetPath, newName, ...(selections.length ? { selections } : {}) };
}

/**
 * 반영 입력의 파일별 revision을 검사한다.
 * @param input 반영 입력이다.
 * @returns 경로별 revision이며 형식이 맞지 않으면 undefined다.
 */
export function parseRenameRevisions(
  input: unknown,
): Readonly<Record<string, string>> | undefined {
  const value = ownValue(input, 'revisions');
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const result: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    const revision = ownValue(value, key);
    if (typeof revision !== 'string' || !revision) return undefined;
    result[key] = revision;
  }
  return result;
}

/** 후보를 이름·경로만 가진 값으로 줄인다. */
function candidate(item: ReferenceCandidate): WorkspaceRenameCandidate {
  return {
    path: item.path,
    ...(item.name === undefined ? {} : { name: item.name }),
  };
}

/** 참조 해석을 보고용 값으로 줄인다. */
function resolution(item: ReferenceResolution): WorkspaceRenameResolution {
  return { status: item.status, candidates: item.candidates.map(candidate) };
}

/** 계산한 영향을 보고용 값으로 줄인다. */
function impact(item: RenameImpact): WorkspaceRenameImpact {
  return {
    path: item.path,
    occurrenceIndex: item.occurrenceIndex,
    text: item.occurrence.text,
    range: item.occurrence.range,
    reason: item.reason,
    before: resolution(item.before),
    after: resolution(item.after),
  };
}

/** 계산한 수정안을 보고용 값으로 줄인다. */
function changeReport(change: RenameChange): WorkspaceRenameChange {
  return {
    path: change.path,
    fieldPath: change.fieldPath,
    range: change.range,
    oldText: change.oldText,
    newText: change.newText,
    targetPath: change.targetPath,
    ...(change.occurrenceIndex === undefined
      ? {}
      : { occurrenceIndex: change.occurrenceIndex }),
  };
}

/** 충돌을 보고용 값으로 줄인다. */
function conflict(item: RenameConflict): WorkspaceRenameConflict {
  return { candidates: item.candidates.map(candidate) };
}

/** 계산을 진행할 수 없는 미리보기를 만든다. 변경은 항상 0개다. */
function blocked(
  plan: RenamePlan,
  reason: RenameBlockingReason,
  revisions: Readonly<Record<string, string>> = {},
): WorkspaceRenamePreparation {
  return {
    preview: {
      status: renamePlanStatuses.blocked,
      targetPath: plan.targetPath,
      ...(plan.oldName === undefined ? {} : { oldName: plan.oldName }),
      newName: plan.newName,
      blockingReason: reason,
      changes: [],
      impacts: plan.impacts.map(impact),
      conflicts: plan.conflicts.map(conflict),
      invalidSelections: plan.invalidSelections,
      revisions,
    },
    edits: [],
  };
}

/**
 * 같은 스캔의 색인으로 이름 변경을 계산하고 파일별 새 원문까지 만든다. 디스크와 색인은 바꾸지 않는다.
 * 새 원문을 안전하게 만들 수 없는 파일이 하나라도 있으면 전체를 blocked로 돌려준다.
 * @param request 대상·새 이름·선택이다.
 * @param scan 색인을 만든 같은 스캔이며 파일별 원문과 revision을 제공한다.
 * @param catalog 같은 스캔에서 만든 색인이다.
 * @returns 미리보기와 반영에 쓸 파일별 새 원문이다.
 */
export function prepareWorkspaceRename(
  request: RenameRequest,
  scan: WorkspaceScanResult,
  catalog: Catalog,
): WorkspaceRenamePreparation {
  const plan = planRename(catalog, request);
  if (plan.status === renamePlanStatuses.blocked)
    return blocked(
      plan,
      plan.blockingReason ?? renameBlockingReasons.targetUnavailable,
    );
  const documents = new Map(
    scan.documents.map((document) => [document.source.path, document]),
  );
  const revisions: Record<string, string> = {};
  for (const path of new Set([
    ...plan.changes.map((change) => change.path),
    ...plan.impacts.map((item) => item.path),
  ])) {
    const document = documents.get(path);
    if (!document)
      return blocked(plan, renameBlockingReasons.targetUnavailable);
    revisions[path] = document.revision;
  }
  const edits: WorkspaceRenameEdit[] = [];
  for (const path of [
    ...new Set(plan.changes.map((change) => change.path)),
  ].sort()) {
    const document = documents.get(path);
    if (!document || document.status === workspaceDocumentStatuses.parseError)
      return blocked(plan, renameBlockingReasons.targetUnavailable);
    if (!document.utf8Lossless)
      return blocked(plan, renameBlockingReasons.sourceNotLossless);
    const edited = applyRenameChanges(
      document.parsed,
      plan.changes.filter((change) => change.path === path),
    );
    if (!edited.success)
      return blocked(plan, renameBlockingReasons.unrepresentable);
    edits.push({ path, raw: edited.raw, revision: document.revision });
  }
  return {
    preview: {
      status: plan.status,
      targetPath: plan.targetPath,
      ...(plan.oldName === undefined ? {} : { oldName: plan.oldName }),
      newName: plan.newName,
      changes: plan.changes.map(changeReport),
      impacts: plan.impacts.map(impact),
      conflicts: [],
      invalidSelections: [],
      revisions,
    },
    edits,
  };
}
