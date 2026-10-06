import {
  changePlanDiagnosticCodes,
  changePlanDiagnosticMessages,
  changePlanStatuses,
  diagnosticSeverities,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  renameDiagnosticCodes,
  renameDiagnosticMessages,
  renamePlanStatuses,
  storageDiagnosticCodes,
  storageDiagnosticMessages,
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  scanStatuses,
  type Catalog,
  type Diagnostic,
} from '@codocs/core';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { planProtectedWorkspaceChange } from '../change-plan/index.js';
import { getIoErrorCode } from '../diagnostics/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import { loadWorkspace, type WorkspaceScanResult } from '../loader/index.js';
import {
  codeFileReasons,
  collectWorkspaceCodeEvidence,
  type WorkspaceCodeEvidence,
  type WorkspaceCodeRenameSources,
} from '../code-reference/index.js';
import {
  computeCodeFilePolicy,
  readEligibleCodeFile,
  type CodeFilePolicy,
} from '../paths/code-file-access.js';
import {
  ensureWorkspaceParent,
  inspectWorkspaceParent,
  resolveWorkspacePath,
} from '../paths/index.js';
import {
  workspacePathFailureStatuses,
  workspaceTargetKinds,
} from '../paths/domain-values.js';
import type { ProjectRoot } from '../project-root/index.js';
import {
  parseRenameRequest,
  parseRenameRevisions,
  prepareWorkspaceRename,
  workspaceRenameFileKinds,
  type WorkspaceRenameApplyFailure,
  type WorkspaceRenameApplyResult,
  type WorkspaceRenameEdit,
  type WorkspaceRenameFileResult,
  type WorkspaceRenamePreview,
} from '../rename/index.js';
import { calculateRevision } from '../revision/index.js';
import {
  workspaceFileOperationKinds,
  workspaceFileStates,
  type WorkspaceFileOperationKind,
  type WorkspaceFileState,
} from './domain-values.js';
export * from './domain-values.js';

