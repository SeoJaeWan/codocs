import type { Diagnostic } from '@codocs/core';
import { diagnosticSeverities } from '@codocs/core';

/** workspace의 경로·IO·탐색 진단 코드와 발생 조건이다. @domainValues */
export const workspaceDiagnosticCodes = {
  /** 초기 구성이나 명시적 전체 갱신이 진행 중일 때 반환한다. */
  indexNotReady: 'index_not_ready',
  /** 루트 선택 입력이 잘못됐거나 선택 대상이 디렉터리가 아니면 반환한다. */
  invalidProjectRoot: 'invalid_project_root',
  /** 선택 루트의 대상 확인 또는 읽기·탐색 권한 확인에 실패하면 반환한다. */
  projectRootUnavailable: 'project_root_unavailable',
  /** 경로 입력이 비문자열·빈 문자열·NUL 포함 문자열이면 반환한다. */
  invalidWorkspacePath: 'invalid_workspace_path',
  /** .codocs 밖의 입력 또는 그 경계를 벗어나는 이동이면 반환한다. */
  pathOutsideWorkspace: 'path_outside_workspace',
  /** 경로가 없거나 실제 대상 확인에 실패하면 반환한다. */
  pathUnavailable: 'path_unavailable',
  /** 심볼릭 링크 또는 Windows 정션을 확인하면 반환한다. */
  unsupportedWorkspaceLink: 'unsupported_workspace_link',
  /** 디렉터리가 필요한 위치에 파일이나 특수 대상이 있으면 반환한다. */
  notDirectory: 'not_directory',
  /** 발견한 경로에서 실제 파일 읽기 또는 폴더 열거에 실패하면 반환한다. */
  readFailed: 'workspace_read_failed',
} as const;

/** workspace 진단의 고정 문구다. 실제 시스템 오류 코드는 IO 경계가 별도로 보존한다. */
export const workspaceDiagnosticMessages = {
  /** 진행 중인 색인이 완료된 뒤 조회를 다시 시도하도록 안내한다. */
  indexNotReady: '문서 색인을 구성하는 중입니다. 완료 후 다시 조회하세요.',
  /** 객체가 아닌 루트 선택 옵션을 받았을 때 사용한다. */
  invalidRootOptions: '프로젝트 루트 선택 옵션은 객체이어야 합니다.',
  /** 시작 cwd가 유효한 절대 경로 문자열이 아닐 때 사용한다. */
  invalidCwd: '시작 cwd는 비어 있지 않은 절대 경로이어야 합니다.',
  /** 명시한 project가 유효한 경로 문자열이 아닐 때 사용한다. */
  invalidProject: 'project는 비어 있지 않은 경로 문자열이어야 합니다.',
  /** 선택한 루트가 디렉터리가 아닐 때 사용한다. */
  rootNotDirectory: '선택한 프로젝트 루트는 디렉터리가 아닙니다.',
  /** 선택 루트의 확인 또는 읽기·탐색 권한 확인에 실패했을 때 사용한다. */
  rootUnavailable: '선택한 프로젝트 루트에 접근할 수 없습니다.',
  /** 경로 입력을 검증하지 못했을 때 사용한다. */
  invalidPath: '작업 경로는 비어 있지 않은 경로 문자열이어야 합니다.',
  /** 작업 범위 밖의 입력에 사용한다. */
  pathOutsideWorkspace: '.codocs의 범위를 벗어났습니다.',
  /** 실제 경로와 대상을 확인하지 못했을 때 사용한다. */
  pathUnavailable: '작업 경로의 실제 대상을 확인할 수 없습니다.',
  /** 지원하지 않는 연결을 발견했을 때 사용한다. */
  unsupportedWorkspaceLink: '심볼릭 링크와 정션은 지원하지 않습니다.',
  /** 디렉터리를 기대한 위치에서 다른 대상을 확인했을 때 사용한다. */
  notDirectory: '탐색할 작업 경로는 디렉터리이어야 합니다.',
  /** 파일 읽기나 폴더 열거의 실제 IO 실패에 사용한다. */
  readFailed: '작업 경로를 읽을 수 없습니다.',
} as const;

/** 코드 정의에서 도출한 workspace 진단 코드다. */
export type WorkspaceDiagnosticCode =
  (typeof workspaceDiagnosticCodes)[keyof typeof workspaceDiagnosticCodes];

/** 실제 IO 경계의 진단이다. 확인한 시스템 오류 코드만 보존하며 원문 좌표를 만들지 않는다. */
export interface WorkspaceDiagnostic extends Diagnostic<WorkspaceDiagnosticCode> {
  ioCode?: string;
}

/** unknown 오류에서 실제 문자열 시스템 코드만 확인한다. */
export function getIoErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

/**
 * 이름 있는 workspace 코드·문구와 확인된 경로·IO 코드로 진단을 구성한다.
 */
export function createWorkspaceDiagnostic(
  code: WorkspaceDiagnosticCode,
  message: string,
  sourcePath?: string,
  error?: unknown,
): WorkspaceDiagnostic {
  const ioCode = getIoErrorCode(error);
  return {
    code,
    severity: diagnosticSeverities.error,
    message,
    ...(sourcePath === undefined ? {} : { path: sourcePath }),
    ...(ioCode === undefined ? {} : { ioCode }),
  };
}
