import {
  changePlanModes,
  changePlanStatuses,
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  diagnosticSeverities,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  scanStatuses,
  storageDiagnosticCodes,
  storageDiagnosticMessages,
  type ChangePlanMode,
  type Diagnostic,
  type PlannedChangeItem,
} from '@codocs/core';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  planProtectedWorkspaceChanges,
  type WorkspaceChangesPlanResult,
} from '../change-plan/index.js';
import {
  codeFileReasons,
  collectWorkspaceCodeEvidence,
  type WorkspaceCodeEvidence,
} from '../code-reference/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import { loadWorkspace, type WorkspaceScanResult } from '../loader/index.js';
import type { ProjectRoot } from '../project-root/index.js';
import { calculateRevision } from '../revision/index.js';
import {
  applyWorkspaceFileBatch,
  workspaceFileOperationKinds,
  workspaceFileStates,
  type WorkspaceFileBatchOptions,
  type WorkspaceFileOperation,
  type WorkspaceFileState,
} from '../storage/index.js';
import {
  workspaceBatchInputKeys,
  workspaceDocumentMoveModes,
  workspaceWriteInputKinds,
  type WorkspaceWriteInputKind,
} from './domain-values.js';

export * from './domain-values.js';

/** write 입력의 분류 결과다. batch와 singleBatch는 core 다중 계획에 넘길 항목 배열을 함께 갖는다. */
export type WorkspaceWriteInputClassification =
  | { kind: typeof workspaceWriteInputKinds.single }
  | {
      kind: Exclude<
        WorkspaceWriteInputKind,
        typeof workspaceWriteInputKinds.single
      >;
      /** 계획에 넘길 값이다. 최상위 형태가 잘못된 batch는 배열이 아니어서 core가 invalid_input으로 거절한다. */
      items: unknown;
    };

/** 자체 데이터 속성 값만 읽는다. 접근자는 실행하지 않는다. */
function ownValue(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && 'value' in descriptor
      ? (descriptor.value as unknown)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * write 입력이 기존 단일 저장 경로, 단일 delete/move, 여러 항목 중 무엇인지 가린다.
 * `changes`가 있는 객체는 다른 속성이 하나라도 있으면 항목 배열 대신 null을 돌려 invalid_input이 되게 한다.
 * @param input 호출자가 보낸 검증 전 입력이다.
 */
export function classifyWorkspaceWriteInput(
  input: unknown,
): WorkspaceWriteInputClassification {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { kind: workspaceWriteInputKinds.single };
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    return { kind: workspaceWriteInputKinds.single };
  }
  if (keys.includes(workspaceBatchInputKeys.changes))
    return {
      kind: workspaceWriteInputKinds.batch,
      items:
        keys.length === 1
          ? ownValue(input, workspaceBatchInputKeys.changes)
          : null,
    };
  const mode = ownValue(input, 'mode');
  if (
    mode === workspaceDocumentMoveModes.delete ||
    mode === workspaceDocumentMoveModes.move
  )
    return { kind: workspaceWriteInputKinds.singleBatch, items: [input] };
  return { kind: workspaceWriteInputKinds.single };
}

/** 여러 항목 저장 결과의 항목 하나다. 입력 순서와 같다. */
export interface WorkspaceBatchChangeResult {
  /** 입력 배열에서의 위치다. */
  index: number;
  mode: ChangePlanMode;
  /** 문서 ID다. */
  id: string;
  /** 반영 뒤 경로다. delete는 지운 경로, move는 새 경로다. */
  path: string;
  /** move의 원래 경로다. */
  previousPath?: string;
  /** 실제로 반영한 상태다. 변경이 없던 항목은 unchanged다. */
  state: WorkspaceFileState;
  /** 요청이 끝난 뒤 디스크에 남은 내용의 revision이다. 지워진 문서는 생략한다. */
  revision?: string;
}

