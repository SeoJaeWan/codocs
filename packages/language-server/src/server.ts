/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- LSP SDK 등록 콜백은 공개 선언 함수가 아니다. */
import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type Connection,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import {
  documentMatchRequestMethod,
  LanguageServerSession,
  workspaceRefreshRequestMethod,
  type DocumentMatchRequest,
  type DocumentMatchResponse,
  type WorkspaceRefreshRequest,
} from './server-session.js';

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
  connection.onInitialize(async (params): Promise<InitializeResult> => {
    supportsWorkspaceFolderChanges =
      params.capabilities.workspace?.workspaceFolders === true;
    await session.initialize(params);
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Full,
        },
        workspace: {
          workspaceFolders: {
            supported: true,
            changeNotifications: true,
          },
        },
      },
      serverInfo: { name: 'codocs-language-server' },
    };
  });
  connection.onDidOpenTextDocument((params) => {
    const update = session.openDocument(params);
    if (!update.accepted)
      logger.error(
        `didOpen ignored: ${params.textDocument.uri} (${update.reason})`,
      );
  });
  connection.onDidChangeTextDocument((params) => {
    const update = session.changeDocument(params);
    if (!update.accepted)
      logger.error(
        `didChange ignored: ${params.textDocument.uri} (${update.reason})`,
      );
  });
  connection.onDidCloseTextDocument((params) => {
    session.closeDocument(params.textDocument.uri);
  });
  connection.onInitialized(() => {
    if (!supportsWorkspaceFolderChanges) return;
    connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
      await session.changeWorkspaceFolders(event.added, event.removed);
    });
  });
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
  connection.onShutdown(async () => {
    await session.close();
  });
  connection.onExit(() => {
    void session.close().catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : String(error));
    });
  });
  return { session, listen: () => connection.listen() };
}

/** argv에서 선택한 stdio 또는 Node IPC 전송으로 실제 서버를 시작한다. */
export function runLanguageServer(): LanguageServerRuntime {
  const runtime = bindLanguageServer(createConnection(ProposedFeatures.all));
  runtime.listen();
  return runtime;
}
