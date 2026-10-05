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
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { planWorkspaceChange } from '../change-plan/index.js';
import { getIoErrorCode } from '../diagnostics/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import { loadWorkspace, type WorkspaceScanResult } from '../loader/index.js';
import type { WorkspaceCodeRenameSources } from '../code-reference/index.js';
import {
  computeCodeFilePolicy,
  readEligibleCodeFile,
  type CodeFilePolicy,
} from '../paths/code-file-access.js';
import { ensureWorkspaceParent, resolveWorkspacePath } from '../paths/index.js';
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
  workspaceRenameFileStates,
  type WorkspaceRenameApplyFailure,
  type WorkspaceRenameApplyResult,
  type WorkspaceRenameEdit,
  type WorkspaceRenameFileResult,
  type WorkspaceRenamePreview,
} from '../rename/index.js';
import { calculateRevision } from '../revision/index.js';

/** 임시 파일 기록과 실제 반영의 실패 지점을 실제 파일로 검사하기 위한 파일 연산 경계다. */
export interface WorkspaceStorageFileHandle {
  writeFile(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
  stat(): Promise<{ dev: number; ino: number }>;
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
}

/** 실제 경합 순서를 제어하는 선택적 검사 지점이다. */
export interface WorkspaceStorageOptions {
  operations?: Partial<WorkspaceStorageOperations>;
  beforeApply?: () => Promise<void>;
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
 * 검증된 단일 문서 후보를 같은 폴더의 배타적 임시 파일에 기록한 뒤 실제 파일에 반영한다.
 * update는 최신 바이트·ID·경로를 확인하고 rename하며 create는 비덮어쓰기 하드링크로 등록한다.
 * 파일 반영 뒤 임시 정리 실패는 저장 성공으로 반환한다. 색인 갱신과 프로세스 간 잠금은 수행하지 않는다.
 */
export async function saveWorkspaceChange(
  input: unknown,
  scan: WorkspaceScanResult,
  options: WorkspaceStorageOptions = {},
): Promise<WorkspaceStorageResult> {
  const planned = planWorkspaceChange(input, scan);
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
        state: workspaceRenameFileStates.unchanged,
        revision: calculateRevision(target.original),
        ...kind,
      };
    if (restoreFailures.has(target.path))
      return {
        path: target.path,
        state: workspaceRenameFileStates.restoreFailed,
        revision: newRevision,
        ...kind,
      };
    const restoredRevision = restored.get(target.path);
    if (restoredRevision !== undefined)
      return {
        path: target.path,
        state: workspaceRenameFileStates.restored,
        revision: restoredRevision,
        ...kind,
      };
    return {
      path: target.path,
      state: workspaceRenameFileStates.changed,
      revision: newRevision,
      ...kind,
    };
  };
  const files = targets.map(fileResult);
  const remaining = files.some(
    (file) =>
      file.state === workspaceRenameFileStates.changed ||
      file.state === workspaceRenameFileStates.restoreFailed,
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