/** 여러 항목 저장이 성공한 결과다. */
export interface WorkspaceBatchWriteSuccess {
  success: true;
  /** 이번 요청의 변경이 남아 있으면 true다. */
  saved: boolean;
  /** 이번 요청의 변경이 남아 있으면 true다. */
  changed: boolean;
  changes: readonly WorkspaceBatchChangeResult[];
  warnings: readonly Diagnostic<string>[];
  diagnostics: readonly Diagnostic<string>[];
  /** 바뀐 항목이 있을 때만 담는다. 색인 게시까지 끝났으면 true다. */
  indexUpdated?: boolean;
}

/** 여러 항목 저장이 실패한 결과다. saved·changed는 복구하지 못한 변경이 남았을 때만 true다. */
export interface WorkspaceBatchWriteFailure {
  success: false;
  saved: boolean;
  changed: boolean;
  /** 계획 단계 실패는 비어 있다. 반영 단계 실패는 항목별 unchanged·restored·restore_failed를 담는다. */
  changes: readonly WorkspaceBatchChangeResult[];
  warnings: readonly Diagnostic<string>[];
  diagnostics: readonly Diagnostic<string>[];
  error: Diagnostic<string>;
  /** 복구하지 못한 변경이 남아 색인을 게시한 때만 담는다. */
  indexUpdated?: boolean;
}

/** 여러 항목 저장 결과다. */
export type WorkspaceBatchWriteResult =
  WorkspaceBatchWriteSuccess | WorkspaceBatchWriteFailure;

/** 저장 직후 색인에서 확인할 경로 하나와 기대하는 디스크 상태다. revision이 없으면 파일이 없어야 한다. */
export interface WorkspacePublishTarget {
  path: string;
  revision?: string;
}

/** 저장 결과와 그 뒤 색인 게시 대상이다. */
export interface WorkspaceBatchSaveOutcome {
  result: WorkspaceBatchWriteResult;
  /** 반영을 시도해 디스크가 바뀌었을 수 있는 경로다. 비어 있으면 색인 갱신이 필요 없다. */
  touchedPaths: readonly string[];
}

/** 코드 증거를 모으는 함수를 만든다. 프로젝트 루트를 모르면 완전하다고 말할 수 없으므로 incomplete다. */
function evidenceCollector(
  projectRoot: string | undefined,
  collect: (projectRoot: string) => Promise<WorkspaceCodeEvidence>,
): () => Promise<WorkspaceCodeEvidence> {
  return /** 요청마다 새로 읽은 코드 증거를 돌려준다. */ () =>
    projectRoot === undefined
      ? Promise.resolve({
          complete: false,
          files: [],
          failures: [
            {
              reason: codeFileReasons.read,
              message: '프로젝트 루트를 확인하지 못했습니다.',
            },
          ],
        })
      : collect(projectRoot);
}

/** 저장 단계 진단 하나를 만든다. */
function storageFailure(
  code: (typeof storageDiagnosticCodes)[keyof typeof storageDiagnosticCodes],
  message: string,
  sourcePath: string,
  suggestion: string,
): Diagnostic<string> {
  return {
    code,
    severity: diagnosticSeverities.error,
    message,
    path: sourcePath,
    suggestion,
  };
}

/** 항목이 읽은 기존 경로다. create는 없다. */
function sourcePathOf(item: PlannedChangeItem): string | undefined {
  if (item.mode === changePlanModes.create) return undefined;
  return item.previousPath ?? item.path;
}

/** 실패 결과를 만든다. */
function failed(
  diagnostics: readonly Diagnostic<string>[],
  changes: readonly WorkspaceBatchChangeResult[] = [],
  remaining = false,
): WorkspaceBatchWriteFailure {
  return {
    success: false,
    saved: remaining,
    changed: remaining,
    changes,
    warnings: [],
    diagnostics,
    error: diagnostics[0] ?? {
      code: storageDiagnosticCodes.fileAccessFailed,
      severity: diagnosticSeverities.error,
      message: storageDiagnosticMessages.fileAccessFailed,
    },
  };
}

/** 항목이 같은 후보를 만드는지 비교한다. */
function samePlan(a: PlannedChangeItem, b: PlannedChangeItem): boolean {
  return (
    a.mode === b.mode &&
    a.id === b.id &&
    a.path === b.path &&
    a.previousPath === b.previousPath &&
    a.changed === b.changed &&
    a.raw === b.raw &&
    a.baseRevision === b.baseRevision
  );
}

