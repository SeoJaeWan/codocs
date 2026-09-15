import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  projectCatalogGet,
  projectCatalogList,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  type Catalog,
  type CatalogGetResult,
  type CatalogListFilters,
  type CatalogListItem,
  type CatalogQueryDiagnostic,
  type Diagnostic,
} from '@codocs/core';
import {
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
} from '../diagnostics/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import {
  loadWorkspace,
  type WorkspaceScanDiagnostic,
  type WorkspaceScanResult,
} from '../loader/index.js';

const pageSize = 50;
const cursorVersion = 1;
const processCursorSecret = randomBytes(32);

/** 목록 커서가 현재 process 또는 snapshot에서 더 이상 유효하지 않을 때 사용하는 코드다. */
export const workspaceQueryDiagnosticCodes = {
  cursorExpired: 'cursor_expired',
} as const;

/** 커서 오류의 고정 문구다. */
export const workspaceQueryDiagnosticMessages = {
  cursorExpired:
    '목록 커서가 만료되었습니다. 커서 없이 첫 페이지를 다시 조회하세요.',
} as const;

/** 조회에서 core·workspace와 커서 계층이 반환할 수 있는 공통 진단이다. */
export type WorkspaceQueryDiagnostic =
  | CatalogQueryDiagnostic
  | WorkspaceScanDiagnostic
  | Diagnostic<(typeof workspaceQueryDiagnosticCodes)['cursorExpired']>;

/** 목록 입력은 고정 페이지와 선택 필터 또는 이전 페이지 커서만 제공한다. */
export interface WorkspaceListInput extends CatalogListFilters {
  cursor?: string;
}

/** 성공한 목록은 현재 scan 상태와 고정 페이지 계수를 함께 반환한다. */
export interface WorkspaceListSuccess {
  success: true;
  scanStatus: 'complete' | 'partial';
  items: readonly CatalogListItem[];
  totalCount: number;
  returnedCount: number;
  nextCursor: string | null;
}

/** 부분 scan에서 색인 밖 ID는 부재로 확정하지 않는다. */
export interface WorkspaceGetUnconfirmedResult {
  id: string;
  found: false;
  confirmation: 'unconfirmed';
  diagnostics: readonly WorkspaceQueryDiagnostic[];
}

/** workspace 확실성을 반영한 ID별 상세 결과다. */
export type WorkspaceGetResult =
  CatalogGetResult | WorkspaceGetUnconfirmedResult;

/** 성공한 상세 조회는 모든 ID별 결과를 입력 순서로 유지한다. */
export interface WorkspaceGetSuccess {
  success: true;
  scanStatus: 'complete' | 'partial';
  results: readonly WorkspaceGetResult[];
}

/** scan 또는 요청 조건 때문에 전체 요청을 수행하지 못한 결과다. */
export interface WorkspaceQueryFailure {
  success: false;
  scanStatus: WorkspaceScanResult['status'];
  error: WorkspaceQueryDiagnostic;
}

/** 목록 조회 결과다. */
export type WorkspaceListResult = WorkspaceListSuccess | WorkspaceQueryFailure;

/** 상세 조회 결과다. */
export type WorkspaceGetResponse = WorkspaceGetSuccess | WorkspaceQueryFailure;

/** 명시 refresh의 scan 결과다. */
export type WorkspaceRefreshResult =
  { success: true; scanStatus: 'complete' | 'partial' } | WorkspaceQueryFailure;

interface CursorPayload {
  version: typeof cursorVersion;
  filters: CatalogListFilters;
  position: number;
  fingerprint: string;
  generation: number;
}

/** 객체의 own data property만 읽고 getter나 prototype 값을 실행하지 않는다. */
function ownValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor
    ? (descriptor.value as unknown)
    : undefined;
}

/** own data property가 실제로 제공됐는지 확인한다. */
function hasOwnData(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor;
}

/** 공개 unknown 입력에서 own data path 선택값만 복사한다. */
function sessionInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return input;
  try {
    const cwd = Object.getOwnPropertyDescriptor(input, 'cwd');
    const project = Object.getOwnPropertyDescriptor(input, 'project');
    if ((cwd && !('value' in cwd)) || (project && !('value' in project)))
      return null;
    return {
      ...(cwd && 'value' in cwd ? { cwd: cwd.value as unknown } : {}),
      ...(project && 'value' in project
        ? { project: project.value as unknown }
        : {}),
    };
  } catch {
    return null;
  }
}

