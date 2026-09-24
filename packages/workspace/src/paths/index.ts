import { lstat, realpath } from 'node:fs/promises';
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

/** 실제 .codocs 디렉터리가 부여한 현 시점 접근 범위다. */
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

/** 경계·대상 확인 결과다. 실패에는 얻지 못한 realPath를 넣지 않는다. */
export type WorkspacePathResult =
  | {
      success: true;
      logicalPath: string;
      path: string;
      realPath: string;
      kind: WorkspaceTargetKind;
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
    };

interface CheckedTarget {
  logicalPath: string;
  realPath: string;
  kind: WorkspaceTargetKind;
}

/** 입력 경로의 구분자를 나누되 대소문자·유니코드 및 ..를 보존한다. */
function pathSegments(input: string): string[] {
  return input
    .split(path.sep === '\\' ? /[\\/]/u : /\//u)
    .filter((segment) => segment !== '');
}

/** 거부·누락·대상 확인 실패를 확인된 경로와 함께 반환한다. */
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

/** 각 항목을 lstat으로 확인하고 연결이면 대상을 열기 전에 거부한다. */
async function checkTarget(
  root: ProjectRoot,
  logicalPath: string,
  rootTarget: boolean,
): Promise<CheckedTarget | WorkspacePathResult> {
  let entry;
  try {
    entry = await lstat(logicalPath);
  } catch (error: unknown) {
    return failure(
      root,
      getIoErrorCode(error) === 'ENOENT'
        ? workspacePathFailureStatuses.missing
        : workspacePathFailureStatuses.unavailable,
      workspaceDiagnosticCodes.pathUnavailable,
      workspaceDiagnosticMessages.pathUnavailable,
      logicalPath,
      error,
    );
  }
  if (entry.isSymbolicLink())
    return failure(
      root,
      rootTarget
        ? workspacePathFailureStatuses.unavailable
        : workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.unsupportedWorkspaceLink,
      workspaceDiagnosticMessages.unsupportedWorkspaceLink,
      logicalPath,
    );
  try {
    const realPath = await realpath(logicalPath);
    return {
      logicalPath,
      realPath,
      kind: entry.isDirectory()
        ? workspaceTargetKinds.directory
        : entry.isFile()
          ? workspaceTargetKinds.file
          : workspaceTargetKinds.other,
    };
  } catch (error: unknown) {
    return failure(
      root,
      workspacePathFailureStatuses.unavailable,
      workspaceDiagnosticCodes.pathUnavailable,
      workspaceDiagnosticMessages.pathUnavailable,
      logicalPath,
      error,
    );
  }
}

/** .codocs의 일반 파일·폴더만 확인한다. 후속 IO는 사용 직전에 다시 확인해야 한다. */
export async function resolveWorkspacePath(
  root: ProjectRoot,
  input: unknown,
): Promise<WorkspacePathResult> {
  if (!isPathString(input))
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.invalidWorkspacePath,
      workspaceDiagnosticMessages.invalidPath,
    );
  // 입력 전체를 정규화하면 중간 연결과 ..를 지울 수 있으므로 원문 성분을 유지한다.
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
  if (segments.shift() !== codocsDirectoryName)
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.pathOutsideWorkspace,
      workspaceDiagnosticMessages.pathOutsideWorkspace,
    );

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
  const checkedRoot = await checkTarget(root, codocsPath, true);
  if ('success' in checkedRoot) return checkedRoot;
  if (checkedRoot.kind !== workspaceTargetKinds.directory)
    return failure(
      root,
      workspacePathFailureStatuses.unavailable,
      workspaceDiagnosticCodes.notDirectory,
      workspaceDiagnosticMessages.notDirectory,
      codocsPath,
    );
  const scope: WorkspaceAccessScope = {
    kind: workspaceScopeKinds.workspace,
    logicalPath: checkedRoot.logicalPath,
    realPath: checkedRoot.realPath,
  };
  let current = checkedRoot;
  for (const segment of segments) {
    if (segment === '..' && current.logicalPath === codocsPath)
      return failure(
        root,
        workspacePathFailureStatuses.denied,
        workspaceDiagnosticCodes.pathOutsideWorkspace,
        workspaceDiagnosticMessages.pathOutsideWorkspace,
        current.logicalPath,
      );
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
    const checked = await checkTarget(root, nextPath, false);
    if ('success' in checked) return checked;
    current = checked;
  }
  return {
    success: true,
    logicalPath: current.logicalPath,
    path: path.relative(root.projectRoot, current.logicalPath),
    realPath: current.realPath,
    kind: current.kind,
    scope,
    access: { read: true, write: true },
    diagnostics: [],
  };
}
