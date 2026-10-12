import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { documentPathMessages, type DocumentPathProblem } from '@codocs/core';
import {
  classifyCodocsLocation,
  type CodocsLocations,
} from './codocs-locations.js';
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
  codocsLocationStates,
  workspacePathFailureStatuses,
  workspaceScopeKinds,
  workspaceTargetKinds,
  type WorkspacePathFailureStatus,
  type WorkspaceScopeKind,
  type WorkspaceTargetKind,
} from './domain-values.js';
import {
  splitPathInput,
  splitWorkspaceInput,
  toProjectPath,
  type PathModule,
} from './project-path.js';
export * from './domain-values.js';
export * from './code-file-access.js';
export * from './codocs-locations.js';
export * from './project-path.js';

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

/**
 * 입력 경로의 구분자를 나누되 대소문자·유니코드 및 ..를 보존한다.
 */
function pathSegments(input: string, pathModule: PathModule): string[] {
  return splitPathInput(input, pathModule).filter((segment) => segment !== '');
}

/**
 * write·validate가 받은 문서 경로의 역슬래시를 `/`로 바꾸고 연속 `/`를 하나로 합친다.
 * 구간 의미(`.`·`..`, 절대 경로, 끝 `/`)는 바꾸지 않아 이후 검사가 원인을 판정한다.
 */
export function normalizeDocumentPathInput(input: string): string {
  return input.replaceAll('\\', '/').replace(/\/{2,}/gu, '/');
}

/** 소유 .codocs 판정 결과다. */
export interface OwningCodocs {
  /** 경로 구간에서 소유 .codocs의 위치다. 0이면 프로젝트 루트의 .codocs다. */
  index: number;
  /** 프로젝트 루트 기준 .codocs 소유 폴더 경로다. 프로젝트 루트이면 빈 문자열이다. */
  ownerDirectory: string;
  /** 소유 .codocs 아래의 상대 경로다. */
  relativePath: string;
}

/**
 * `/`로 구분한 문서 경로에서 첫 `.codocs` 구간을 소유 .codocs로 찾는다.
 * 파일 시스템을 읽지 않는 순수 판정이며, 입력은 normalizeDocumentPathInput을 거친 경로여야 한다.
 * @returns 경로에 .codocs 구간이 없으면 undefined다.
 */
export function locateOwningCodocs(
  documentPath: string,
): OwningCodocs | undefined {
  const segments = documentPath.split('/');
  const index = segments.indexOf(codocsDirectoryName);
  if (index < 0) return undefined;
  return {
    index,
    ownerDirectory: segments.slice(0, index).join('/'),
    relativePath: segments.slice(index + 1).join('/'),
  };
}

/**
 * 문서 경로의 소유 .codocs가 탐색 규칙에서 빠졌거나 확인하지 못한 위치이면 거부 문구를 돌려준다.
 * 문구는 그 .codocs 위치로 시작하며 제외된 위치에는 올바른 예시가 붙는다. 루트 .codocs는 거부하지 않는다.
 * @param locations 마지막으로 확인한 위치 규칙이다.
 * @param documentPath `/`로 구분한 프로젝트 상대 문서 경로다.
 * @returns 인정되는 위치이거나 .codocs 구간이 없으면 undefined다.
 */
export function codocsLocationRejection(
  locations: CodocsLocations | undefined,
  documentPath: string,
): string | undefined {
  const owner = locateOwningCodocs(documentPath);
  if (!owner?.ownerDirectory) return undefined;
  const state = classifyCodocsLocation(locations, owner.ownerDirectory);
  const location = `${owner.ownerDirectory}/${codocsDirectoryName}`;
  if (state === codocsLocationStates.excluded)
    return `${location}: ${workspaceDiagnosticMessages.codocsLocationExcluded}`;
  if (state === codocsLocationStates.unknown)
    return `${location}: ${workspaceDiagnosticMessages.codocsLocationUnknown}`;
  return undefined;
}

/** 문서 경로 검사 결과다. 성공하면 구간 목록을, 실패하면 원인을 담는다. */
export type DocumentPathCheck =
  | { success: true; segments: string[] }
  | { success: false; problem: DocumentPathProblem };