/** 임시 파일 기록과 실제 반영의 실패 지점을 실제 파일로 검사하기 위한 파일 연산 경계다. */
export interface WorkspaceStorageFileHandle {
  writeFile(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
  stat(): Promise<{ dev: number; ino: number }>;
}

/** 대상 항목의 종류·식별자·권한을 확인하는 데 필요한 lstat 결과다. */
export interface WorkspaceStorageStats {
  dev: number;
  ino: number;
  mode: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** 실제 파일 연산을 기본으로 하고 실패 지점만 선택적으로 대체한다. */
export interface WorkspaceStorageOperations {
  open: (
    target: string,
    flags: string,
    mode: number,
  ) => Promise<WorkspaceStorageFileHandle>;
  readFile: (target: string) => Promise<Uint8Array>;
  rename: (source: string, target: string) => Promise<void>;
  link: (source: string, target: string) => Promise<void>;
  unlink: (target: string) => Promise<void>;
  /** 여러 파일 반영이 폴더를 만들 때만 쓴다. 부모는 이미 있어야 한다. */
  mkdir: (target: string) => Promise<void>;
  /** 여러 파일 반영이 비게 된 폴더를 지울 때만 쓴다. */
  rmdir: (target: string) => Promise<void>;
  /** 여러 파일 반영이 폴더가 비었는지 확인할 때만 쓴다. */
  readdir: (target: string) => Promise<string[]>;
  /** 여러 파일 반영이 파일 동일성·권한을 확인할 때만 쓴다. */
  lstat: (target: string) => Promise<WorkspaceStorageStats>;
}

/** 실제 경합 순서를 제어하는 선택적 검사 지점이다. */
export interface WorkspaceStorageOptions {
  operations?: Partial<WorkspaceStorageOperations>;
  beforeApply?: () => Promise<void>;
  /**
   * 섹션 삭제 보호에 쓰는 코드 저장 원문 증거의 수집을 대체한다. 기본값은 디스크를 새로 읽는 수집이다.
   * IDE 편집 buffer나 색인의 보유 관측은 저장 보호의 근거가 될 수 없다.
   */
  collectCodeEvidence?: (projectRoot: string) => Promise<WorkspaceCodeEvidence>;
}

/** 저장 결과는 디스크 반영 여부와 변경 여부를 따로 전달한다. */
export type WorkspaceStorageResult =
  | {
      success: true;
      saved: boolean;
      changed: boolean;
      id: string;
      source: { path: string };
      revision: string;
      warnings: readonly Diagnostic<string>[];
      diagnostics: readonly Diagnostic<string>[];
    }
  | {
      success: false;
      saved: false;
      changed: false;
      diagnostics: readonly Diagnostic<string>[];
    };

const fileOperations: WorkspaceStorageOperations = {
  open,
  readFile,
  rename,
  link,
  unlink,
  /** 상위 폴더가 있는 경우의 폴더 하나만 만든다. */
  mkdir: async (target) => {
    await mkdir(target);
  },
  rmdir,
  /** 폴더 항목 이름만 읽는다. */
  readdir: async (target) => readdir(target),
  lstat,
};

// Windows의 일시적인 교체 공유 위반만 짧고 유한하게 기다린다.
const windowsRenameRetryDelays = [20, 50, 100] as const;

/** 반영 전의 확인 실패를 실제 IO 예외와 구분한다. */
class StorageRejection extends Error {
  /** 확인 실패의 원래 진단을 보존한다. */
  constructor(readonly diagnostics: readonly Diagnostic<string>[]) {
    super('Workspace storage pre-apply rejection');
  }
}

/** 확인한 실패 원인과 후속 조치를 공통 진단 형식으로 보존한다. */
function storageDiagnostic(
  code: (typeof storageDiagnosticCodes)[keyof typeof storageDiagnosticCodes],
  message: string,
  sourcePath: string,
  suggestion: string,
  error?: unknown,
): Diagnostic<string> & { ioCode?: string } {
  const ioCode = getIoErrorCode(error);
  return {
    code,
    severity: diagnosticSeverities.error,
    message,
    path: sourcePath,
    suggestion,
    ...(ioCode === undefined ? {} : { ioCode }),
  };
}

/** 저장 전 실패에서 원인을 유지하고 현재 파일을 변경하지 않았음을 알린다. */
function failure(
  ...diagnostics: readonly Diagnostic<string>[]
): WorkspaceStorageResult {
  return { success: false, saved: false, changed: false, diagnostics };
}

/**
 * 저장 대상의 실제 상태를 재확인하고 update의 디스크 바이트를 기준 버전과 비교한다.
 */
async function inspectTarget(
  root: ProjectRoot,
  sourcePath: string,
  logicalPath: string,
  baseRevision: string | undefined,
  operations: WorkspaceStorageOperations,
): Promise<readonly Diagnostic<string>[]> {
  const checked = await resolveWorkspacePath(root, logicalPath);
  if (!checked.success) {
    if (
      baseRevision === undefined &&
      checked.status === workspacePathFailureStatuses.missing
    )
      return [];
    if (
      baseRevision !== undefined &&
      checked.status === workspacePathFailureStatuses.missing
    )
      return [
        storageDiagnostic(
          storageDiagnosticCodes.revisionConflict,
          storageDiagnosticMessages.revisionConflict,
          sourcePath,
          '최신 문서를 다시 읽고 변경을 검토하세요.',
        ),
      ];
    return checked.diagnostics;
  }
  if (baseRevision === undefined)
    return [
      storageDiagnostic(
        storageDiagnosticCodes.fileExists,
        storageDiagnosticMessages.fileExists,
        sourcePath,
        '다른 경로를 선택하거나 현재 파일을 확인하세요.',
      ),
    ];
  if (checked.kind !== workspaceTargetKinds.file)
    return [
      storageDiagnostic(
        storageDiagnosticCodes.fileAccessFailed,
        storageDiagnosticMessages.fileAccessFailed,
        sourcePath,
        '대상 파일의 종류와 경로를 확인하세요.',
      ),
    ];
  try {
    const bytes = await operations.readFile(checked.logicalPath);
    if (calculateRevision(bytes) !== baseRevision)
      return [
        storageDiagnostic(
          storageDiagnosticCodes.revisionConflict,
          storageDiagnosticMessages.revisionConflict,
          sourcePath,
          '최신 문서를 다시 읽고 변경을 검토하세요.',
        ),
      ];
    return [];
  } catch (error: unknown) {
    return [
      storageDiagnostic(
        storageDiagnosticCodes.fileAccessFailed,
        storageDiagnosticMessages.fileAccessFailed,
        sourcePath,
        '파일 접근 권한과 현재 경로를 확인하세요.',
        error,
      ),
    ];
  }
}

/**
 * 호출 시점의 코드 저장 원문을 새로 수집하는 함수를 만든다.
 * 프로젝트 루트를 모르면 코드 증거를 완전하다고 말할 수 없으므로 incomplete로 돌려준다.
 */
function codeEvidenceCollector(
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

/**
 * 검증된 단일 문서 후보를 같은 폴더의 배타적 임시 파일에 기록한 뒤 실제 파일에 반영한다.
 * update는 최신 바이트·ID·경로를 확인하고 rename하며 create는 비덮어쓰기 하드링크로 등록한다.
 * 파일 반영 뒤 임시 정리 실패는 저장 성공으로 반환한다. 색인 갱신과 프로세스 간 잠금은 수행하지 않는다.
 */
export async function saveWorkspaceChange(
  input: unknown,
  scan: WorkspaceScanResult,
  options: WorkspaceStorageOptions = {},
): Promise<WorkspaceStorageResult> {
  const projectRoot =
    'root' in scan && scan.root ? scan.root.projectRoot : undefined;
  const collectEvidence =
    options.collectCodeEvidence ?? collectWorkspaceCodeEvidence;
  const collect = codeEvidenceCollector(projectRoot, collectEvidence);
  const planned = await planProtectedWorkspaceChange(input, scan, collect);
  if (planned.status === changePlanStatuses.failed)
    return failure(...planned.diagnostics);
  if (!('root' in scan) || !scan.root)
    return failure(
      storageDiagnostic(
        storageDiagnosticCodes.fileAccessFailed,
        storageDiagnosticMessages.fileAccessFailed,
        planned.path,
        '프로젝트 경로를 다시 선택하고 탐색하세요.',
      ),
    );
  const root = scan.root;
  const operations = { ...fileOperations, ...options.operations };
  const sourcePath = planned.path;
  const baseRevision =
    planned.status === changePlanStatuses.unchanged
      ? planned.revision
      : planned.baseRevision;
  if (planned.status === changePlanStatuses.unchanged) {
    const checked = await resolveWorkspacePath(root, sourcePath);
    if (!checked.success || checked.kind !== workspaceTargetKinds.file)
      return failure(
        ...(!checked.success
          ? checked.diagnostics
          : [
              storageDiagnostic(
                storageDiagnosticCodes.fileAccessFailed,
                storageDiagnosticMessages.fileAccessFailed,
                sourcePath,
                '대상 파일의 종류와 경로를 확인하세요.',
              ),
            ]),
      );
    const stale = await inspectTarget(
      root,
      sourcePath,
      checked.logicalPath,
      baseRevision,
      operations,
    );
    if (stale.length) return failure(...stale);
    return {
      success: true,
      saved: false,
      changed: false,
      id: planned.id,
      source: { path: sourcePath },
      revision: planned.revision,
      warnings: planned.diagnostics,
      diagnostics: planned.diagnostics,
    };
  }
  const parent = await ensureWorkspaceParent(
    root,
    sourcePath,
    baseRevision === undefined,
  );
  if (!parent.success) return failure(...parent.diagnostics);
  const logicalPath = parent.logicalPath;
  const initial = await inspectTarget(
    root,
    sourcePath,
    logicalPath,
    baseRevision,
    operations,
  );
  if (initial.length) return failure(...initial);
  const tempPath = path.join(
    path.dirname(logicalPath),
    `.codocs-write-${randomUUID()}.tmp`,
  );
  const bytes = Buffer.from(planned.raw, 'utf8');
  let ownedTemp = false;
  let tempIdentity: { dev: number; ino: number } | undefined;
  let applied = false;
  const failureDiagnostics: Diagnostic<string>[] = [];
  let appliedRevision = calculateRevision(bytes);
  let targetIdentity: { dev: number; ino: number } | undefined;
  try {
    let handle: WorkspaceStorageFileHandle | undefined;
    try {
      handle = await operations.open(tempPath, 'wx', 0o600);
      ownedTemp = true;
      const identity = await handle.stat();
      tempIdentity = { dev: identity.dev, ino: identity.ino };
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error: unknown) {
      failureDiagnostics.push(
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.fileWriteFailed,
          sourcePath,
          '원본은 유지되었습니다. 임시 기록 권한과 디스크 상태를 확인하세요.',
          error,
        ),
      );
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (error: unknown) {
          failureDiagnostics.push(
            storageDiagnostic(
              storageDiagnosticCodes.fileWriteFailed,
              storageDiagnosticMessages.fileWriteFailed,
              sourcePath,
              '원본은 유지되었습니다. 임시 파일 닫기 오류를 확인하세요.',
              error,
            ),
          );
        }
      }
    }
    if (failureDiagnostics.length) throw new StorageRejection([]);
    const written = await operations.readFile(tempPath);
    if (!Buffer.from(written).equals(bytes))
      throw new StorageRejection([
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.fileWriteFailed,
          sourcePath,
          '임시 파일의 기록 바이트를 확인하세요.',
        ),
      ]);
    appliedRevision = calculateRevision(written);
    if (options.beforeApply) await options.beforeApply();
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        const checkedTemp = await resolveWorkspacePath(root, tempPath);
        if (!checkedTemp.success)
          throw new StorageRejection(checkedTemp.diagnostics);
        const identity = await lstat(tempPath);
        if (
          checkedTemp.kind !== workspaceTargetKinds.file ||
          identity.dev !== tempIdentity?.dev ||
          identity.ino !== tempIdentity.ino ||
          !Buffer.from(await operations.readFile(tempPath)).equals(bytes)
        )
          throw new StorageRejection([
            storageDiagnostic(
              storageDiagnosticCodes.fileWriteFailed,
              storageDiagnosticMessages.fileWriteFailed,
              sourcePath,
              '임시 파일의 경로·식별자·기록 바이트가 변경되었습니다. 원본은 유지되었습니다.',
            ),
          ]);
      }
      const beforeScan = await inspectTarget(
        root,
        sourcePath,
        logicalPath,
        baseRevision,
        operations,
      );
      if (beforeScan.length) throw new StorageRejection(beforeScan);
      const current = await loadWorkspace({
        cwd: root.startCwd,
        project: root.projectRoot,
      });
      if (current.status !== scanStatuses.complete)
        throw new StorageRejection([
          storageDiagnostic(
            storageDiagnosticCodes.fileAccessFailed,
            storageDiagnosticMessages.fileAccessFailed,
            sourcePath,
            '전체 문서를 다시 탐색한 뒤 저장하세요.',
          ),
        ]);
      const currentTarget = await inspectTarget(
        root,
        sourcePath,
        logicalPath,
        baseRevision,
        operations,
      );
      if (currentTarget.length) throw new StorageRejection(currentTarget);
      const catalog = buildWorkspaceCatalog(current);
      if (
        [...(catalog.idPaths.get(planned.id) ?? [])].some(
          (item) => path.normalize(item) !== path.normalize(sourcePath),
        )
      )
        throw new StorageRejection([
          {
            code: catalogDiagnosticCodes.duplicateId,
            severity: diagnosticSeverities.error,
            message: catalogDiagnosticMessages.duplicateId,
            path: sourcePath,
            suggestion: '충돌한 문서 ID를 확인하고 다시 저장하세요.',
          },
        ]);
      // 최종 재탐색의 문서와 새로 읽은 코드 원문으로 후보와 참조 보호를 다시 증명한다. 재시도마다 반복한다.
      const replanned = await planProtectedWorkspaceChange(
        input,
        current,
        collect,
        catalog,
      );
      if (replanned.status === changePlanStatuses.failed)
        throw new StorageRejection(replanned.diagnostics);
      if (
        replanned.status !== changePlanStatuses.candidate ||
        replanned.raw !== planned.raw
      )
        throw new StorageRejection([
          storageDiagnostic(
            storageDiagnosticCodes.revisionConflict,
            storageDiagnosticMessages.revisionConflict,
            sourcePath,
            '최신 문서를 다시 읽고 변경을 검토하세요.',
          ),
        ]);
      const latest = await inspectTarget(
        root,
        sourcePath,
        logicalPath,
        baseRevision,
        operations,
      );
      if (latest.length) throw new StorageRejection(latest);
      if (baseRevision === undefined) {
        try {
          await operations.link(tempPath, logicalPath);
        } catch (error: unknown) {
          if (getIoErrorCode(error) === 'EEXIST')
            throw new StorageRejection([
              storageDiagnostic(
                storageDiagnosticCodes.fileExists,
                storageDiagnosticMessages.fileExists,
                sourcePath,
                '현재 파일을 확인하고 다른 경로를 선택하세요.',
                error,
              ),
            ]);
          throw error;
        }
      } else {
        const identity = await lstat(logicalPath);
        if (
          targetIdentity &&
          (identity.dev !== targetIdentity.dev ||
            identity.ino !== targetIdentity.ino)
        )
          throw new StorageRejection([
            storageDiagnostic(
              storageDiagnosticCodes.fileAccessFailed,
              storageDiagnosticMessages.fileAccessFailed,
              sourcePath,
              '재시도 전에 대상 파일이 교체되었습니다. 최신 문서를 다시 확인하세요.',
            ),
          ]);
        targetIdentity = { dev: identity.dev, ino: identity.ino };
        try {
          await operations.rename(tempPath, logicalPath);
        } catch (error: unknown) {
          const wait = windowsRenameRetryDelays[attempt];
          if (
            process.platform !== 'win32' ||
            getIoErrorCode(error) !== 'EPERM' ||
            wait === undefined
          )
            throw error;
          await delay(wait);
          continue;
        }
        ownedTemp = false;
      }
      applied = true;
      break;
    }
  } catch (error: unknown) {
    if (error instanceof StorageRejection)
      failureDiagnostics.push(...error.diagnostics);
    else
      failureDiagnostics.push(
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.fileWriteFailed,
          sourcePath,
          '원본은 유지되었습니다. 권한과 파일 시스템 오류를 확인하세요.',
          error,
        ),
      );
  } finally {
    if (ownedTemp) {
      try {
        const checkedTemp = await resolveWorkspacePath(root, tempPath);
        if (
          !checkedTemp.success ||
          checkedTemp.kind !== workspaceTargetKinds.file ||
          !tempIdentity
        )
          throw new Error('Request temporary file path cannot be verified');
        const currentIdentity = await lstat(tempPath);
        if (
          currentIdentity.dev !== tempIdentity.dev ||
          currentIdentity.ino !== tempIdentity.ino
        )
          throw new Error('Request temporary file identity changed');
        await operations.unlink(tempPath);
      } catch (error: unknown) {
        failureDiagnostics.push(
          storageDiagnostic(
            storageDiagnosticCodes.fileWriteFailed,
            applied
              ? storageDiagnosticMessages.cleanupFailed
              : storageDiagnosticMessages.fileWriteFailed,
            sourcePath,
            applied
              ? '파일은 저장되었습니다. 남은 요청 임시 파일만 별도로 정리하세요.'
              : '원래 저장 실패 원인을 확인하고 남은 요청 임시 파일을 정리하세요.',
            error,
          ),
        );
      }
    }
  }
  if (!applied) return failure(...failureDiagnostics);
  return {
    success: true,
    saved: true,
    changed: true,
    id: planned.id,
    source: { path: sourcePath },
    revision: appliedRevision,
    warnings: planned.diagnostics,
    diagnostics: [...planned.diagnostics, ...failureDiagnostics],
  };
}

/** 파일 하나를 새 바이트로 교체한 결과다. 성공해도 임시 파일 정리 실패 진단이 있을 수 있다. */
type ReplaceFileResult =
  | {
      success: true;
      revision: string;
      diagnostics: readonly Diagnostic<string>[];
    }
  | { success: false; diagnostics: readonly Diagnostic<string>[] };

/**
 * 코드 파일을 .codocs 경계가 아닌 수집 경계로 확인하며 쓰기 위한 정보다.
 * 이름 변경 반영 경로만 만들며 codocs_write와 resolveWorkspacePath의 경계는 바꾸지 않는다.
 */
interface CodeWriteBoundary {
  /** 반영 시작 때 계산한 Git 추적·ignore 정책이다. */
  policy: CodeFilePolicy;
  /** 교체한 파일이 원래 권한을 유지하도록 임시 파일에 적용하는 권한 비트다. */
  mode: number;
}

/**
 * 코드 파일이 지금도 수집 경계 안의 UTF-8 일반 파일이고 바이트가 기준 revision과 같은지 확인한다.
 * 링크·특수 파일·ignore 대상·Git 확인 불가·UTF-8 손실이 있으면 쓰지 않는다.
 */
async function inspectCodeTarget(
  policy: CodeFilePolicy,
  sourcePath: string,
  baseRevision: string,
): Promise<readonly Diagnostic<string>[]> {
  const observed = await readEligibleCodeFile(policy, sourcePath);
  if (!observed || !('text' in observed))
    return [
      storageDiagnostic(
        storageDiagnosticCodes.fileAccessFailed,
        storageDiagnosticMessages.fileAccessFailed,
        sourcePath,
        '코드 파일이 수집 경계 안의 UTF-8 일반 파일인지(링크·ignore·바이너리 아님) 확인하세요.',
      ),
    ];
  if (observed.revision !== baseRevision)
    return [
      storageDiagnostic(
        storageDiagnosticCodes.revisionConflict,
        storageDiagnosticMessages.revisionConflict,
        sourcePath,
        '최신 문서를 다시 읽고 변경을 검토하세요.',
      ),
    ];
  return [];
}

