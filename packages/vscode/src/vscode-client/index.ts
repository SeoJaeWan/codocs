import * as vscode from 'vscode';
import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  State,
  TransportKind,
  HoverRequest,
  DocumentLinkRequest,
  type ErrorHandler,
  type LanguageClientOptions,
  type Middleware,
  type ServerOptions,
} from 'vscode-languageclient/node.js';
import {
  RollingRestartBudget,
  WorkspaceClientManager,
  type DisposableBoundary,
  type FolderClientBoundary,
  type WorkspaceFolderBoundary,
  type WorkspaceHostBoundary,
} from '../client-manager/index.js';
import {
  openSource,
  openSourceCommand,
  confirmSourceMethod,
  snapshotChangedMethod,
  type OpenSourceCommandArgument,
  trustGeneratedOpenSourceHoverContents,
  type OpenSourceDocument,
  type OpenSourceHost,
  type OpenSourceShowOptions,
} from '../open-source/index.js';
import { bundledServerPath } from '../package-assembly/index.js';
import {
  isOwnedByWorkspaceRoot,
  type WorkspaceRoot,
} from '../workspace-routing/index.js';

const refreshMethod = 'codocs/refresh';

/** 실제 VS Code API와 language client SDK를 소유하는 확장 runtime이다. */
export class VscodeExtensionRuntime {
  readonly #context: vscode.ExtensionContext;
  readonly #output: vscode.OutputChannel;
  readonly #manager: WorkspaceClientManager;
  readonly #disposables: vscode.Disposable[] = [];
  readonly #clients = new Map<string, VscodeFolderClient>();

  /** 확장 context에서 서버 경로와 VS Code host adapter를 구성한다. */
  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
    this.#output = vscode.window.createOutputChannel('Codocs');
    const host = this.#workspaceHost();
    /** manager가 요청한 folder를 실제 VS Code client로 만든다. */
    const createFolderClient = (folder: WorkspaceFolderBoundary) =>
      this.#createFolderClient(folder);
    this.#manager = new WorkspaceClientManager(host, createFolderClient);
  }

  /** 명령과 workspace 연결을 활성화한다. */
  async activate(): Promise<void> {
    this.#disposables.push(
      vscode.commands.registerCommand(
        'codocs.restartLanguageServers',
        async () => this.#manager.restartAll(),
      ),
      vscode.commands.registerCommand(
        openSourceCommand,
        /** 검증한 선택을 탭 열기로 연결한다. */ async (argument) =>
          openSource(
            argument,
            vscodeOpenSourceHost(
              /** 출처 문서의 가장 가까운 client에 선택을 확인한다. */ async (
                selection,
              ) => {
                const folder = vscode.workspace.getWorkspaceFolder(
                  vscode.Uri.parse(selection.sourceUri),
                );
                return folder
                  ? this.#clients
                      .get(folder.uri.toString())
                      ?.confirmSource(selection)
                  : null;
              },
              (error) => this.#output.appendLine(errorMessage(error)),
            ),
          ),
      ),
    );
    await this.#manager.activate();
  }

  /** 명령·watcher·listener·client와 서버 프로세스를 정리한다. */
  async deactivate(): Promise<void> {
    for (const disposable of this.#disposables.splice(0)) disposable.dispose();
    await this.#manager.deactivate();
    this.#output.dispose();
  }

  /** VS Code workspace API를 테스트 가능한 host 경계로 감싼다. */
  #workspaceHost(): WorkspaceHostBoundary {
    /** 현재 VS Code workspace folder 목록을 경계 타입으로 반환한다. */
    const folders = (): WorkspaceFolderBoundary[] =>
      (vscode.workspace.workspaceFolders ?? []).map(toFolderBoundary);
    /** VS Code folder 변경을 manager 경계 이벤트로 변환한다. */
    const onDidChangeFolders = (
      listener: Parameters<WorkspaceHostBoundary['onDidChangeFolders']>[0],
    ): DisposableBoundary => {
      /** VS Code folder 변경 이벤트를 manager listener에 전달한다. */
      const handleFolderChange = (
        event: vscode.WorkspaceFoldersChangeEvent,
      ) => {
        listener({
          added: event.added.map(toFolderBoundary),
          removed: event.removed.map(toFolderBoundary),
        });
      };
      return vscode.workspace.onDidChangeWorkspaceFolders(handleFolderChange);
    };
    /** VS Code output channel에 host 경계 오류를 기록한다. */
    const reportFailure = (message: string, error: unknown): void => {
      this.#output.appendLine(`${message} ${errorMessage(error)}`);
    };
    return {
      folders,
      onDidChangeFolders,
      reportFailure,
    };
  }

  /** 직렬화한 folder 경계를 실제 VS Code folder client로 연결한다. */
  #createFolderClient(folder: WorkspaceFolderBoundary): FolderClientBoundary {
    const vscodeFolder = workspaceFolder(folder.uri);
    if (!vscodeFolder)
      throw new Error(`Workspace folder를 찾을 수 없습니다: ${folder.uri}`);
    const client = new VscodeFolderClient(
      vscodeFolder,
      bundledServerPath(this.#context.extensionPath),
      this.#output,
    );
    this.#clients.set(folder.uri, client);
    return client;
  }
}

