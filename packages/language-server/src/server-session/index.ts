import type {
  CodeMatchCandidate,
  CodeMatchEvidence,
  OffsetRange,
} from '@codocs/core';
import {
  createWorkspaceQuerySession,
  type WorkspaceMatchResult,
  type WorkspacePathGetResponse,
  type WorkspaceRefreshResult,
  type WorkspaceReadiness,
} from '@codocs/workspace';
import type {
  CancellationToken,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  Hover,
  HoverParams,
  InitializeParams,
  Range,
  WorkspaceFolder,
} from 'vscode-languageserver/node.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  SynchronizedDocuments,
  utf16OffsetsToRange,
} from '../document-sync/index.js';
import {
  createEmptyHover,
  createHover,
  createStatusHover,
  hoverCandidatePaths,
  hoverDetailPaths,
  selectHover,
} from '../hover/index.js';
export {
  documentMatchErrorCodes,
  type DocumentMatchErrorCode,
} from './domain-values.js';
import {
  documentMatchErrorCodes,
  type DocumentMatchErrorCode,
} from './domain-values.js';

/** 문서 매칭 요청의 메서드 이름이다. */
export const documentMatchRequestMethod = 'codocs/match';
/** 작업 공간 색인 수동 갱신 요청의 메서드 이름이다. */
export const workspaceRefreshRequestMethod = 'codocs/refresh';

/** 최신 열린 문서를 매칭하는 요청이다. */
export interface DocumentMatchRequest {
  textDocument: { uri: string };
  version?: number;
}

/** 코어 offset과 편집기 Range를 함께 보존한 근거다. */
export type LspMatchEvidence = Omit<CodeMatchEvidence, 'range'> & {
  offsetRange: OffsetRange;
  range: Range;
};

/** 모든 후보 정보와 변환된 근거를 함께 보존한다. */
export type LspMatchCandidate = Omit<CodeMatchCandidate, 'evidence'> & {
  evidence: readonly LspMatchEvidence[];
};

/** 최신 문서와 catalog snapshot이 일치할 때의 매칭 응답이다. */
export type DocumentMatchSuccess = Omit<
  Extract<WorkspaceMatchResult, { success: true }>,
  'candidates' | 'evidence'
> & {
  success: true;
  uri: string;
  version: number;
  workspaceUri: string;
  workspaceState: WorkspaceReadiness;
  candidates: readonly LspMatchCandidate[];
  evidence: readonly LspMatchEvidence[];
};

/** 문서·작업 공간·색인의 현재 상태로 수행할 수 없는 매칭 응답이다. */
export interface DocumentMatchFailure {
  success: false;
  code: DocumentMatchErrorCode;
  uri: string;
  requestedVersion?: number;
  currentVersion?: number;
  workspaceUri?: string;
  workspaceState?: WorkspaceReadiness;
  scanStatus?: WorkspaceMatchResult['scanStatus'];
  error?: Extract<WorkspaceMatchResult, { success: false }>['error'];
}

/** 공개 문서 매칭 응답이다. */
export type DocumentMatchResponse = DocumentMatchSuccess | DocumentMatchFailure;

/** 색인을 명시적으로 다시 읽을 작업 공간 선택이다. */
export interface WorkspaceRefreshRequest {
  workspaceUri?: string;
}

/** 작업 공간별 명시 refresh 결과와 갱신 뒤 lifecycle 상태다. */
export interface WorkspaceRefreshResponse {
  workspaceUri: string;
  result: WorkspaceRefreshResult;
  workspaceState: WorkspaceReadiness;
}

/** 세션 구현을 테스트에서 결정적으로 바꾸기 위한 최소 경계다. */
export interface WorkspaceSessionBoundary {
  readonly readiness: WorkspaceReadiness;
  readonly catalogVersion: number;
  match(text: string): Promise<WorkspaceMatchResult>;
  getByPaths(
    paths: readonly string[],
    expectedCatalogVersion: number,
  ): Promise<WorkspacePathGetResponse>;
  refresh(): Promise<WorkspaceRefreshResult>;
  close(): Promise<void>;
}

/** 작업 공간마다 독립 세션을 만드는 경계다. */
export type WorkspaceSessionFactory = (
  rootPath: string,
) => WorkspaceSessionBoundary;

