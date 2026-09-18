import {
  catalogConfirmations,
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  diagnosticSeverities,
  isDocumentKind,
  isDocumentStatus,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  scanStatuses,
  type CatalogListItem,
  type CatalogQueryDiagnostic,
} from '@codocs/core';
import {
  createWorkspaceQuerySession,
  workspaceDiagnosticCodes,
  workspaceLifecycleStates,
  type WorkspaceReadiness,
  type WorkspaceGetResponse,
  type WorkspaceListInput,
  type WorkspaceListResult,
  type WorkspaceListSuccess,
  type WorkspaceQueryFailure,
  type WorkspaceQuerySession,
  type WorkspaceRefreshResult,
} from '@codocs/workspace';

const listKeys = new Set(['cursor', 'domain', 'kind', 'status']);
const getKeys = new Set(['ids']);
const refreshKeys = new Set<string>();

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
  ids: readonly string[];
}

/** 미확인 목록 항목에는 현재 상태를 확정하지 않는 진단을 함께 제공한다. */
export type CodocsListItem = CatalogListItem & {
  diagnostics?: readonly CatalogQueryDiagnostic[];
};

/** codocs_list의 공통 success 응답이다. */
export type CodocsListResponse =
  | (Omit<WorkspaceListSuccess, 'items'> & {
      items: readonly CodocsListItem[];
    })
  | WorkspaceQueryFailure;

/** codocs_get의 공통 success 응답이다. */
export type CodocsGetResponse = WorkspaceGetResponse;

/** SDK 등록과 독립적으로 직접 호출할 수 있는 조회 handler 모음이다. */
export interface CodocsQueryHandlers {
  readonly access: CodocsAccessState;
  codocsList(input?: unknown): Promise<CodocsListResponse>;
  codocsGet(input: unknown): Promise<CodocsGetResponse>;
  codocsRefresh(input?: unknown): Promise<WorkspaceRefreshResult>;
  refresh(input?: unknown): Promise<WorkspaceRefreshResult>;
}

/** 객체의 own data property 목록을 getter 실행 없이 검증한다. */
function dataProperties(
  input: unknown,
  allowed: ReadonlySet<string>,
): ReadonlyMap<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  try {
    if (Array.isArray(input)) return undefined;
    const properties = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !allowed.has(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor)) return undefined;
      properties.set(key, descriptor.value as unknown);
    }
    return properties;
  } catch {
    return undefined;
  }
}

/** 문자열 배열을 희소 값·접근자·추가 속성 없이 복사한다. */
function stringArray(input: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(input)) return undefined;
    const length = Object.getOwnPropertyDescriptor(input, 'length');
    if (!length || !('value' in length) || !Number.isSafeInteger(length.value))
      return undefined;
    const values: string[] = [];
    const keys = Reflect.ownKeys(input);
    if (keys.length !== (length.value as number) + 1) return undefined;
    for (let index = 0; index < (length.value as number); index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        !descriptor?.enumerable ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string' ||
        descriptor.value.length === 0
      )
        return undefined;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return undefined;
  }
}

/** 목록 unknown 입력을 허용 속성과 열거 값만 가진 값으로 좁힌다. */
function listInput(input: unknown): CodocsListInput | undefined {
  const properties = dataProperties(input, listKeys);
  if (!properties) return undefined;
  const cursor = properties.get('cursor');
  const domain = properties.get('domain');
  const kind = properties.get('kind');
  const status = properties.get('status');
  if (
    (properties.has('cursor') && typeof cursor !== 'string') ||
    (properties.has('domain') && typeof domain !== 'string') ||
    (properties.has('kind') && !isDocumentKind(kind)) ||
    (properties.has('status') && !isDocumentStatus(status))
  )
    return undefined;
  return {
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(typeof domain === 'string' ? { domain } : {}),
    ...(isDocumentKind(kind) ? { kind } : {}),
    ...(isDocumentStatus(status) ? { status } : {}),
  };
}

/** 상세 unknown 입력을 중복 제거한 1~20개 문자열 ID로 좁힌다. */
function getInput(input: unknown): CodocsGetInput | undefined {
  const properties = dataProperties(input, getKeys);
  if (!properties || !properties.has('ids')) return undefined;
  const ids = stringArray(properties.get('ids'));
  if (!ids) return undefined;
  const unique = [...new Set(ids)];
  return unique.length >= 1 && unique.length <= 20
    ? { ids: unique }
    : undefined;
}