/**
 * 같은 폴더의 배타적 임시 파일에 기록한 뒤 기준 revision을 다시 확인하고 기존 파일을 교체한다.
 * 기준 revision이 다르면 다른 쓰기를 덮지 않고 거절한다. Windows의 일시적인 교체 공유 위반만 유한하게 재시도한다.
 * code를 주면 대상 확인을 .codocs 경계 대신 코드 수집 경계로 하고 교체 전에 원래 권한을 임시 파일에 적용한다.
 */
async function replaceWorkspaceFile(
  root: ProjectRoot,
  sourcePath: string,
  logicalPath: string,
  baseRevision: string,
  bytes: Buffer,
  operations: WorkspaceStorageOperations,
  options: WorkspaceStorageOptions,
  code?: CodeWriteBoundary,
): Promise<ReplaceFileResult> {
  const tempPath = path.join(
    path.dirname(logicalPath),
    `.codocs-write-${randomUUID()}.tmp`,
  );
  let ownedTemp = false;
  let tempIdentity: { dev: number; ino: number } | undefined;
  let targetIdentity: { dev: number; ino: number } | undefined;
  let applied = false;
  const diagnostics: Diagnostic<string>[] = [];
  try {
    let handle: WorkspaceStorageFileHandle | undefined;
    try {
      handle = await operations.open(tempPath, 'wx', 0o600);
      ownedTemp = true;
      const identity = await handle.stat();
      tempIdentity = { dev: identity.dev, ino: identity.ino };
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      if (handle) await handle.close();
    }
    if (!Buffer.from(await operations.readFile(tempPath)).equals(bytes))
      throw new StorageRejection([
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.fileWriteFailed,
          sourcePath,
          '임시 파일의 기록 바이트를 확인하세요. 원본은 유지되었습니다.',
        ),
      ]);
    if (code) await chmod(tempPath, code.mode);
    if (options.beforeApply) await options.beforeApply();
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        const identity = await lstat(tempPath);
        if (
          identity.dev !== tempIdentity?.dev ||
          identity.ino !== tempIdentity.ino ||
          !Buffer.from(await operations.readFile(tempPath)).equals(bytes)
        )
          throw new StorageRejection([
            storageDiagnostic(
              storageDiagnosticCodes.fileWriteFailed,
              storageDiagnosticMessages.fileWriteFailed,
              sourcePath,
              '임시 파일이 변경되었습니다. 원본은 유지되었습니다.',
            ),
          ]);
      }
      const stale = code
        ? await inspectCodeTarget(code.policy, sourcePath, baseRevision)
        : await inspectTarget(
            root,
            sourcePath,
            logicalPath,
            baseRevision,
            operations,
          );
      if (stale.length) throw new StorageRejection(stale);
      const identity = await lstat(logicalPath);
      if (
        targetIdentity &&
        (identity.dev !== targetIdentity.dev ||
          identity.ino !== targetIdentity.ino)
      )
        throw new StorageRejection([
          storageDiagnostic(
            storageDiagnosticCodes.fileAccessFailed,
            storageDiagnosticMessages.fileAccessFailed,
            sourcePath,
            '재시도 전에 대상 파일이 교체되었습니다. 최신 문서를 다시 확인하세요.',
          ),
        ]);
      targetIdentity = { dev: identity.dev, ino: identity.ino };
      try {
        await operations.rename(tempPath, logicalPath);
      } catch (error: unknown) {
        const wait = windowsRenameRetryDelays[attempt];
        if (
          process.platform !== 'win32' ||
          getIoErrorCode(error) !== 'EPERM' ||
          wait === undefined
        )
          throw error;
        await delay(wait);
        continue;
      }
      ownedTemp = false;
      applied = true;
      break;
    }
  } catch (error: unknown) {
    if (error instanceof StorageRejection)
      diagnostics.push(...error.diagnostics);
    else
      diagnostics.push(
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.fileWriteFailed,
          sourcePath,
          '원본은 유지되었습니다. 권한과 파일 시스템 오류를 확인하세요.',
          error,
        ),
      );
  } finally {
    if (ownedTemp) {
      try {
        const identity = await lstat(tempPath);
        if (
          !tempIdentity ||
          identity.dev !== tempIdentity.dev ||
          identity.ino !== tempIdentity.ino
        )
          throw new Error('Request temporary file identity changed');
        await operations.unlink(tempPath);
      } catch (error: unknown) {
        diagnostics.push(
          storageDiagnostic(
            storageDiagnosticCodes.fileWriteFailed,
            storageDiagnosticMessages.cleanupFailed,
            sourcePath,
            '남은 요청 임시 파일만 별도로 정리하세요.',
            error,
          ),
        );
      }
    }
  }
  return applied
    ? { success: true, revision: calculateRevision(bytes), diagnostics }
    : { success: false, diagnostics };
}

/** 쓰기 전에 확인한 대상 파일의 위치와 현재 바이트다. */
interface RenameTarget {
  path: string;
  logicalPath: string;
  original: Buffer;
  raw: string;
  /** 코드 파일이면 수집 경계 기준의 쓰기 정보다. .codocs 문서에는 없다. */
  code?: CodeWriteBoundary;
}

/**
 * 반영 시작 전에 대상 파일이 있고 미리보기 revision과 같으며 UTF-8 손실 없이 쓸 수 있는지 확인한다.
 * 임시 파일을 같은 폴더에 만들었다 지워 폴더 권한까지 확인한다. 실패하면 이 파일의 모든 원인을 반환한다.
 */
async function checkRenameTarget(
  root: ProjectRoot,
  edit: WorkspaceRenameEdit,
  operations: WorkspaceStorageOperations,
): Promise<
  | { success: true; target: RenameTarget }
  | { success: false; diagnostics: readonly Diagnostic<string>[] }
> {
  const checked = await resolveWorkspacePath(root, edit.path);
  if (!checked.success)
    return { success: false, diagnostics: checked.diagnostics };
  if (checked.kind !== workspaceTargetKinds.file)
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.fileAccessFailed,
          storageDiagnosticMessages.fileAccessFailed,
          edit.path,
          '대상 파일의 종류와 경로를 확인하세요.',
        ),
      ],
    };
  return checkReadWriteTarget(edit, checked.logicalPath, operations);
}

/**
 * 코드 파일을 .codocs 경계가 아닌 수집 경계(Git 추적·ignore·링크 금지·UTF-8 무손실) 기준으로 확인한다.
 * 이 함수는 이름 변경 반영 경로에서만 호출한다. 통과하면 원래 권한을 보존할 정보와 함께 대상 파일을 돌려준다.
 */
async function checkCodeRenameTarget(
  root: ProjectRoot,
  policy: CodeFilePolicy,
  edit: WorkspaceRenameEdit,
  operations: WorkspaceStorageOperations,
): Promise<
  | { success: true; target: RenameTarget }
  | { success: false; diagnostics: readonly Diagnostic<string>[] }
> {
  const logicalPath = path.join(root.projectRoot, ...edit.path.split('/'));
  const eligible = await inspectCodeTarget(policy, edit.path, edit.revision);
  if (eligible.length) return { success: false, diagnostics: eligible };
  let mode: number;
  try {
    mode = (await lstat(logicalPath)).mode & 0o777;
  } catch (error: unknown) {
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.fileAccessFailed,
          storageDiagnosticMessages.fileAccessFailed,
          edit.path,
          '파일 접근 권한과 현재 경로를 확인하세요.',
          error,
        ),
      ],
    };
  }
  const checked = await checkReadWriteTarget(edit, logicalPath, operations);
  return checked.success
    ? {
        success: true,
        target: { ...checked.target, code: { policy, mode } },
      }
    : checked;
}

/**
 * 대상 파일의 현재 바이트가 미리보기 revision과 같고 UTF-8 손실 없이 새 원문을 쓸 수 있는지 확인한다.
 * 쓰기 권한과 같은 폴더의 임시 파일 생성도 확인하며 실패하면 이 파일의 모든 원인을 반환한다.
 */
async function checkReadWriteTarget(
  edit: WorkspaceRenameEdit,
  logicalPath: string,
  operations: WorkspaceStorageOperations,
): Promise<
  | { success: true; target: RenameTarget }
  | { success: false; diagnostics: readonly Diagnostic<string>[] }
> {
  let original: Buffer;
  try {
    original = Buffer.from(await operations.readFile(logicalPath));
  } catch (error: unknown) {
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.fileAccessFailed,
          storageDiagnosticMessages.fileAccessFailed,
          edit.path,
          '파일 접근 권한과 현재 경로를 확인하세요.',
          error,
        ),
      ],
    };
  }
  if (calculateRevision(original) !== edit.revision)
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.revisionConflict,
          storageDiagnosticMessages.revisionConflict,
          edit.path,
          '미리보기를 다시 요청하세요.',
        ),
      ],
    };
  const diagnostics: Diagnostic<string>[] = [];
  if (!Buffer.from(original.toString('utf8'), 'utf8').equals(original))
    diagnostics.push({
      code: changePlanDiagnosticCodes.sourceNotLossless,
      severity: diagnosticSeverities.error,
      message: changePlanDiagnosticMessages.sourceNotLossless,
      path: edit.path,
    });
  try {
    await access(logicalPath, constants.W_OK);
  } catch (error: unknown) {
    diagnostics.push(
      storageDiagnostic(
        storageDiagnosticCodes.fileWriteFailed,
        storageDiagnosticMessages.fileWriteFailed,
        edit.path,
        '파일에 쓸 권한이 없습니다. 읽기 전용 속성과 권한을 확인하세요.',
        error,
      ),
    );
  }
  const tempPath = path.join(
    path.dirname(logicalPath),
    `.codocs-write-${randomUUID()}.tmp`,
  );
  let created = false;
  try {
    const handle = await operations.open(tempPath, 'wx', 0o600);
    created = true;
    await handle.close();
  } catch (error: unknown) {
    diagnostics.push(
      storageDiagnostic(
        storageDiagnosticCodes.fileWriteFailed,
        storageDiagnosticMessages.fileWriteFailed,
        edit.path,
        '같은 폴더에 임시 파일을 만들 수 없습니다. 폴더 권한과 디스크 상태를 확인하세요.',
        error,
      ),
    );
  }
  if (created)
    try {
      await operations.unlink(tempPath);
    } catch (error: unknown) {
      diagnostics.push(
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.cleanupFailed,
          edit.path,
          '남은 확인용 임시 파일을 별도로 정리하세요.',
          error,
        ),
      );
    }
  return diagnostics.length
    ? { success: false, diagnostics }
    : {
        success: true,
        target: { path: edit.path, logicalPath, original, raw: edit.raw },
      };
}

