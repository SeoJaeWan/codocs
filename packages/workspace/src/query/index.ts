/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- refresh 내부 콜백은 공개 선언 함수가 아니다. */
import {
  catalogConfirmations,
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  diagnosticSeverities,
  isDocumentKind,
  isDocumentStatus,
  projectCatalogGet,
  projectCatalogList,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  scanStatuses,
  type Catalog,
  type CatalogGetResult,
  type CatalogListFilters,
  type CatalogListItem,
  type CatalogQueryDiagnostic,
  type Diagnostic,
  type ScanStatus,
} from '@codocs/core';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
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
import {
  createWorkspaceWatcher,
  type WorkspaceWatcher,
} from '../watcher/index.js';
import {
  workspaceLifecycleStates,
  type WorkspaceReadiness,
} from '../lifecycle/index.js';

const pageSize = 50;
const cursorVersion = 1;
const processCursorSecret = randomBytes(32);

/** 목록 커서가 현재 process 또는 snapshot에서 더 이상 유효하지 않을 때 사용하는 코드다. @domainValues */
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
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
  items: readonly CatalogListItem[];
  totalCount: number;
  returnedCount: number;
  nextCursor: string | null;
}

/** 부분 scan에서 색인 밖 ID는 부재로 확정하지 않는다. */
export interface WorkspaceGetUnconfirmedResult {
  id: string;
  found: false;
  confirmation: typeof catalogConfirmations.unconfirmed;
  diagnostics: readonly WorkspaceQueryDiagnostic[];
}

/** workspace 확실성을 반영한 ID별 상세 결과다. */
export type WorkspaceGetResult =
  CatalogGetResult | WorkspaceGetUnconfirmedResult;

