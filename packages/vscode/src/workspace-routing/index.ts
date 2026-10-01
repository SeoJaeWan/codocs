import path from 'node:path';

/** 문서 소유권을 계산할 workspace root다. */
export interface WorkspaceRoot {
  fsPath: string;
  uri: string;
}

/** 포함하는 루트 중 가장 가까운 workspace folder를 선택한다.
 * @codocs [[VS Code:언어 서버 연결]]#L20-L21 */
export function nearestWorkspaceRoot(
  documentPath: string,
  roots: readonly WorkspaceRoot[],
): WorkspaceRoot | undefined {
  return roots
    .filter((root) => containsPath(root.fsPath, documentPath))
    .sort(
      (left, right) =>
        path.resolve(right.fsPath).length - path.resolve(left.fsPath).length,
    )[0];
}

/** 문서가 선택한 workspace folder에 속하는지 확인한다. */
export function isOwnedByWorkspaceRoot(
  documentPath: string,
  root: WorkspaceRoot,
  roots: readonly WorkspaceRoot[],
): boolean {
  return nearestWorkspaceRoot(documentPath, roots)?.uri === root.uri;
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

/** 플랫폼 경로 구분자 기준으로 실제 하위 경로만 포함한다. */
function containsPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(
    path.resolve(rootPath),
    path.resolve(candidatePath),
  );
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}