/** scan을 시작하지 못한 입력 오류를 고정 공통 진단으로 반환한다. */
function invalidInput(): CodocsListResponse & CodocsGetResponse {
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

/** 전체 재구성 중에는 마지막 색인을 최신 조회로 노출하지 않는다. */
function rebuilding(): CodocsListResponse & CodocsGetResponse {
  return {
    success: false,
    scanStatus: scanStatuses.failed,
    error: {
      code: workspaceDiagnosticCodes.readFailed,
      severity: diagnosticSeverities.error,
      message: '색인을 구성하는 중입니다. 완료 후 다시 조회하세요.',
    },
  };
}

/** 현재 세션의 상태만 읽으며 별도 스캔이나 snapshot을 만들지 않는다. */
function accessState(session: WorkspaceQuerySession): CodocsAccessState {
  const readiness = session.readiness;
  const scanStatus = session.scanStatus;
  const canRead =
    readiness.state === workspaceLifecycleStates.ready &&
    (scanStatus === scanStatuses.complete ||
      scanStatus === scanStatuses.partial);
  const canChange = canRead && scanStatus === scanStatuses.complete;
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

/** partial 목록의 이전 문서에 존재·최신성 미확인 진단을 붙인다. */
function confirmList(result: WorkspaceListResult): CodocsListResponse {
  if (!result.success || result.scanStatus !== scanStatuses.partial)
    return result;
  return {
    ...result,
    items: result.items.map(
      /** 이번 탐색에서 확인하지 못한 항목만 진단을 확장한다. */
      (item): CodocsListItem => {
        if (
          item.conflict ||
          item.confirmation !== catalogConfirmations.unconfirmed
        )
          return item;
        return {
          ...item,
          diagnostics: [
            {
              code: catalogDiagnosticCodes.unconfirmedReference,
              severity: diagnosticSeverities.warning,
              message: catalogDiagnosticMessages.unconfirmedReference,
              path: item.source.path,
            },
          ],
        };
      },
    ),
  };
}

/** 한 workspace 세션을 codocs_list/codocs_get 직접 handler로 감싼다.
 * @param workspaceInput 프로젝트 선택용 workspace 입력이다.
 */
export function createCodocsQueryHandlers(
  workspaceInput: unknown = {},
): CodocsQueryHandlers {
  const session: WorkspaceQuerySession =
    createWorkspaceQuerySession(workspaceInput);
  let activeRefresh: Promise<WorkspaceRefreshResult> | undefined;
  /** 동시 전송 호출을 같은 workspace refresh 결과에 연결한다. */
  const refresh = (input: unknown = {}): Promise<WorkspaceRefreshResult> => {
    if (!dataProperties(input, refreshKeys))
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
  };
  return {
    /** 현재 workspace 준비 상태에서 도구별 접근 가능 여부를 계산한다. */
    get access(): CodocsAccessState {
      return accessState(session);
    },
    /** 유효한 목록 입력만 workspace scan과 조회로 전달한다. */
    async codocsList(input: unknown = {}): Promise<CodocsListResponse> {
      const parsed = listInput(input);
      if (!parsed) return invalidInput();
      if (
        session.readiness.state === workspaceLifecycleStates.refreshing ||
        session.readiness.state === workspaceLifecycleStates.recovering
      )
        return rebuilding();
      return confirmList(await session.list(parsed));
    },
    /** 유효한 상세 입력 전체만 workspace scan과 조회로 전달한다. */
    async codocsGet(input: unknown): Promise<CodocsGetResponse> {
      const parsed = getInput(input);
      if (!parsed) return invalidInput();
      if (
        session.readiness.state === workspaceLifecycleStates.refreshing ||
        session.readiness.state === workspaceLifecycleStates.recovering
      )
        return rebuilding();
      return session.get(parsed.ids);
    },
    /** 같은 세션의 명시 refresh로 기존 목록 cursor를 만료한다. */
    codocsRefresh: refresh,
    /** 직접 호출자를 위한 codocsRefresh 별칭이다. */
    refresh,
  };
}
