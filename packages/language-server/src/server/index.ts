import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type Connection,
} from 'vscode-languageserver/node.js';
import {
  documentMatchRequestMethod,
  LanguageServerSession,
  workspaceRefreshRequestMethod,
  type DocumentMatchRequest,
  type DocumentMatchResponse,
  type WorkspaceRefreshRequest,
} from '../server-session/index.js';
import {
  confirmSourceMethod,
  snapshotChangedMethod,
} from '../navigation/index.js';
import { diagnosticStatusMethod } from '../diagnostics/index.js';
import { observePerformanceEvent } from '../performance-observation/index.js';

/** 프로토콜 외 로그를 stdout과 분리하는 최소 로거다. */
export interface ServerLogger {
  error(message: string): void;
}

/** 등록된 연결과 종료 가능한 세션을 함께 반환한다. */
export interface LanguageServerRuntime {
  session: LanguageServerSession;
  listen(): void;
}

const stderrLogger: ServerLogger = {
  /** LSP 프레임을 오염시키지 않고 서버 오류를 기록한다. */
  error(message: string): void {
    process.stderr.write(`${message}\n`);
  },
};

/** 기존 Connection에 초기화·동기화·매칭·종료 핸들러를 등록한다. */
export function bindLanguageServer(
  connection: Connection,
  session = new LanguageServerSession(),
  logger: ServerLogger = stderrLogger,
): LanguageServerRuntime {
  let supportsWorkspaceFolderChanges = false;
  let generation = 0;
  let stopped = false;
  let published = new Set<string>();
  /** 편집 시 이전 범위를 즉시 지우고 최신 전체 관측만 게시한다. */
  const publish = (changedUri?: string): void => {
    const current = ++generation;
    if (changedUri) {
      const document = session.documents.get(changedUri);
      void connection
        .sendDiagnostics({
          uri: changedUri,
          ...(document ? { version: document.version } : {}),
          diagnostics: [],
        })
        .catch((error: unknown) => logger.error(String(error)));
    }
    void session
      .diagnostics()
      .then(
        /** 같은 관측의 문서·진단을 게시 경계로 변환한다. */ async (result) => {
          if (!result || current !== generation || stopped) return;
          const next = new Set(result.documents.map((item) => item.uri));
          const removed = [...published].filter((uri) => !next.has(uri));
          published = next;
          // 전송 호출 사이에 await를 두지 않아 다른 세대의 게시와 섞이지 않는다.
          await Promise.all([
            ...result.documents.map((document) =>
              connection.sendDiagnostics(document),
            ),
            ...removed.map((uri) =>
              connection.sendDiagnostics({ uri, diagnostics: [] }),
            ),
            connection.sendNotification(
              diagnosticStatusMethod,
              result.statuses,
            ),
          ]);
        },
      )
      .catch((error: unknown) => logger.error(String(error)));
    if (!changedUri)
      void connection
        .sendNotification(snapshotChangedMethod)
        .catch((error: unknown) => logger.error(String(error)));
  };
  session.onDidChange(publish);
  /** LSP 초기화 요청을 세션에 적용하고 서버 capability를 반환한다. */
  const initialize: Parameters<Connection['onInitialize']>[0] = async (
    params,
  ) => {
    supportsWorkspaceFolderChanges =
      params.capabilities.workspace?.workspaceFolders === true;
    await session.initialize(params);
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Full,
        },
        hoverProvider: true,
        inlayHintProvider: true,
        documentLinkProvider: { resolveProvider: true },
        workspace: {
          workspaceFolders: {
            supported: true,
            changeNotifications: true,
          },
        },
      },
      serverInfo: { name: 'codocs-language-server' },
    };
  };
  connection.onInitialize(initialize);
  /** 열린 문서를 세션에 저장하고 무시된 요청을 기록한다. */
  const didOpenTextDocument: Parameters<
    Connection['onDidOpenTextDocument']
  >[0] = (params) => {
    const update = session.openDocument(params);
    if (!update.accepted)
      logger.error(
        `didOpen ignored: ${params.textDocument.uri} (${update.reason})`,
      );
  };
  connection.onDidOpenTextDocument(didOpenTextDocument);
  /** 변경된 문서를 세션에 반영하고 무시된 요청을 기록한다. */
  const didChangeTextDocument: Parameters<
    Connection['onDidChangeTextDocument']
  >[0] = (params) => {
    const update = session.changeDocument(params);
    if (!update.accepted)
      logger.error(
        `didChange ignored: ${params.textDocument.uri} (${update.reason})`,
      );
  };
  connection.onDidChangeTextDocument(didChangeTextDocument);
  /** 닫힌 문서를 세션에서 제거한다. */
  const didCloseTextDocument: Parameters<
    Connection['onDidCloseTextDocument']
  >[0] = (params) => {
    session.closeDocument(params.textDocument.uri);
  };
  connection.onDidCloseTextDocument(didCloseTextDocument);
  /** 표준 Hover 요청을 최신 문서와 같은 catalog 관측으로 처리한다. */
  const hover: Parameters<Connection['onHover']>[0] = (params, token) =>
    session.hoverDocument(params, token);
  connection.onHover(hover);
  connection.languages.inlayHint.on((params, token) =>
    session.inlayHints(params.textDocument.uri, token),
  );
  connection.onDocumentLinks((params, token) =>
    session.documentLinks(params.textDocument.uri, token),
  );
  connection.onDocumentLinkResolve((link) => session.resolveDocumentLink(link));
  connection.onRequest(confirmSourceMethod, (input: unknown) =>
    session.confirmSource(input),
  );
  /** 초기화 완료 뒤 workspace folder 변경 알림을 등록한다. */
  const initialized: Parameters<Connection['onInitialized']>[0] = () => {
    publish();
    if (!supportsWorkspaceFolderChanges) return;
    /** workspace folder 변경을 세션에 반영한다. */
    const changeWorkspaceFolders: Parameters<
      typeof connection.workspace.onDidChangeWorkspaceFolders
    >[0] = async (event) => {
      await session.changeWorkspaceFolders(event.added, event.removed);
      publish();
    };
    connection.workspace.onDidChangeWorkspaceFolders(changeWorkspaceFolders);
  };
  connection.onInitialized(initialized);
  connection.onRequest(
    documentMatchRequestMethod,
    async (request: DocumentMatchRequest): Promise<DocumentMatchResponse> =>
      session.matchDocument(request),
  );
  connection.onRequest(
    workspaceRefreshRequestMethod,
    async (request: WorkspaceRefreshRequest | undefined) =>
      session.refreshWorkspaces(request),
  );
  /** 종료 요청을 받으면 세션을 닫는다. */
  const shutdown = async (): Promise<void> => {
    stopped = true;
    generation++;
    await session.close();
  };
  connection.onShutdown(shutdown);
  /** 프로세스 종료 시 세션 정리를 시도하고 실패를 기록한다. */
  const exit = (): void => {
    stopped = true;
    generation++;
    void session.close().catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : String(error));
    });
  };
  connection.onExit(exit);
  /** LSP transport listener를 시작한다. */
  const listen = (): void => connection.listen();
  return { session, listen };
}

/** argv에서 선택한 stdio 또는 Node IPC 전송으로 실제 서버를 시작한다. */
export function runLanguageServer(): LanguageServerRuntime {
  observePerformanceEvent('server-start', { folder: process.cwd() });
  const runtime = bindLanguageServer(createConnection(ProposedFeatures.all));
  runtime.listen();
  return runtime;
}
