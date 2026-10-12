import path, { type PlatformPath } from 'node:path';

/** 문서 소유권을 계산할 workspace root다. */
export interface WorkspaceRoot {
  fsPath: string;
  uri: string;
}

/** 포함하는 루트 중 가장 가까운 workspace folder를 선택한다.
 * */
export function nearestWorkspaceRoot(
  documentPath: string,
  roots: readonly WorkspaceRoot[],
  pathModule: PlatformPath = path,
): WorkspaceRoot | undefined {
  return roots
    .filter((root) => containsPath(root.fsPath, documentPath, pathModule))
    .sort(
      (left, right) =>
        pathModule.resolve(right.fsPath).length -
        pathModule.resolve(left.fsPath).length,
    )[0];
}

/** 문서가 선택한 workspace folder에 속하는지 확인한다. */
export function isOwnedByWorkspaceRoot(
  documentPath: string,
  root: WorkspaceRoot,
  roots: readonly WorkspaceRoot[],
  pathModule: PlatformPath = path,
): boolean {
  return (
    nearestWorkspaceRoot(documentPath, roots, pathModule)?.uri === root.uri
  );
}

/** 선택한 workspace folder 안에 있으면서 별도 workspace folder로 열린 폴더를 고른다. 자기 자신은 제외한다. */
export function nestedWorkspaceRoots(
  root: WorkspaceRoot,
  roots: readonly WorkspaceRoot[],
  pathModule: PlatformPath = path,
): WorkspaceRoot[] {
  return roots.filter(
    /** 자기 자신을 뺀 하위 folder만 남긴다. */ (candidate) =>
      candidate.uri !== root.uri &&
      pathModule.resolve(candidate.fsPath) !==
        pathModule.resolve(root.fsPath) &&
      containsPath(root.fsPath, candidate.fsPath, pathModule),
  );
}

/** 가장 가까운 workspace가 소유한 요청만 해당 client에 전달한다. */
export async function routeOwnedRequest<Result>(
  documentPath: string,
  root: WorkspaceRoot,
  roots: readonly WorkspaceRoot[],
  request: () => Promise<Result>,
): Promise<Result | undefined> {
  if (!isOwnedByWorkspaceRoot(documentPath, root, roots)) return undefined;
  return request();
}

/** 주어진 경로 규칙(기본은 실행 중인 OS)의 구분자 기준으로 실제 하위 경로만 포함한다. */
function containsPath(
  rootPath: string,
  candidatePath: string,
  pathModule: PlatformPath,
): boolean {
  const relative = pathModule.relative(
    pathModule.resolve(rootPath),
    pathModule.resolve(candidatePath),
  );
  return (
    relative === '' ||
    (!relative.startsWith(`..${pathModule.sep}`) &&
      relative !== '..' &&
      !pathModule.isAbsolute(relative))
  );
}
