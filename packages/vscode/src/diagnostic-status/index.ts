import * as vscode from 'vscode';

/** 서버가 작업 공간별 진단 실패를 게시하는 알림이다. */
export const diagnosticStatusMethod = 'codocs/diagnosticStatus';
/** 상태 표시줄이 실행하는 상세 안내 명령이다. */
export const diagnosticStatusCommand = 'codocs.showDiagnosticStatus';

/** 프로토콜의 실패 원인과 과거 관측을 표시하는 경계다. */
export interface DiagnosticFailure {
  uri?: string;
  reason: string;
  previousDiagnostics: readonly string[];
}

/** 외부 서버 알림의 구조를 검사하고 자기 작업 공간의 결과만 채택한다. */
export function readDiagnosticFailures(
  input: unknown,
  workspaceUri: string,
): DiagnosticFailure[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const status: unknown = input.find(
    /** 작업 공간에 속한 실패 관측을 사용자 안내로 변환한다. */ (
      item: unknown,
    ) =>
      typeof item === 'object' &&
      item !== null &&
      'workspaceUri' in item &&
      typeof item.workspaceUri === 'string' &&
      vscode.Uri.parse(item.workspaceUri).toString() === workspaceUri,
  );
  if (
    typeof status !== 'object' ||
    status === null ||
    !('failures' in status) ||
    !Array.isArray(status.failures)
  )
    return undefined;
  const failures: DiagnosticFailure[] = [];
  for (const value of status.failures as unknown[]) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('reason' in value) ||
      typeof value.reason !== 'string' ||
      !('previousDiagnostics' in value) ||
      !Array.isArray(value.previousDiagnostics) ||
      !value.previousDiagnostics.every(
        (message: unknown) => typeof message === 'string',
      ) ||
      ('uri' in value && typeof value.uri !== 'string')
    )
      return undefined;
    failures.push({
      reason: value.reason,
      previousDiagnostics: value.previousDiagnostics,
      ...('uri' in value ? { uri: value.uri as string } : {}),
    });
  }
  return failures;
}

/** 한 작업 공간의 표시 수명과 과거 결과를 독립적으로 관리한다.
 * @codocs [[VS Code:언어 서버 연결]]#L39-L44 */
export class DiagnosticStatus {
  readonly #folder: vscode.WorkspaceFolder;
  readonly #item: vscode.StatusBarItem;
  #failures: DiagnosticFailure[] = [];
  #observed = false;

  /** workspace별 상태 표시줄을 만들고 상세 명령에 소유 URI를 전달한다. */
  constructor(folder: vscode.WorkspaceFolder) {
    this.#folder = folder;
    this.#item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
    );
    this.#item.name = `Codocs 진단 (${folder.name})`;
    this.#item.command = {
      command: diagnosticStatusCommand,
      title: '진단 재검사 상태',
      arguments: [folder.uri.toString()],
    };
  }

  /** 알림은 자기 workspace에 적용하며 성공 시 그 항목만 숨긴다.
   * @codocs [[VS Code:언어 서버 연결]]#L41-L43 */
  update(input: unknown): void {
    const failures = readDiagnosticFailures(input, this.#folder.uri.toString());
    if (failures === undefined) return;
    this.#observed = true;
    this.#failures = failures;
    if (!failures.length) {
      this.#item.hide();
      return;
    }
    this.#item.text = `$(warning) Codocs: ${this.#folder.name} 재검사 실패`;
    this.#item.tooltip =
      '현재 상태를 확인하지 못했습니다. 선택하여 파일·사유·과거 결과를 확인하세요.';
    this.#item.show();
  }

  /** 상세 명령과 실제 Host 검사가 같은 표시 관측을 읽는다. */
  details(): {
    workspaceUri: string;
    text: string;
    statusText: string;
    failures: readonly DiagnosticFailure[];
  } {
    const lines = this.#failures.length
      ? this.#failures.flatMap(
          /** 작업 공간에 속한 실패 관측을 사용자 안내로 변환한다. */ (
            failure,
          ) => [
            `파일: ${failure.uri ?? '(작업 공간 전체)'}`,
            `사유: ${failure.reason}`,
            '현재 상태를 확인하지 못했습니다.',
            ...(failure.previousDiagnostics.length
              ? ['과거 관측 결과:', ...failure.previousDiagnostics]
              : ['과거 진단 결과 없음']),
          ],
        )
      : [
          this.#observed
            ? '최신 진단 재검사 성공'
            : '현재 진단 관측을 기다리고 있습니다.',
        ];
    return {
      workspaceUri: this.#folder.uri.toString(),
      text: [`작업 공간: ${this.#folder.name}`, ...lines].join('\n'),
      statusText: this.#failures.length ? this.#item.text : '',
      failures: this.#failures,
    };
  }

  /** 서버 세션 종료 시 재검사 표시를 지워 다른 세션과 섞이지 않게 한다. */
  clear(): void {
    this.#failures = [];
    this.#observed = false;
    this.#item.hide();
  }

  /** workspace가 닫히면 상태 항목을 해제한다. */
  dispose(): void {
    this.#item.dispose();
  }
}