/** 계획 항목을 파일 연산으로 바꾼다. 변경 없는 항목은 연산이 없다. */
function toOperation(
  item: PlannedChangeItem,
): WorkspaceFileOperation | undefined {
  if (!item.changed) return undefined;
  switch (item.mode) {
    case changePlanModes.create:
      return {
        kind: workspaceFileOperationKinds.create,
        path: item.path,
        raw: item.raw ?? '',
      };
    case changePlanModes.delete:
      return {
        kind: workspaceFileOperationKinds.delete,
        path: item.path,
        baseRevision: item.baseRevision ?? '',
      };
    case changePlanModes.move:
      return {
        kind: workspaceFileOperationKinds.move,
        path: item.previousPath ?? item.path,
        baseRevision: item.baseRevision ?? '',
        toPath: item.path,
      };
    default:
      return {
        kind: workspaceFileOperationKinds.replace,
        path: item.path,
        baseRevision: item.baseRevision ?? '',
        raw: item.raw ?? '',
      };
  }
}

/** 항목별 결과를 만든다. 지운 문서는 revision이 없다. */
function toChange(
  item: PlannedChangeItem,
  state: WorkspaceFileState,
  revision: string | undefined,
): WorkspaceBatchChangeResult {
  const kept =
    item.mode === changePlanModes.delete &&
    state === workspaceFileStates.changed
      ? undefined
      : revision;
  return {
    index: item.index,
    mode: item.mode,
    id: item.id,
    path: item.path,
    ...(item.previousPath === undefined
      ? {}
      : { previousPath: item.previousPath }),
    state,
    ...(kept === undefined ? {} : { revision: kept }),
  };
}

/**
 * 반영 직전 전체를 다시 탐색하고 계획을 다시 세워 후보가 같은지 확인한다. batch 전체에 한 번 수행한다.
 * 후보가 달라지면 달라진 항목의 문서를 모두 revision_conflict로 돌려준다.
 */
async function recheck(
  root: ProjectRoot,
  items: unknown,
  planned: readonly PlannedChangeItem[],
  collect: () => Promise<WorkspaceCodeEvidence>,
): Promise<readonly Diagnostic<string>[]> {
  const current = await loadWorkspace({
    cwd: root.startCwd,
    project: root.projectRoot,
  });
  const first = planned.find((item) => item.changed) ?? planned[0];
  if (current.status !== scanStatuses.complete)
    return [
      storageFailure(
        storageDiagnosticCodes.fileAccessFailed,
        storageDiagnosticMessages.fileAccessFailed,
        first?.path ?? '',
        '전체 문서를 다시 탐색한 뒤 저장하세요.',
      ),
    ];
  const catalog = buildWorkspaceCatalog(current);
  const duplicates: Diagnostic<string>[] = [];
  for (const item of planned) {
    const expected = sourcePathOf(item);
    const others = [...(catalog.idPaths.get(item.id) ?? [])].filter(
      (candidate) =>
        expected === undefined ||
        path.normalize(candidate) !== path.normalize(expected),
    );
    if (others.length)
      duplicates.push({
        code: catalogDiagnosticCodes.duplicateId,
        severity: diagnosticSeverities.error,
        message: catalogDiagnosticMessages.duplicateId,
        path: item.path,
        suggestion: '충돌한 문서 ID를 확인하고 다시 저장하세요.',
      });
  }
  if (duplicates.length) return duplicates;
  const replanned = await planProtectedWorkspaceChanges(
    items,
    current,
    collect,
    catalog,
  );
  if (replanned.status === changePlanStatuses.failed)
    return replanned.diagnostics;
  const conflicts: Diagnostic<string>[] = [];
  for (const item of planned) {
    const same =
      replanned.status === changePlanStatuses.candidate &&
      replanned.items.length === planned.length &&
      replanned.items[item.index] !== undefined &&
      samePlan(item, replanned.items[item.index]!);
    if (!same)
      conflicts.push(
        storageFailure(
          storageDiagnosticCodes.revisionConflict,
          storageDiagnosticMessages.revisionConflict,
          sourcePathOf(item) ?? item.path,
          '최신 문서를 다시 읽고 변경을 검토하세요.',
        ),
      );
  }
  if (!conflicts.length && replanned.status !== changePlanStatuses.candidate)
    conflicts.push(
      storageFailure(
        storageDiagnosticCodes.revisionConflict,
        storageDiagnosticMessages.revisionConflict,
        first?.path ?? '',
        '최신 문서를 다시 읽고 변경을 검토하세요.',
      ),
    );
  return conflicts;
}

