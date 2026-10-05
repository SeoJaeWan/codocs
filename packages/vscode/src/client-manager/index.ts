/** VS Code WorkspaceFolder에서 생명주기에 필요한 값만 남긴 경계다. */
export interface WorkspaceFolderBoundary {
  name: string;
  uri: string;
}

/** 이벤트 등록을 정리하는 최소 경계다. */
export interface DisposableBoundary {
  dispose(): void;
}

/** workspace folder 변경에서 추가·제거된 폴더 목록이다. */
export interface WorkspaceFolderChangeEvent {
  added: readonly WorkspaceFolderBoundary[];
  removed: readonly WorkspaceFolderBoundary[];
}

/** 폴더 하나에 고정된 language client와 server 프로세스 경계다. */
export interface FolderClientBoundary {
  start(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

/** Workspace API와 사용자 안내를 테스트 가능한 형태로 제한한다. */
export interface WorkspaceHostBoundary {
  folders(): readonly WorkspaceFolderBoundary[];
  onDidChangeFolders(
    listener: (event: WorkspaceFolderChangeEvent) => void,
  ): DisposableBoundary;
  reportFailure(message: string, error: unknown): void;
}

/** 폴더별 클라이언트를 만드는 호스트 adapter다. */
export type FolderClientFactory = (
  folder: WorkspaceFolderBoundary,
) => FolderClientBoundary;

/** 지정 시간 안의 연속 종료만 세어 무한 재시작을 막는다.
 * */
export class RollingRestartBudget {
  readonly #maximumRestarts: number;
  readonly #windowMilliseconds: number;
  #failures: number[] = [];

  /** 재시작 횟수와 관찰 구간을 명시해 정책을 만든다. */
  constructor(maximumRestarts = 3, windowMilliseconds = 60_000) {
    this.#maximumRestarts = maximumRestarts;
    this.#windowMilliseconds = windowMilliseconds;
  }

  /** 이번 종료 뒤 자동 재시작이 가능한지 계산한다. */
  recordFailure(now = Date.now()): boolean {
    this.#failures = this.#failures.filter(
      (failure) => now - failure <= this.#windowMilliseconds,
    );
    this.#failures.push(now);
    return this.#failures.length <= this.#maximumRestarts;
  }

  /** 사용자가 수동으로 재시작하면 이전 실패 묶음을 지운다. */
  reset(): void {
    this.#failures = [];
  }
}

/** 동적인 workspace folder 목록과 일대일 클라이언트 생명주기를 맞춘다.
 * */
export class WorkspaceClientManager {
  readonly #host: WorkspaceHostBoundary;
  readonly #factory: FolderClientFactory;
  readonly #clients = new Map<string, FolderClientBoundary>();
  #folderListener: DisposableBoundary | undefined;
  #operation = Promise.resolve();
  #active = false;

  /** VS Code 호스트 경계와 폴더별 client factory를 연결한다. */
  constructor(host: WorkspaceHostBoundary, factory: FolderClientFactory) {
    this.#host = host;
    this.#factory = factory;
  }

  /** 현재 폴더를 시작하고 이후 폴더 변경을 직렬로 처리한다. */
  async activate(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    for (const folder of this.#host.folders()) await this.#add(folder);
    this.#folderListener = this.#host.onDidChangeFolders((event) =>
      this.#queueFolderChange(event),
    );
  }

  /** 폴더 변경 처리까지 기다리는 테스트·종료 동기화 지점이다. */
  async settled(): Promise<void> {
    await this.#operation;
  }

  /** 모든 폴더의 실패 예산을 초기화하며 수동 재시작한다. */
  async restartAll(): Promise<void> {
    await this.#operation;
    for (const [uri, client] of this.#clients) {
      try {
        await client.restart();
      } catch (error: unknown) {
        this.#host.reportFailure(
          `Codocs language server를 다시 시작하지 못했습니다: ${uri}`,
          error,
        );
      }
    }
  }

  /** 이벤트를 끊고 모든 client/server를 완전히 종료한다. */
  async deactivate(): Promise<void> {
    if (!this.#active) return;
    this.#active = false;
    this.#folderListener?.dispose();
    this.#folderListener = undefined;
    await this.#operation;
    const clients = [...this.#clients.entries()];
    this.#clients.clear();
    for (const [uri, client] of clients) {
      try {
        await client.stop();
      } catch (error: unknown) {
        this.#host.reportFailure(
          `Codocs language server를 종료하지 못했습니다: ${uri}`,
          error,
        );
      }
    }
  }

  /** 현재 관리 중인 폴더 URI를 진단과 테스트에 제공한다. */
  get folderUris(): readonly string[] {
    return [...this.#clients.keys()];
  }

  /** workspace folder 변경을 기존 작업 뒤에 직렬로 예약한다. */
  #queueFolderChange(event: WorkspaceFolderChangeEvent): void {
    this.#operation = this.#operation
      .then(() => this.#changeFolders(event.added, event.removed))
      .catch((error: unknown) => this.#reportFolderChangeFailure(error));
  }

  /** workspace folder 변경 실패를 host에 전달한다. */
  #reportFolderChangeFailure(error: unknown): void {
    this.#host.reportFailure(
      'Codocs workspace folder 변경을 처리하지 못했습니다.',
      error,
    );
  }

  /** 추가·제거된 folder에 맞춰 client 연결을 갱신한다. */
  async #changeFolders(
    added: readonly WorkspaceFolderBoundary[],
    removed: readonly WorkspaceFolderBoundary[],
  ): Promise<void> {
    const removedUris = new Set(removed.map((folder) => folder.uri));
    const retained = [...this.#clients.entries()].filter(
      ([uri]) => !removedUris.has(uri),
    );
    for (const folder of removed) await this.#remove(folder.uri);
    for (const folder of added) await this.#add(folder);
    // 중첩 루트의 소유권이 바뀔 수 있으므로 남은 연결을 다시 열어 현재 원문을 재동기화한다.
    for (const [uri, client] of retained) {
      if (!this.#clients.has(uri)) continue;
      try {
        await client.restart();
      } catch (error: unknown) {
        this.#host.reportFailure(
          `Codocs workspace 경계를 다시 동기화하지 못했습니다: ${uri}`,
          error,
        );
      }
    }
  }

  /** folder 경계에 대응하는 client를 만들고 시작한다. */
  async #add(folder: WorkspaceFolderBoundary): Promise<void> {
    if (this.#clients.has(folder.uri)) return;
    let client: FolderClientBoundary;
    try {
      client = this.#factory(folder);
    } catch (error: unknown) {
      this.#host.reportFailure(
        `Codocs language client를 구성하지 못했습니다: ${folder.name}`,
        error,
      );
      return;
    }
    this.#clients.set(folder.uri, client);
    try {
      await client.start();
    } catch (error: unknown) {
      this.#clients.delete(folder.uri);
      try {
        await client.stop();
      } catch {
        // 시작 실패가 주 원인이므로 정리 실패는 같은 안내에 함께 남긴다.
      }
      this.#host.reportFailure(
        `Codocs language server를 시작하지 못했습니다: ${folder.name}`,
        error,
      );
    }
  }

  /** URI에 대응하는 client를 종료하고 관리 목록에서 제거한다. */
  async #remove(uri: string): Promise<void> {
    const client = this.#clients.get(uri);
    if (!client) return;
    this.#clients.delete(uri);
    try {
      await client.stop();
    } catch (error: unknown) {
      this.#host.reportFailure(
        `제거된 workspace의 Codocs language server를 종료하지 못했습니다: ${uri}`,
        error,
      );
    }
  }
}
