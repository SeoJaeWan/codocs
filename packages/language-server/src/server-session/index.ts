import {
  referenceResolutionStatuses,
  scanStatuses,
  type CatalogOccurrence,
} from '@codocs/core';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
  type WorkspaceLiveReferenceSuccess,
  type WorkspaceSectionDestination,
  type WorkspacePathDocumentResult,
  type WorkspaceQueryDiagnostic,
  type WorkspacePathGetResponse,
  type WorkspaceRefreshResult,
  type WorkspaceReadiness,
  type WorkspaceDiagnosticsSnapshot,
} from '@codocs/workspace';
import type {
  CancellationToken,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  Hover,
  HoverParams,
  InitializeParams,
  Range,
  DocumentLink,
  Diagnostic,
  WorkspaceFolder,
  InlayHint,
} from 'vscode-languageserver/node.js';
import path from 'node:path';
import {
  CodeNavigation,
  type CodeOwner,
  type CodeSession,
  type ConfirmedCodeSource,
} from '../code-navigation/index.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  toLspDiagnostics,
  type DiagnosticFailure,
  type WorkspaceDiagnosticStatus,
} from '../diagnostics/index.js';
import {
  SynchronizedDocuments,
  utf16OffsetsToRange,
} from '../document-sync/index.js';
import {
  createEmptyHover,
  createStatusHover,
  detailLabel,
  escapeMarkdown,
} from '../hover/index.js';
import {
  nameValueRange,
  referencePartAt,
  sectionKeyAt,
  renameRequestFailureCodes,
  type ApplyRenameResponse,
  type PlanRenameResponse,
  type PrepareRenameRequest,
  type PrepareRenameResponse,
  type RenameFileUris,
  type RenameRequestFailure,
} from '../rename/index.js';
import {
  SourceSelections,
  selectionTarget,
  type CandidateSession,
} from '../navigation/index.js';
/** 작업 공간 색인 수동 갱신 요청의 메서드 이름이다. */
export const workspaceRefreshRequestMethod = 'codocs/refresh';

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
export interface WorkspaceSessionBoundary extends Partial<
  Pick<
    WorkspaceQuerySession,
    | 'references'
    | 'onDidChangeSnapshot'
    | 'captureCandidate'
    | 'confirmCandidate'
    | 'releaseCandidate'
    | 'closeDocument'
    | 'diagnostics'
    | 'closeCodeBuffer'
    | 'setCodeReferenceOwner'
    | 'updateCodeBuffer'
    | 'codeReferenceSnapshot'
    | 'codeReferencesForRows'
    | 'codeReferencesForDocument'
    | 'captureCodeReference'
    | 'confirmCodeReference'
    | 'releaseCodeReference'
    | 'onDidChangeCodeReferences'
    | 'previewRename'
    | 'applyRename'
  >