/**
 * 저장 후보 경로의 형식을 검사하고 원인을 가린다. 구간 하나 이상이 `.codocs`인 YAML 파일 경로만 인정하며
 * 하위 .codocs의 위치가 탐색 규칙에서 인정되는지는 판단하지 않는다.
 * @param input 프로젝트 루트 기준 상대 경로이며 구분자는 `/`나 OS 구분자다.
 * @param pathModule 경로 규칙이다. 기본값은 실행 중인 OS이며 `\`는 win32에서만 구분자로 인정한다.
 */
export function checkDocumentPath(
  input: string,
  pathModule: PathModule = path,
): DocumentPathCheck {
  const segments = pathSegments(input, pathModule);
  if (
    pathModule.isAbsolute(input) ||
    path.win32.isAbsolute(input) ||
    /^[A-Za-z]:/u.test(input)
  )
    return { success: false, problem: 'absolute' };
  const owner = locateOwningCodocs(segments.join('/'));
  if (!owner) return { success: false, problem: 'missingCodocs' };
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return { success: false, problem: 'dotSegment' };
  if (owner.index >= segments.length - 1 || /[\\/]$/u.test(input))
    return { success: false, problem: 'missingFileName' };
  if (!/\.ya?ml$/u.test(segments.at(-1) ?? ''))
    return { success: false, problem: 'extension' };
  return { success: true, segments };
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
      : toProjectPath(root.projectRoot, logicalPath);
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

/**
 * 소유 .codocs(경로의 첫 `.codocs` 구간) 아래의 일반 파일·폴더만 확인한다. 후속 IO는 사용 직전에 다시 확인해야 한다.
 * 소유 .codocs까지의 바깥 폴더도 링크·종류를 확인하며 `..`로 소유 .codocs 밖에 나갈 수 없다.
 * 하위 .codocs가 탐색 규칙에서 인정되는 위치인지는 판단하지 않는다.
 */
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
  const split = splitWorkspaceInput(root.projectRoot, input);
  if (!split.success)
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.pathOutsideWorkspace,
      workspaceDiagnosticMessages.pathOutsideWorkspace,
    );
  const segments = split.segments;
  // 첫 .codocs 구간이 소유 .codocs다. 그 앞 구간은 프로젝트 안의 일반 폴더여야 하며 .·..로 경계를 흐리지 않는다.
  const ownerIndex = segments.indexOf(codocsDirectoryName);
  const ownerSegments = segments.slice(0, Math.max(ownerIndex, 0));
  if (
    ownerIndex < 0 ||
    ownerSegments.some((segment) => segment === '.' || segment === '..')
  )
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.pathOutsideWorkspace,
      workspaceDiagnosticMessages.pathOutsideWorkspace,
    );
  segments.splice(0, ownerIndex + 1);

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
  let ownerPath = validatedRoot.root.projectRoot;
  for (const segment of ownerSegments) {
    ownerPath = path.join(ownerPath, segment);
    const checkedOwner = await checkTarget(root, ownerPath, true);
    if ('success' in checkedOwner) return checkedOwner;
    if (checkedOwner.kind !== workspaceTargetKinds.directory)
      return failure(
        root,
        workspacePathFailureStatuses.unavailable,
        workspaceDiagnosticCodes.notDirectory,
        workspaceDiagnosticMessages.notDirectory,
        ownerPath,
      );
  }
  const codocsPath = path.join(ownerPath, codocsDirectoryName);
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
    path: toProjectPath(root.projectRoot, current.logicalPath),
    realPath: current.realPath,
    kind: current.kind,
    scope,
    access: { read: true, write: true },
    diagnostics: [],
  };
}

/**
 * 저장 후보의 프로젝트 상대 경로를 검증하고 허용된 부모 폴더를 한 단계씩 만든다.
 * create에서만 부재 폴더를 생성한다. 각 단계의 연결·종류를 다시 확인하며 최종 파일은 만들지 않는다.
 */