/** 성공한 상세 조회는 모든 ID별 결과를 입력 순서로 유지한다. */
export interface WorkspaceGetSuccess {
  success: true;
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
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
  | {
      success: true;
      scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
    }
  | WorkspaceQueryFailure;

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
    (kind !== undefined && !isDocumentKind(kind)) ||
    (status !== undefined && !isDocumentStatus(status))
  )
    return undefined;
  return {
    version,
    filters: normalizeFilters({
      ...(typeof domain === 'string' ? { domain } : {}),
      ...(isDocumentKind(kind) ? { kind } : {}),
      ...(isDocumentStatus(status) ? { status } : {}),
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
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>,
): WorkspaceQueryFailure {
  return {
    success: false,
    scanStatus,
    error: {
      code: workspaceQueryDiagnosticCodes.cursorExpired,
      severity: diagnosticSeverities.error,
      message: workspaceQueryDiagnosticMessages.cursorExpired,
    },
  };
}

/** cursor와 함께 제공한 조건이 원래 조건과 다를 때 입력 오류를 반환한다. */
function invalidInput(
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>,
): WorkspaceQueryFailure {
  return {
    success: false,
    scanStatus,
    error: {
      code: queryDiagnosticCodes.invalidInput,
      severity: diagnosticSeverities.error,
      message: queryDiagnosticMessages.invalidInput,
    },
  };
}

/** failed scan의 확인된 첫 원인을 반환하고 원인이 비어 있어도 이전 문서는 노출하지 않는다. */
function scanFailure(scan: WorkspaceScanResult): WorkspaceQueryFailure {
  const error = scan.diagnostics[0] ?? {
    code: workspaceDiagnosticCodes.readFailed,
    severity: diagnosticSeverities.error,
    message: workspaceDiagnosticMessages.readFailed,
  };
  return { success: false, scanStatus: scanStatuses.failed, error };
}

/** 같은 읽기에서 로더가 원본 바이트로 계산한 revision을 전달한다. */
function scanRevisions(scan: WorkspaceScanResult): Map<string, string> {
  return new Map(
    scan.documents.map((document) => [document.source.path, document.revision]),
  );
}

/** 미확인 문서에 최신성 비보장 진단을 추가한다. */
function withConfirmationDiagnostic(
  result: CatalogGetResult,
): WorkspaceGetResult {
  if (
    !result.found ||
    result.conflict ||
    result.confirmation === catalogConfirmations.confirmed
  )
    return result;
  return {
    ...result,
    diagnostics: [
      ...result.diagnostics,
      {
        code: catalogDiagnosticCodes.unconfirmedReference,
        severity: diagnosticSeverities.warning,
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
  #scan: WorkspaceScanResult | undefined;
  #revisions = new Map<string, string>();
  #generation = 0;
  #refreshPromise: Promise<WorkspaceScanResult> | undefined;
  #explicitRefreshPromise: Promise<WorkspaceRefreshResult> | undefined;
  #watcher: WorkspaceWatcher | undefined;
  #dirty = false;
  #closed = false;

  /** 프로젝트 선택의 own data 값만 고정하고 IO는 각 요청 시 수행한다. */
  constructor(input: unknown = {}) {
    this.#input = sessionInput(input);
  }

  /** 하나의 스캔에서 문서·참조·진단·revision을 함께 게시한다. */
  async #scanOnce(): Promise<WorkspaceScanResult> {
    const scan = await loadWorkspace(this.#input);
    const next =
      scan.status === scanStatuses.failed
        ? undefined
        : buildWorkspaceCatalog(scan, this.#catalog);
    const revisions =
      scan.status === scanStatuses.complete
        ? new Map<string, string>()
        : new Map(this.#revisions);
    if (scan.status !== scanStatuses.failed)
      for (const [sourcePath, revision] of scanRevisions(scan))
        revisions.set(sourcePath, revision);
    if (scan.root && !this.#watcher && !this.#closed) {
      const watcher = await createWorkspaceWatcher(scan.root.projectRoot);
      this.#watcher = watcher;
      watcher.subscribe(() => {
        if (this.#refreshPromise) this.#dirty = true;
        else void this.#synchronize().catch(() => undefined);
      });
    }
    await this.#watcher?.trackTargets(
      scan.documents.map((document) => document.source.realPath),
    );
    if (scan.status !== scanStatuses.failed) {
      this.#catalog = next;
      this.#revisions = revisions;
      this.#generation++;
    }
    this.#scan = scan;
    return scan;
  }

  /** 병행 호출은 하나의 작업을 공유하고 스캔 도중 온 알림도 반영한다. */
  #synchronize(): Promise<WorkspaceScanResult> {
    if (this.#refreshPromise) return this.#refreshPromise;
    /** 변경 알림을 스캔 완료 시점까지 다시 반영한다. */
    const operation = (async (): Promise<WorkspaceScanResult> => {
      let scan: WorkspaceScanResult;
      do {
        this.#dirty = false;
        try {
          scan = await this.#scanOnce();
        } catch (error: unknown) {
          scan = {
            status: scanStatuses.failed,
            documents: [],
            failures: [],
            skippedCycles: [],
            diagnostics: [
              {
                code: workspaceDiagnosticCodes.readFailed,
                severity: diagnosticSeverities.error,
                message:
                  error instanceof Error
                    ? error.message
                    : workspaceDiagnosticMessages.readFailed,
              },
            ],
          };
          this.#scan = scan;
        }
      } while (this.#dirty && !this.#closed);
      return scan;
    })();
    this.#refreshPromise = operation;
    const clear = (): void => {
      if (this.#refreshPromise === operation) this.#refreshPromise = undefined;
    };
    void operation.then(clear, clear).catch(() => undefined);
    return operation;
  }

  /** 최초 조회만 스캔 완료를 기다리고 이후에는 보유한 단일 snapshot을 읽는다. */
  async #current(): Promise<WorkspaceScanResult> {
    if (!this.#scan) return this.#synchronize();
    return this.#scan;
  }

  /** 감시 연결 및 현재 scan의 준비 상태다. */
  get readiness(): WorkspaceReadiness {
    if (this.#closed)
      return { state: workspaceLifecycleStates.closed, ready: false };
    if (this.#watcher?.readiness.state === workspaceLifecycleStates.failed)
      return this.#watcher.readiness;
    if (this.#scan?.status === scanStatuses.failed)
      return {
        state: workspaceLifecycleStates.failed,
        ready: false,
        ...(this.#scan.diagnostics[0]?.message
          ? { cause: this.#scan.diagnostics[0].message }
          : {}),
      };
    if (this.#refreshPromise)
      return { state: workspaceLifecycleStates.refreshing, ready: false };
    if (this.#watcher) return this.#watcher.readiness;
    return {
      state: this.#refreshPromise
        ? workspaceLifecycleStates.refreshing
        : workspaceLifecycleStates.starting,
      ready: false,
    };
  }

  /** 반영된 complete 또는 partial refresh의 세대다. */
  get generation(): number {
    return this.#generation;
  }

  /** 마지막으로 게시한 탐색 상태다. */
  get scanStatus(): ScanStatus | undefined {
    return this.#scan?.status;
  }

  /** 감시 실패를 마지막 색인의 최신 성공으로 숨기지 않는다. */
  #watchFailure(): WorkspaceQueryFailure | undefined {
    const readiness = this.#watcher?.readiness;
    if (readiness?.state !== workspaceLifecycleStates.failed) return undefined;
    return {
      success: false,
      scanStatus: scanStatuses.failed,
      error: {
        code: workspaceDiagnosticCodes.readFailed,
        severity: diagnosticSeverities.error,
        message:
          `${readiness.cause ?? workspaceDiagnosticMessages.readFailed} ${readiness.guidance ?? ''}`.trim(),
      },
    };
  }

  /** 최신 실제 scan에서 필터 snapshot을 50개씩 반환한다. */
  async list(input: WorkspaceListInput = {}): Promise<WorkspaceListResult> {
    const scan = await this.#current();
    const watchFailure = this.#watchFailure();
    if (watchFailure) return watchFailure;
    if (scan.status === scanStatuses.failed) return scanFailure(scan);
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
    const scan = await this.#current();
    const watchFailure = this.#watchFailure();
    if (watchFailure) return watchFailure;
    if (scan.status === scanStatuses.failed) return scanFailure(scan);
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
        if (scan.status === scanStatuses.partial && !result.found)
          return {
            id: result.id,
            found: false,
            confirmation: catalogConfirmations.unconfirmed,
            diagnostics: [
              {
                code: catalogDiagnosticCodes.unconfirmedReference,
                severity: diagnosticSeverities.warning,
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
  refresh(): Promise<WorkspaceRefreshResult> {
    if (this.#explicitRefreshPromise) return this.#explicitRefreshPromise;
    /** 수동 재연결과 전체 스캔의 결과를 함께 반환한다. */
    const operation = (async (): Promise<WorkspaceRefreshResult> => {
      if (this.#watcher) await this.#watcher.refresh();
      const scan = await this.#synchronize();
      const watchFailure = this.#watchFailure();
      if (watchFailure) return watchFailure;
      return scan.status === scanStatuses.failed
        ? scanFailure(scan)
        : { success: true, scanStatus: scan.status };
    })();
    this.#explicitRefreshPromise = operation;
    const clear = (): void => {
      if (this.#explicitRefreshPromise === operation)
        this.#explicitRefreshPromise = undefined;
    };
    void operation.then(clear, clear).catch(() => undefined);
    return operation;
  }

  /** 연결된 파일 감시를 명시적으로 종료한다. */
  async close(): Promise<void> {
    this.#closed = true;
    await this.#watcher?.close();
  }
}

/** 프로젝트용 조회 세션을 만든다. 첫 IO는 list/get/refresh에서 실행한다. */
export function createWorkspaceQuerySession(
  input: unknown = {},
): WorkspaceQuerySession {
  return new WorkspaceQuerySession(input);
}