> {
  readonly readiness: WorkspaceReadiness;
  readonly catalogVersion: number;
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
  readonly #selections = new SourceSelections();
  readonly #code = new CodeNavigation();
  readonly #changes = new Set<(uri?: string) => void>();
  readonly #live = new Map<
    string,
    Promise<WorkspaceLiveReferenceSuccess | undefined>
  >();
  readonly #referenceFailures = new Map<string, WorkspaceQueryDiagnostic>();
  #closed = false;
  #diagnosticEpoch = 0;
  readonly #diagnosticHistory = new Map<
    string,
    {
      session: WorkspaceSessionBoundary;
      text: string | undefined;
      diagnostics: Diagnostic[];
    }
  >();

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
    for (const document of this.documents.all())
      this.#documentChanged(document.uri);
  }

  /** 현재 작업 공간 수를 테스트와 서버 상태 확인에 제공한다. */
  get workspaceCount(): number {
    return this.#workspaces.size;
  }

  /** didOpen 원문을 언어·확장자와 무관하게 저장한다. */
  openDocument(
    params: DidOpenTextDocumentParams,
  ): ReturnType<SynchronizedDocuments['open']> {
    const result = this.documents.open(params);
    if (result.accepted) this.#documentChanged(result.document.uri);
    return result;
  }

  /** didChange 전체 원문은 버전이 증가할 때만 저장한다. */
  changeDocument(
    params: DidChangeTextDocumentParams,
  ): ReturnType<SynchronizedDocuments['change']> {
    const result = this.documents.change(params);
    if (result.accepted) this.#documentChanged(result.document.uri);
    return result;
  }

  /** 닫은 문서의 편집 중 원문을 제거한다. */
  closeDocument(uri: string): boolean {
    const closed = this.documents.close(uri);
    this.#documentChanged(uri);
    return closed;
  }

  /** 편집과 완료 색인 관측의 변경을 프로토콜 게시자에 알린다. */
  onDidChange(listener: (uri?: string) => void): () => void {
    this.#changes.add(listener);
    return /** 해당 변경 구독을 해제한다. */ () => {
      this.#changes.delete(listener);
    };
  }

  /** 편집 출처에 묶인 조회·선택을 무효화한다. */
  #documentChanged(uri: string): void {
    this.#diagnosticEpoch++;
    this.#live.delete(uri);
    this.#referenceFailures.delete(uri);
    this.#selections.release(uri);
    const workspace = this.#workspaceForDocument(uri);
    this.#code.release(uri);
    if (workspace && !this.documents.get(uri)) {
      workspace.session.closeDocument?.(this.#sourcePath(uri, workspace));
      this.#code.forget(uri);
    }
    for (const listener of this.#changes) listener(uri);
  }

  /** workspace 상대 발견 경로를 공개 참조 API에 전달한다. */
  #sourcePath(uri: string, workspace: WorkspaceBinding): string {
    return path
      .relative(workspace.rootPath, fileURLToPath(uri))
      .split(path.sep)
      .join('/');
  }

  /** 같은 문서·완료 관측의 참조 요청을 공유하며 늦은 결과를 폐기한다. */
  async #references(
    uri: string,
  ): Promise<WorkspaceLiveReferenceSuccess | undefined> {
    const document = this.documents.get(uri);
    const workspace = this.#workspaceForDocument(uri);
    if (
      !document ||
      !workspace?.session.references ||
      !this.#isKnowledgeDocument(uri, workspace)
    )
      return undefined;
    const existing = this.#live.get(uri);
    if (existing) return existing;
    const version = document.version;
    const text = document.getText();
    const operation = workspace.session
      .references({
        sourcePath: this.#sourcePath(uri, workspace),
        text,
        documentVersion: version,
      })
      .then(
        /** 최신 live 요청과 관측이 일치할 때만 결과를 보존한다. */ (
          result,
        ) => {
          if (
            !this.#isCurrentSnapshot(uri, version, text, workspace, document) ||
            (result.success &&
              result.catalogVersion !== workspace.session.catalogVersion) ||
            this.#live.get(uri) !== operation
          )
            return undefined;
          if (!result.success) {
            this.#referenceFailures.set(uri, result.error);
            return undefined;
          }
          return result;
        },
      );
    this.#live.set(uri, operation);
    return operation;
  }

  /** 출처와 후보를 서버 내부 선택 근거에 묶어 제한 command를 만든다. */
  #target(
    uri: string,
    workspace: WorkspaceBinding,
    detail: WorkspacePathDocumentResult,
    catalogVersion: number,
    occurrence?: CatalogOccurrence,
    explicit = false,
  ): string | undefined {
    const document = this.documents.get(uri);
    const session = workspace.session;
    if (
      !document ||
      !session.captureCandidate ||
      !session.confirmCandidate ||
      !session.releaseCandidate
    )
      return undefined;
    const reference = occurrence?.occurrence;
    const origin =
      reference && 'name' in reference
        ? {
            reference: {
              name: reference.name,
              ...('section' in reference && reference.section !== undefined
                ? { section: reference.section }
                : {}),
            },
            sourcePath: this.#sourcePath(uri, workspace),
            explicit,
          }
        : undefined;
    const selection = this.#selections.capture(
      uri,
      document.version,
      session as CandidateSession,
      origin,
      detail,
      catalogVersion,
    );
    return selection ? selectionTarget(selection) : undefined;
  }

  /** 단일 확정 YAML 참조에만 본문 링크를 제공한다. */
  async #yamlLinks(
    uri: string,
    cancellation?: CancellationToken,
  ): Promise<DocumentLink[]> {
    const result = await this.#references(uri);
    const workspace = this.#workspaceForDocument(uri);
    if (
      !result ||
      !workspace ||
      result.documentVersion !== this.documents.get(uri)?.version ||
      result.catalogVersion !== workspace.session.catalogVersion ||
      cancellation?.isCancellationRequested
    )
      return [];
    return result.occurrences.flatMap(
      /** 단일 확정 출현의 command 링크를 만든다. */ (item) => {
        const section = item.resolution.section;
        // 다른 문서는 resolved, 같은 문서의 섹션 참조는 self + section일 때만 링크가 된다.
        if (
          item.resolution.status !== referenceResolutionStatuses.resolved &&
          !(
            item.resolution.status === referenceResolutionStatuses.self &&
            section !== undefined
          )
        )
          return [];
        const detail = result.targets.find(
          (target) => target.path === item.resolution.target?.path,
        );
        if (!detail?.found) return [];
        const target = this.#target(
          uri,
          workspace,
          detail,
          result.catalogVersion,
          item,
        );
        return target
          ? [
              {
                range: item.occurrence.range,
                target,
                // Host가 만드는 native 링크의 표시 이름에서도 메타데이터를 서식으로 해석하지 않는다.
                tooltip: escapeMarkdown(
                  section === undefined
                    ? `원문 열기: ${detailLabel(detail)} (${detail.path.replaceAll('\\', '/')})`
                    : `${'name' in item.occurrence ? item.occurrence.name : detailLabel(detail)}:${section} · ${detail.path.replaceAll('\\', '/')}`,
                ),
              },
            ]
          : [];
      },
    );
  }

  /** 공개 코드 API가 있는 실제 세션에 열린 출처를 연결한다. */
  #codeOwner(uri: string): CodeOwner | undefined {
    const document = this.documents.get(uri);
    const workspace = this.#workspaceForDocument(uri);
    if (!document || !workspace?.session.codeReferenceSnapshot)
      return undefined;
    return {
      uri,
      path: this.#sourcePath(uri, workspace),
      rootPath: workspace.rootPath,
      version: document.version,
      text: document.getText(),
      session: workspace.session as CodeSession,
    };
  }

  /** 명시 링크를 우선하고 YAML 이름 링크와 단일 역참조를 함께 제공한다. */
  async documentLinks(
    uri: string,
    cancellation?: CancellationToken,
  ): Promise<DocumentLink[]> {
    const document = this.documents.get(uri);
    const workspace = this.#workspaceForDocument(uri);
    if (!document) return [];
    const owner = this.#codeOwner(uri);
    if (owner) await this.#prepareCodeBuffers(owner.session);
    const forward = owner
      ? await this.#code.forward(owner)
      : { links: [], diagnostics: [] };
    const yaml = (await this.#yamlLinks(uri, cancellation)).filter(
      /** 명시 표기의 전체 범위를 YAML 이름 링크보다 우선한다. */ (link) =>
        !forward.links.some((item) => rangesOverlap(item.range, link.range)) &&
        !(
          owner &&
          this.#code.markerAt(owner, document.offsetAt(link.range.start))
        ),
    );
    const reverse =
      owner && workspace && this.#isKnowledgeDocument(uri, workspace)
        ? await this.#code.reverseLinks(owner, [...yaml, ...forward.links])
        : [];
    if (
      cancellation?.isCancellationRequested ||
      (owner && !this.#currentCodeOwner(owner))
    )
      return [];
    return [...forward.links, ...yaml, ...reverse];
  }

  /** 열린 source들을 같은 프로젝트의 overlay에 먼저 반영한다. */
  async #prepareCodeBuffers(session: CodeSession): Promise<void> {
    for (const document of this.documents.all()) {
      const owner = this.#codeOwner(document.uri);
      if (owner?.session === session) await this.#code.prepare(owner);
    }
  }

  /** 현재 출처와 세션을 비동기 요청 전후 비교한다. */
  #currentCodeOwner(owner: CodeOwner): boolean {
    return (
      this.documents.get(owner.uri)?.version === owner.version &&
      this.documents.get(owner.uri)?.getText() === owner.text &&
      this.#workspaceForDocument(owner.uri)?.session === owner.session
    );
  }

  /** 문서 전체 코드 출현은 원문 수정 없이 첫 행 Hint로 제공한다. */
  async inlayHints(
    uri: string,
    cancellation?: CancellationToken,
  ): Promise<InlayHint[]> {
    const owner = this.#codeOwner(uri);
    const workspace = this.#workspaceForDocument(uri);
    if (!owner || !workspace || !this.#isKnowledgeDocument(uri, workspace))
      return [];
    await this.#prepareCodeBuffers(owner.session);
    const hints = await this.#code.hints(owner);
    return this.#currentCodeOwner(owner) &&
      !cancellation?.isCancellationRequested
      ? hints
      : [];
  }

  /** live YAML의 확인된 위치에만 같은 snapshot의 진단을 투영한다. */
  async documentDiagnostics(
    uri: string,
  ): Promise<{ version: number; diagnostics: Diagnostic[] } | undefined> {
    const result = await this.#references(uri);
    if (
      !result ||
      result.documentVersion !== this.documents.get(uri)?.version ||
      result.catalogVersion !==
        this.#workspaceForDocument(uri)?.session.catalogVersion
    )
      return undefined;
    return {
      version: result.documentVersion,
      diagnostics: toLspDiagnostics(result.diagnostics, result.sourcePath),
    };
  }

  /** 열린 원문을 우선하여 모든 저장 지식 문서를 진단하고 실패 관측을 분리한다. */
  async diagnostics(): Promise<
    | {
        documents: {
          uri: string;
          version?: number;
          diagnostics: Diagnostic[];
        }[];
        statuses: WorkspaceDiagnosticStatus[];
      }
    | undefined
  > {
    const epoch = this.#diagnosticEpoch;
    const documents: {
      uri: string;
      version?: number;
      diagnostics: Diagnostic[];
    }[] = [];
    const statuses: WorkspaceDiagnosticStatus[] = [];
    const history = new Map(this.#diagnosticHistory);
    const retained = new Set<string>();
    for (const workspace of this.#workspaces.values()) {
      const snapshot: WorkspaceDiagnosticsSnapshot | undefined =
        await workspace.session.diagnostics?.();
      if (epoch !== this.#diagnosticEpoch || this.#closed) return undefined;
      const failures: DiagnosticFailure[] = (snapshot?.failures ?? []).map(
        /** 같은 관측의 문서·진단을 게시 경계로 변환한다. */ (failure) => ({
          ...(failure.path
            ? {
                uri: pathToFileURL(
                  path.resolve(workspace.rootPath, failure.path),
                ).href,
              }
            : {}),
          reason: failure.message,
          previousDiagnostics: [],
        }),
      );
      const saved = new Map(
        (snapshot?.documents ?? []).map((document) => [document.uri, document]),
      );
      const failureSummary = failures
        .map((failure) => failure.reason)
        .join('; ');
      const uris = new Set([
        ...saved.keys(),
        ...this.documents
          .all()
          .filter(
            (document) =>
              this.#workspaceForDocument(document.uri) === workspace &&
              this.#isKnowledgeDocument(document.uri, workspace),
          )
          .map((document) => normalizeWorkspaceUri(document.uri)),
        ...(snapshot && snapshot.scanStatus !== scanStatuses.complete
          ? [...history]
              .filter(([, value]) => value.session === workspace.session)
              .map(([uri]) => uri)
          : []),
      ]);
      for (const uri of uris) {
        if (this.#workspaceForDocument(uri) !== workspace) continue;
        retained.add(uri);
        const open = this.documents
          .all()
          .find(
            (document) =>
              this.#workspaceForDocument(document.uri) === workspace &&
              normalizeWorkspaceUri(document.uri) === uri,
          );
        const disk = saved.get(uri);
        const previous =
          history.get(uri)?.session === workspace.session
            ? history.get(uri)
            : undefined;
        let diagnostics: Diagnostic[];
        let reason: string | undefined;
        let text: string | undefined;
        if (open) {
          text = open.getText();
          const live = await this.#references(open.uri);
          if (epoch !== this.#diagnosticEpoch || this.#closed) return undefined;
          if (live) {
            diagnostics = toLspDiagnostics(live.diagnostics, live.sourcePath);
            if (live.scanStatus !== scanStatuses.complete)
              reason = failureSummary || '색인을 일부 확인하지 못했습니다.';
          } else {
            diagnostics = previous?.text === text ? previous.diagnostics : [];
            reason =
              this.#referenceFailures.get(open.uri)?.message ??
              '현재 문서의 진단을 확인하지 못했습니다.';
          }
        } else {
          text = disk?.text;
          diagnostics = disk?.confirmed
            ? toLspDiagnostics(disk.diagnostics, disk.path)
            : [];
          if (!disk?.confirmed)
            reason = failureSummary || '현재 저장 원문을 확인하지 못했습니다.';
        }
        documents.push({
          uri,
          ...(open ? { version: open.version } : {}),
          diagnostics,
        });
        if (reason)
          failures.push({
            uri,
            reason,
            previousDiagnostics: (
              previous?.diagnostics ??
              (disk ? toLspDiagnostics(disk.diagnostics, disk.path) : [])
            ).map((diagnostic) => diagnostic.message),
          });
        else
          history.set(uri, { session: workspace.session, text, diagnostics });
      }
      const grouped = new Map<string | undefined, DiagnosticFailure>();
      for (const failure of failures) {
        const previous = grouped.get(failure.uri);
        grouped.set(
          failure.uri,
          previous
            ? {
                ...failure,
                reason: [...new Set([previous.reason, failure.reason])].join(
                  '; ',
                ),
                previousDiagnostics: [
                  ...new Set([
                    ...previous.previousDiagnostics,
                    ...failure.previousDiagnostics,
                  ]),
                ],
              }
            : failure,
        );
      }
      statuses.push({
        workspaceUri: workspace.uri,
        failures: [...grouped.values()],
      });
    }
    for (const document of this.documents.all()) {
      const owner = this.#codeOwner(document.uri);
      if (!owner) continue;
      const result = await this.#code.forward(owner);
      if (
        !this.#currentCodeOwner(owner) ||
        epoch !== this.#diagnosticEpoch ||
        this.#closed
      )
        return undefined;
      const existing = documents.find(
        (item) =>
          normalizeWorkspaceUri(item.uri) ===
          normalizeWorkspaceUri(document.uri),
      );
      if (existing) existing.diagnostics.push(...result.diagnostics);
      else
        documents.push({
          uri: document.uri,
          version: document.version,
          diagnostics: result.diagnostics,
        });
    }
    if (epoch !== this.#diagnosticEpoch || this.#closed) return undefined;
    this.#diagnosticHistory.clear();
    for (const [uri, value] of history)
      if (retained.has(uri)) this.#diagnosticHistory.set(uri, value);
    return { documents, statuses };
  }

  /** 프로젝트 지식 폴더 안의 YAML만 편집 중 지식 문서로 취급한다. */
  #isKnowledgeDocument(uri: string, workspace: WorkspaceBinding): boolean {
    const relative = this.#sourcePath(uri, workspace);
    return relative.startsWith('.codocs/') && /\.ya?ml$/iu.test(relative);
  }

  /** 최신 출처 소유권·버전·선택 근거를 확인하고 file URI만 반환한다. */
  async confirmSource(
    input: unknown,
  ): Promise<
    | { uri: string; destination?: WorkspaceSectionDestination }
    | ConfirmedCodeSource
    | null
  > {
    if (this.#code.has(input))
      return this.#code.confirm(input, (owner) =>
        this.#currentCodeOwner(owner),
      );
    return this.#selections.confirm(
      input,
      (uri, version, session) =>
        this.documents.get(uri)?.version === version &&
        this.#workspaceForDocument(uri)?.session === session,
    );
  }

  /**
   * 이름 바꾸기를 시작할 수 있는 위치인지 확인하고 바꿀 문서와 현재 이름을 돌려준다.
   * 문서의 name 값, 섹션 키, 하나의 문서(와 섹션)로 확정되는 참조에서만 시작할 수 있다.
   * 참조의 섹션 부분과 섹션 키는 섹션 이름 변경이고 참조의 이름 부분과 name 값은 문서 이름 변경이다.
   * @param request 편집 중인 문서와 커서 위치다.
   * @returns 시작할 수 없는 위치이면 null이다.
   */
  async prepareRename(
    request: PrepareRenameRequest,
  ): Promise<PrepareRenameResponse | null> {
    const uri = request.textDocument.uri;
    const document = this.documents.get(uri);
    const workspace = this.#workspaceForDocument(uri);
    if (!document || !workspace || !this.#isKnowledgeDocument(uri, workspace))
      return null;
    const offset = document.offsetAt(request.position);
    const text = document.getText();
    const ownPath = path.relative(workspace.rootPath, fileURLToPath(uri));
    const name = nameValueRange(text);
    if (name && name.range.start <= offset && offset <= name.range.end)
      return {
        kind: 'document',
        range: utf16OffsetsToRange(document, name.range),
        placeholder: name.name,
        targetPath: ownPath,
      };
    const key = sectionKeyAt(text, offset);
    if (key)
      return {
        kind: 'section',
        range: utf16OffsetsToRange(document, key.range),
        placeholder: key.section,
        targetPath: ownPath,
        section: key.section,
      };
    const version = document.version;
    const references = await this.#references(uri);
    if (
      !references ||
      this.documents.get(uri)?.version !== version ||
      references.catalogVersion !== workspace.session.catalogVersion
    )
      return null;
    const item = references.occurrences.find(
      ({ occurrence }) =>
        occurrence.offsetRange.start <= offset &&
        offset < occurrence.offsetRange.end,
    );
    const target = item?.resolution.target;
    if (!item) return null;
    const { status, section } = item.resolution;
    const part = referencePartAt(text, item.occurrence, offset);
    if (!part) return null;
    if (part.part === 'section') {
      if (
        section === undefined ||
        !target ||
        (status !== referenceResolutionStatuses.resolved &&
          status !== referenceResolutionStatuses.self)
      )
        return null;
      return {
        kind: 'section',
        range: utf16OffsetsToRange(document, part.range),
        placeholder: section,
        targetPath: target.path,
        section,
      };
    }
    // 같은 문서의 섹션 참조(self + section)는 이름 부분에서 그 문서의 이름 변경을 시작한다.
    if (
      target?.name === undefined ||
      (status !== referenceResolutionStatuses.resolved &&
        !(status === referenceResolutionStatuses.self && section !== undefined))
    )
      return null;
    return {
      kind: 'document',
      range: utf16OffsetsToRange(document, part.range),
      placeholder: target.name,
      targetPath: target.path,
    };
  }

  /** 파일과 색인을 바꾸지 않고 이름 변경을 계산한다. */
  async planRename(input: unknown): Promise<PlanRenameResponse> {
    const request = this.#renameRequest(input);
    if ('success' in request) return request;
    if (!request.workspace.session.previewRename)
      return renameFailure(renameRequestFailureCodes.renameUnsupported);
    const result = await request.workspace.session.previewRename(request.input);
    return {
      ...result,
      fileUris: this.#renameFileUris(request.workspace, [
        ...(result.success ? Object.keys(result.revisions) : []),
      ]),
    };
  }

  /** 미리보기와 같은 입력과 revision으로 이름 변경을 파일에 반영한다. */
  async applyRename(input: unknown): Promise<ApplyRenameResponse> {
    const request = this.#renameRequest(input);
    if ('success' in request) return request;
    if (!request.workspace.session.applyRename)
      return renameFailure(renameRequestFailureCodes.renameUnsupported);
    const result = await request.workspace.session.applyRename(request.input);
    return {
      ...result,
      fileUris: this.#renameFileUris(request.workspace, [
        ...result.files.map((file) => file.path),
        ...(result.success ? [] : Object.keys(result.preview?.revisions ?? {})),
      ]),
    };
  }

  /** 요청의 출처 문서로 작업 공간을 고르고 세션에 넘길 입력만 남긴다. */
  #renameRequest(
    input: unknown,
  ): { workspace: WorkspaceBinding; input: object } | RenameRequestFailure {
    const uri =
      typeof input === 'object' && input !== null && 'textDocument' in input
        ? (input.textDocument as { uri?: unknown } | null)?.uri
        : undefined;
    const workspace =
      typeof uri === 'string' ? this.#workspaceForDocument(uri) : undefined;
    if (!workspace || typeof input !== 'object' || input === null)
      return renameFailure(renameRequestFailureCodes.workspaceNotFound);
    // 세션은 대상·새 이름·선택·revision만 읽고 나머지 필드는 무시한다.
    return { workspace, input };
  }

  /** 프로젝트 상대 경로를 작업 공간 루트 기준 file URI로 바꾼다. */
  #renameFileUris(
    workspace: WorkspaceBinding,
    paths: readonly string[],
  ): RenameFileUris['fileUris'] {
    return Object.fromEntries(
      [...new Set(paths)].map((item) => [
        item,
        pathToFileURL(path.resolve(workspace.rootPath, item)).href,
      ]),
    );
  }

  /** 마커와 YAML 참조 위치의 표준 Hover를 만든다. 그 밖의 위치에는 Hover가 없다. */
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
    const owner = this.#codeOwner(uri);
    if (owner) await this.#prepareCodeBuffers(owner.session);
    if (
      owner &&
      this.#code.markerAt(owner, snapshot.offsetAt(params.position))
    ) {
      const hover = await this.#code.markerHover(
        owner,
        snapshot.offsetAt(params.position),
      );
      return this.#currentCodeOwner(owner) &&
        !cancellation?.isCancellationRequested
        ? hover
        : null;
    }
    if (/\.ya?ml$/iu.test(fileURLToPath(uri))) {
      const references = await this.#references(uri);
      const failure = this.#referenceFailures.get(uri);
      if (
        failure &&
        !cancellation?.isCancellationRequested &&
        this.#isCurrentSnapshot(
          uri,
          snapshotVersion,
          snapshotText,
          workspace,
          snapshot,
        )
      )
        return createStatusHover(workspace.session.readiness, failure);
      if (
        !references ||
        references.catalogVersion !== workspace.session.catalogVersion ||
        cancellation?.isCancellationRequested ||
        !this.#isCurrentSnapshot(
          uri,
          snapshotVersion,
          snapshotText,
          workspace,
          snapshot,
        )
      )
        return null;
      const offset = snapshot.offsetAt(params.position);
      const item = references.occurrences.find(
        ({ occurrence }) =>
          occurrence.offsetRange.start <= offset &&
          offset < occurrence.offsetRange.end,
      );
      const empty = createEmptyHover(
        references.scanStatus !== scanStatuses.complete,
      );
      const reverse =
        owner && this.#isKnowledgeDocument(uri, workspace)
          ? await this.#code.reverseHover(owner, params.position.line)
          : '';
      if (
        cancellation?.isCancellationRequested ||
        (owner && !this.#currentCodeOwner(owner))
      )
        return null;
      if (!item)
        return reverse
          ? { contents: { kind: 'markdown', value: reverse } }
          : empty;
      const targets = references.targets.filter(
        /** 해당 참조 출현에 속하는 디스크 후보만 선택한다. */ (
          target,
        ): target is WorkspacePathDocumentResult =>
          target.found &&
          item.resolution.candidates.some(
            (candidate) => candidate.path === target.path,
          ),
      );
      if (!targets.length)
        return reverse
          ? { contents: { kind: 'markdown', value: reverse } }
          : empty;
      const lines = targets.map(
        /** 선택한 이름 후보마다 독립 링크를 표시한다. */ (detail) => {
          const target = this.#target(
            uri,
            workspace,
            detail,
            references.catalogVersion,
            item,
            true,
          );
          const label = escapeMarkdown(detailLabel(detail, targets));
          return target ? `- [${label}](${target})` : `- ${label}`;
        },
      );
      const notice = empty?.contents;
      return {
        contents: {
          kind: 'markdown',
          value:
            lines.join('\n') +
            (reverse ? `\n\n${reverse}` : '') +
            (notice &&
            !Array.isArray(notice) &&
            typeof notice === 'object' &&
            'value' in notice
              ? `\n\n${notice.value}`
              : ''),
        },
        range: item.occurrence.range,
      };
    }
    return null;
  }

  /** 서버가 발급하지 않은 외부 URI·명령의 resolve를 거부한다. */
  resolveDocumentLink(link: DocumentLink): DocumentLink | null {
    const prefix = 'command:codocs.openSource?';
    if (!link.target?.startsWith(prefix)) return null;
    try {
      const input: unknown = JSON.parse(
        decodeURIComponent(link.target.slice(prefix.length)),
      );
      return Array.isArray(input) &&
        input.length === 1 &&
        (this.#selections.has(input[0]) || this.#code.has(input[0]))
        ? link
        : null;
    } catch {
      return null;
    }
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
    this.#diagnosticEpoch++;
    this.#diagnosticHistory.clear();
    this.#selections.release();
    this.#code.release();
    this.#live.clear();
    this.#referenceFailures.clear();
    this.#changes.clear();
    const sessions = [...this.#workspaces.values()].map(
      (workspace) => workspace.session,
    );
    this.#workspaces.clear();
    this.documents.clear();
    await Promise.all(sessions.map((session) => session.close()));
  }

  /** 초기화 목록 전체를 새 세션 집합으로 교체한다. */
  async #replaceWorkspaces(folders: readonly WorkspaceFolder[]): Promise<void> {
    this.#diagnosticEpoch++;
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
    const session = this.#sessionFactory(rootPath);
    this.#diagnosticEpoch++;
    this.#workspaces.set(uri, {
      uri,
      rootPath,
      session,
    });
    let codeObservation = '';
    session.onDidChangeCodeReferences?.(
      /** 변경된 코드 관측만 갱신하며 동일 catalog 게시의 재조회 순환을 막는다. */ (
        snapshot,
      ) => {
        if (this.#workspaces.get(uri)?.session !== session) return;
        const generation = `${snapshot.codeGeneration}/${snapshot.documentGeneration}`;
        const observation = JSON.stringify([
          generation,
          snapshot.status,
          snapshot.confirmedCount,
          snapshot.failures,
        ]);
        if (observation === codeObservation) return;
        codeObservation = observation;
        for (const listener of this.#changes) listener();
      },
    );
    session.onDidChangeSnapshot?.(
      /** 게시 완료된 관측만 캐시와 진단을 갱신한다. */ () => {
        if (this.#workspaces.get(uri)?.session !== session) return;
        this.#diagnosticEpoch++;
        this.#live.clear();
        this.#referenceFailures.clear();
        for (const listener of this.#changes) listener();
      },
    );
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
    this.#diagnosticEpoch++;
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
    expectedDocument: TextDocument,
  ): boolean {
    const current = this.documents.get(uri);
    return (
      current?.version === version &&
      current === expectedDocument &&
      current.getText() === text &&
      this.#workspaceForDocument(uri) === workspace
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

/** 이름 변경 요청을 시작하지 못한 고정 실패를 만든다. */
function renameFailure(
  code: RenameRequestFailure['error']['code'],
): RenameRequestFailure {
  return {
    success: false,
    error: {
      code,
      message:
        code === renameRequestFailureCodes.workspaceNotFound
          ? '출처 문서의 작업 공간을 찾을 수 없습니다.'
          : '작업 공간 세션이 이름 변경을 지원하지 않습니다.',
    },
  };
}

/** 같은 행의 이름 링크와 명시 표기의 범위 교집합을 확인한다. */
function rangesOverlap(left: Range, right: Range): boolean {
  /** 위치가 다른 위치보다 앞서는지 UTF-16 순서로 확인한다. */
  const before = (a: Range['start'], b: Range['start']): boolean =>
    a.line < b.line || (a.line === b.line && a.character < b.character);
  return before(left.start, right.end) && before(right.start, left.end);
}