/** folder마다 Node IPC 프로세스 하나와 watcher를 관리한다. */
export class VscodeFolderClient implements FolderClientBoundary {
  readonly #folder: vscode.WorkspaceFolder;
  readonly #serverPath: string;
  readonly #output: vscode.OutputChannel;
  readonly #budget = new RollingRestartBudget();
  readonly #disposables: vscode.Disposable[] = [];
  #client: LanguageClient | undefined;
  #stopping = false;
  #providers: vscode.Disposable[] = [];
  #providerGeneration = 0;
  #sessionGeneration = 0;

  /** 대상 URI가 아니라 출처 문서의 소유 client에서 선택을 확인한다. */
  async confirmSource(argument: OpenSourceCommandArgument): Promise<unknown> {
    const client = this.#client;
    const generation = this.#sessionGeneration;
    const document = vscode.workspace.textDocuments.find(
      (item) => item.uri.toString() === argument.sourceUri,
    );
    const version = document?.version;
    if (
      !client?.isRunning() ||
      !document ||
      document.isClosed ||
      vscode.workspace
        .getWorkspaceFolder(vscode.Uri.parse(argument.sourceUri))
        ?.uri.toString() !== this.#folder.uri.toString()
    )
      return null;
    const result: unknown = await client.sendRequest(
      confirmSourceMethod,
      argument,
    );
    return this.#client === client &&
      client.isRunning() &&
      generation === this.#sessionGeneration &&
      !document.isClosed &&
      document.version === version &&
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() ===
        this.#folder.uri.toString()
      ? result
      : null;
  }

