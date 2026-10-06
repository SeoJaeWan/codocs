import {
  diagnosticSeverities,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  scanStatuses,
} from '@codocs/core';
import {
  workspaceLifecycleStates,
  type WorkspaceReadiness,
  type WorkspaceGetResponse,
  type WorkspaceListInput,
  type WorkspaceListResult,
  type WorkspaceListSuccess,
  type WorkspaceQueryFailure,
  type WorkspaceQuerySession,
  type WorkspaceRefreshResult,
  type WorkspaceRenamePreviewResult,
  type WorkspaceRenameResult,
  type WorkspaceValidationResult,
  type WorkspaceWriteResult,
} from '@codocs/workspace';
import {
  acceptsToolInput,
  parseGetInput,
  parseListInput,
  parseRenameInput,
  parseValidateInput,
  parseWriteInput,
} from '../tool-input/index.js';

/** MCP 호출자가 조회와 변경 요청의 허용 상태를 판단하는 값이다. */
export interface CodocsAccessState extends WorkspaceReadiness {
  scanStatus: WorkspaceQuerySession['scanStatus'];
  canRead: boolean;
  canWrite: boolean;
  canValidate: boolean;
  canGuide: true;
  canRefresh: true;
}

/** codocs_list가 허용하는 전송 독립 입력이다. */
export type CodocsListInput = WorkspaceListInput;

/** codocs_get이 허용하는 전송 독립 입력이다. */
export interface CodocsGetInput {
  addresses: readonly string[];
}

/** 미확인 목록 항목에는 현재 상태를 확정하지 않는 진단을 함께 제공한다. */
export type CodocsListItem = WorkspaceListSuccess['items'][number];

/** codocs_list의 공통 success 응답이다. */
export type CodocsListResponse = WorkspaceListResult;

/** codocs_get의 공통 success 응답이다. */
export type CodocsGetResponse = WorkspaceGetResponse;

/** codocs_validate의 공통 결과이며 문서 오류 진단도 요청 성공이다.
 * */
export type CodocsValidationResponse = WorkspaceValidationResult;

/** codocs_write의 저장 여부와 색인 게시 여부를 구분하는 공통 결과다.
 * */
export type CodocsWriteResponse = WorkspaceWriteResult;

/** codocs_rename의 mode별 결과다. preview는 계산 결과, apply는 저장 결과를 돌려준다. */
export type CodocsRenameResponse =
  WorkspaceRenamePreviewResult | WorkspaceRenameResult;

/** SDK 등록과 독립적으로 직접 호출할 수 있는 조회 handler 모음이다.
 * */
export interface CodocsQueryHandlers {
  readonly access: CodocsAccessState;
  codocsList(input?: unknown): Promise<CodocsListResponse>;
  codocsGet(input: unknown): Promise<CodocsGetResponse>;
  codocsValidate(input?: unknown): Promise<CodocsValidationResponse>;
  codocsRefresh(input?: unknown): Promise<WorkspaceRefreshResult>;
  codocsWrite(input: unknown): Promise<CodocsWriteResponse>;
  codocsRename(input: unknown): Promise<CodocsRenameResponse>;
  refresh(input?: unknown): Promise<WorkspaceRefreshResult>;
}

/** scan을 시작하지 못한 입력 오류를 고정 공통 진단으로 반환한다. */
function invalidInput(): WorkspaceQueryFailure {
  return {
    success: false,
    scanStatus: scanStatuses.failed,
    error: {
      code: queryDiagnosticCodes.invalidInput,
      severity: diagnosticSeverities.error,
      message: queryDiagnosticMessages.invalidInput,
    },
  };
}

/** apply 요청을 시작하지 못한 실패를 파일 변경 없음으로 반환한다. */
function renameApplyFailure(
  error: WorkspaceQueryFailure['error'],
): WorkspaceRenameResult {
  return {
    success: false,
    saved: false,
    changed: false,
    files: [],
    error,
    diagnostics: [error],
  };
}

/** 현재 세션의 상태만 읽으며 별도 스캔이나 snapshot을 만들지 않는다. */
function accessState(session: WorkspaceQuerySession): CodocsAccessState {
  const readiness = session.readiness;
  const scanStatus = session.scanStatus;
  const canRead =
    (readiness.state === workspaceLifecycleStates.ready &&
      (scanStatus === scanStatuses.complete ||
        scanStatus === scanStatuses.partial)) ||
    (readiness.state === workspaceLifecycleStates.failed &&
      session.limitedReadAvailable);
  const canChange =
    readiness.state === workspaceLifecycleStates.ready &&
    scanStatus === scanStatuses.complete;
  return {
    ...readiness,
    scanStatus,
    canRead,
    canWrite: canChange,
    canValidate: canChange,
    canGuide: true,
    canRefresh: true,
  };
}

