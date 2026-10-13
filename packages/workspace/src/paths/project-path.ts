import path, { type PlatformPath } from 'node:path';

/**
 * 경로 계산에 쓰는 OS별 구현이다. 기본값은 실행 중인 OS의 `path`이며
 * 테스트는 `path.win32`·`path.posix`를 넣어 한 OS에서 두 OS의 결과를 비교한다.
 */
export type PathModule = PlatformPath;

/** 프로젝트 기준 경로의 구분자다. 내부 경로는 OS와 무관하게 항상 이 문자로 구분한다. */
export const projectPathSeparator = '/';

/** 해당 구현이 Windows 경로 규칙(`\`도 구분자)을 따르는지 판단한다. */
export function isWin32PathModule(pathModule: PathModule = path): boolean {
  return pathModule.sep === '\\';
}

/**
 * 입력 경로를 구분자로 나눈다. 대소문자·유니코드·`..`와 빈 구간을 보존한다.
 * `\`는 Windows 경로 규칙에서만 구분자로 인정하고 posix에서는 파일 이름의 문자로 둔다.
 */
export function splitPathInput(
  input: string,
  pathModule: PathModule = path,
): string[] {
  return input.split(isWin32PathModule(pathModule) ? /[\\/]/u : /\//u);
}

/**
 * 프로젝트 루트에서 대상까지의 상대 경로를 `/` 구분으로 만든다.
 * 파일 시스템 경로가 프로젝트 기준 경로로 바뀌는 유일한 지점이며 대소문자·유니코드는 그대로 둔다.
 * 대상이 루트 밖이면 `..`로 시작하는 경로를, 루트 자신이면 빈 문자열을 돌려준다.
 */
export function toProjectPath(
  projectRoot: string,
  target: string,
  pathModule: PathModule = path,
): string {
  const relative = pathModule.relative(projectRoot, target);
  return pathModule.sep === projectPathSeparator
    ? relative
    : relative.split(pathModule.sep).join(projectPathSeparator);
}

/**
 * `/`로 구분한 프로젝트 기준 경로를 프로젝트 루트 아래의 OS 경로로 바꾼다.
 * 파일 IO 직전에만 쓰며 경로 구간은 바꾸지 않는다.
 */
export function toOsPath(
  projectRoot: string,
  projectPath: string,
  pathModule: PathModule = path,
): string {
  return pathModule.join(
    projectRoot,
    ...projectPath.split(projectPathSeparator),
  );
}

/** `splitWorkspaceInput`의 결과다. 루트 밖 입력은 구간 없이 실패로 구분한다. */
export type WorkspaceInputSplit =
  { success: true; segments: string[] } | { success: false };

/**
 * resolveWorkspacePath 입력을 프로젝트 기준 구간으로 나눈다. 파일 시스템을 읽지 않는 순수 계산이다.
 * 프로젝트 안의 절대 경로는 루트 이후 구간만 남기고, 루트 밖 절대 경로와 드라이브·루트 접두는 실패다.
 * 앞쪽의 `.` 구간은 제거하고 끝 구분자는 마지막 `.` 구간으로 남겨 폴더 지정을 구분한다.
 */
export function splitWorkspaceInput(
  projectRoot: string,
  input: string,
  pathModule: PathModule = path,
): WorkspaceInputSplit {
  const win32 = isWin32PathModule(pathModule);
  // 입력 전체를 정규화하면 중간 연결과 ..를 지울 수 있으므로 원문 성분을 유지한다.
  const pathInput = win32 ? input.replaceAll('/', pathModule.sep) : input;
  const projectPrefix = projectRoot.endsWith(pathModule.sep)
    ? projectRoot
    : projectRoot + pathModule.sep;
  let relativeInput = pathInput;
  if (pathModule.isAbsolute(pathInput)) {
    if (!pathInput.startsWith(projectPrefix)) return { success: false };
    relativeInput = pathInput.slice(projectPrefix.length);
  } else if (pathModule.parse(pathInput).root !== '') {
    return { success: false };
  }
  const segments = splitPathInput(relativeInput, pathModule).filter(
    (segment) => segment !== '',
  );
  while (segments[0] === '.') segments.shift();
  if (relativeInput.endsWith(pathModule.sep)) segments.push('.');
  return { success: true, segments };
}