/**
 * 여러 항목(create·update·replace·delete·move)을 한 번에 계획하고 storage 엔진으로 반영한다.
 * 계획 단계가 실패하면 아무것도 바꾸지 않는다. 코드 증거는 필요한 계획에만 새로 읽고(계획 1회, 반영 직전 재계획 1회),
 * 반영 직전에 전체 재스캔·중복 ID 확인·재계획을 batch 전체에 한 번 수행한다. 색인 반영은 수행하지 않는다.
 * @param items 항목 배열이다. 검증하지 않은 입력을 그대로 받는다.
 * @param scan 계획의 기준이 되는 완료된 스캔이다.
 * @param options 파일 연산·경합 지점·코드 증거 수집 대체다.
 */
export async function saveWorkspaceChanges(
  items: unknown,
  scan: WorkspaceScanResult,
  options: WorkspaceFileBatchOptions = {},
): Promise<WorkspaceBatchSaveOutcome> {
  if (!Array.isArray(items) || !items.length)
    return {
      result: failed([
        {
          code: queryDiagnosticCodes.invalidInput,
          severity: diagnosticSeverities.error,
          message: queryDiagnosticMessages.invalidInput,
          suggestion:
            'changes에는 create·update·replace·delete·move 항목을 하나 이상 담으세요.',
        },
      ]),
      touchedPaths: [],
    };
  const projectRoot =
    'root' in scan && scan.root ? scan.root.projectRoot : undefined;
  const collect = evidenceCollector(
    projectRoot,
    options.collectCodeEvidence ?? collectWorkspaceCodeEvidence,
  );
  const plan: WorkspaceChangesPlanResult = await planProtectedWorkspaceChanges(
    items,
    scan,
    collect,
  );
  if (plan.status === changePlanStatuses.failed)
    return { result: failed(plan.diagnostics), touchedPaths: [] };
  if (plan.status === changePlanStatuses.unchanged)
    return {
      result: {
        success: true,
        saved: false,
        changed: false,
        changes: plan.items.map((item) =>
          toChange(item, workspaceFileStates.unchanged, item.revision),
        ),
        warnings: plan.diagnostics,
        diagnostics: plan.diagnostics,
      },
      touchedPaths: [],
    };
  if (!('root' in scan) || !scan.root)
    return {
      result: failed([
        storageFailure(
          storageDiagnosticCodes.fileAccessFailed,
          storageDiagnosticMessages.fileAccessFailed,
          plan.items[0]?.path ?? '',
          '프로젝트 경로를 다시 선택하고 탐색하세요.',
        ),
      ]),
      touchedPaths: [],
    };
  const root = scan.root;
  const planned = plan.items;
  const operations: WorkspaceFileOperation[] = [];
  const itemOf: PlannedChangeItem[] = [];
  for (const item of planned) {
    const operation = toOperation(item);
    if (!operation) continue;
    operations.push(operation);
    itemOf.push(item);
  }
  /** 호출자 지점을 먼저 거친 뒤 반영 직전 재스캔·재계획을 batch 전체에 한 번 수행한다. */
  async function beforeBatchApply(): Promise<readonly Diagnostic<string>[]> {
    const early = await options.beforeBatchApply?.();
    if (early?.length) return early;
    return recheck(root, items, planned, collect);
  }
  const applied = await applyWorkspaceFileBatch(root, operations, {
    ...options,
    beforeBatchApply,
  });
  const states = new Map<
    number,
    { state: WorkspaceFileState; revision?: string }
  >();
  for (const operation of applied.operations) {
    const item = itemOf[operation.index];
    if (item)
      states.set(item.index, {
        state: operation.state,
        ...(operation.revision === undefined
          ? {}
          : { revision: operation.revision }),
      });
  }
  const changes = planned.map(
    /** 항목마다 반영 상태를 입력 순서로 모은다. */ (item) => {
      const entry = states.get(item.index);
      return entry
        ? toChange(item, entry.state, entry.revision)
        : toChange(item, workspaceFileStates.unchanged, item.revision);
    },
  );
  const diagnostics = [...plan.diagnostics, ...applied.diagnostics];
  const touched = new Set<string>();
  for (const operation of applied.operations)
    if (operation.state !== workspaceFileStates.unchanged) {
      touched.add(operation.path);
      if (operation.toPath !== undefined) touched.add(operation.toPath);
    }
  if (!applied.success)
    return {
      result: failed(applied.diagnostics, changes, applied.saved),
      touchedPaths: [...touched],
    };
  return {
    result: {
      success: true,
      saved: applied.saved,
      changed: applied.changed,
      changes,
      warnings: plan.diagnostics,
      diagnostics,
    },
    touchedPaths: [...touched],
  };
}