  /** 완료 snapshot 게시 때 provider를 재등록해 Host의 이전 링크 캐시를 무효화한다. */
  #registerProviders(client: LanguageClient): void {
    ++this.#providerGeneration;
    for (const provider of this.#providers.splice(0)) provider.dispose();
    if (this.#client !== client || !client.isRunning()) return;
    /** 중첩 workspace에서는 가장 가까운 출처 소유권을 확인한다. */
    const owns = (document: vscode.TextDocument): boolean =>
      document.uri.scheme === 'file' &&
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() ===
        this.#folder.uri.toString();
    this.#providers.push(
      vscode.languages.registerHoverProvider(
        { scheme: 'file' },
        {
          /** 최신 서버 Hover만 Host Markdown으로 변환한다. */
          provideHover: async (document, position, token) => {
            if (!owns(document)) return undefined;
            const hover = await this.#latestQuery(
              client,
              document,
              token,
              owns,
              /** 새 관측에서 Hover를 다시 요청한다. */ async () =>
                client.protocol2CodeConverter.asHover(
                  await client.sendRequest(
                    HoverRequest.type,
                    {
                      textDocument: { uri: document.uri.toString() },
                      position,
                    },
                    token,
                  ),
                ),
            );
            if (hover) trustGeneratedOpenSourceHoverContents(hover.contents);
            return hover;
          },
        },
      ),
      vscode.languages.registerDocumentLinkProvider(
        { scheme: 'file' },
        {
          /** 본문은 서버가 제공한 단일 확인 command만 표시한다. */
          provideDocumentLinks: async (document, token) => {
            if (!owns(document)) return [];
            return (
              (await this.#latestQuery(
                client,
                document,
                token,
                owns,
                /** 새 관측에서 본문 링크를 다시 요청한다. */ async () =>
                  client.protocol2CodeConverter.asDocumentLinks(
                    await client.sendRequest(
                      DocumentLinkRequest.type,
                      { textDocument: { uri: document.uri.toString() } },
                      token,
                    ),
                    token,
                  ),
              )) ?? []
            );
          },
        },
      ),
    );
  }

  /** 표시 관측만 교체되면 재조회하고 출처·서버가 무효해지면 즉시 폐기한다. */
  async #latestQuery<T>(
    client: LanguageClient,
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
    owns: (document: vscode.TextDocument) => boolean,
    query: () => Promise<T>,
  ): Promise<T | undefined> {
    const version = document.version;
    const session = this.#sessionGeneration;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (
        token.isCancellationRequested ||
        document.isClosed ||
        document.version !== version ||
        !owns(document) ||
        this.#client !== client ||
        !client.isRunning() ||
        session !== this.#sessionGeneration
      )
        return undefined;
      const epoch = this.#providerGeneration;
      const result = await query();
      if (
        token.isCancellationRequested ||
        document.isClosed ||
        document.version !== version ||
        !owns(document) ||
        this.#client !== client ||
        !client.isRunning() ||
        session !== this.#sessionGeneration
      )
        return undefined;
      if (epoch === this.#providerGeneration) return result;
    }
    return undefined;
  }

  /** 실제 workspace folder와 서버 경로를 관리하는 client를 만든다. */
  constructor(
    folder: vscode.WorkspaceFolder,
    serverPath: string,
    output: vscode.OutputChannel,
  ) {
    this.#folder = folder;
    this.#serverPath = serverPath;
    this.#output = output;
  }

  /** folder용 watcher와 language client를 시작한다. */
  async start(): Promise<void> {
    if (this.#client) return;
    this.#stopping = false;
    const directoryWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.#folder, '.codocs'),
    );
    const contentsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.#folder, '.codocs/**'),
    );
    const serverOptions: ServerOptions = {
      module: this.#serverPath,
      transport: TransportKind.ipc,
      options: { cwd: this.#folder.uri.fsPath },
    };
    const clientOptions: LanguageClientOptions = {
      workspaceFolder: this.#folder,
      // SDK selector는 넓게 두고 middleware가 중첩 workspace의 가장 가까운 루트만 통과시킨다.
      documentSelector: [{ scheme: 'file' }],
      middleware: this.#documentMiddleware(),
      errorHandler: this.#errorHandler(),
      /** 시작 실패를 제한된 횟수만 자동 재시작한다. */
      initializationFailedHandler: (error) => {
        const restart = this.#budget.recordFailure();
        if (!restart) this.#reportStopped(error);
        return restart;
      },
      outputChannel: this.#output,
      synchronize: { fileEvents: [directoryWatcher, contentsWatcher] },
    };
    const client = new LanguageClient(
      `codocs-${this.#folder.index}`,
      `Codocs (${this.#folder.name})`,
      serverOptions,
      clientOptions,
    );
    this.#client = client;
    this.#disposables.push(
      client.onNotification(snapshotChangedMethod, () =>
        this.#registerProviders(client),
      ),
    );
    /** knowledge 파일 변경 뒤 해당 작업 공간의 catalog를 갱신한다. */
    const refresh = () => this.#refresh();
    /** 실행 상태가 되면 연결 사실을 output channel에 기록한다. */
    const reportRunning = (event: { newState: State }): void => {
      this.#sessionGeneration++;
      if (event.newState === State.Running) {
        this.#registerProviders(client);
        this.#output.appendLine(
          `Codocs language server가 연결되었습니다: ${this.#folder.name}`,
        );
      }
    };
    this.#disposables.push(
      directoryWatcher,
      contentsWatcher,
      directoryWatcher.onDidCreate(refresh),
      directoryWatcher.onDidChange(refresh),
      directoryWatcher.onDidDelete(refresh),
      contentsWatcher.onDidCreate(refresh),
      contentsWatcher.onDidChange(refresh),
      contentsWatcher.onDidDelete(refresh),
      client.onDidChangeState(reportRunning),
    );
    await client.start();
    this.#registerProviders(client);
  }

  /** 시작 중인 client를 정리하고 현재 열린 문서를 다시 동기화한다. */
  async restart(): Promise<void> {
    if (this.#client?.state === State.Starting)
      await this.#waitForStartTransition(this.#client);
    await this.stop();
    this.#budget.reset();
    await this.start();
  }

  /** watcher·listener·language client와 서버 프로세스를 종료한다. */
  async stop(): Promise<void> {
    this.#stopping = true;
    this.#sessionGeneration++;
    this.#providerGeneration += 1;
    for (const provider of this.#providers.splice(0)) provider.dispose();
    for (const disposable of this.#disposables.splice(0)) disposable.dispose();
    const client = this.#client;
    this.#client = undefined;
    if (client) await client.dispose();
  }

  /** 현재 folder가 소유한 문서만 language client에 전달한다. */
  #documentMiddleware(): Middleware {
    const synchronized = new Set<string>();
    /** 현재 workspace folder를 경로 소유권 경계로 변환한다. */
    const root = (): WorkspaceRoot => ({
      fsPath: this.#folder.uri.fsPath,
      uri: this.#folder.uri.toString(),
    });
    /** 현재 host의 모든 workspace folder 경계를 반환한다. */
    const roots = (): WorkspaceRoot[] =>
      (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        fsPath: folder.uri.fsPath,
        uri: folder.uri.toString(),
      }));
    /** 현재 language client folder가 문서를 소유하는지 확인한다. */
    const owns = (document: vscode.TextDocument): boolean => {
      if (document.uri.scheme !== 'file') return false;
      return isOwnedByWorkspaceRoot(document.uri.fsPath, root(), roots());
    };
    return {
      /** 소유한 문서의 열림 이벤트를 LSP client에 전달한다. */
      didOpen: async (document, next) => {
        if (!owns(document)) return;
        synchronized.add(document.uri.toString());
        await next(document);
      },
      /** 이미 동기화한 문서의 변경 이벤트를 LSP client에 전달한다. */
      didChange: async (event, next) => {
        if (!synchronized.has(event.document.uri.toString())) return;
        await next(event);
      },
      /** 닫힌 문서를 동기화 집합에서 제거하고 LSP client에 전달한다. */
      didClose: async (document, next) => {
        if (!synchronized.delete(document.uri.toString())) return;
        await next(document);
      },
      /** Hover도 가장 가까운 workspace folder의 client에만 요청한다. */
      provideHover: () => undefined,
      /** 완료 관측마다 재등록하는 provider가 본문 링크를 담당한다. */
      provideDocumentLinks: () => [],
      /** 진단도 출처를 소유한 client의 게시만 반영한다. */
      handleDiagnostics: (uri, diagnostics, next) => {
        if (
          uri.scheme === 'file' &&
          isOwnedByWorkspaceRoot(uri.fsPath, root(), roots())
        )
          next(uri, diagnostics);
      },
    };
  }

  /** client가 Starting 상태에서 벗어날 때까지 기다린다. */
  async #waitForStartTransition(client: LanguageClient): Promise<void> {
    if (client.state !== State.Starting) return;
    /** language client 상태 변화를 기다리고 제한 시간을 적용한다. */
    const waitForTransition = (
      resolve: () => void,
      reject: (reason?: unknown) => void,
    ): void => {
      /** 시작 전환이 지연되면 대기를 실패시킨다. */
      const rejectAfterTimeout = (): void => {
        listener.dispose();
        reject(
          new Error(
            `Codocs language client 시작 전환이 완료되지 않았습니다: ${this.#folder.name}`,
          ),
        );
      };
      const timer = setTimeout(rejectAfterTimeout, 5_000);
      /** Starting 상태가 끝나면 대기 중인 작업을 재개한다. */
      const handleStateChange = (event: { newState: State }): void => {
        if (event.newState === State.Starting) return;
        clearTimeout(timer);
        listener.dispose();
        resolve();
      };
      const listener = client.onDidChangeState(handleStateChange);
    };
    await new Promise<void>(waitForTransition);
  }

  /** 예기치 않은 연결 오류의 재시작·중단 정책을 반환한다. */
  #errorHandler(): ErrorHandler {
    return {
      /** 오류 횟수에 따라 연결을 계속하거나 종료한다. */
      error: (_error, _message, count) => ({
        action: (count ?? 0) < 3 ? ErrorAction.Continue : ErrorAction.Shutdown,
      }),
      /** 종료 원인에 따라 자동 재시작 또는 사용자 안내를 선택한다. */
      closed: () => {
        if (this.#stopping) return { action: CloseAction.DoNotRestart };
        if (this.#budget.recordFailure())
          return { action: CloseAction.Restart };
        /** 중단 안내 표시 실패를 output channel에 기록한다. */
        const reportStoppedMessageFailure = (error: unknown): void => {
          this.#output.appendLine(
            `Codocs language server 중지 안내를 표시하지 못했습니다: ${errorMessage(error)}`,
          );
        };
        this.#showStoppedMessage().catch(reportStoppedMessageFailure);
        return { action: CloseAction.DoNotRestart, handled: true };
      },
    };
  }

  /** 현재 작업 공간의 catalog 갱신 요청을 서버에 보낸다. */
  #refresh(): void {
    const client = this.#client;
    if (!client?.isRunning()) return;
    /** catalog 갱신 요청 실패를 output channel에 기록한다. */
    const reportRefreshFailure = (error: unknown): void => {
      this.#output.appendLine(
        `Codocs knowledge 갱신에 실패했습니다: ${errorMessage(error)}`,
      );
    };
    client
      .sendRequest(refreshMethod, {
        workspaceUri: this.#folder.uri.toString(),
      })
      .catch(reportRefreshFailure);
  }

  /** 반복 시작 실패 뒤 중단 상태와 수동 복구 방법을 기록한다. */
  #reportStopped(error: unknown): void {
    this.#output.appendLine(
      `Codocs language server가 반복해서 시작하지 못해 중지되었습니다 (${this.#folder.name}): ${errorMessage(error)}. “Codocs: Restart Language Servers” 명령을 실행하세요.`,
    );
  }

  /** 중단 안내를 표시하고 사용자가 선택하면 수동 재시작한다. */
  async #showStoppedMessage(): Promise<void> {
    const restart = 'Restart Codocs';
    const selection = await vscode.window.showErrorMessage(
      `Codocs language server가 반복해서 종료되어 중지되었습니다: ${this.#folder.name}`,
      restart,
    );
    this.#output.appendLine(
      `Codocs language server가 중지되었습니다: ${this.#folder.name}. “Codocs: Restart Language Servers” 명령을 실행하세요.`,
    );
    if (selection === restart)
      await vscode.commands.executeCommand('codocs.restartLanguageServers');
  }
}

