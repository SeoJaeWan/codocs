import {
  diagnosticSeverities,
  type Diagnostic as CoreDiagnostic,
} from '@codocs/core';
import type { Diagnostic } from 'vscode-languageserver/node.js';

/** 진단 재검사의 실패 상태를 밑줄과 별도로 전달하는 알림이다. */
export const diagnosticStatusMethod = 'codocs/diagnosticStatus';

/** 이전 진단은 과거 관측이며 현재 검사 성공을 의미하지 않는다. */
export interface DiagnosticFailure {
  uri?: string;
  reason: string;
  previousDiagnostics: readonly string[];
}

/** 작업 공간별 재검사 관측이다. 빈 failures는 최신 검사 성공이다. */
export interface WorkspaceDiagnosticStatus {
  workspaceUri: string;
  failures: readonly DiagnosticFailure[];
}

/** 실제 원문에서 확인한 위치만 편집기 진단으로 변환한다. */
export function toLspDiagnostics(
  items: readonly CoreDiagnostic<string>[],
  sourcePath: string,
): Diagnostic[] {
  return items.flatMap(
    /** 같은 관측의 문서·진단을 게시 경계로 변환한다. */ (item) =>
      item.range && (!item.path || item.path === sourcePath)
        ? [
            {
              range: item.range,
              message: item.message,
              code: item.code,
              source: 'codocs',
              severity: item.severity === diagnosticSeverities.error ? 1 : 2,
            },
          ]
        : [],
  );
}