/** 생략 속성을 제외한 고정 순서 필터를 만든다. */
function normalizeFilters(input: CatalogListFilters): CatalogListFilters {
  return {
    ...(input.domain === undefined ? {} : { domain: input.domain }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
}

/** 커서와 함께 필터가 하나라도 명시되었는지 판별한다. */
function hasSuppliedFilters(input: WorkspaceListInput): boolean {
  return ['domain', 'kind', 'status'].some((key) => hasOwnData(input, key));
}

/** 목록에 보이는 모든 값만 canonical snapshot으로 해시한다. */
function fingerprint(items: readonly CatalogListItem[]): string {
  return createHash('sha256')
    .update(JSON.stringify(items), 'utf8')
    .digest('hex');
}

/** HMAC 입력과 payload를 분리할 수 있는 URL-safe 토큰으로 만든다. */
function encodeCursor(payload: CursorPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', processCursorSecret)
    .update(encoded, 'utf8')
    .digest('base64url');
  return `${encoded}.${signature}`;
}

/** JSON payload를 own data property 확인 뒤 계약 타입으로 좁힌다. */
function cursorPayload(value: unknown): CursorPayload | undefined {
  const version = ownValue(value, 'version');
  const filters = ownValue(value, 'filters');
  const position = ownValue(value, 'position');
  const listFingerprint = ownValue(value, 'fingerprint');
  const generation = ownValue(value, 'generation');
  const domain = ownValue(filters, 'domain');
  const kind = ownValue(filters, 'kind');
  const status = ownValue(filters, 'status');
  if (
    version !== cursorVersion ||
    !Number.isSafeInteger(position) ||
    (position as number) < 0 ||
    typeof listFingerprint !== 'string' ||
    !Number.isSafeInteger(generation) ||
    (generation as number) < 0 ||
    (domain !== undefined && typeof domain !== 'string') ||
    (kind !== undefined &&
      kind !== 'policy' &&
      kind !== 'procedure' &&
      kind !== 'decision' &&
      kind !== 'discussion') ||
    (status !== undefined &&
      status !== 'proposed' &&
      status !== 'confirmed' &&
      status !== 'deprecated')
  )
    return undefined;
  return {
    version,
    filters: normalizeFilters({
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
    }),
    position: position as number,
    fingerprint: listFingerprint,
    generation: generation as number,
  };
}

/** 서명과 payload 구조를 검증하며 실패 이유를 외부에 구분해 노출하지 않는다. */
function decodeCursor(token: string): CursorPayload | undefined {
  const parts = token.split('.');
  if (parts.length !== 2) return undefined;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return undefined;
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return undefined;
  }
  if (actual.toString('base64url') !== signature) return undefined;
  const expected = createHmac('sha256', processCursorSecret)
    .update(encoded, 'utf8')
    .digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return undefined;
  try {
    return cursorPayload(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    );
  } catch {
    return undefined;
  }
}

/** 커서가 만료되었음을 첫 페이지 대체 없이 반환한다. */
function cursorExpired(
  scanStatus: 'complete' | 'partial',
): WorkspaceQueryFailure {
  return {
    success: false,
    scanStatus,
    error: {
      code: workspaceQueryDiagnosticCodes.cursorExpired,
      severity: 'error',
      message: workspaceQueryDiagnosticMessages.cursorExpired,
    },
  };
}

/** cursor와 함께 제공한 조건이 원래 조건과 다를 때 입력 오류를 반환한다. */
function invalidInput(
  scanStatus: 'complete' | 'partial',
): WorkspaceQueryFailure {
  return {
    success: false,
    scanStatus,
    error: {
      code: queryDiagnosticCodes.invalidInput,
      severity: 'error',
      message: queryDiagnosticMessages.invalidInput,
    },
  };
}

/** failed scan의 확인된 첫 원인을 반환하고 원인이 비어 있어도 이전 문서는 노출하지 않는다. */
function scanFailure(scan: WorkspaceScanResult): WorkspaceQueryFailure {
  const error = scan.diagnostics[0] ?? {
    code: workspaceDiagnosticCodes.readFailed,
    severity: 'error' as const,
    message: workspaceDiagnosticMessages.readFailed,
  };
  return { success: false, scanStatus: 'failed', error };
}

/** 원문 문자열을 다시 포맷하지 않고 UTF-8 byte SHA-256으로 계산한다. */
function scanRevisions(scan: WorkspaceScanResult): Map<string, string> {
  return new Map(
    scan.documents.map((document) => [
      document.source.path,
      createHash('sha256').update(document.raw, 'utf8').digest('hex'),
    ]),
  );
}

/** 미확인 문서에 최신성 비보장 진단을 추가한다. */
function withConfirmationDiagnostic(
  result: CatalogGetResult,
): WorkspaceGetResult {
  if (!result.found || result.conflict || result.confirmation === 'confirmed')
    return result;
  return {
    ...result,
    diagnostics: [
      ...result.diagnostics,
      {
        code: catalogDiagnosticCodes.unconfirmedReference,
        severity: 'warning',
        message: catalogDiagnosticMessages.unconfirmedReference,
        path: result.source.path,
      },
    ],
  };
}

/** 실제 scan과 이전 Catalog를 직렬로 연결하는 process 범위 조회 세션이다. */
export class WorkspaceQuerySession {
  readonly #input: unknown;
  #catalog: Catalog | undefined;
  #revisions = new Map<string, string>();
  #generation = 0;
  #queue: Promise<void> = Promise.resolve();

  /** 프로젝트 선택의 own data 값만 고정하고 IO는 각 요청 시 수행한다. */
  constructor(input: unknown = {}) {
    this.#input = sessionInput(input);
  }

  /** scan을 늦은 완료 순서와 무관하게 직렬 적용한다. */
  async #synchronize(invalidateCursors: boolean): Promise<WorkspaceScanResult> {
    let resolved!: WorkspaceScanResult;
    const operation = this.#queue.then(
      /** 앞 요청이 끝난 뒤 한 scan의 상태를 원자적으로 교체한다. */ async () => {
        const scan = await loadWorkspace(this.#input);
        const next = buildWorkspaceCatalog(scan, this.#catalog);
        if (scan.status === 'complete') this.#revisions = scanRevisions(scan);
        else if (scan.status === 'partial') {
          const revisions = new Map(this.#revisions);
          for (const [path, revision] of scanRevisions(scan))
            revisions.set(path, revision);
          this.#revisions = revisions;
        }
        this.#catalog = next;
        if (invalidateCursors) this.#generation++;
        resolved = scan;
      },
    );
    this.#queue = operation.catch(() => undefined);
    await operation;
    return resolved;
  }

  /** 최신 실제 scan에서 필터 snapshot을 50개씩 반환한다. */
  async list(input: WorkspaceListInput = {}): Promise<WorkspaceListResult> {
    const scan = await this.#synchronize(false);
    if (scan.status === 'failed') return scanFailure(scan);
    const catalog = this.#catalog;
    if (!catalog) return scanFailure(scan);

    const decoded =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    if (input.cursor !== undefined && !decoded)
      return cursorExpired(scan.status);
    const supplied = normalizeFilters(input);
    if (
      decoded &&
      hasSuppliedFilters(input) &&
      JSON.stringify(supplied) !== JSON.stringify(decoded.filters)
    )
      return invalidInput(scan.status);
    const filters = decoded?.filters ?? supplied;
    const projection = projectCatalogList(catalog, filters);
    const currentFingerprint = fingerprint(projection.items);
    if (
      decoded &&
      (decoded.generation !== this.#generation ||
        decoded.fingerprint !== currentFingerprint ||
        decoded.position > projection.totalCount)
    )
      return cursorExpired(scan.status);
    const position = decoded?.position ?? 0;
    const items = projection.items.slice(position, position + pageSize);
    const nextPosition = position + items.length;
    const nextCursor =
      nextPosition < projection.totalCount
        ? encodeCursor({
            version: cursorVersion,
            filters,
            position: nextPosition,
            fingerprint: currentFingerprint,
            generation: this.#generation,
          })
        : null;
    return {
      success: true,
      scanStatus: scan.status,
      items,
      totalCount: projection.totalCount,
      returnedCount: items.length,
      nextCursor,
    };
  }

  /** 최신 실제 scan에서 1~20개 ID를 독립 결과로 반환한다. */
  async get(ids: readonly string[]): Promise<WorkspaceGetResponse> {
    const scan = await this.#synchronize(false);
    if (scan.status === 'failed') return scanFailure(scan);
    const catalog = this.#catalog;
    if (!catalog) return scanFailure(scan);
    const projection = projectCatalogGet(catalog, ids, {
      revisions: this.#revisions,
    });
    if (!projection.success)
      return {
        success: false,
        scanStatus: scan.status,
        error: projection.error,
      };
    const results = projection.results.map(
      /** partial의 부재와 이전 기록을 확정 결과와 구분한다. */ (
        result,
      ): WorkspaceGetResult => {
        if (scan.status === 'partial' && !result.found)
          return {
            id: result.id,
            found: false,
            confirmation: 'unconfirmed',
            diagnostics: [
              {
                code: catalogDiagnosticCodes.unconfirmedReference,
                severity: 'warning',
                message: catalogDiagnosticMessages.unconfirmedReference,
              },
            ],
          };
        return withConfirmationDiagnostic(result);
      },
    );
    return { success: true, scanStatus: scan.status, results };
  }

  /** 명시 refresh는 결과 변화와 무관하게 기존 커서 generation을 만료한다. */
  async refresh(): Promise<WorkspaceRefreshResult> {
    const scan = await this.#synchronize(true);
    return scan.status === 'failed'
      ? scanFailure(scan)
      : { success: true, scanStatus: scan.status };
  }
}

/** 프로젝트용 조회 세션을 만든다. 첫 IO는 list/get/refresh에서 실행한다. */
export function createWorkspaceQuerySession(
  input: unknown = {},
): WorkspaceQuerySession {
  return new WorkspaceQuerySession(input);
}