interface WorkspaceBinding {
  uri: string;
  rootPath: string;
  session: WorkspaceSessionBoundary;
}

/** 실제 WorkspaceQuerySession을 선택한 루트에 고정해 만든다. */
const defaultSessionFactory: WorkspaceSessionFactory = (rootPath) =>
  createWorkspaceQuerySession({ cwd: rootPath });

/** LSP 연결과 분리해 문서·작업 공간·비동기 최신성을 관리한다. */
export class LanguageServerSession {
  readonly documents = new SynchronizedDocuments();
  readonly #sessionFactory: WorkspaceSessionFactory;
  readonly #workspaces = new Map<string, WorkspaceBinding>();
  #closed = false;

  /** 테스트 대체가 없으면 실제 workspace 조회 세션을 사용한다. */
  constructor(sessionFactory: WorkspaceSessionFactory = defaultSessionFactory) {
    this.#sessionFactory = sessionFactory;
  }

  /** initialize의 작업 공간 목록을 각각 독립된 조회 세션으로 만든다. */
  async initialize(params: InitializeParams): Promise<void> {
    const folders = initialWorkspaceFolders(params);
    await this.#replaceWorkspaces(folders);
  }

  /** 동적 workspace folder 변경을 세션 생성·종료에 반영한다. */
  async changeWorkspaceFolders(
    added: readonly WorkspaceFolder[],
    removed: readonly WorkspaceFolder[],
  ): Promise<void> {
    for (const folder of removed) await this.#removeWorkspace(folder.uri);
    for (const folder of added) this.#addWorkspace(folder);
  }

  /** 현재 작업 공간 수를 테스트와 서버 상태 확인에 제공한다. */
  get workspaceCount(): number {
    return this.#workspaces.size;
  }

  /** didOpen 원문을 언어·확장자와 무관하게 저장한다. */
  openDocument(
    params: DidOpenTextDocumentParams,
  ): ReturnType<SynchronizedDocuments['open']> {
    return this.documents.open(params);
  }

  /** didChange 전체 원문은 버전이 증가할 때만 저장한다. */
  changeDocument(
    params: DidChangeTextDocumentParams,
  ): ReturnType<SynchronizedDocuments['change']> {
    return this.documents.change(params);
  }

  /** 닫은 문서의 편집 중 원문을 제거한다. */
  closeDocument(uri: string): boolean {
    return this.documents.close(uri);
  }

  /** 요청 시점의 원문을 매칭하고 완료 시점에도 같은 버전인지 확인한다. */
  async matchDocument(
    request: DocumentMatchRequest,
  ): Promise<DocumentMatchResponse> {
    const uri = request.textDocument.uri;
    const snapshot = this.documents.get(uri);
    if (!snapshot)
      return {
        success: false,
        code: documentMatchErrorCodes.documentNotOpen,
        uri,
        ...(request.version === undefined
          ? {}
          : { requestedVersion: request.version }),
      };
    if (request.version !== undefined && request.version !== snapshot.version)
      return staleResult(uri, request.version, snapshot.version);
    const snapshotVersion = snapshot.version;
    const snapshotText = snapshot.getText();
    const workspace = this.#workspaceForDocument(uri);
    if (!workspace)
      return {
        success: false,
        code: documentMatchErrorCodes.workspaceNotFound,
        uri,
        currentVersion: snapshot.version,
      };
    const result = await workspace.session.match(snapshotText);
    const current = this.documents.get(uri);
    if (
      !current ||
      current.version !== snapshotVersion ||
      current.getText() !== snapshotText
    )
      return staleResult(uri, snapshotVersion, current?.version);
    if (!result.success)
      return {
        success: false,
        code: documentMatchErrorCodes.workspaceQueryFailed,
        uri,
        currentVersion: snapshotVersion,
        workspaceUri: workspace.uri,
        workspaceState: workspace.session.readiness,
        scanStatus: result.scanStatus,
        error: result.error,
      };
    return mapMatchResult(current, workspace, result);
  }