/** 한 workspace 세션을 codocs_list/codocs_get 직접 handler로 감싼다.
 * @param session 서버 또는 호출자가 소유하며 종료하는 프로젝트 세션이다.
 */
export function createCodocsQueryHandlers(
  session: WorkspaceQuerySession,
): CodocsQueryHandlers {
  let activeRefresh: Promise<WorkspaceRefreshResult> | undefined;
  /** 동시 전송 호출을 같은 workspace refresh 결과에 연결한다. */
  function refresh(input?: unknown): Promise<WorkspaceRefreshResult> {
    if (
      !acceptsToolInput('codocs_refresh', arguments.length === 0 ? {} : input)
    )
      return Promise.resolve(invalidInput());
    if (activeRefresh) return activeRefresh;
    const operation = session.refresh();
    activeRefresh = operation;
    /** 완료된 작업에 한해 다음 수동 refresh를 허용한다. */
    const clear = (): void => {
      if (activeRefresh === operation) activeRefresh = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }
  return {
    /** 현재 workspace 준비 상태에서 도구별 접근 가능 여부를 계산한다. */
    get access(): CodocsAccessState {
      return accessState(session);
    },
    /** 유효한 목록 입력만 workspace scan과 조회로 전달한다.
     * */
    async codocsList(input?: unknown): Promise<CodocsListResponse> {
      const parsed = parseListInput(arguments.length === 0 ? {} : input);
      if (!parsed) return invalidInput();
      return session.list(parsed);
    },
    /** 유효한 상세 입력 전체만 workspace scan과 조회로 전달한다.
     * */
    async codocsGet(input: unknown): Promise<CodocsGetResponse> {
      const parsed = parseGetInput(input);
      if (!parsed) return invalidInput();
      return session.get(parsed.addresses);
    },
    /** 같은 세션의 완료 색인과 경로 검사로 검증 범위를 결정한다.
     * */
    async codocsValidate(input?: unknown): Promise<CodocsValidationResponse> {
      const parsed = parseValidateInput(arguments.length === 0 ? {} : input);
      if (!parsed) return invalidInput();
      return session.validate(parsed.path);
    },
    /** 같은 세션의 명시 refresh로 색인을 다시 구성한다. */
    codocsRefresh: refresh,
    /** 형식 오류만 여기서 거부하고 문서 진단은 workspace 변경 계획에서 보존한다.
     * */
    async codocsWrite(input: unknown): Promise<CodocsWriteResponse> {
      const parsed = parseWriteInput(input);
      if (!parsed) {
        const error = invalidInput().error;
        return {
          success: false,
          saved: false,
          changed: false,
          error,
          diagnostics: [error],
        };
      }
      return session.write(parsed);
    },
    /** 현재 ID를 파일 경로로 바꾼 뒤 preview 또는 apply를 workspace에 전달한다. 결과는 가공하지 않는다.
     * */
    async codocsRename(input: unknown): Promise<CodocsRenameResponse> {
      const parsed = parseRenameInput(input);
      if (!parsed) {
        const failure = invalidInput();
        return (input as { mode?: unknown } | null)?.mode === 'apply'
          ? renameApplyFailure(failure.error)
          : failure;
      }
      const { id, mode, ...request } = parsed;
      const apply = mode === 'apply';
      const found = await session.resolveIdPath(id);
      if (!found.success || found.path === undefined) {
        const failure: WorkspaceQueryFailure = found.success
          ? {
              success: false,
              scanStatus: found.scanStatus,
              error: {
                code: queryDiagnosticCodes.notFound,
                severity: diagnosticSeverities.error,
                message: queryDiagnosticMessages.notFound,
              },
            }
          : found;
        return apply ? renameApplyFailure(failure.error) : failure;
      }
      const target = { ...request, targetPath: found.path };
      return apply
        ? session.applyRename(target)
        : session.previewRename(target);
    },
    /** 직접 호출자를 위한 codocsRefresh 별칭이다. */
    refresh,
  };
}
