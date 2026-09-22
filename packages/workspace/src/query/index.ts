import {
  catalogConfirmations,
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  diagnosticSeverities,
  isDocumentKind,
  isDocumentStatus,
  matchCode,
  projectCatalogGet,
  projectCatalogList,
  projectCatalogPaths,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  scanStatuses,
  type Catalog,
  type CatalogGetResult,
  type CatalogListFilters,
  type CatalogListItem,
  type CatalogPathDocumentResult,
  type CatalogPathLink,
  type CatalogPathMissingResult,
  type CatalogPathResult,
  type CatalogQueryDiagnostic,
  type CodeMatchCandidate,
  type CodeMatchEvidence,
  type CodeMatchResult,
  type Diagnostic,
  type ScanStatus,
} from '@codocs/core';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
} from '../diagnostics/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import {
  loadWorkspace,
  loadWorkspacePath,
  WorkspaceObservationCache,
  containsWorkspacePath,
  workspacePathsForLinkEvent,
  type WorkspaceScanDiagnostic,
  type WorkspaceScanResult,
} from '../loader/index.js';
import { workspaceTargetKinds } from '../paths/domain-values.js';
import { WorkspaceWatcher } from '../watcher/index.js';
import { resolveProjectRoot, type ProjectRoot } from '../project-root/index.js';
import type { WorkspacePathLink } from '../paths/index.js';
import { QueryObservations } from './observations.js';
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
  /** 요청한 코드 매칭 catalog와 현재 상세 조회 catalog가 다를 때 사용하는 코드다. */
  catalogVersionMismatch: 'catalog_version_mismatch',
} as const;

/** 커서 오류의 고정 문구다. */
export const workspaceQueryDiagnosticMessages = {
  cursorExpired:
    '목록 커서가 만료되었습니다. 커서 없이 첫 페이지를 다시 조회하세요.',
  catalogVersionMismatch:
    '코드 매칭에 사용한 문서 색인이 변경되었습니다. 최신 코드 매칭 결과로 다시 조회하세요.',
} as const;

/** 조회에서 core·workspace와 커서 계층이 반환할 수 있는 공통 진단이다. */
export type WorkspaceQueryDiagnostic =
  | CatalogQueryDiagnostic
  | WorkspaceScanDiagnostic
  | Diagnostic<
      (typeof workspaceQueryDiagnosticCodes)[keyof typeof workspaceQueryDiagnosticCodes]
    >;

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
  diagnostics?: readonly WorkspaceQueryDiagnostic[];
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
  diagnostics?: readonly WorkspaceQueryDiagnostic[];
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

/** 같은 catalog 버전에서 경로별 내용과 관계를 조회한 결과다. */
export interface WorkspacePathGetSuccess {
  success: true;
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
  catalogVersion: number;
  results: readonly WorkspacePathGetItem[];
  diagnostics?: readonly WorkspaceQueryDiagnostic[];
}

/** 코드 매칭 뒤 catalog가 바뀌어 경로 결과를 적용할 수 없는 실패다. */
export interface WorkspaceCatalogVersionMismatch {
  success: false;
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
  catalogVersion: number;
  expectedCatalogVersion: number;
  error: Diagnostic<
    (typeof workspaceQueryDiagnosticCodes)['catalogVersionMismatch']
  >;
}

/** 경로 상세 조회의 성공·일반 실패·catalog 버전 불일치 결과다. */
export type WorkspacePathGetResponse =
  | WorkspacePathGetSuccess
  | WorkspaceCatalogVersionMismatch
  | WorkspaceQueryFailure;

/** 편집기가 열 수 있는 file URI를 확인된 문서 경로에 연결한다. */
export type WorkspacePathGetLink = CatalogPathLink & { uri: string };

/** Core 경로 문서에 발견 경로의 file URI와 URI가 있는 관계를 추가한다. */
export type WorkspacePathDocumentResult =
  CatalogPathDocumentResult extends infer Result
    ? Result extends CatalogPathDocumentResult
      ? Omit<Result, 'source' | 'references' | 'referencedBy'> & {
          source: Result['source'] & { uri: string };
          references?: readonly WorkspacePathGetLink[];
          referencedBy?: readonly WorkspacePathGetLink[];
        }
      : never
    : never;

/** 확인되지 않은 경로와 URI까지 확인한 문서 결과를 구분한다. */
export type WorkspacePathGetItem =
  CatalogPathMissingResult | WorkspacePathDocumentResult;