  /** 같은 코드·catalog 관측의 커서 후보와 경로 상세로 표준 Hover를 만든다. */
  async hoverDocument(
    params: HoverParams,
    cancellation?: CancellationToken,
  ): Promise<Hover | null> {
    const uri = params.textDocument.uri;
    const snapshot = this.documents.get(uri);
    if (!snapshot) return null;
    const snapshotVersion = snapshot.version;
    const snapshotText = snapshot.getText();
    const workspace = this.#workspaceForDocument(uri);
    if (!workspace) return null;
    if (cancellation?.isCancellationRequested) return null;
    const result = await workspace.session.match(snapshotText);
    if (
      cancellation?.isCancellationRequested ||
      !this.#isCurrentSnapshot(uri, snapshotVersion, snapshotText, workspace)
    )
      return null;
    if (!result.success)
      return createStatusHover(workspace.session.readiness, result.error);
    const match = mapMatchResult(snapshot, workspace, result);
    const selection = selectHover(snapshot, match, params.position);
    if (!selection) return createEmptyHover(match);
    const candidatePaths = hoverCandidatePaths(selection);
    const candidateQueryVersion = workspace.session.catalogVersion;
    let details = await workspace.session.getByPaths(
      candidatePaths,
      match.catalogVersion,
    );
    if (
      cancellation?.isCancellationRequested ||
      !this.#isCurrentSnapshot(uri, snapshotVersion, snapshotText, workspace) ||
      workspace.session.catalogVersion !== candidateQueryVersion
    )
      return null;
    if (!details.success)
      return 'expectedCatalogVersion' in details
        ? null
        : createStatusHover(workspace.session.readiness, details.error);
    const allPaths = hoverDetailPaths(candidatePaths, details);
    if (allPaths.length !== candidatePaths.length) {
      const detailQueryVersion = workspace.session.catalogVersion;
      details = await workspace.session.getByPaths(
        allPaths,
        match.catalogVersion,
      );
      if (
        cancellation?.isCancellationRequested ||
        !this.#isCurrentSnapshot(
          uri,
          snapshotVersion,
          snapshotText,
          workspace,
        ) ||
        workspace.session.catalogVersion !== detailQueryVersion
      )
        return null;
      if (!details.success)
        return 'expectedCatalogVersion' in details
          ? null
          : createStatusHover(workspace.session.readiness, details.error);
    }
    return createHover(selection, match, details);
  }

  /** 선택한 작업 공간 또는 모든 작업 공간을 명시적으로 갱신한다. */
  async refreshWorkspaces(
    request: WorkspaceRefreshRequest = {},
  ): Promise<readonly WorkspaceRefreshResponse[]> {
    const selected = request.workspaceUri
      ? [this.#workspaces.get(normalizeWorkspaceUri(request.workspaceUri))]
      : [...this.#workspaces.values()];
    /** 선택된 workspace 하나를 갱신하고 현재 상태를 반환한다. */
    const refreshWorkspace = async (
      workspace: WorkspaceBinding,
    ): Promise<WorkspaceRefreshResponse> => ({
      workspaceUri: workspace.uri,
      result: await workspace.session.refresh(),
      workspaceState: workspace.session.readiness,
    });
    return Promise.all(
      selected
        .filter((workspace): workspace is WorkspaceBinding => !!workspace)
        .map(refreshWorkspace),
    );
  }

  /** 모든 감시 세션과 열린 문서 상태를 종료한다. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const sessions = [...this.#workspaces.values()].map(
      (workspace) => workspace.session,
    );
    this.#workspaces.clear();
    this.documents.clear();
    await Promise.all(sessions.map((session) => session.close()));
  }

  /** 초기화 목록 전체를 새 세션 집합으로 교체한다. */
  async #replaceWorkspaces(folders: readonly WorkspaceFolder[]): Promise<void> {
    const previous = [...this.#workspaces.values()];
    this.#workspaces.clear();
    await Promise.all(previous.map((workspace) => workspace.session.close()));
    for (const folder of folders) this.#addWorkspace(folder);
  }

  /** 유효한 file URI 작업 공간 하나를 중복 없이 추가한다. */
  #addWorkspace(folder: WorkspaceFolder): void {
    const uri = normalizeWorkspaceUri(folder.uri);
    if (this.#workspaces.has(uri)) return;
    const rootPath = fileURLToPath(uri);
    this.#workspaces.set(uri, {
      uri,
      rootPath,
      session: this.#sessionFactory(rootPath),
    });
  }

  /** URI가 가리키는 세션 하나를 종료하고 제거한다. */
  async #removeWorkspace(uri: string): Promise<void> {
    let normalized: string;
    try {
      normalized = normalizeWorkspaceUri(uri);
    } catch {
      return;
    }
    const workspace = this.#workspaces.get(normalized);
    if (!workspace) return;
    this.#workspaces.delete(normalized);
    await workspace.session.close();
  }

  /** 포함하는 루트 중 가장 구체적인 작업 공간을 선택한다. */
  #workspaceForDocument(uri: string): WorkspaceBinding | undefined {
    let documentPath: string;
    try {
      documentPath = path.resolve(fileURLToPath(uri));
    } catch {
      return undefined;
    }
    return [...this.#workspaces.values()]
      .filter((workspace) => containsPath(workspace.rootPath, documentPath))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
  }

  /** 비동기 조회 뒤에도 열린 문서와 선택한 workspace가 같은지 확인한다. */
  #isCurrentSnapshot(
    uri: string,
    version: number,
    text: string,
    workspace: WorkspaceBinding,
  ): boolean {
    const current = this.documents.get(uri);
    return (
      current?.version === version &&
      current.getText() === text &&
      this.#workspaces.get(workspace.uri) === workspace
    );
  }
}

