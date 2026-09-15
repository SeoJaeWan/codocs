import { queryDiagnosticCodes, queryDiagnosticMessages } from '@codosc/core';
import {
  createWorkspaceQuerySession,
  type WorkspaceGetResponse,
  type WorkspaceListInput,
  type WorkspaceListResult,
  type WorkspaceQuerySession,
  type WorkspaceRefreshResult,
} from '@codosc/workspace';

const listKeys = new Set(['cursor', 'domain', 'kind', 'status']);
const getKeys = new Set(['ids']);

/** codocs_list가 허용하는 전송 독립 입력이다. */
export type CodocsListInput = WorkspaceListInput;

/** codocs_get이 허용하는 전송 독립 입력이다. */
export interface CodocsGetInput {
  ids: readonly string[];
}

/** codocs_list의 공통 success 응답이다. */
export type CodocsListResponse = WorkspaceListResult;

/** codocs_get의 공통 success 응답이다. */
export type CodocsGetResponse = WorkspaceGetResponse;

/** SDK 등록과 독립적으로 직접 호출할 수 있는 조회 handler 모음이다. */
export interface CodocsQueryHandlers {
  codocsList(input?: unknown): Promise<CodocsListResponse>;
  codocsGet(input: unknown): Promise<CodocsGetResponse>;
  refresh(): Promise<WorkspaceRefreshResult>;
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
    (properties.has('kind') &&
      kind !== 'policy' &&
      kind !== 'procedure' &&
      kind !== 'decision' &&
      kind !== 'discussion') ||
    (properties.has('status') &&
      status !== 'proposed' &&
      status !== 'confirmed' &&
      status !== 'deprecated')
  )
    return undefined;
  return {
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(typeof domain === 'string' ? { domain } : {}),
    ...(kind === 'policy' ||
    kind === 'procedure' ||
    kind === 'decision' ||
    kind === 'discussion'
      ? { kind }
      : {}),
    ...(status === 'proposed' ||
    status === 'confirmed' ||
    status === 'deprecated'
      ? { status }
      : {}),
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
    scanStatus: 'failed',
    error: {
      code: queryDiagnosticCodes.invalidInput,
      severity: 'error',
      message: queryDiagnosticMessages.invalidInput,
    },
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
  return {
    /** 유효한 목록 입력만 workspace scan과 조회로 전달한다. */
    async codocsList(input: unknown = {}): Promise<CodocsListResponse> {
      const parsed = listInput(input);
      return parsed ? session.list(parsed) : invalidInput();
    },
    /** 유효한 상세 입력 전체만 workspace scan과 조회로 전달한다. */
    async codocsGet(input: unknown): Promise<CodocsGetResponse> {
      const parsed = getInput(input);
      return parsed ? session.get(parsed.ids) : invalidInput();
    },
    /** 같은 세션의 명시 refresh로 기존 목록 cursor를 만료한다. */
    async refresh(): Promise<WorkspaceRefreshResult> {
      return session.refresh();
    },
  };
}
