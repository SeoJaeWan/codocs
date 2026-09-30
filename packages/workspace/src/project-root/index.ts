/** 프로젝트 지식 파일을 찾는 논리 루트 이름이다. */
export const codocsDirectoryName = '.codocs';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  createWorkspaceDiagnostic,
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
  type WorkspaceDiagnostic,
} from '../diagnostics/index.js';

/** 호출 시점의 시작 cwd와 선택 루트다. 실제 경로는 확인한 값만 제공한다. */
export interface ProjectRoot {
  startCwd: string;
  projectRoot: string;
  realPath: string;
  codocsPath: string;
}

/** 루트 선택의 공개 입력이다. cwd 생략 시 호출 시점의 process.cwd()를 사용한다. */
export interface ProjectRootOptions {
  cwd?: string;
  project?: string;
}

/** 유효한 루트와 선택 실패를 구분한다. 실패에는 확인하지 못한 실제 경로가 없다. */
export type ProjectRootResult =
  | {
      success: true;
      root: ProjectRoot;
      diagnostics: readonly WorkspaceDiagnostic[];
    }
  | {
      success: false;
      projectRoot?: string;
      diagnostics: readonly WorkspaceDiagnostic[];
    };

/** 경로 원문을 수정하지 않고 비문자열·공백뿐인 값·NUL을 거부한다. */
export function isPathString(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    input.trim().length > 0 &&
    !input.includes('\0')
  );
}

/** 선택 경로의 이름 성분에 연결이 있으면 후속 파일 작업 전에 그 위치를 반환한다. */
async function selectedLink(
  startCwd: string,
  projectRoot: string,
): Promise<string | undefined> {
  for (const selected of [startCwd, projectRoot]) {
    const volumeRoot = path.parse(selected).root;
    let current = volumeRoot;
    for (const segment of path.relative(volumeRoot, selected).split(path.sep)) {
      if (!segment) continue;
      current = path.join(current, segment);
      if (!(await lstat(current)).isSymbolicLink()) continue;
      // macOS의 /var·/tmp·/etc는 프로젝트보다 위의 시스템 경로 별칭이다.
      if (
        process.platform === 'darwin' &&
        current !== selected &&
        ['/var', '/tmp', '/etc'].includes(current)
      )
        continue;
      return current;
    }
  }
  return undefined;
}

/**
 * 시작 cwd 또는 그 기준의 project 디렉터리를 선택하고 실제 루트와 읽기·탐색 권한을 확인한다.
 * 상위 .codocs·Git을 탐색하지 않으며 .codocs 부재 여부를 루트 선택에 사용하지 않는다.
 * IO 실패는 진단으로 반환한다. 결과는 현 시점 확인이며 후속 IO를 위한 영구 허가가 아니다.
 * @codocs [[작업 공간:프로젝트 루트]]
 */
export async function resolveProjectRoot(
  input: unknown = {},
): Promise<ProjectRootResult> {
  let cwd: unknown;
  let project: unknown;
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return {
        success: false,
        diagnostics: [
          createWorkspaceDiagnostic(
            workspaceDiagnosticCodes.invalidProjectRoot,
            workspaceDiagnosticMessages.invalidRootOptions,
          ),
        ],
      };
    }
    // 접근자·Proxy 예외는 입력 오류로 처리하고 정상 속성 값은 한 번만 읽어 고정한다.
    cwd = 'cwd' in input ? input.cwd : undefined;
    project = 'project' in input ? input.project : undefined;
  } catch {
    return {
      success: false,
      diagnostics: [
        createWorkspaceDiagnostic(
          workspaceDiagnosticCodes.invalidProjectRoot,
          workspaceDiagnosticMessages.invalidRootOptions,
        ),
      ],
    };
  }
  try {
    if (cwd === undefined) cwd = process.cwd();
  } catch (error: unknown) {
    return {
      success: false,
      diagnostics: [
        createWorkspaceDiagnostic(
          workspaceDiagnosticCodes.projectRootUnavailable,
          workspaceDiagnosticMessages.rootUnavailable,
          undefined,
          error,
        ),
      ],
    };
  }
  if (!isPathString(cwd) || !path.isAbsolute(cwd)) {
    return {
      success: false,
      diagnostics: [
        createWorkspaceDiagnostic(
          workspaceDiagnosticCodes.invalidProjectRoot,
          workspaceDiagnosticMessages.invalidCwd,
        ),
      ],
    };
  }
  if (project !== undefined && !isPathString(project)) {
    return {
      success: false,
      diagnostics: [
        createWorkspaceDiagnostic(
          workspaceDiagnosticCodes.invalidProjectRoot,
          workspaceDiagnosticMessages.invalidProject,
        ),
      ],
    };
  }
  const startCwd = path.resolve(cwd);
  const projectRoot = path.resolve(startCwd, project ?? '.');
  try {
    const linked = await selectedLink(startCwd, projectRoot);
    if (linked) {
      return {
        success: false,
        projectRoot,
        diagnostics: [
          createWorkspaceDiagnostic(
            workspaceDiagnosticCodes.unsupportedWorkspaceLink,
            workspaceDiagnosticMessages.unsupportedWorkspaceLink,
            linked,
          ),
        ],
      };
    }
    const target = await lstat(projectRoot);
    if (!target.isDirectory()) {
      return {
        success: false,
        projectRoot,
        diagnostics: [
          createWorkspaceDiagnostic(
            workspaceDiagnosticCodes.invalidProjectRoot,
            workspaceDiagnosticMessages.rootNotDirectory,
            projectRoot,
          ),
        ],
      };
    }
    await access(projectRoot, constants.R_OK | constants.X_OK);
    const realPath = await realpath(projectRoot);
    return {
      success: true,
      root: {
        startCwd,
        projectRoot,
        realPath,
        codocsPath: path.join(projectRoot, codocsDirectoryName),
      },
      diagnostics: [],
    };
  } catch (error: unknown) {
    return {
      success: false,
      projectRoot,
      diagnostics: [
        createWorkspaceDiagnostic(
          workspaceDiagnosticCodes.projectRootUnavailable,
          workspaceDiagnosticMessages.rootUnavailable,
          projectRoot,
          error,
        ),
      ],
    };
  }
}