/** initialize의 현대·이전 단일 루트 표현을 작업 공간 목록으로 통합한다. */
function initialWorkspaceFolders(
  params: InitializeParams,
): readonly WorkspaceFolder[] {
  if (params.workspaceFolders) return params.workspaceFolders;
  if (params.rootUri)
    return [
      {
        uri: params.rootUri,
        name: path.basename(fileURLToPath(params.rootUri)),
      },
    ];
  if (params.rootPath) {
    const rootPath = path.resolve(params.rootPath);
    return [
      { uri: pathToFileURL(rootPath).href, name: path.basename(rootPath) },
    ];
  }
  return [];
}

/** 작업 공간 URI를 절대 file URI 하나로 정규화한다. */
function normalizeWorkspaceUri(uri: string): string {
  return pathToFileURL(path.resolve(fileURLToPath(uri))).href;
}

/** 경로가 루트 자체 또는 그 하위인지 플랫폼 경계로 판별한다. */
function containsPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

/** 비동기 결과가 현재 문서 버전과 달라졌음을 반환한다. */
function staleResult(
  uri: string,
  requestedVersion: number,
  currentVersion: number | undefined,
): DocumentMatchFailure {
  return {
    success: false,
    code: documentMatchErrorCodes.staleDocumentVersion,
    uri,
    requestedVersion,
    ...(currentVersion === undefined ? {} : { currentVersion }),
  };
}

/** 코어 근거의 offset을 보존하며 LSP 범위를 추가한다. */
function mapEvidence(
  document: TextDocument,
  evidence: CodeMatchEvidence,
): LspMatchEvidence {
  return {
    ...evidence,
    offsetRange: { ...evidence.range },
    range: utf16OffsetsToRange(document, evidence.range),
  };
}

/** 최신 snapshot에 workspace 매칭 결과와 LSP 좌표를 결합한다. */
function mapMatchResult(
  document: TextDocument,
  workspace: WorkspaceBinding,
  result: Extract<WorkspaceMatchResult, { success: true }>,
): DocumentMatchSuccess {
  /** 후보 하나에 LSP 좌표로 변환한 근거 목록을 연결한다. */
  const mapCandidate = (candidate: CodeMatchCandidate): LspMatchCandidate => ({
    ...candidate,
    evidence: candidate.evidence.map((evidence) =>
      mapEvidence(document, evidence),
    ),
  });
  return {
    ...result,
    uri: document.uri,
    version: document.version,
    workspaceUri: workspace.uri,
    workspaceState: workspace.session.readiness,
    candidates: result.candidates.map(mapCandidate),
    evidence: result.evidence.map((evidence) =>
      mapEvidence(document, evidence),
    ),
  };
}