export async function ensureWorkspaceParent(
  root: ProjectRoot,
  input: string,
  createMissing: boolean,
): Promise<
  | { success: true; logicalPath: string }
  | { success: false; diagnostics: readonly WorkspaceDiagnostic[] }
> {
  const checked = checkDocumentPath(input);
  if (!checked.success)
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.invalidWorkspacePath,
      documentPathMessages[checked.problem],
    );
  const segments = checked.segments;
  const selected = await resolveProjectRoot({
    cwd: root.startCwd,
    project: root.projectRoot,
  });
  if (!selected.success)
    return { success: false, diagnostics: selected.diagnostics };
  let current = root.projectRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    let checked = await checkTarget(
      root,
      current,
      segment === codocsDirectoryName,
    );
    if (
      'success' in checked &&
      !checked.success &&
      checked.status === workspacePathFailureStatuses.missing &&
      createMissing
    ) {
      try {
        await mkdir(current);
      } catch (error: unknown) {
        if (getIoErrorCode(error) !== 'EEXIST')
          return failure(
            root,
            workspacePathFailureStatuses.unavailable,
            workspaceDiagnosticCodes.pathUnavailable,
            workspaceDiagnosticMessages.pathUnavailable,
            current,
            error,
          );
      }
      checked = await checkTarget(
        root,
        current,
        segment === codocsDirectoryName,
      );
    }
    if ('success' in checked) return checked;
    if (checked.kind !== workspaceTargetKinds.directory)
      return failure(
        root,
        workspacePathFailureStatuses.unavailable,
        workspaceDiagnosticCodes.notDirectory,
        workspaceDiagnosticMessages.notDirectory,
        current,
      );
  }
  return { success: true, logicalPath: path.join(current, segments.at(-1)!) };
}

/** 부모 폴더 점검 결과다. 없는 폴더는 상위부터 만들 순서로 담는다. */
export type WorkspaceParentInspection =
  | { success: true; logicalPath: string; missingDirectories: string[] }
  | { success: false; diagnostics: readonly WorkspaceDiagnostic[] };

/**
 * 저장 후보의 프로젝트 상대 경로를 검증하고 폴더를 만들지 않은 채 부모 폴더 상태를 점검한다.
 * 존재하는 폴더는 연결·종류를 확인하고, 처음 없는 폴더부터 끝까지를 만들 순서대로 돌려준다.
 * 없는 .codocs와 그 바깥 폴더도 만들 폴더에 넣어 단일 create와 같이 만든다.
 */
export async function inspectWorkspaceParent(
  root: ProjectRoot,
  input: string,
): Promise<WorkspaceParentInspection> {
  const checked = checkDocumentPath(input);
  if (!checked.success)
    return failure(
      root,
      workspacePathFailureStatuses.denied,
      workspaceDiagnosticCodes.invalidWorkspacePath,
      documentPathMessages[checked.problem],
    ) as WorkspaceParentInspection;
  const segments = checked.segments;
  const selected = await resolveProjectRoot({
    cwd: root.startCwd,
    project: root.projectRoot,
  });
  if (!selected.success)
    return { success: false, diagnostics: selected.diagnostics };
  const missingDirectories: string[] = [];
  let current = root.projectRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (missingDirectories.length) {
      missingDirectories.push(current);
      continue;
    }
    const checked = await checkTarget(
      root,
      current,
      segment === codocsDirectoryName,
    );
    if ('success' in checked) {
      if (
        !checked.success &&
        checked.status === workspacePathFailureStatuses.missing
      ) {
        missingDirectories.push(current);
        continue;
      }
      return checked as WorkspaceParentInspection;
    }
    if (checked.kind !== workspaceTargetKinds.directory)
      return failure(
        root,
        workspacePathFailureStatuses.unavailable,
        workspaceDiagnosticCodes.notDirectory,
        workspaceDiagnosticMessages.notDirectory,
        current,
      ) as WorkspaceParentInspection;
  }
  return {
    success: true,
    logicalPath: path.join(current, segments.at(-1)!),
    missingDirectories,
  };
}
