import type { Diagnostic, WorkspaceDiagnosticCode } from '@codosc/core';

/** 실제 IO 경계의 진단이다. 확인한 시스템 오류 코드만 보존하며 원문 좌표를 만들지 않는다. */
export interface WorkspaceDiagnostic extends Diagnostic {
  code: WorkspaceDiagnosticCode;
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

/** 이름 있는 core 코드·문구와 확인된 경로·IO 코드로 진단을 구성한다. */
export function createWorkspaceDiagnostic(
  code: WorkspaceDiagnosticCode,
  message: string,
  sourcePath?: string,
  error?: unknown,
): WorkspaceDiagnostic {
  const ioCode = getIoErrorCode(error);
  return {
    code,
    severity: 'error',
    message,
    ...(sourcePath === undefined ? {} : { path: sourcePath }),
    ...(ioCode === undefined ? {} : { ioCode }),
  };
}
