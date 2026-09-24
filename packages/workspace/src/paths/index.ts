import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  createWorkspaceDiagnostic,
  getIoErrorCode,
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
  type WorkspaceDiagnostic,
} from '../diagnostics/index.js';
import {
  codocsDirectoryName,
  isPathString,
  resolveProjectRoot,
  type ProjectRoot,
} from '../project-root/index.js';
import {
  workspacePathFailureStatuses,
  workspaceScopeKinds,
  workspaceTargetKinds,
  type WorkspacePathFailureStatus,
  type WorkspaceScopeKind,
  type WorkspaceTargetKind,
} from './domain-values.js';
export * from './domain-values.js';

/** 논리 .codocs 또는 가장 가까운 명시적 연결이 부여한 현 시점 접근 범위다. */
export interface WorkspaceAccessScope {
  kind: WorkspaceScopeKind;
  logicalPath: string;
  realPath: string;
}

/** 실제 저장·권한 변경 없이 대상의 읽기·쓰기 정책 범위만 허용한다. */
export interface WorkspaceAccessPolicy {
  read: true;
  write: true;
}

/** 확인한 대상 종류다. Node Stats 같은 FS 내부 타입을 공개하지 않는다. */

/** 현재 대상 확인에서 얻은 0이 아닌 폴더 식별 정보다. 영구 파일 ID나 전역 중복 제거에 사용하지 않는다. */
export interface WorkspaceDirectoryIdentity {
  device: bigint;
  inode: bigint;
}

/** 명시적 링크의 발견 경로와 감시할 대상이다. 미확인 대상은 실경로로 단정하지 않는다. */
export interface WorkspacePathLink {
  path: string;
  logicalPath: string;
  targetPath: string;
  realPath?: string;
  kind?: WorkspaceTargetKind;
  confirmed: boolean;
}

/** 경계·대상 확인 결과다. 실패에는 얻지 못한 realPath를 넣지 않는다. */
export type WorkspacePathResult = { links?: readonly WorkspacePathLink[] } & (
  | {
      success: true;
      logicalPath: string;
      path: string;
      realPath: string;
      kind: WorkspaceTargetKind;
      directoryIdentity?: WorkspaceDirectoryIdentity;
      isSymbolicLink: boolean;
      scope: WorkspaceAccessScope;
      access: WorkspaceAccessPolicy;
      diagnostics: readonly WorkspaceDiagnostic[];
    }
  | {
      success: false;
      status: WorkspacePathFailureStatus;
      logicalPath?: string;
      path?: string;
      diagnostics: readonly WorkspaceDiagnostic[];
    }
);

/** 대상 확인에 사용하는 내부 값이다. */
interface CheckedTarget {
  logicalPath: string;
  realPath: string;
  kind: WorkspaceTargetKind;
  directoryIdentity?: WorkspaceDirectoryIdentity;
  isSymbolicLink: boolean;
}