/** 현재 catalog snapshot으로 전체 문서 텍스트를 매칭한 결과다. */
export interface WorkspaceMatchSuccess {
  success: true;
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
  catalogVersion: number;
  refreshing: boolean;
  candidates: readonly CodeMatchCandidate[];
  evidence: readonly CodeMatchEvidence[];
  diagnostics: CodeMatchResult['diagnostics'];
  partial: boolean;
  status: CodeMatchResult['status'];
  failures: CodeMatchResult['failures'];
}

/** 전체 텍스트 매칭 결과 또는 catalog를 확인할 수 없는 실패다. */
export type WorkspaceMatchResult =
  WorkspaceMatchSuccess | WorkspaceQueryFailure;

/** 명시 refresh의 scan 결과다. */
export type WorkspaceRefreshResult =
  | {
      success: true;
      scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
      fileCount: number;
      itemCount: number;
      errorCount: number;
      warningCount: number;
      countsComplete: boolean;
      diagnostics: readonly WorkspaceScanDiagnostic[];
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

/** 미확인 경로 문서에 최신성 비보장 진단을 추가한다. */
function withPathConfirmationDiagnostic(
  result: CatalogPathResult,
): CatalogPathResult {
  if (!result.found || result.confirmation === catalogConfirmations.confirmed)
    return result;
  return {
    ...result,
    diagnostics: [
      ...result.diagnostics,
      {
        code: catalogDiagnosticCodes.unconfirmedReference,
        severity: diagnosticSeverities.warning,
        message: catalogDiagnosticMessages.unconfirmedReference,
        path: result.path,
      },
    ],
  };
}

/** 프로젝트 발견 경로를 열 수 있는 file URI로 변환한다. */
function workspacePathUri(projectRoot: string, documentPath: string): string {
  return pathToFileURL(path.resolve(projectRoot, documentPath)).href;
}

/** Core 경로 결과에 확인한 프로젝트 기준의 이동 URI를 추가한다. */
function withWorkspaceUris(
  projectRoot: string,
  result: CatalogPathResult,
): WorkspacePathGetItem {
  if (!result.found) return result;
  const { references, referencedBy, ...base } = result;
  /** 같은 관측의 관계 경로에 이동 URI를 추가한다. */
  const link = (item: CatalogPathLink): WorkspacePathGetLink => ({
    ...item,
    uri: workspacePathUri(projectRoot, item.path),
  });
  return {
    ...base,
    source: {
      ...result.source,
      uri: workspacePathUri(projectRoot, result.source.path),
    },
    ...(references ? { references: references.map(link) } : {}),
    ...(referencedBy ? { referencedBy: referencedBy.map(link) } : {}),
  };
}

/** 실제 scan과 이전 Catalog를 직렬로 연결하는 process 범위 조회 세션이다. */
export class WorkspaceQuerySession {
  readonly #input: unknown;
  #catalog: Catalog | undefined;
  #scan: WorkspaceScanResult | undefined;
  #revisions = new Map<string, string>();
  #completed:
    | { catalog: Catalog; revisions: Map<string, string>; version: number }
    | undefined;
  #generation = 0;
  #catalogVersion = 0;
  #refreshPromise: Promise<WorkspaceScanResult> | undefined;
  #explicitRefreshPromise: Promise<WorkspaceRefreshResult> | undefined;
  #watcher: WorkspaceWatcher | undefined;
  #root: ProjectRoot | undefined;
  #cache = new WorkspaceObservationCache();
  readonly #pending = new Set<string>();
  readonly #links = new Map<string, WorkspacePathLink>();
  #closed = false;

  /** 프로젝트 선택의 own data 값만 고정하고 IO는 각 요청 시 수행한다. */
  constructor(input: unknown = {}) {
    this.#input = sessionInput(input);
  }

  /** 감시 신호를 허용된 발견 경로로만 되돌리고 진행 중 읽기의 세대를 무효화한다. */
  #collect(paths: readonly string[]): void {
    if (this.#closed || !this.#root) return;
    for (const changed of paths) {
      const scopes = workspacePathsForLinkEvent(
        [...this.#links.values()],
        changed,
      );
      if (containsWorkspacePath(this.#root.codocsPath, changed))
        scopes.push(changed);
      else if (containsWorkspacePath(changed, this.#root.codocsPath))
        scopes.push(this.#root.codocsPath);
      for (const scope of new Set(scopes)) {
        this.#cache.invalidate(scope);
        if (
          [...this.#pending].some((parent) =>
            containsWorkspacePath(parent, scope),
          )
        )
          continue;
        for (const child of this.#pending)
          if (containsWorkspacePath(scope, child)) this.#pending.delete(child);
        this.#pending.add(scope);
      }
    }
    if (this.#pending.size && !this.#refreshPromise)
      void this.#synchronize(false).catch(() => undefined);
  }

  /** 새 연결은 읽기 전에 감시 준비를 기다리며 발견 경로별 대응을 보존한다. */
  async #register(link: WorkspacePathLink): Promise<void> {
    if (this.#closed) return;
    this.#links.set(link.logicalPath, link);
    await this.#watcher?.trackTargets([
      ...new Set([link.targetPath, ...(link.realPath ? [link.realPath] : [])]),
    ]);
  }

  /** 프로젝트 선택 후 첫 문서 IO 전에 구독과 감시 준비를 완료한다. */
  async #prepare(): Promise<WorkspaceScanResult | undefined> {
    if (this.#watcher || this.#closed) return;
    const selected = await resolveProjectRoot(this.#input);
    if (this.#closed) return;
    if (!selected.success)
      return {
        status: scanStatuses.failed,
        documents: [],
        failures: [],
        skippedCycles: [],
        diagnostics: selected.diagnostics,
        ...(selected.projectRoot ? { projectRoot: selected.projectRoot } : {}),
      };
    this.#root = selected.root;
    const watcher = new WorkspaceWatcher(selected.root.projectRoot);
    this.#watcher = watcher;
    watcher.subscribe((batch) => this.#collect(batch.paths));
    await watcher.start();
  }

  /** 채택한 관측의 내용·revision·참조·진단을 await 없이 한 번에 게시한다. */
  #publish(scan: WorkspaceScanResult): void {
    if (this.#closed) return;
    const previousFingerprint = this.#catalog
      ? fingerprint(projectCatalogList(this.#catalog, {}).items)
      : undefined;
    if (scan.status !== scanStatuses.failed) {
      const next = buildWorkspaceCatalog(scan, this.#catalog);
      const revisions =
        scan.status === scanStatuses.complete
          ? new Map<string, string>()
          : new Map(this.#revisions);
      for (const [sourcePath, revision] of scanRevisions(scan))
        revisions.set(sourcePath, revision);
      this.#catalog = next;
      this.#revisions = revisions;
      this.#catalogVersion++;
      if (
        previousFingerprint !== undefined &&
        previousFingerprint !== fingerprint(projectCatalogList(next, {}).items)
      )
        this.#generation++;
      if (scan.status === scanStatuses.complete)
        this.#completed = {
          catalog: next,
          revisions,
          version: this.#catalogVersion,
        };
    }
    this.#scan = scan;
  }

  /** 전체 순회를 계속하면서 이후 신호의 파일·하위 범위만 다시 확인한다. */
  async #scanOperation(full: boolean): Promise<WorkspaceScanResult> {
    const preparationFailure = await this.#prepare();
    if (preparationFailure) {
      this.#publish(preparationFailure);
      return preparationFailure;
    }
    if (this.#closed) return this.#closedScan();
    const watchFailure = this.#watchFailure();
    if (watchFailure) {
      if (this.#scan) return this.#scan;
      const failed = {
        ...this.#closedScan(),
        diagnostics: [
          { ...watchFailure, severity: diagnosticSeverities.error },
        ],
      };
      this.#publish(failed);
      return failed;
    }
    const options = {
      cache: this.#cache,
      /** 발견한 연결의 감시 준비를 내용 읽기 전에 완료한다. */ onLink: (
        link: WorkspacePathLink,
      ) => this.#register(link),
    };
    let working: QueryObservations;
    if (
      full ||
      !this.#scan ||
      this.#scan.status === scanStatuses.failed ||
      !this.#root
    ) {
      this.#watcher?.drain();
      this.#pending.clear();
      if (this.#root) this.#cache.invalidate(this.#root.codocsPath);
      const loaded = await loadWorkspace(this.#input, options);
      if (this.#closed) return this.#closedScan();
      this.#watcher?.drain();
      if (!loaded.root) {
        this.#publish(loaded);
        return loaded;
      }
      working = new QueryObservations(
        loaded.root,
        loaded,
        this.#cache,
        loaded.observations,
      );
    } else working = new QueryObservations(this.#root, this.#scan, this.#cache);
    while (!this.#closed) {
      await this.#watcher?.settle();
      if (this.#closed) return this.#closedScan();
      const interruptedWatch = this.#watchFailure();
      if (interruptedWatch) {
        this.#pending.clear();
        if (this.#scan) return this.#scan;
        const failed = {
          ...this.#closedScan(),
          diagnostics: [
            { ...interruptedWatch, severity: diagnosticSeverities.error },
          ],
        };
        this.#publish(failed);
        return failed;
      }
      this.#watcher?.drain();
      const scopes = [...this.#pending];
      this.#pending.clear();
      if (!scopes.length) break;
      for (const scope of scopes) {
        if (this.#closed) return this.#closedScan();
        const result = await loadWorkspacePath(this.#root!, scope, options);
        this.#watcher?.drain();
        working.apply(result, this.#cache);
      }
    }
    if (this.#closed) return this.#closedScan();
    const scan = working.snapshot();
    this.#publish(scan);
    return scan;
  }

  /** 종료된 세션의 늦은 IO 결과를 새 관측으로 게시하지 않는다. */
  #closedScan(): WorkspaceScanResult {
    return {
      status: scanStatuses.failed,
      documents: [],
      failures: [],
      skippedCycles: [],
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.readFailed,
          severity: diagnosticSeverities.error,
          message: workspaceDiagnosticMessages.readFailed,
        },
      ],
    };
  }

  /** 병행 최초 호출은 공유하고 게시와 promise 해제 사이의 신호도 후속 작업으로 유지한다. */
  #synchronize(full = true): Promise<WorkspaceScanResult> {
    if (this.#refreshPromise) return this.#refreshPromise;
    if (this.#closed) return Promise.resolve(this.#closedScan());
    const operation = this.#scanOperation(full).catch(
      /** 예외를 실패 관측으로 게시해 준비 상태를 끝낸다. */ (
        error: unknown,
      ) => {
        const scan = this.#closedScan();
        scan.diagnostics = [
          {
            code: workspaceDiagnosticCodes.readFailed,
            severity: diagnosticSeverities.error,
            message:
              error instanceof Error
                ? error.message
                : workspaceDiagnosticMessages.readFailed,
          },
        ];
        this.#publish(scan);
        return scan;
      },
    );
    this.#refreshPromise = operation;
    /** 공유 작업을 해제할 때도 수집한 변경의 실행 책임을 놓치지 않는다. */
    const clear = (): void => {
      if (this.#refreshPromise !== operation) return;
      this.#refreshPromise = undefined;
      this.#watcher?.drain();
      if (this.#pending.size && !this.#closed)
        void this.#synchronize(false).catch(() => undefined);
    };
    void operation.then(clear, clear);
    return operation;
  }

  /** 최초 조회만 스캔 완료를 기다리고 이후에는 보유한 단일 snapshot을 읽는다. */
  async #current(): Promise<WorkspaceScanResult> {
    if (this.#closed) return this.#closedScan();
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

  /** 매칭에 사용하는 catalog snapshot이 게시될 때마다 바뀌는 버전이다. */
  get catalogVersion(): number {
    return this.#catalogVersion;
  }

  /** 마지막으로 게시한 탐색 상태다. */
  get scanStatus(): ScanStatus | undefined {
    return this.#scan?.status;
  }

  /** 감시만 실패했을 때 제한 조회에 쓸 마지막 완료 snapshot의 존재 여부다. */
  get limitedReadAvailable(): boolean {
    return this.#scan?.status !== scanStatuses.failed && !!this.#completed;
  }

  /** 감시 실패를 마지막 색인의 최신 성공으로 숨기지 않는다. */
  #watchFailure(): WorkspaceScanDiagnostic | undefined {
    const readiness = this.#watcher?.readiness;
    if (readiness?.state !== workspaceLifecycleStates.failed) return undefined;
    return {
      code: workspaceDiagnosticCodes.readFailed,
      severity: diagnosticSeverities.warning,
      message:
        `${readiness.cause ?? workspaceDiagnosticMessages.readFailed} ${readiness.guidance ?? ''}`.trim(),
    };
  }

  /** 보유 완료 snapshot이 없으면 감시 진단을 요청 실패로 반환한다. */
  #watchFailureResult(
    diagnostic: WorkspaceQueryDiagnostic,
  ): WorkspaceQueryFailure {
    return {
      success: false,
      scanStatus: scanStatuses.failed,
      error: { ...diagnostic, severity: diagnosticSeverities.error },
    };
  }

  /** 최신 실제 scan에서 필터 snapshot을 50개씩 반환한다. */
  async list(input: WorkspaceListInput = {}): Promise<WorkspaceListResult> {
    const scan = await this.#current();
    const watchFailure = this.#watchFailure();
    if (scan.status === scanStatuses.failed) return scanFailure(scan);
    if (watchFailure && !this.#completed)
      return this.#watchFailureResult(watchFailure);
    const catalog = watchFailure ? this.#completed?.catalog : this.#catalog;
    if (!catalog) return scanFailure(scan);
    const scanStatus = watchFailure ? scanStatuses.partial : scan.status;

    const decoded =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    if (input.cursor !== undefined && !decoded)
      return cursorExpired(scanStatus);
    const supplied = normalizeFilters(input);
    if (
      decoded &&
      hasSuppliedFilters(input) &&
      JSON.stringify(supplied) !== JSON.stringify(decoded.filters)
    )
      return invalidInput(scanStatus);
    const filters = decoded?.filters ?? supplied;
    const projection = projectCatalogList(catalog, filters);
    const currentFingerprint = fingerprint(projection.items);
    if (
      decoded &&
      (decoded.generation !== this.#generation ||
        decoded.fingerprint !== currentFingerprint ||
        decoded.position > projection.totalCount)
    )
      return cursorExpired(scanStatus);
    const position = decoded?.position ?? 0;
    const items = projection.items
      .slice(position, position + pageSize)
      .map((item) =>
        watchFailure && !item.conflict
          ? { ...item, confirmation: catalogConfirmations.unconfirmed }
          : item,
      );
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
      scanStatus,
      items,
      totalCount: projection.totalCount,
      returnedCount: items.length,
      nextCursor,
      ...(watchFailure ? { diagnostics: [watchFailure] } : {}),
    };
  }

  /** 최신 실제 scan에서 1~20개 ID를 독립 결과로 반환한다. */
  async get(ids: readonly string[]): Promise<WorkspaceGetResponse> {
    const scan = await this.#current();
    const watchFailure = this.#watchFailure();
    if (scan.status === scanStatuses.failed) return scanFailure(scan);
    if (watchFailure && !this.#completed)
      return this.#watchFailureResult(watchFailure);
    const catalog = watchFailure ? this.#completed?.catalog : this.#catalog;
    if (!catalog) return scanFailure(scan);
    const scanStatus = watchFailure ? scanStatuses.partial : scan.status;
    const projection = projectCatalogGet(catalog, ids, {
      revisions: watchFailure ? this.#completed!.revisions : this.#revisions,
    });
    if (!projection.success)
      return {
        success: false,
        scanStatus,
        error: projection.error,
      };
    const results = projection.results.map(
      /** partial의 부재와 이전 기록을 확정 결과와 구분한다. */ (
        result,
      ): WorkspaceGetResult => {
        if (scanStatus === scanStatuses.partial && !result.found)
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
        return withConfirmationDiagnostic(
          watchFailure && result.found && !result.conflict
            ? { ...result, confirmation: catalogConfirmations.unconfirmed }
            : result,
        );
      },
    );
    return {
      success: true,
      scanStatus,
      results,
      ...(watchFailure ? { diagnostics: [watchFailure] } : {}),
    };
  }

  /** 코드 매칭 경로를 그때의 catalog 버전에서 내용·관계와 함께 반환한다. */
  async getByPaths(
    paths: readonly string[],
    expectedCatalogVersion: number,
  ): Promise<WorkspacePathGetResponse> {
    const scan = await this.#current();
    const watchFailure = this.#watchFailure();
    if (scan.status === scanStatuses.failed) return scanFailure(scan);
    if (watchFailure && !this.#completed)
      return this.#watchFailureResult(watchFailure);
    const catalog = watchFailure ? this.#completed?.catalog : this.#catalog;
    if (!catalog) return scanFailure(scan);
    const scanStatus = watchFailure ? scanStatuses.partial : scan.status;
    const catalogVersion = watchFailure
      ? this.#completed!.version
      : this.#catalogVersion;
    const projection = projectCatalogPaths(catalog, paths, {
      revisions: watchFailure ? this.#completed!.revisions : this.#revisions,
    });
    if (!projection.success)
      return {
        success: false,
        scanStatus,
        error: projection.error,
      };
    if (
      !Number.isSafeInteger(expectedCatalogVersion) ||
      expectedCatalogVersion < 0
    )
      return invalidInput(scanStatus);
    if (expectedCatalogVersion !== catalogVersion)
      return {
        success: false,
        scanStatus,
        catalogVersion,
        expectedCatalogVersion,
        error: {
          code: workspaceQueryDiagnosticCodes.catalogVersionMismatch,
          severity: diagnosticSeverities.error,
          message: workspaceQueryDiagnosticMessages.catalogVersionMismatch,
        },
      };
    const results = projection.results.map(
      /** 확인한 문서에만 현재 프로젝트의 URI와 감시 상태를 결합한다. */ (
        result,
      ): WorkspacePathGetItem => {
        if (!result.found) return result;
        return withWorkspaceUris(
          scan.root.projectRoot,
          withPathConfirmationDiagnostic(
            watchFailure
              ? { ...result, confirmation: catalogConfirmations.unconfirmed }
              : result,
          ),
        );
      },
    );
    return {
      success: true,
      scanStatus,
      catalogVersion,
      results,
      ...(watchFailure ? { diagnostics: [watchFailure] } : {}),
    };
  }

  /** 열린 문서의 전체 원문을 현재 프로젝트 catalog snapshot으로 매칭한다. */
  async match(text: string): Promise<WorkspaceMatchResult> {
    const scan = await this.#current();
    const watchFailure = this.#watchFailure();
    if (scan.status === scanStatuses.failed) return scanFailure(scan);
    if (watchFailure && !this.#completed)
      return this.#watchFailureResult(watchFailure);
    const catalog = watchFailure ? this.#completed?.catalog : this.#catalog;
    if (!catalog) return scanFailure(scan);
    const scanStatus = watchFailure ? scanStatuses.partial : scan.status;
    const result = matchCode(catalog, text);
    const candidates = watchFailure
      ? result.candidates.map((candidate) => ({
          ...candidate,
          confirmation: catalogConfirmations.unconfirmed,
        }))
      : result.candidates;
    return {
      ...result,
      success: true,
      scanStatus,
      catalogVersion: watchFailure
        ? this.#completed!.version
        : this.#catalogVersion,
      refreshing: !!this.#refreshPromise,
      candidates,
      partial: result.partial || !!watchFailure,
      status: scanStatus,
      ...(watchFailure
        ? { diagnostics: [...result.diagnostics, watchFailure] }
        : {}),
    };
  }

  /** 명시 refresh는 결과 변화와 무관하게 기존 커서 generation을 만료한다. */
  refresh(): Promise<WorkspaceRefreshResult> {
    if (this.#explicitRefreshPromise) return this.#explicitRefreshPromise;
    /** 수동 재연결과 전체 스캔의 결과를 함께 반환한다. */
    const refreshOperation = async (): Promise<WorkspaceRefreshResult> => {
      if (this.#refreshPromise) await this.#refreshPromise;
      if (this.#closed) return scanFailure(this.#closedScan());
      if (this.#watcher) await this.#watcher.refresh();
      while (this.#refreshPromise) await this.#refreshPromise;
      const generation = this.#generation;
      const scan = await this.#synchronize();
      const watchFailure = this.#watchFailure();
      if (watchFailure) return this.#watchFailureResult(watchFailure);
      if (scan.status !== scanStatuses.failed)
        this.#generation = Math.max(this.#generation, generation + 1);
      return scan.status === scanStatuses.failed
        ? scanFailure(scan)
        : {
            success: true,
            scanStatus: scan.status,
            fileCount:
              scan.documents.length +
              scan.failures.filter(
                (failure) => failure.kind === workspaceTargetKinds.file,
              ).length,
            itemCount: projectCatalogList(this.#catalog!, {}).totalCount,
            errorCount: scan.diagnostics.filter(
              (diagnostic) =>
                diagnostic.severity === diagnosticSeverities.error,
            ).length,
            warningCount: scan.diagnostics.filter(
              (diagnostic) =>
                diagnostic.severity === diagnosticSeverities.warning,
            ).length,
            countsComplete: scan.status === scanStatuses.complete,
            diagnostics: scan.diagnostics,
          };
    };
    const operation = refreshOperation();
    this.#explicitRefreshPromise = operation;
    /** refresh 완료 뒤 현재 operation 참조를 정리한다. */
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
    this.#pending.clear();
    this.#links.clear();
    await this.#watcher?.close();
  }
}

/** 프로젝트용 조회 세션을 만든다. 첫 IO는 list/get/refresh에서 실행한다. */
export function createWorkspaceQuerySession(
  input: unknown = {},
): WorkspaceQuerySession {
  return new WorkspaceQuerySession(input);
}