/** VS Code 문서와 원문 열기 경계가 공유하는 editor 관측이다. */
interface VscodeOpenSourceDocument extends OpenSourceDocument {
  document: vscode.TextDocument;
}

/** 현재 VS Code 문서를 저장·재로딩 없이 원문 열기 관측으로 변환한다. */
function toOpenSourceDocument(
  document: vscode.TextDocument,
): VscodeOpenSourceDocument {
  return {
    uri: document.uri.toString(),
    text: document.getText(),
    document,
  };
}

/** 열린 text tab 전체에서 URI가 같은 기존 group의 열을 찾는다. */
function existingTextTabColumn(uri: string): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === uri
      )
        return group.viewColumn;
    }
  }
  return undefined;
}

/** 원문 열기 순수 경계를 VS Code의 문서·탭 API에 연결한다. */
function vscodeOpenSourceHost(
  confirmSource: OpenSourceHost['confirmSource'],
  reportError: OpenSourceHost['reportError'],
): OpenSourceHost<VscodeOpenSourceDocument> {
  return {
    confirmSource,
    reportError,
    /** 이미 열린 dirty 문서를 포함해 URI가 같은 현재 buffer를 찾는다. */
    findOpenDocument: (uri) => {
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === uri,
      );
      return document ? toOpenSourceDocument(document) : undefined;
    },
    /** 보이지 않는 tab group을 포함해 기존 탭의 열을 찾는다. */
    findExistingViewColumn: existingTextTabColumn,
    /** 새 문서만 VS Code workspace를 통해 연다. */
    openDocument: async (uri) =>
      toOpenSourceDocument(
        await vscode.workspace.openTextDocument(vscode.Uri.parse(uri, true)),
      ),
    /** 기존 열과 검증된 선택 범위를 사용해 editor를 표시한다. */
    showDocument: async (source, options) => {
      await vscode.window.showTextDocument(
        source.document,
        vscodeShowOptions(options),
      );
    },
  };
}

/** 프로토콜 범위를 VS Code의 UTF-16 editor 범위로 바꾼다. */
function vscodeShowOptions(
  options: OpenSourceShowOptions,
): vscode.TextDocumentShowOptions {
  return {
    preview: options.preview,
    ...(options.viewColumn === undefined
      ? {}
      : { viewColumn: options.viewColumn }),
    ...(options.selection === undefined
      ? {}
      : {
          selection: new vscode.Range(
            options.selection.start.line,
            options.selection.start.character,
            options.selection.end.line,
            options.selection.end.character,
          ),
        }),
  };
}

/** VS Code folder를 serialization 가능한 manager 경계로 바꾼다. */
function toFolderBoundary(
  folder: vscode.WorkspaceFolder,
): WorkspaceFolderBoundary {
  return { name: folder.name, uri: folder.uri.toString() };
}

/** 현재 host 목록에서 같은 URI의 실제 folder 객체를 찾는다. */
function workspaceFolder(uri: string): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.find(
    (folder) => folder.uri.toString() === uri,
  );
}

/** 알 수 없는 throw 값을 사용자 안내 문자열로 바꾼다. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