/** 반영 거절·실패를 파일 변경 없음 상태로 만든다. */
function renameFailure(
  diagnostics: readonly Diagnostic<string>[],
  preview?: WorkspaceRenamePreview,
): WorkspaceRenameApplyFailure {
  return {
    success: false,
    saved: false,
    changed: false,
    files: [],
    diagnostics,
    ...(preview ? { preview } : {}),
  };
}

/**
 * 이름 변경을 미리보기와 같은 입력으로 다시 계산해 영향 파일 전체에 반영한다.
 * 파일별 revision이 다르거나 영향 파일 집합이 받은 집합을 벗어나면 저장 전에 거절하고,
 * 쓰기 전에 모든 대상 파일을 확인해 하나라도 쓸 수 없으면 아무 파일도 바꾸지 않는다.
 * 파일은 하나씩 임시 파일에 기록해 교체하며 중간 실패 시 이미 바꾼 파일을 원본 바이트로 되돌려 보고 파일별 상태를 보고한다.
 * 코드 파일(code)은 .codocs 경계와 별도로 수집 경계(Git 추적·ignore·링크 금지·UTF-8 무손실)로 확인하고 같은 규칙으로 쓰고 되돌린다.
 * 여러 파일을 한 번에 바꾸는 원자성은 보장하지 않으며 색인 갱신과 프로세스 간 잠금은 수행하지 않는다.
 * @param input 대상 경로·새 이름·선택과 미리보기가 돌려준 파일별 revision이다.
 * @param scan 같은 색인을 만든 스캔이다.
 * @param catalog 스캔에서 만든 색인이다.
 * @param options 파일 연산과 경합 검사 지점이다.
 * @param code 코드 수집의 저장 관측이다. 없으면 코드 파일은 다루지 않는다.
 */
export async function applyWorkspaceRename(
  input: unknown,
  scan: WorkspaceScanResult,
  catalog: Catalog,
  options: WorkspaceStorageOptions = {},
  code?: WorkspaceCodeRenameSources,
): Promise<WorkspaceRenameApplyResult> {
  const request = parseRenameRequest(input);
  const received = parseRenameRevisions(input);
  if (!request || !received)
    return renameFailure([
      {
        code: queryDiagnosticCodes.invalidInput,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.invalidInput,
      },
    ]);
  const { preview, edits } = prepareWorkspaceRename(
    request,
    scan,
    catalog,
    code,
  );
  if (preview.status === renamePlanStatuses.blocked)
    return renameFailure(
      [
        {
          code: renameDiagnosticCodes.blocked,
          severity: diagnosticSeverities.error,
          message: renameDiagnosticMessages.blocked,
          path: preview.targetPath,
          ...(preview.blockingReason === undefined
            ? {}
            : { suggestion: preview.blockingReason }),
        },
      ],
      preview,
    );
  const current = new Map([
    ...scan.documents.map((document): [string, string] => [
      document.source.path,
      document.revision,
    ]),
    ...(code?.files ?? []).map((file): [string, string] => [
      file.path,
      file.revision,
    ]),
  ]);
  const stale = Object.entries(received).filter(
    ([sourcePath, revision]) => current.get(sourcePath) !== revision,
  );
  if (stale.length) {
    const conflicts: Diagnostic<string>[] = [];
    for (const [sourcePath] of stale)
      conflicts.push(
        storageDiagnostic(
          storageDiagnosticCodes.revisionConflict,
          storageDiagnosticMessages.revisionConflict,
          sourcePath,
          '미리보기를 다시 요청하고 변경을 검토하세요.',
        ),
      );
    return renameFailure(conflicts);
  }
  const unexpected = Object.keys(preview.revisions).filter(
    (sourcePath) => !Object.hasOwn(received, sourcePath),
  );
  if (unexpected.length) {
    const changedSet: Diagnostic<string>[] = [];
    for (const sourcePath of unexpected)
      changedSet.push({
        code: renameDiagnosticCodes.affectedFilesChanged,
        severity: diagnosticSeverities.error,
        message: renameDiagnosticMessages.affectedFilesChanged,
        path: sourcePath,
        suggestion: '미리보기를 다시 요청하세요.',
      });
    return renameFailure(changedSet);
  }
  if (!edits.length)
    return {
      success: true,
      status: preview.status,
      saved: false,
      changed: false,
      files: [],
      impacts: preview.impacts,
      diagnostics: [],
    };
  if (!('root' in scan) || !scan.root)
    return renameFailure([
      storageDiagnostic(
        storageDiagnosticCodes.fileAccessFailed,
        storageDiagnosticMessages.fileAccessFailed,
        preview.targetPath,
        '프로젝트 경로를 다시 선택하고 탐색하세요.',
      ),
    ]);
  const root = scan.root;
  const operations = { ...fileOperations, ...options.operations };
  const targets: RenameTarget[] = [];
  const checkFailures: Diagnostic<string>[] = [];
  let policy: CodeFilePolicy | undefined;
  for (const edit of edits) {
    if (edit.fileKind === workspaceRenameFileKinds.code) {
      // 코드 정책은 코드 파일을 고칠 때만 한 번 계산하고 쓰기 직전 확인에 그대로 쓴다.
      policy ??= (await computeCodeFilePolicy(root.projectRoot)).policy;
    }
    const checked =
      edit.fileKind === workspaceRenameFileKinds.code && policy
        ? await checkCodeRenameTarget(root, policy, edit, operations)
        : await checkRenameTarget(root, edit, operations);
    if (checked.success) targets.push(checked.target);
    else checkFailures.push(...checked.diagnostics);
  }
  if (checkFailures.length) return renameFailure(checkFailures);
  const written = new Map<string, string>();
  const restored = new Map<string, string>();
  const restoreFailures = new Set<string>();
  const diagnostics: Diagnostic<string>[] = [];
  let failed = false;
  for (const target of targets) {
    const result = await replaceWorkspaceFile(
      root,
      target.path,
      target.logicalPath,
      calculateRevision(target.original),
      Buffer.from(target.raw, 'utf8'),
      operations,
      options,
      target.code,
    );
    diagnostics.push(...result.diagnostics);
    if (!result.success) {
      failed = true;
      break;
    }
    written.set(target.path, result.revision);
  }
  if (failed) {
    for (const target of [...targets].reverse()) {
      const newRevision = written.get(target.path);
      if (newRevision === undefined) continue;
      const result = await replaceWorkspaceFile(
        root,
        target.path,
        target.logicalPath,
        newRevision,
        target.original,
        operations,
        {},
        target.code,
      );
      if (result.success) restored.set(target.path, result.revision);
      else {
        restoreFailures.add(target.path);
        diagnostics.push(
          {
            code: renameDiagnosticCodes.restoreFailed,
            severity: diagnosticSeverities.error,
            message: renameDiagnosticMessages.restoreFailed,
            path: target.path,
            suggestion:
              '이 파일에 새 이름이 남아 있을 수 있습니다. 파일을 확인하고 필요하면 직접 되돌리세요.',
          },
          ...result.diagnostics,
        );
      }
    }
  }
  /** 대상 파일 하나의 최종 상태를 기록한 결과로 만든다. */
  const fileResult = (target: RenameTarget): WorkspaceRenameFileResult => {
    const kind = target.code ? { fileKind: workspaceRenameFileKinds.code } : {};
    const newRevision = written.get(target.path);
    if (newRevision === undefined)
      return {
        path: target.path,
        state: workspaceFileStates.unchanged,
        revision: calculateRevision(target.original),
        ...kind,
      };
    if (restoreFailures.has(target.path))
      return {
        path: target.path,
        state: workspaceFileStates.restoreFailed,
        revision: newRevision,
        ...kind,
      };
    const restoredRevision = restored.get(target.path);
    if (restoredRevision !== undefined)
      return {
        path: target.path,
        state: workspaceFileStates.restored,
        revision: restoredRevision,
        ...kind,
      };
    return {
      path: target.path,
      state: workspaceFileStates.changed,
      revision: newRevision,
      ...kind,
    };
  };
  const files = targets.map(fileResult);
  const remaining = files.some(
    (file) =>
      file.state === workspaceFileStates.changed ||
      file.state === workspaceFileStates.restoreFailed,
  );
  if (failed)
    return {
      success: false,
      saved: remaining,
      changed: remaining,
      files,
      diagnostics,
    };
  return {
    success: true,
    status: preview.status,
    saved: true,
    changed: true,
    files,
    impacts: preview.impacts,
    diagnostics,
  };
}

/** 여러 파일 반영 엔진이 받는 파일 연산 하나다. 경로는 프로젝트 기준 `.codocs/...` 상대 경로다. */
export type WorkspaceFileOperation =
  | {
      kind: typeof workspaceFileOperationKinds.create;
      path: string;
      raw: string;
    }
  | {
      kind: typeof workspaceFileOperationKinds.replace;
      path: string;
      baseRevision: string;
      raw: string;
    }
  | {
      kind: typeof workspaceFileOperationKinds.delete;
      path: string;
      baseRevision: string;
    }
  | {
      kind: typeof workspaceFileOperationKinds.move;
      path: string;
      baseRevision: string;
      toPath: string;
    };

/** 여러 파일 반영의 선택적 검사 지점이다. 파일 연산 대체와 파일별 경합 지점은 기존 저장 옵션과 같다. */
export interface WorkspaceFileBatchOptions extends WorkspaceStorageOptions {
  /**
   * 사전 검사를 통과한 뒤 첫 변경 전에 한 번 부른다. 진단을 돌려주면 아무것도 바꾸지 않고 그 진단으로 실패한다.
   * 호출자가 전체 재스캔·재계획 같은 반영 직전 재확인을 한 번만 수행하는 지점이다.
   */
  beforeBatchApply?: () => Promise<readonly Diagnostic<string>[] | void>;
}

/** 연산 하나의 반영 결과다. 입력 순서대로 돌려준다. */
export interface WorkspaceFileOperationResult {
  index: number;
  kind: WorkspaceFileOperationKind;
  path: string;
  /** move의 새 경로다. */
  toPath?: string;
  state: WorkspaceFileState;
  /** 이 요청이 끝난 뒤 디스크에 남은 내용의 revision이다. 파일이 없으면 생략한다. */
  revision?: string;
}

/** 이번 요청이 지운 폴더 하나의 반영 결과다. changed는 지운 채 남은 것이다. */
export interface WorkspaceFolderResult {
  path: string;
  state: WorkspaceFileState;
}

/** 여러 파일 반영의 결과다. saved·changed는 실패 뒤에도 이번 요청의 변경이 남았는지를 뜻한다. */
export interface WorkspaceFileBatchResult {
  success: boolean;
  saved: boolean;
  changed: boolean;
  operations: readonly WorkspaceFileOperationResult[];
  folders: readonly WorkspaceFolderResult[];
  diagnostics: readonly Diagnostic<string>[];
}