/** 입력 경로의 구분자를 나누되 대소문자·유니코드 및 ..를 보존한다. */
function pathSegments(input: string): string[] {
  return input
    .split(path.sep === '\\' ? /[\\/]/u : /\//u)
    .filter((segment) => segment !== '');
}

/** 해당 논리 경로의 링크 여부와 현재 실제 대상을 확인한다. */
async function checkTarget(logicalPath: string): Promise<CheckedTarget> {
  const entry = await lstat(logicalPath);
  const realPath = await realpath(logicalPath);
  const target = await stat(logicalPath, { bigint: true });
  return {
    logicalPath,
    realPath,
    kind: target.isDirectory()
      ? workspaceTargetKinds.directory
      : target.isFile()
        ? workspaceTargetKinds.file
        : workspaceTargetKinds.other,
    ...(target.isDirectory() && target.dev > 0n && target.ino > 0n
      ? { directoryIdentity: { device: target.dev, inode: target.ino } }
      : {}),
    isSymbolicLink: entry.isSymbolicLink(),
  };
}

/** 거부·누락·대상 확인 실패를 확인된 논리 경로와 함께 반환한다. */
function failure(
  root: ProjectRoot,
  status: WorkspacePathFailureStatus,
  code: WorkspaceDiagnostic['code'],
  message: string,
  logicalPath?: string,
  error?: unknown,
): WorkspacePathResult {
  const sourcePath =
    logicalPath === undefined
      ? undefined
      : path.relative(root.projectRoot, logicalPath);
  return {
    success: false,
    status,
    ...(logicalPath === undefined ? {} : { logicalPath }),
    ...(sourcePath === undefined ? {} : { path: sourcePath }),
    diagnostics: [createWorkspaceDiagnostic(code, message, sourcePath, error)],
  };
}

/**
 * 프로젝트 상대 .codocs 경로 또는 그 논리 절대 경로에서 연결을 따라 현재 대상을 확인한다.
 * 외부 실경로 직접 입력은 거부한다. ..는 현재 .codocs 또는 폴더 링크 루트 안에서만 허용한다.
 * 링크 대상 파일·폴더는 읽기·쓰기 정책 범위에 편입하지만 OS 쓰기 권한·저장·잠금은 수행하지 않는다.
 * 대상은 호출 사이에 바뀔 수 있으므로 후속 writer는 실제 쓰기 시 다시 확인해야 한다.
 */
export async function resolveWorkspacePath(
  root: ProjectRoot,
  input: unknown,
): Promise<WorkspacePathResult> {
  const links: WorkspacePathLink[] = [];
  const result = await resolvePath(root, input, links);
  return links.length === 0 ? result : { ...result, links };
}

/** 링크 자체의 존재와 대상 확인을 분리하고 실패 전 확인한 연결도 보존한다. */
async function resolvePath(
  root: ProjectRoot,
  input: unknown,
  links: WorkspacePathLink[],
): Promise<WorkspacePathResult> {
  /** 대상이 끊어져도 readlink로 확인한 감시 위치를 보존한다. 읽기 권한은 부여하지 않는다. */
  async function checkLinkedTarget(
    logicalPath: string,
  ): Promise<CheckedTarget> {
    const entry = await lstat(logicalPath);
    let link: WorkspacePathLink | undefined;
    if (entry.isSymbolicLink()) {
      link = {
        path: path.relative(root.projectRoot, logicalPath),
        logicalPath,
        targetPath: path.resolve(
          path.dirname(logicalPath),
          await readlink(logicalPath),
        ),
        confirmed: false,
      };
      links.push(link);
    }
    const target = await checkTarget(logicalPath);
    if (link) {
      link.realPath = target.realPath;
      link.kind = target.kind;
      link.confirmed = true;
    }
    return target;
  }
  if (!isPathString(input)) {
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.invalidWorkspacePath,
      workspaceDiagnosticMessages.invalidPath,
    );
  }
  // resolve/join으로 입력 전체를 정규화하면 link/.. 경계를 잃으므로 먼저 원문 성분을 보존한다.
  // Windows가 허용하는 두 구분자 표기만 통일하고 링크 뒤 ..와 대소문자는 보존한다.
  const pathInput = path.sep === '\\' ? input.replaceAll('/', path.sep) : input;
  const projectPrefix = root.projectRoot.endsWith(path.sep)
    ? root.projectRoot
    : root.projectRoot + path.sep;
  let relativeInput = pathInput;
  if (path.isAbsolute(pathInput)) {
    if (!pathInput.startsWith(projectPrefix))
      return failure(
        root,
        workspacePathFailureStatuses.denied,
        workspaceDiagnosticCodes.pathOutsideWorkspace,
        workspaceDiagnosticMessages.pathOutsideWorkspace,
      );
    relativeInput = pathInput.slice(projectPrefix.length);
  } else if (path.parse(pathInput).root !== '') {
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.pathOutsideWorkspace,
      workspaceDiagnosticMessages.pathOutsideWorkspace,
    );
  }
  const segments = pathSegments(relativeInput);
  while (segments[0] === '.') segments.shift();
  if (
    relativeInput.endsWith(path.sep) ||
    (path.sep === '\\' && relativeInput.endsWith('/'))
  )
    segments.push('.');
  if (segments.shift() !== codocsDirectoryName) {
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.pathOutsideWorkspace,
      workspaceDiagnosticMessages.pathOutsideWorkspace,
    );
  }
  const validatedRoot = await resolveProjectRoot({
    cwd: root.startCwd,
    project: root.projectRoot,
  });
  if (!validatedRoot.success)
    return {
      success: false,
      status: workspacePathFailureStatuses.unavailable,
      diagnostics: validatedRoot.diagnostics,
    };
  const codocsPath = validatedRoot.root.codocsPath;
  let current: CheckedTarget;
  try {
    // lstat의 ENOENT만 부재다. 존재하는 깨진 .codocs 링크는 이후 대상 확인 실패다.
    await lstat(codocsPath);
  } catch (error: unknown) {
    return failure(
      root,
      getIoErrorCode(error) === 'ENOENT'
        ? workspacePathFailureStatuses.missing
        : workspacePathFailureStatuses.unavailable,
      workspaceDiagnosticCodes.pathUnavailable,
      workspaceDiagnosticMessages.pathUnavailable,
      codocsPath,
      error,
    );
  }
  try {
    current = await checkLinkedTarget(codocsPath);
  } catch (error: unknown) {
    return failure(
      root,
      workspacePathFailureStatuses.unavailable,
      workspaceDiagnosticCodes.pathUnavailable,
      workspaceDiagnosticMessages.pathUnavailable,
      codocsPath,
      error,
    );
  }
  if (current.kind !== workspaceTargetKinds.directory)
    return failure(
      root,
      workspacePathFailureStatuses.unavailable,
      workspaceDiagnosticCodes.notDirectory,
      workspaceDiagnosticMessages.notDirectory,
      codocsPath,
    );
  let scope: WorkspaceAccessScope = {
    kind: current.isSymbolicLink
      ? workspaceScopeKinds.linkedDirectory
      : workspaceScopeKinds.workspace,
    logicalPath: current.logicalPath,
    realPath: current.realPath,
  };
  for (const segment of segments) {
    if (
      segment === '..' &&
      (current.logicalPath === scope.logicalPath ||
        current.kind !== workspaceTargetKinds.directory)
    ) {
      return failure(
        root,
        workspacePathFailureStatuses.denied,
        workspaceDiagnosticCodes.pathOutsideWorkspace,
        workspaceDiagnosticMessages.pathOutsideWorkspace,
        current.logicalPath,
      );
    }
    if (current.kind !== workspaceTargetKinds.directory)
      return failure(
        root,
        workspacePathFailureStatuses.unavailable,
        workspaceDiagnosticCodes.notDirectory,
        workspaceDiagnosticMessages.notDirectory,
        current.logicalPath,
      );
    if (segment === '.') continue;
    const nextPath =
      segment === '..'
        ? path.dirname(current.logicalPath)
        : path.join(current.logicalPath, segment);
    try {
      // 존재하는 링크의 대상 실패를 ENOENT 부재로 오인하지 않는다.
      await lstat(nextPath);
    } catch (error: unknown) {
      return failure(
        root,
        getIoErrorCode(error) === 'ENOENT'
          ? workspacePathFailureStatuses.missing
          : workspacePathFailureStatuses.unavailable,
        workspaceDiagnosticCodes.pathUnavailable,
        workspaceDiagnosticMessages.pathUnavailable,
        nextPath,
        error,
      );
    }
    try {
      current = await checkLinkedTarget(nextPath);
    } catch (error: unknown) {
      return failure(
        root,
        workspacePathFailureStatuses.unavailable,
        workspaceDiagnosticCodes.pathUnavailable,
        workspaceDiagnosticMessages.pathUnavailable,
        nextPath,
        error,
      );
    }
    if (current.isSymbolicLink)
      scope = {
        kind:
          current.kind === workspaceTargetKinds.directory
            ? workspaceScopeKinds.linkedDirectory
            : workspaceScopeKinds.linkedFile,
        logicalPath: current.logicalPath,
        realPath: current.realPath,
      };
  }
  return {
    success: true,
    logicalPath: current.logicalPath,
    path: path.relative(root.projectRoot, current.logicalPath),
    realPath: current.realPath,
    kind: current.kind,
    ...(current.directoryIdentity === undefined
      ? {}
      : { directoryIdentity: current.directoryIdentity }),
    isSymbolicLink: current.isSymbolicLink,
    scope,
    access: { read: true, write: true },
    diagnostics: [],
  };
}