/**
 * 반영 뒤 색인이 맞춰야 할 실제 디스크 상태를 경로마다 읽는다.
 * 파일이 있으면 그 바이트의 revision, 없으면 revision 없이 부재를 기대한다. 읽지 못한 경로는 건너뛴다.
 * @param root 프로젝트 루트다.
 * @param paths 프로젝트 기준 상대 경로다.
 */
export async function readWorkspacePublishTargets(
  root: ProjectRoot,
  paths: readonly string[],
): Promise<readonly WorkspacePublishTarget[]> {
  const targets: WorkspacePublishTarget[] = [];
  for (const target of paths) {
    try {
      const bytes = await readFile(path.resolve(root.projectRoot, target));
      targets.push({ path: target, revision: calculateRevision(bytes) });
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 'ENOENT' || code === 'ENOTDIR')
        targets.push({ path: target });
    }
  }
  return targets;
}

/** 단일 delete/move 요청의 성공 결과다. 기존 단일 저장 결과 형태에 move의 previousPath를 더한다. */
export interface WorkspaceMoveDeleteSuccess {
  success: true;
  saved: boolean;
  changed: boolean;
  id: string;
  source: { path: string };
  revision?: string;
  previousPath?: string;
  warnings: readonly Diagnostic<string>[];
  diagnostics: readonly Diagnostic<string>[];
  indexUpdated?: boolean;
}

/** 단일 delete/move 요청의 실패 결과다. 복구하지 못한 변경이 남으면 saved·changed가 true다. */
export interface WorkspaceMoveDeleteFailure {
  success: false;
  saved: boolean;
  changed: boolean;
  diagnostics: readonly Diagnostic<string>[];
  error: Diagnostic<string>;
  indexUpdated?: boolean;
}

/** 단일 delete/move 요청의 결과다. */
export type WorkspaceMoveDeleteResult =
  WorkspaceMoveDeleteSuccess | WorkspaceMoveDeleteFailure;

/**
 * 항목 하나의 여러 항목 결과를 기존 단일 저장 결과 형태로 바꾼다.
 * @param result 항목 하나를 계획·반영한 결과다.
 */
export function toSingleMoveDeleteResult(
  result: WorkspaceBatchWriteResult,
): WorkspaceMoveDeleteResult {
  const item = result.changes[0];
  if (!result.success || !item)
    return {
      success: false,
      saved: result.saved,
      changed: result.changed,
      diagnostics: result.diagnostics,
      error: 'error' in result ? result.error : failed([]).error,
      ...(result.indexUpdated === undefined
        ? {}
        : { indexUpdated: result.indexUpdated }),
    };
  return {
    success: true,
    saved: result.saved,
    changed: result.changed,
    id: item.id,
    source: { path: item.path },
    ...(item.revision === undefined ? {} : { revision: item.revision }),
    ...(item.previousPath === undefined
      ? {}
      : { previousPath: item.previousPath }),
    warnings: result.warnings,
    diagnostics: result.diagnostics,
    ...(result.indexUpdated === undefined
      ? {}
      : { indexUpdated: result.indexUpdated }),
  };
}