/** 사전 검사 결과다. 실패하면 모든 연산의 모든 원인을 담는다. */
export type WorkspaceFileBatchCheck =
  | { success: true }
  | { success: false; diagnostics: readonly Diagnostic<string>[] };

/** 파일의 같은 항목임을 가리는 식별자다. */
interface FileIdentity {
  dev: number;
  ino: number;
}

/** 사전 검사를 통과한 연산과 반영 때 다시 쓰는 원본 정보다. */
interface PreparedOperation {
  operation: WorkspaceFileOperation;
  index: number;
  logicalPath: string;
  /** 기존 파일이 대상일 때의 원래 바이트다. create에는 없다. */
  original?: Buffer;
  identity?: FileIdentity;
  mode?: number;
  /** create·move의 새 파일 위치다. */
  destinationPath?: string;
  destinationLogicalPath?: string;
}

/** 연산 하나를 반영한 뒤 되돌릴 수 있는 기록이다. */
interface AppliedOperation {
  /** 반영 직후 디스크에 있는 내용의 revision이다. delete는 없다. */
  revision: string | undefined;
  /** 이번 요청이 만든 상태가 그대로일 때만 되돌리고 실패 원인 진단을 돌려준다. 비어 있으면 성공이다. */
  undo: () => Promise<readonly Diagnostic<string>[]>;
}

/** 연산 하나의 반영 결과다. 실패해도 이 연산이 만든 흔적은 스스로 정리하고, 못 하면 stuck으로 알린다. */
type StepResult =
  | {
      success: true;
      applied: AppliedOperation;
      diagnostics: Diagnostic<string>[];
    }
  | {
      success: false;
      diagnostics: Diagnostic<string>[];
      /** 정리하지 못한 흔적이 남았다. 이 연산은 restore_failed로 보고한다. */
      stuck?: { revision: string | undefined };
    };

/** 반영·복구 중 쓰는 공통 실행 맥락이다. */
interface BatchContext {
  root: ProjectRoot;
  operations: WorkspaceStorageOperations;
  options: WorkspaceStorageOptions;
}

/** 일시적인 Windows 공유 위반만 짧고 유한하게 재시도한다. */
async function withWindowsRetry<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error: unknown) {
      const wait = windowsRenameRetryDelays[attempt];
      const code = getIoErrorCode(error);
      if (
        process.platform !== 'win32' ||
        (code !== 'EPERM' && code !== 'EBUSY') ||
        wait === undefined
      )
        throw error;
      await delay(wait);
    }
  }
}

