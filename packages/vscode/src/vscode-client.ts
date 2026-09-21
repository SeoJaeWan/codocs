/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- VS Code 이벤트 adapter 콜백은 SDK 타입으로 설명한다. */
import * as vscode from 'vscode';
import {
  CloseAction,
  ErrorAction,
  LanguageClient,
  State,
  TransportKind,
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
} from './client-manager.js';
import { bundledServerPath } from './package-paths.js';
import { isOwnedByWorkspaceRoot } from './workspace-routing.js';

const refreshMethod = 'codocs/refresh';

/** 실제 VS Code API와 language client SDK를 소유하는 확장 runtime이다. */
export class VscodeExtensionRuntime {
  readonly #context: vscode.ExtensionContext;
  readonly #output: vscode.OutputChannel;
  readonly #manager: WorkspaceClientManager;
  readonly #disposables: vscode.Disposable[] = [];

  /** 확장 context에서 서버 경로와 VS Code host adapter를 구성한다. */
  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
    this.#output = vscode.window.createOutputChannel('Codocs');
    const host = this.#workspaceHost();
    this.#manager = new WorkspaceClientManager(host, (folder) =>
      this.#createFolderClient(folder),
    );
  }

  /** 명령과 workspace 연결을 활성화한다. */
  async activate(): Promise<void> {
    this.#disposables.push(
      vscode.commands.registerCommand(
        'codocs.restartLanguageServers',
        async () => this.#manager.restartAll(),
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

  #workspaceHost(): WorkspaceHostBoundary {
    return {
      folders: () =>
        (vscode.workspace.workspaceFolders ?? []).map(toFolderBoundary),
      onDidChangeFolders: (listener): DisposableBoundary =>
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
          listener({
            added: event.added.map(toFolderBoundary),
            removed: event.removed.map(toFolderBoundary),
          });
        }),
      reportFailure: (message, error) => {
        this.#output.appendLine(`${message} ${errorMessage(error)}`);
      },
    };
  }

  #createFolderClient(folder: WorkspaceFolderBoundary): FolderClientBoundary {
    const vscodeFolder = workspaceFolder(folder.uri);
    if (!vscodeFolder)
      throw new Error(`Workspace folder를 찾을 수 없습니다: ${folder.uri}`);
    return new VscodeFolderClient(
      vscodeFolder,
      bundledServerPath(this.#context.extensionPath),
      this.#output,
    );
  }
}

/** folder마다 Node IPC 프로세스 하나와 watcher를 관리한다. */
class VscodeFolderClient implements FolderClientBoundary {
  readonly #folder: vscode.WorkspaceFolder;
  readonly #serverPath: string;
  readonly #output: vscode.OutputChannel;
  readonly #budget = new RollingRestartBudget();
  readonly #disposables: vscode.Disposable[] = [];
  #client: LanguageClient | undefined;
  #stopping = false;

  constructor(
    folder: vscode.WorkspaceFolder,
    serverPath: string,
    output: vscode.OutputChannel,
  ) {
    this.#folder = folder;
    this.#serverPath = serverPath;
    this.#output = output;
  }

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
    const refresh = () => this.#refresh();
    this.#disposables.push(
      directoryWatcher,
      contentsWatcher,
      directoryWatcher.onDidCreate(refresh),
      directoryWatcher.onDidChange(refresh),
      directoryWatcher.onDidDelete(refresh),
      contentsWatcher.onDidCreate(refresh),
      contentsWatcher.onDidChange(refresh),
      contentsWatcher.onDidDelete(refresh),
      client.onDidChangeState((event) => {
        if (event.newState === State.Running)
          this.#output.appendLine(
            `Codocs language server가 연결되었습니다: ${this.#folder.name}`,
          );
      }),
    );
    await client.start();
  }

  async restart(): Promise<void> {
    this.#budget.reset();
    if (!this.#client) {
      await this.start();
      return;
    }
    await this.#client.restart();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    for (const disposable of this.#disposables.splice(0)) disposable.dispose();
    const client = this.#client;
    this.#client = undefined;
    if (client) await client.dispose();
  }

  #documentMiddleware(): Middleware {
    const synchronized = new Set<string>();
    const owns = (document: vscode.TextDocument): boolean => {
      if (document.uri.scheme !== 'file') return false;
      return isOwnedByWorkspaceRoot(
        document.uri.fsPath,
        {
          fsPath: this.#folder.uri.fsPath,
          uri: this.#folder.uri.toString(),
        },
        (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          fsPath: folder.uri.fsPath,
          uri: folder.uri.toString(),
        })),
      );
    };
    return {
      didOpen: async (document, next) => {
        if (!owns(document)) return;
        synchronized.add(document.uri.toString());
        await next(document);
      },
      didChange: async (event, next) => {
        if (!synchronized.has(event.document.uri.toString())) return;
        await next(event);
      },
      didClose: async (document, next) => {
        if (!synchronized.delete(document.uri.toString())) return;
        await next(document);
      },
    };
  }

  #errorHandler(): ErrorHandler {
    return {
      error: (_error, _message, count) => ({
        action: (count ?? 0) < 3 ? ErrorAction.Continue : ErrorAction.Shutdown,
      }),
      closed: async () => {
        if (this.#stopping) return { action: CloseAction.DoNotRestart };
        if (this.#budget.recordFailure())
          return { action: CloseAction.Restart };
        await this.#showStoppedMessage();
        return { action: CloseAction.DoNotRestart, handled: true };
      },
    };
  }

  #refresh(): void {
    const client = this.#client;
    if (!client?.isRunning()) return;
    client
      .sendRequest(refreshMethod, {
        workspaceUri: this.#folder.uri.toString(),
      })
      .catch((error: unknown) => {
        this.#output.appendLine(
          `Codocs knowledge 갱신에 실패했습니다: ${errorMessage(error)}`,
        );
      });
  }

  #reportStopped(error: unknown): void {
    this.#output.appendLine(
      `Codocs language server가 반복해서 시작하지 못해 중지되었습니다 (${this.#folder.name}): ${errorMessage(error)}. “Codocs: Restart Language Servers” 명령을 실행하세요.`,
    );
  }

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
