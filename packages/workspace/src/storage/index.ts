import {
  changePlanStatuses,
  diagnosticSeverities,
  storageDiagnosticCodes,
  storageDiagnosticMessages,
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  scanStatuses,
  type Diagnostic,
} from '@codocs/core';
import { randomUUID } from 'node:crypto';
import { link, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { planWorkspaceChange } from '../change-plan/index.js';
import { getIoErrorCode } from '../diagnostics/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import { loadWorkspace, type WorkspaceScanResult } from '../loader/index.js';
import { ensureWorkspaceParent, resolveWorkspacePath } from '../paths/index.js';
import {
  workspacePathFailureStatuses,
  workspaceTargetKinds,
} from '../paths/domain-values.js';
import type { ProjectRoot } from '../project-root/index.js';
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
 * @codocs [[작업 공간:저장]]#L19-L21
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
 * @codocs [[작업 공간:저장]]
 * @codocs [[작업 공간:쓰기 조정]]#L15-L24
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