/** 같은 폴더에 임시 파일을 만들었다 지워 폴더 권한과 임시 파일 생성 가능 여부를 확인한다. */
async function probeTempWrite(
  directory: string,
  sourcePath: string,
  operations: WorkspaceStorageOperations,
): Promise<Diagnostic<string>[]> {
  const diagnostics: Diagnostic<string>[] = [];
  const tempPath = path.join(directory, `.codocs-write-${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await operations.open(tempPath, 'wx', 0o600);
    created = true;
    await handle.close();
  } catch (error: unknown) {
    diagnostics.push(
      storageDiagnostic(
        storageDiagnosticCodes.fileWriteFailed,
        storageDiagnosticMessages.fileWriteFailed,
        sourcePath,
        '같은 폴더에 임시 파일을 만들 수 없습니다. 폴더 권한과 디스크 상태를 확인하세요.',
        error,
      ),
    );
  }
  if (created)
    try {
      await operations.unlink(tempPath);
    } catch (error: unknown) {
      diagnostics.push(
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.cleanupFailed,
          sourcePath,
          '남은 확인용 임시 파일을 별도로 정리하세요.',
          error,
        ),
      );
    }
  return diagnostics;
}

/** 이 요청의 복구 실패를 알리는 진단과 그 원인 진단을 만든다. */
function restoreFailedDiagnostics(
  sourcePath: string,
  causes: readonly Diagnostic<string>[],
): Diagnostic<string>[] {
  return [
    {
      code: storageDiagnosticCodes.writeRestoreFailed,
      severity: diagnosticSeverities.error,
      message: storageDiagnosticMessages.writeRestoreFailed,
      path: sourcePath,
      suggestion:
        '이 경로에 이번 요청의 변경이 남아 있을 수 있습니다. 파일을 확인하고 필요하면 직접 되돌리세요.',
    },
    ...causes,
  ];
}

/** 되돌릴 수 없는 이유를 원인 진단 하나로 만든다. */
function restoreCause(
  sourcePath: string,
  suggestion: string,
  error?: unknown,
): Diagnostic<string> {
  return storageDiagnostic(
    storageDiagnosticCodes.fileWriteFailed,
    storageDiagnosticMessages.fileWriteFailed,
    sourcePath,
    suggestion,
    error,
  );
}

/** 경로가 지금도 같은 일반 파일이고(선택적으로 바이트도 같은지) 확인한다. */
async function sameFile(
  operations: WorkspaceStorageOperations,
  logicalPath: string,
  identity: FileIdentity,
  bytes?: Buffer,
): Promise<boolean> {
  try {
    const current = await operations.lstat(logicalPath);
    if (
      !current.isFile() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    )
      return false;
    return bytes === undefined
      ? true
      : Buffer.from(await operations.readFile(logicalPath)).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * 같은 폴더의 배타적 임시 파일에 바이트를 쓰고 읽어 확인한다. 실패하면 만든 임시 파일을 정리하고 예외를 던진다.
 * 성공하면 호출자가 임시 파일을 link한 뒤 removeOwnedTemp로 정리한다.
 */
async function writeOwnedTemp(
  operations: WorkspaceStorageOperations,
  directory: string,
  bytes: Buffer,
): Promise<{ tempPath: string; identity: FileIdentity }> {
  const tempPath = path.join(directory, `.codocs-write-${randomUUID()}.tmp`);
  let identity: FileIdentity | undefined;
  let handle: WorkspaceStorageFileHandle | undefined;
  try {
    try {
      handle = await operations.open(tempPath, 'wx', 0o600);
      const stat = await handle.stat();
      identity = { dev: stat.dev, ino: stat.ino };
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      if (handle) await handle.close();
    }
    if (!Buffer.from(await operations.readFile(tempPath)).equals(bytes))
      throw new Error('Temporary file bytes differ from the requested bytes');
    return { tempPath, identity };
  } catch (error: unknown) {
    if (identity)
      await removeOwnedTemp(operations, tempPath, identity).catch(
        /** 원래 실패를 가리지 않는다. */ () => undefined,
      );
    throw error;
  }
}

/** 이번 요청이 만든 임시 파일이 그대로일 때만 지운다. 실패하면 원인을 예외로 던진다. */
async function removeOwnedTemp(
  operations: WorkspaceStorageOperations,
  tempPath: string,
  identity: FileIdentity,
): Promise<void> {
  const current = await operations.lstat(tempPath);
  if (current.dev !== identity.dev || current.ino !== identity.ino)
    throw new Error('Request temporary file identity changed');
  await operations.unlink(tempPath);
}

/** 이번 요청이 만든 폴더를 하위부터 지운다. 비어 있지 않거나 지우지 못하면 원인을 모아 돌려준다. */
async function removeCreatedDirectories(
  ctx: BatchContext,
  directories: readonly string[],
  sourcePath: string,
): Promise<Diagnostic<string>[]> {
  const causes: Diagnostic<string>[] = [];
  for (const directory of [...directories].reverse()) {
    try {
      await withWindowsRetry(() => ctx.operations.rmdir(directory));
    } catch (error: unknown) {
      causes.push(
        restoreCause(
          sourcePath,
          '이번 요청이 만든 폴더를 제거하지 못했습니다. 폴더를 확인하세요.',
          error,
        ),
      );
      break;
    }
  }
  return causes;
}

/**
 * 없는 폴더를 상위부터 만든다. 만든 폴더만 기록하고 이미 생긴 폴더는 건드리지 않는다.
 * 실패하면 지금까지 만든 폴더를 제거해 되돌린다.
 */
async function createMissingDirectories(
  ctx: BatchContext,
  missing: readonly string[],
  sourcePath: string,
): Promise<
  | { success: true; created: string[] }
  | { success: false; diagnostics: Diagnostic<string>[]; stuck: boolean }
> {
  const created: string[] = [];
  for (const directory of missing) {
    try {
      await ctx.operations.mkdir(directory);
      created.push(directory);
    } catch (error: unknown) {
      if (getIoErrorCode(error) === 'EEXIST') continue;
      const causes = await removeCreatedDirectories(ctx, created, sourcePath);
      return {
        success: false,
        stuck: causes.length > 0,
        diagnostics: [
          storageDiagnostic(
            storageDiagnosticCodes.fileWriteFailed,
            storageDiagnosticMessages.fileWriteFailed,
            sourcePath,
            '폴더를 만들 수 없습니다. 폴더 권한과 디스크 상태를 확인하세요.',
            error,
          ),
          ...(causes.length
            ? restoreFailedDiagnostics(sourcePath, causes)
            : []),
        ],
      };
    }
  }
  return { success: true, created };
}

/** 새 파일 위치(create·move 대상)가 비어 있고 쓸 수 있는지 확인한다. 없는 폴더 목록도 돌려준다. */
async function inspectDestination(
  root: ProjectRoot,
  destination: string,
  operations: WorkspaceStorageOperations,
): Promise<
  | { success: true; logicalPath: string; missingDirectories: string[] }
  | { success: false; diagnostics: readonly Diagnostic<string>[] }
> {
  const parent = await inspectWorkspaceParent(root, destination);
  if (!parent.success) return parent;
  const existing = await resolveWorkspacePath(root, destination);
  if (existing.success)
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.fileExists,
          storageDiagnosticMessages.fileExists,
          destination,
          '다른 경로를 선택하거나 현재 파일을 확인하세요.',
        ),
      ],
    };
  if (existing.status !== workspacePathFailureStatuses.missing) return existing;
  const probeDirectory = parent.missingDirectories.length
    ? path.dirname(parent.missingDirectories[0]!)
    : path.dirname(parent.logicalPath);
  const probe = await probeTempWrite(probeDirectory, destination, operations);
  if (probe.length) return { success: false, diagnostics: probe };
  return {
    success: true,
    logicalPath: parent.logicalPath,
    missingDirectories: parent.missingDirectories,
  };
}

/** 기존 파일 대상의 위치·revision·UTF-8 무손실·쓰기 가능 여부를 확인하고 원본 정보를 모은다. */
async function inspectExistingSource(
  root: ProjectRoot,
  operation: Exclude<
    WorkspaceFileOperation,
    { kind: typeof workspaceFileOperationKinds.create }
  >,
  operations: WorkspaceStorageOperations,
): Promise<
  | {
      success: true;
      logicalPath: string;
      original: Buffer;
      identity: FileIdentity;
      mode: number;
    }
  | { success: false; diagnostics: readonly Diagnostic<string>[] }
> {
  const staleSuggestion = '최신 문서를 다시 읽고 변경을 검토하세요.';
  const checked = await resolveWorkspacePath(root, operation.path);
  if (!checked.success) {
    if (checked.status === workspacePathFailureStatuses.missing)
      return {
        success: false,
        diagnostics: [
          storageDiagnostic(
            storageDiagnosticCodes.revisionConflict,
            storageDiagnosticMessages.revisionConflict,
            operation.path,
            staleSuggestion,
          ),
        ],
      };
    return { success: false, diagnostics: checked.diagnostics };
  }
  if (checked.kind !== workspaceTargetKinds.file)
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.fileAccessFailed,
          storageDiagnosticMessages.fileAccessFailed,
          operation.path,
          '대상 파일의 종류와 경로를 확인하세요.',
        ),
      ],
    };
  let original: Buffer;
  let stats: WorkspaceStorageStats;
  try {
    stats = await operations.lstat(checked.logicalPath);
    original = Buffer.from(await operations.readFile(checked.logicalPath));
  } catch (error: unknown) {
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.fileAccessFailed,
          storageDiagnosticMessages.fileAccessFailed,
          operation.path,
          '파일 접근 권한과 현재 경로를 확인하세요.',
          error,
        ),
      ],
    };
  }
  if (calculateRevision(original) !== operation.baseRevision)
    return {
      success: false,
      diagnostics: [
        storageDiagnostic(
          storageDiagnosticCodes.revisionConflict,
          storageDiagnosticMessages.revisionConflict,
          operation.path,
          staleSuggestion,
        ),
      ],
    };
  const diagnostics: Diagnostic<string>[] = [];
  if (!Buffer.from(original.toString('utf8'), 'utf8').equals(original))
    diagnostics.push({
      code: changePlanDiagnosticCodes.sourceNotLossless,
      severity: diagnosticSeverities.error,
      message: changePlanDiagnosticMessages.sourceNotLossless,
      path: operation.path,
    });
  if (operation.kind === workspaceFileOperationKinds.replace)
    try {
      await access(checked.logicalPath, constants.W_OK);
    } catch (error: unknown) {
      diagnostics.push(
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.fileWriteFailed,
          operation.path,
          '파일에 쓸 권한이 없습니다. 읽기 전용 속성과 권한을 확인하세요.',
          error,
        ),
      );
    }
  diagnostics.push(
    ...(await probeTempWrite(
      path.dirname(checked.logicalPath),
      operation.path,
      operations,
    )),
  );
  if (diagnostics.length) return { success: false, diagnostics };
  return {
    success: true,
    logicalPath: checked.logicalPath,
    original,
    identity: { dev: stats.dev, ino: stats.ino },
    mode: stats.mode & 0o777,
  };
}

/** 모든 연산을 반영 전에 검사하고 실패는 모두 모은다. 파일과 폴더는 바꾸지 않는다. */
async function prepareFileBatch(
  root: ProjectRoot,
  operations: readonly WorkspaceFileOperation[],
  fileOperationsInUse: WorkspaceStorageOperations,
): Promise<
  | { success: true; prepared: PreparedOperation[] }
  | { success: false; diagnostics: Diagnostic<string>[] }
> {
  const diagnostics: Diagnostic<string>[] = [];
  const prepared: PreparedOperation[] = [];
  const seen = new Set<string>();
  /** 같은 경로를 두 연산이 다루면 순서에 따라 결과가 달라지므로 거부한다. */
  const claim = (sourcePath: string): void => {
    const key = path.normalize(sourcePath);
    if (seen.has(key))
      diagnostics.push(
        storageDiagnostic(
          storageDiagnosticCodes.fileAccessFailed,
          storageDiagnosticMessages.fileAccessFailed,
          sourcePath,
          '같은 경로를 두 번 이상 다룰 수 없습니다.',
        ),
      );
    seen.add(key);
  };
  for (const [index, operation] of operations.entries()) {
    claim(operation.path);
    if (operation.kind === workspaceFileOperationKinds.move)
      claim(operation.toPath);
    if (operation.kind === workspaceFileOperationKinds.create) {
      const destination = await inspectDestination(
        root,
        operation.path,
        fileOperationsInUse,
      );
      if (destination.success)
        prepared.push({
          operation,
          index,
          logicalPath: destination.logicalPath,
          destinationPath: operation.path,
          destinationLogicalPath: destination.logicalPath,
        });
      else diagnostics.push(...destination.diagnostics);
      continue;
    }
    const source = await inspectExistingSource(
      root,
      operation,
      fileOperationsInUse,
    );
    if (!source.success) {
      diagnostics.push(...source.diagnostics);
      if (operation.kind !== workspaceFileOperationKinds.move) continue;
    }
    if (operation.kind === workspaceFileOperationKinds.move) {
      const destination = await inspectDestination(
        root,
        operation.toPath,
        fileOperationsInUse,
      );
      if (!destination.success) {
        diagnostics.push(...destination.diagnostics);
        continue;
      }
      if (source.success)
        prepared.push({
          operation,
          index,
          logicalPath: source.logicalPath,
          original: source.original,
          identity: source.identity,
          mode: source.mode,
          destinationPath: operation.toPath,
          destinationLogicalPath: destination.logicalPath,
        });
      continue;
    }
    if (source.success)
      prepared.push({
        operation,
        index,
        logicalPath: source.logicalPath,
        original: source.original,
        identity: source.identity,
        mode: source.mode,
      });
  }
  return diagnostics.length
    ? { success: false, diagnostics }
    : { success: true, prepared };
}

/**
 * 여러 파일 연산을 반영 전에 검사한다. 모든 연산 대상의 revision·접근·UTF-8 무손실·쓰기 가능 여부와
 * 새 경로의 부재를 확인하고 모든 원인을 모아 돌려준다. 파일과 폴더는 바꾸지 않는다.
 * @param root 대상 프로젝트 루트다.
 * @param operations 검사할 연산 목록이다.
 * @param options 파일 연산 대체 지점이다.
 */
export async function checkWorkspaceFileBatch(
  root: ProjectRoot,
  operations: readonly WorkspaceFileOperation[],
  options: WorkspaceFileBatchOptions = {},
): Promise<WorkspaceFileBatchCheck> {
  const checked = await prepareFileBatch(root, operations, {
    ...fileOperations,
    ...options.operations,
  });
  return checked.success
    ? { success: true }
    : { success: false, diagnostics: checked.diagnostics };
}

/** 반영 직전에 기존 파일이 사전 검사 때와 같은 파일·같은 revision인지 다시 확인한다. */
async function recheckSource(
  ctx: BatchContext,
  prepared: PreparedOperation,
): Promise<Diagnostic<string>[]> {
  const sourcePath = prepared.operation.path;
  /** 기준 revision이 달라진 경우의 충돌 진단을 만든다. */
  const stale = (suggestion: string): Diagnostic<string>[] => [
    storageDiagnostic(
      storageDiagnosticCodes.revisionConflict,
      storageDiagnosticMessages.revisionConflict,
      sourcePath,
      suggestion,
    ),
  ];
  const checked = await resolveWorkspacePath(ctx.root, sourcePath);
  if (!checked.success)
    return checked.status === workspacePathFailureStatuses.missing
      ? stale('최신 문서를 다시 읽고 변경을 검토하세요.')
      : [...checked.diagnostics];
  if (
    checked.kind !== workspaceTargetKinds.file ||
    !prepared.identity ||
    !(await sameFile(ctx.operations, checked.logicalPath, prepared.identity))
  )
    return stale('대상 파일이 바뀌었습니다. 최신 문서를 다시 확인하세요.');
  try {
    const bytes = Buffer.from(
      await ctx.operations.readFile(checked.logicalPath),
    );
    if (
      prepared.operation.kind !== workspaceFileOperationKinds.create &&
      calculateRevision(bytes) !== prepared.operation.baseRevision
    )
      return stale('최신 문서를 다시 읽고 변경을 검토하세요.');
  } catch (error: unknown) {
    return [
      storageDiagnostic(
        storageDiagnosticCodes.fileAccessFailed,
        storageDiagnosticMessages.fileAccessFailed,
        sourcePath,
        '파일 접근 권한과 현재 경로를 확인하세요.',
        error,
      ),
    ];
  }
  return [];
}

/** 연산 하나가 실패했음을 알리는 단계 결과를 만든다. 이 연산이 만든 폴더를 정리하지 못했으면 stuck으로 남긴다. */
function stepFailure(
  diagnostics: Diagnostic<string>[],
  stuckRevision?: { revision: string | undefined },
): StepResult {
  return stuckRevision
    ? { success: false, diagnostics, stuck: stuckRevision }
    : { success: false, diagnostics };
}

/** create를 반영한다. 없는 폴더를 만들고 임시 파일을 link로 등록해 기존 파일을 덮어쓰지 않는다. */
async function applyCreate(
  ctx: BatchContext,
  prepared: PreparedOperation,
  raw: string,
): Promise<StepResult> {
  const sourcePath = prepared.operation.path;
  const bytes = Buffer.from(raw, 'utf8');
  const parent = await inspectWorkspaceParent(ctx.root, sourcePath);
  if (!parent.success) return stepFailure([...parent.diagnostics]);
  const directories = await createMissingDirectories(
    ctx,
    parent.missingDirectories,
    sourcePath,
  );
  if (!directories.success)
    return stepFailure(
      directories.diagnostics,
      directories.stuck ? { revision: undefined } : undefined,
    );
  /** 이번 요청이 만든 폴더를 되돌리고 실패 원인을 돌려준다. */
  const cleanDirectories = (): Promise<Diagnostic<string>[]> =>
    removeCreatedDirectories(ctx, directories.created, sourcePath);
  let temp: { tempPath: string; identity: FileIdentity };
  try {
    temp = await writeOwnedTemp(
      ctx.operations,
      path.dirname(parent.logicalPath),
      bytes,
    );
  } catch (error: unknown) {
    const causes = await cleanDirectories();
    return stepFailure(
      [
        storageDiagnostic(
          storageDiagnosticCodes.fileWriteFailed,
          storageDiagnosticMessages.fileWriteFailed,
          sourcePath,
          '임시 기록 권한과 디스크 상태를 확인하세요.',
          error,
        ),
        ...(causes.length ? restoreFailedDiagnostics(sourcePath, causes) : []),
      ],
      causes.length ? { revision: undefined } : undefined,
    );
  }
  const diagnostics: Diagnostic<string>[] = [];
  try {
    if (ctx.options.beforeApply) await ctx.options.beforeApply();
    await ctx.operations.link(temp.tempPath, parent.logicalPath);
  } catch (error: unknown) {
    const exists = getIoErrorCode(error) === 'EEXIST';
    await removeOwnedTemp(ctx.operations, temp.tempPath, temp.identity).catch(
      /** 원래 실패가 우선이며 남은 임시 파일은 별도로 정리하도록 알린다. */
      () => {
        diagnostics.push(
          storageDiagnostic(
            storageDiagnosticCodes.fileWriteFailed,
            storageDiagnosticMessages.cleanupFailed,
            sourcePath,
            '남은 요청 임시 파일만 별도로 정리하세요.',
          ),
        );
      },
    );
    const causes = await cleanDirectories();
    return stepFailure(
      [
        exists
          ? storageDiagnostic(
              storageDiagnosticCodes.fileExists,
              storageDiagnosticMessages.fileExists,
              sourcePath,
              '현재 파일을 확인하고 다른 경로를 선택하세요.',
              error,
            )
          : storageDiagnostic(
              storageDiagnosticCodes.fileWriteFailed,
              storageDiagnosticMessages.fileWriteFailed,
              sourcePath,
              '권한과 파일 시스템 오류를 확인하세요.',
              error,
            ),
        ...diagnostics,
        ...(causes.length ? restoreFailedDiagnostics(sourcePath, causes) : []),
      ],
      causes.length ? { revision: undefined } : undefined,
    );
  }
  try {
    await removeOwnedTemp(ctx.operations, temp.tempPath, temp.identity);
  } catch (error: unknown) {
    diagnostics.push(
      storageDiagnostic(
        storageDiagnosticCodes.fileWriteFailed,
        storageDiagnosticMessages.cleanupFailed,
        sourcePath,
        '파일은 저장되었습니다. 남은 요청 임시 파일만 별도로 정리하세요.',
        error,
      ),
    );
  }
  return {
    success: true,
    diagnostics,
    applied: {
      revision: calculateRevision(bytes),
      /** 이번 요청이 쓴 파일이 그대로일 때만 지우고 만든 폴더를 제거한다. */
      undo: async () => {
        if (
          !(await sameFile(
            ctx.operations,
            parent.logicalPath,
            temp.identity,
            bytes,
          ))
        )
          return [
            restoreCause(
              sourcePath,
              '이번 요청이 만든 파일이 바뀌어 지우지 않았습니다. 파일을 확인하세요.',
            ),
          ];
        try {
          await withWindowsRetry(() =>
            ctx.operations.unlink(parent.logicalPath),
          );
        } catch (error: unknown) {
          return [
            restoreCause(
              sourcePath,
              '이번 요청이 만든 파일을 지우지 못했습니다. 파일을 확인하세요.',
              error,
            ),
          ];
        }
        return cleanDirectories();
      },
    },
  };
}

/** replace를 반영한다. 기존 교체 원시 연산을 쓰며 되돌릴 때는 쓴 파일이 그대로일 때만 원래 바이트로 교체한다. */
async function applyReplace(
  ctx: BatchContext,
  prepared: PreparedOperation,
  operation: Extract<
    WorkspaceFileOperation,
    { kind: typeof workspaceFileOperationKinds.replace }
  >,
): Promise<StepResult> {
  const bytes = Buffer.from(operation.raw, 'utf8');
  const result = await replaceWorkspaceFile(
    ctx.root,
    operation.path,
    prepared.logicalPath,
    operation.baseRevision,
    bytes,
    ctx.operations,
    ctx.options,
  );
  if (!result.success) return stepFailure([...result.diagnostics]);
  let identity: FileIdentity | undefined;
  try {
    const stats = await ctx.operations.lstat(prepared.logicalPath);
    identity = { dev: stats.dev, ino: stats.ino };
  } catch {
    identity = undefined;
  }
  return {
    success: true,
    diagnostics: [...result.diagnostics],
    applied: {
      revision: result.revision,
      /** 쓴 파일의 동일성·내용이 그대로일 때만 원래 바이트로 되돌린다. */
      undo: async () => {
        if (
          !identity ||
          !(await sameFile(
            ctx.operations,
            prepared.logicalPath,
            identity,
            bytes,
          ))
        )
          return [
            restoreCause(
              operation.path,
              '복구 전에 파일이 바뀌어 덮어쓰지 않았습니다. 파일을 확인하세요.',
            ),
          ];
        const restored = await replaceWorkspaceFile(
          ctx.root,
          operation.path,
          prepared.logicalPath,
          result.revision,
          prepared.original!,
          ctx.operations,
          {},
        );
        if (!restored.success) return [...restored.diagnostics];
        // 교체 원시 연산은 임시 파일 권한으로 쓰므로 원래 권한을 되돌린다. 권한 복원 실패는 내용 복구를 되돌리지 않는다.
        await chmod(prepared.logicalPath, prepared.mode!).catch(
          /** 내용은 이미 원래대로이므로 권한 실패만 무시한다. */ () =>
            undefined,
        );
        return [];
      },
    },
  };
}

/** delete를 반영한다. 직전에 revision·동일성을 다시 확인하고 원본 바이트·권한을 보관한 채 지운다. */
async function applyDelete(
  ctx: BatchContext,
  prepared: PreparedOperation,
): Promise<StepResult> {
  const sourcePath = prepared.operation.path;
  const stale = await recheckSource(ctx, prepared);
  if (stale.length) return stepFailure(stale);
  try {
    if (ctx.options.beforeApply) await ctx.options.beforeApply();
    await withWindowsRetry(() => ctx.operations.unlink(prepared.logicalPath));
  } catch (error: unknown) {
    return stepFailure([
      storageDiagnostic(
        storageDiagnosticCodes.fileWriteFailed,
        storageDiagnosticMessages.fileWriteFailed,
        sourcePath,
        '원본은 유지되었습니다. 권한과 파일 시스템 오류를 확인하세요.',
        error,
      ),
    ]);
  }
  return {
    success: true,
    diagnostics: [],
    applied: {
      revision: undefined,
      /** 원본 바이트·권한으로 덮어쓰지 않고 다시 만든다. */
      undo: async () => {
        let temp: { tempPath: string; identity: FileIdentity } | undefined;
        try {
          temp = await writeOwnedTemp(
            ctx.operations,
            path.dirname(prepared.logicalPath),
            prepared.original!,
          );
          await chmod(temp.tempPath, prepared.mode!);
          await ctx.operations.link(temp.tempPath, prepared.logicalPath);
          await removeOwnedTemp(ctx.operations, temp.tempPath, temp.identity);
          return [];
        } catch (error: unknown) {
          if (temp)
            await removeOwnedTemp(
              ctx.operations,
              temp.tempPath,
              temp.identity,
            ).catch(/** 복구 실패 원인이 우선이다. */ () => undefined);
          return [
            restoreCause(
              sourcePath,
              getIoErrorCode(error) === 'EEXIST'
                ? '같은 경로에 다른 파일이 생겨 지운 파일을 다시 만들지 않았습니다. 파일을 확인하세요.'
                : '지운 파일을 다시 만들지 못했습니다. 파일을 확인하세요.',
              error,
            ),
          ];
        }
      },
    },
  };
}

/** move를 반영한다. 새 경로에 link한 뒤 원래 경로를 unlink하며 기존 파일을 덮어쓰지 않는다. */
async function applyMove(
  ctx: BatchContext,
  prepared: PreparedOperation,
  operation: Extract<
    WorkspaceFileOperation,
    { kind: typeof workspaceFileOperationKinds.move }
  >,
): Promise<StepResult> {
  const sourcePath = operation.path;
  const stale = await recheckSource(ctx, prepared);
  if (stale.length) return stepFailure(stale);
  const parent = await inspectWorkspaceParent(ctx.root, operation.toPath);
  if (!parent.success) return stepFailure([...parent.diagnostics]);
  const directories = await createMissingDirectories(
    ctx,
    parent.missingDirectories,
    sourcePath,
  );
  if (!directories.success)
    return stepFailure(
      directories.diagnostics,
      directories.stuck
        ? { revision: calculateRevision(prepared.original!) }
        : undefined,
    );
  const revision = calculateRevision(prepared.original!);
  /** 이번 요청이 만든 폴더를 되돌리고 실패 원인을 돌려준다. */
  const cleanDirectories = (): Promise<Diagnostic<string>[]> =>
    removeCreatedDirectories(ctx, directories.created, sourcePath);
  /** 실패 진단 뒤에 정리 결과를 이어 붙여 단계 결과를 만든다. */
  const failedStep = async (
    first: Diagnostic<string>,
    extraCauses: readonly Diagnostic<string>[] = [],
    leftoverLink = false,
  ): Promise<StepResult> => {
    const causes = leftoverLink
      ? extraCauses
      : [...extraCauses, ...(await cleanDirectories())];
    return stepFailure(
      [
        first,
        ...(causes.length ? restoreFailedDiagnostics(sourcePath, causes) : []),
      ],
      causes.length ? { revision } : undefined,
    );
  };
  try {
    if (ctx.options.beforeApply) await ctx.options.beforeApply();
    await ctx.operations.link(prepared.logicalPath, parent.logicalPath);
  } catch (error: unknown) {
    return failedStep(
      getIoErrorCode(error) === 'EEXIST'
        ? storageDiagnostic(
            storageDiagnosticCodes.fileExists,
            storageDiagnosticMessages.fileExists,
            operation.toPath,
            '현재 파일을 확인하고 다른 경로를 선택하세요.',
            error,
          )
        : storageDiagnostic(
            storageDiagnosticCodes.fileWriteFailed,
            storageDiagnosticMessages.fileWriteFailed,
            sourcePath,
            '원본은 유지되었습니다. 권한과 파일 시스템 오류를 확인하세요.',
            error,
          ),
    );
  }
  try {
    await withWindowsRetry(() => ctx.operations.unlink(prepared.logicalPath));
  } catch (error: unknown) {
    const cause = storageDiagnostic(
      storageDiagnosticCodes.fileWriteFailed,
      storageDiagnosticMessages.fileWriteFailed,
      sourcePath,
      '원래 경로를 지우지 못했습니다. 권한과 파일 시스템 오류를 확인하세요.',
      error,
    );
    const identity = prepared.identity!;
    const linkRemoved =
      (await sameFile(ctx.operations, parent.logicalPath, identity)) &&
      (await withWindowsRetry(() =>
        ctx.operations.unlink(parent.logicalPath),
      ).then(
        /** 새 경로의 링크를 지웠다. */ () => true,
        /** 새 경로의 링크를 지우지 못했다. */ () => false,
      ));
    if (linkRemoved) return failedStep(cause);
    return failedStep(
      cause,
      [
        restoreCause(
          operation.toPath,
          '새 경로에 같은 파일이 남아 있을 수 있습니다. 파일을 확인하세요.',
        ),
      ],
      true,
    );
  }
  return {
    success: true,
    diagnostics: [],
    applied: {
      revision,
      /** 새 경로의 파일이 그대로일 때만 원래 경로에 다시 link하고 새 경로를 지운다. */
      undo: async () => {
        if (
          !(await sameFile(
            ctx.operations,
            parent.logicalPath,
            prepared.identity!,
            prepared.original,
          ))
        )
          return [
            restoreCause(
              operation.toPath,
              '복구 전에 옮긴 파일이 바뀌어 되돌리지 않았습니다. 파일을 확인하세요.',
            ),
          ];
        try {
          await ctx.operations.link(parent.logicalPath, prepared.logicalPath);
        } catch (error: unknown) {
          return [
            restoreCause(
              sourcePath,
              getIoErrorCode(error) === 'EEXIST'
                ? '원래 경로에 다른 파일이 생겨 덮어쓰지 않았습니다. 파일을 확인하세요.'
                : '옮긴 파일을 원래 경로로 되돌리지 못했습니다. 파일을 확인하세요.',
              error,
            ),
          ];
        }
        try {
          await withWindowsRetry(() =>
            ctx.operations.unlink(parent.logicalPath),
          );
        } catch (error: unknown) {
          return [
            restoreCause(
              operation.toPath,
              '새 경로의 파일을 지우지 못해 두 경로에 파일이 남았습니다. 파일을 확인하세요.',
              error,
            ),
          ];
        }
        return cleanDirectories();
      },
    },
  };
}

/** 지운 파일이 있던 폴더 가운데 `.codocs` 바로 아래까지의 하위 폴더를 깊은 순서로 모은다. */
function emptyFolderCandidates(
  operations: readonly WorkspaceFileOperation[],
): string[] {
  const folders = new Set<string>();
  for (const operation of operations) {
    if (
      operation.kind !== workspaceFileOperationKinds.delete &&
      operation.kind !== workspaceFileOperationKinds.move
    )
      continue;
    const segments = operation.path.split(/[\\/]/u).filter(Boolean);
    for (let depth = 2; depth < segments.length; depth++)
      folders.add(segments.slice(0, depth).join('/'));
  }
  return [...folders].sort(
    (left, right) => right.split('/').length - left.split('/').length,
  );
}

/**
 * delete·move로 비게 된 폴더를 하위부터 지운다. 지울 때마다 다시 비었는지 확인하고
 * `.codocs` 자체와 다른 파일이 남은 폴더는 지우지 않는다. 실패해도 지금까지 지운 폴더 목록을 돌려준다.
 */
async function removeEmptiedFolders(
  ctx: BatchContext,
  candidates: readonly string[],
): Promise<{
  removed: { path: string; logicalPath: string }[];
  failure?: Diagnostic<string>[];
}> {
  const removed: { path: string; logicalPath: string }[] = [];
  for (const folder of candidates) {
    const checked = await resolveWorkspacePath(ctx.root, folder);
    if (!checked.success) {
      if (checked.status === workspacePathFailureStatuses.missing) continue;
      return { removed, failure: [...checked.diagnostics] };
    }
    if (checked.kind !== workspaceTargetKinds.directory) continue;
    try {
      if ((await ctx.operations.readdir(checked.logicalPath)).length) continue;
      await withWindowsRetry(() => ctx.operations.rmdir(checked.logicalPath));
      removed.push({ path: folder, logicalPath: checked.logicalPath });
    } catch (error: unknown) {
      const code = getIoErrorCode(error);
      if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST')
        continue;
      return {
        removed,
        failure: [
          storageDiagnostic(
            storageDiagnosticCodes.fileWriteFailed,
            storageDiagnosticMessages.fileWriteFailed,
            folder,
            '비게 된 폴더를 제거하지 못했습니다. 폴더 권한과 파일 시스템 오류를 확인하세요.',
            error,
          ),
        ],
      };
    }
  }
  return { removed };
}

/** 연산 하나의 반영 함수를 종류에 맞게 고른다. */
function applyStep(
  ctx: BatchContext,
  prepared: PreparedOperation,
): Promise<StepResult> {
  const operation = prepared.operation;
  switch (operation.kind) {
    case workspaceFileOperationKinds.create:
      return applyCreate(ctx, prepared, operation.raw);
    case workspaceFileOperationKinds.replace:
      return applyReplace(ctx, prepared, operation);
    case workspaceFileOperationKinds.delete:
      return applyDelete(ctx, prepared);
    case workspaceFileOperationKinds.move:
      return applyMove(ctx, prepared, operation);
  }
}

/** 연산 하나의 결과 항목을 만든다. revision이 없으면 생략한다. */
function operationResult(
  operation: WorkspaceFileOperation,
  index: number,
  state: WorkspaceFileState,
  revision: string | undefined,
): WorkspaceFileOperationResult {
  return {
    index,
    kind: operation.kind,
    path: operation.path,
    ...(operation.kind === workspaceFileOperationKinds.move
      ? { toPath: operation.toPath }
      : {}),
    state,
    ...(revision === undefined ? {} : { revision }),
  };
}

/** 반영 거절·실패를 아무것도 바꾸지 않은 결과로 만든다. */
function batchFailure(
  operations: readonly WorkspaceFileOperation[],
  diagnostics: readonly Diagnostic<string>[],
): WorkspaceFileBatchResult {
  const results: WorkspaceFileOperationResult[] = [];
  for (const [index, operation] of operations.entries())
    results.push(
      operationResult(
        operation,
        index,
        workspaceFileStates.unchanged,
        operation.kind === workspaceFileOperationKinds.create ||
          operation.kind === workspaceFileOperationKinds.move
          ? undefined
          : operation.baseRevision,
      ),
    );
  return {
    success: false,
    saved: false,
    changed: false,
    operations: results,
    folders: [],
    diagnostics,
  };
}

/**
 * 파일 연산 목록을 사전 검사한 뒤 순서대로 반영하고, 첫 실패에서 멈춰 반영한 연산만 역순으로 되돌린다.
 * 사전 검사에서 하나라도 실패하면 아무것도 바꾸지 않는다. 반영 시점마다 revision·동일성을 다시 확인하며 새 잠금은 없다.
 * 마지막에 delete·move로 비게 된 폴더를 `.codocs` 바로 아래까지 하위부터 지운다(`.codocs` 자체와 원래 비어 있던 폴더는 제외).
 * 되돌리기는 이번 요청이 쓴 내용·동일성이 그대로일 때만 하고 아니면 restore_failed로 남긴다.
 * 색인 갱신과 프로세스 간 잠금은 수행하지 않으며 여러 파일의 원자성은 보장하지 않는다.
 * @param root 대상 프로젝트 루트다.
 * @param operations create·replace·delete·move 연산 목록이다. 입력 순서대로 반영한다.
 * @param options 파일 연산 대체, 파일별 경합 지점, 반영 직전 일괄 재확인 지점이다.
 */
export async function applyWorkspaceFileBatch(
  root: ProjectRoot,
  operations: readonly WorkspaceFileOperation[],
  options: WorkspaceFileBatchOptions = {},
): Promise<WorkspaceFileBatchResult> {
  const ctx: BatchContext = {
    root,
    operations: { ...fileOperations, ...options.operations },
    options,
  };
  const checked = await prepareFileBatch(root, operations, ctx.operations);
  if (!checked.success) return batchFailure(operations, checked.diagnostics);
  const recheck = (await options.beforeBatchApply?.()) ?? [];
  if (recheck.length) return batchFailure(operations, recheck);
  const diagnostics: Diagnostic<string>[] = [];
  const applied = new Map<number, AppliedOperation>();
  const restored = new Set<number>();
  const stuck = new Map<number, string | undefined>();
  let failed = false;
  for (const prepared of checked.prepared) {
    const step = await applyStep(ctx, prepared);
    diagnostics.push(...step.diagnostics);
    if (!step.success) {
      failed = true;
      if (step.stuck) stuck.set(prepared.index, step.stuck.revision);
      break;
    }
    applied.set(prepared.index, step.applied);
  }
  let folders: { path: string; logicalPath: string }[] = [];
  const folderStates = new Map<string, WorkspaceFileState>();
  if (!failed) {
    const emptied = await removeEmptiedFolders(
      ctx,
      emptyFolderCandidates(operations),
    );
    folders = emptied.removed;
    for (const folder of folders)
      folderStates.set(folder.path, workspaceFileStates.changed);
    if (emptied.failure) {
      failed = true;
      diagnostics.push(...emptied.failure);
    }
  }
  if (failed) {
    for (const folder of [...folders].reverse()) {
      try {
        await ctx.operations.mkdir(folder.logicalPath);
        folderStates.set(folder.path, workspaceFileStates.restored);
      } catch (error: unknown) {
        if (getIoErrorCode(error) === 'EEXIST') {
          folderStates.set(folder.path, workspaceFileStates.restored);
          continue;
        }
        folderStates.set(folder.path, workspaceFileStates.restoreFailed);
        diagnostics.push(
          ...restoreFailedDiagnostics(folder.path, [
            restoreCause(
              folder.path,
              '비웠던 폴더를 다시 만들지 못했습니다. 폴더를 확인하세요.',
              error,
            ),
          ]),
        );
      }
    }
    for (const prepared of [...checked.prepared].reverse()) {
      const record = applied.get(prepared.index);
      if (!record) continue;
      const causes = await record.undo();
      if (causes.length) {
        stuck.set(prepared.index, record.revision);
        diagnostics.push(
          ...restoreFailedDiagnostics(prepared.operation.path, causes),
        );
      } else restored.add(prepared.index);
    }
  }
  const results: WorkspaceFileOperationResult[] = [];
  for (const [index, operation] of operations.entries()) {
    const preparedOperation = checked.prepared.find(
      (item) => item.index === index,
    );
    const originalRevision = preparedOperation?.original
      ? calculateRevision(preparedOperation.original)
      : undefined;
    const record = applied.get(index);
    let state: WorkspaceFileState = workspaceFileStates.changed;
    let revision = record?.revision;
    if (stuck.has(index)) {
      state = workspaceFileStates.restoreFailed;
      revision = stuck.get(index);
    } else if (!record) {
      state = workspaceFileStates.unchanged;
      revision = originalRevision;
    } else if (restored.has(index)) {
      state = workspaceFileStates.restored;
      revision = originalRevision;
    }
    results.push(operationResult(operation, index, state, revision));
  }
  const folderResults = folders.map((folder): WorkspaceFolderResult => ({
    path: folder.path,
    state: folderStates.get(folder.path) ?? workspaceFileStates.changed,
  }));
  /** 되돌리지 못했거나 새 상태로 남은 항목이다. */
  const remaining = (state: WorkspaceFileState): boolean =>
    state === workspaceFileStates.changed ||
    state === workspaceFileStates.restoreFailed;
  const left =
    results.some((item) => remaining(item.state)) ||
    folderResults.some((item) => remaining(item.state));
  return {
    success: !failed,
    saved: left,
    changed: left,
    operations: results,
    folders: folderResults,
    diagnostics,
  };
}
