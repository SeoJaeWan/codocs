import chokidar, { type FSWatcher, type ChokidarOptions } from 'chokidar';
import {
  watch as watchDirectory,
  type FSWatcher as DirectoryWatcher,
} from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { containsWorkspacePath } from '../loader/observations.js';
import {
  workspaceLifecycleStates,
  type WorkspaceReadiness,
} from '../lifecycle/index.js';
import { codocsDirectoryName } from '../project-root/index.js';

/** 하나의 병합된 파일 변경 알림이다. */
export interface WorkspaceChangeBatch {
  paths: readonly string[];
}
type ContentIdentity = { dev: number; ino: number } | null;
/** 변화 감지 실패 후 사용자가 직접 호출할 복구 방법이다. */
export const watcherRecoveryGuidance =
  '파일 감시가 중단되었습니다. 원인을 확인한 뒤 codocs_refresh를 실행하세요.';

/** YAML이나 snapshot 없이 경로 신호·대상별 준비·배치 수명만 관리한다. */
export class WorkspaceWatcher {
  readonly #root: string;
  readonly #listeners = new Set<(batch: WorkspaceChangeBatch) => void>();
  readonly #connections = new Set<FSWatcher>();
  readonly #directoryRegistrations = new Map<
    string,
    { watcher: FSWatcher; ready: Promise<void> }
  >();
  readonly #waiters = new Map<FSWatcher, () => void>();
  readonly #targets = new Set<string>();
  readonly #registrations = new Map<string, Promise<void>>();
  readonly #parentRegistrations = new Map<string, Promise<void>>();
  readonly #parentTimers = new Set<ReturnType<typeof setInterval>>();
  readonly #parentChecks = new Set<Promise<void>>();
  #entryWatcher: DirectoryWatcher | undefined;
  #contentWatcher: FSWatcher | undefined;
  #pending = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #state: WorkspaceReadiness = {
    state: workspaceLifecycleStates.starting,
    ready: false,
  };
  #recoveryUsed = false;
  #closed = false;
  #epoch = 0;
  #starting: Promise<void> | undefined;
  #reconnecting: Promise<void> | undefined;
  #openingContent = false;
  #reopenRequested = false;
  #reopening: Promise<void> | undefined;
  #contentIdentity: ContentIdentity | undefined;
  readonly #retiring = new Set<Promise<void>>();
  #closing: Promise<void> | undefined;

  /** 선택한 프로젝트 경로를 고정하며 시작 전에 구독을 허용한다. */
  constructor(projectRoot: string) {
    this.#root = path.resolve(projectRoot);
  }
  /** 원인과 수동 복구 안내를 포함한 현재 준비 상태다. */
  get readiness(): WorkspaceReadiness {
    return { ...this.#state };
  }
  /** 마지막 수동 복구 이후 자동 재연결 시도 횟수다. */
  get automaticRecoveryAttempts(): 0 | 1 {
    return this.#recoveryUsed ? 1 : 0;
  }
  /** 이미 감지했으나 아직 배치로 전달하지 않은 변경의 유무다. */
  get hasPendingChanges(): boolean {
    return this.#pending.size > 0;
  }
  /** 변화 배치를 구독하고 해제 함수를 반환한다. */
  subscribe(listener: (batch: WorkspaceChangeBatch) => void): () => void {
    if (!this.#closed) this.#listeners.add(listener);
    return /** 해당 구독자만 이후 배치에서 제외한다. */ () => {
      this.#listeners.delete(listener);
    };
  }
  /** 배치 타이머를 기다리지 않고 현재 수집한 변경을 구독자에게 전달한다. */
  drain(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    const paths = [...this.#pending].sort();
    this.#pending.clear();
    if (!this.#closed && paths.length)
      for (const listener of this.#listeners) listener({ paths });
  }
  /** 같은 경로의 다중 이벤트를 하나의 배치로 합친다. */
  #signal(changed: string): void {
    if (this.#closed) return;
    this.#pending.add(path.resolve(changed));
    if (!this.#timer) this.#timer = setTimeout(() => this.drain(), 50);
  }
  /** 이전 연결 또는 종료 이후의 비동기 완료를 구분한다. */
  #active(epoch: number): boolean {
    return !this.#closed && epoch === this.#epoch;
  }
  /** 공개 ready/error 이벤트와 세션 취소로 대상별 준비를 확인한다. */
  #connect(
    paths: string | string[],
    options: ChokidarOptions,
    epoch: number,
    onChange: (event: string, changed: string) => void,
    initialSignals = false,
  ): { watcher: FSWatcher; ready: Promise<void> } {
    const watcher = chokidar.watch(paths, {
      ignoreInitial: false,
      awaitWriteFinish: false,
      ...options,
    });
    this.#connections.add(watcher);
    let prepared = false;
    watcher.on(
      'all',
      /** 수집한 변경과 연결 상태를 현재 작업에 반영한다. */ (
        event,
        changed,
      ) => {
        if ((prepared || initialSignals) && this.#active(epoch))
          onChange(event, changed);
      },
    );
    const ready = new Promise<void>(
      /** ready·error·취소 중 먼저 도착한 결과로 준비 대기를 끝낸다. */ (
        resolve,
        reject,
      ) => {
        /** 종료·연결 교체는 ready 이벤트가 없어도 대기를 끝낸다. */
        const cancel = (): void => {
          cleanup();
          resolve();
        };
        /** 일회성 준비 구독과 취소 핸들을 정리한다. */
        const cleanup = (): void => {
          this.#waiters.delete(watcher);
          watcher.off('ready', success);
          watcher.off('error', failure);
        };
        /** 등록 이후의 실제 이벤트만 소비자에게 전달한다. */
        const success = (): void => {
          prepared = true;
          cleanup();
          resolve();
        };
        /** 등록 오류를 무한 대기로 남기지 않는다. */
        const failure = (error: unknown): void => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        };
        this.#waiters.set(watcher, cancel);
        watcher.once('ready', success);
        watcher.once('error', failure);
      },
    );
    watcher.on(
      'error',
      /** 현재 연결에서 난 오류만 자동 복구에 전달한다. */ (error) => {
        if (prepared && this.#active(epoch))
          void this.#recover(error).catch((failure: unknown) =>
            this.#fail(failure),
          );
      },
    );
    return { watcher, ready };
  }
  /** 이미 시작한 동적 하위 감시의 준비와 준비 중 추가된 등록까지 기다린다. */
  async settle(): Promise<void> {
    while (!this.#closed) {
      const connections = [...this.#directoryRegistrations.values()];
      await Promise.all(connections.map((connection) => connection.ready));
      const current = [...this.#directoryRegistrations.values()];
      if (
        current.length === connections.length &&
        current.every((connection, index) => connection === connections[index])
      )
        return;
    }
  }

  /** 루트 보완 감시가 먼저 발견한 새 하위 폴더도 독립 ready 이후 재확인한다. */
  async #prepareDirectory(directory: string, epoch: number): Promise<void> {
    if (!this.#active(epoch)) return;
    let connection = this.#directoryRegistrations.get(directory);
    if (!connection) {
      connection = this.#connect(
        directory,
        { followSymlinks: true },
        epoch,
        (_event, changed) => this.#signal(changed),
        true,
      );
      this.#directoryRegistrations.set(directory, connection);
    }
    await connection.ready;
    if (this.#active(epoch)) this.#signal(directory);
  }

  /** 디렉터리 식별자로 같은 경로의 실제 교체를 구분한다. */
  async #readContentIdentity(): Promise<ContentIdentity> {
    try {
      const result = await stat(path.join(this.#root, codocsDirectoryName));
      return { dev: result.dev, ino: result.ino };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  /** 루트 교체 감시와 내용 감시를 연결하고 모든 대상의 준비를 기다린다. */
  async #open(epoch: number): Promise<void> {
    const codocs = path.join(this.#root, codocsDirectoryName);
    this.#contentIdentity = await this.#readContentIdentity();
    if (!this.#active(epoch)) return;
    this.#openingContent = true;
    const root = this.#connect(
      this.#root,
      {
        usePolling: true,
        interval: 100,
        followSymlinks: false,
        /** 프로젝트 밖 파일은 루트 보완 감시의 재귀 탐색에 포함하지 않는다. */
        ignored: (candidate) =>
          path.resolve(candidate) !== this.#root &&
          !containsWorkspacePath(codocs, path.resolve(candidate)),
      },
      epoch,
      /** 보완 감시가 먼저 발견한 하위 폴더를 등록하고 기존 신호도 보존한다. */ (
        event,
        changed,
      ) => {
        if (path.resolve(changed) === codocs)
          void this.#reopenContent(epoch).catch((error: unknown) =>
            this.#fail(error),
          );
        else if (containsWorkspacePath(codocs, path.resolve(changed))) {
          this.#signal(changed);
          if (event === 'addDir')
            void this.#prepareDirectory(changed, epoch)
              .catch((error: unknown) => this.#recover(error))
              .catch((error: unknown) => this.#fail(error));
          else if (event === 'unlinkDir') {
            const previous = this.#directoryRegistrations.get(changed);
            this.#directoryRegistrations.delete(changed);
            if (previous)
              void this.#retire(previous.watcher).catch((error: unknown) =>
                this.#fail(error),
              );
          }
        }
      },
    );
    const content = this.#connect(
      codocs,
      { followSymlinks: true },
      epoch,
      /** 수집한 변경과 연결 상태를 현재 작업에 반영한다. */ (
        event,
        changed,
      ) => {
        if (
          path.resolve(changed) === codocs &&
          (event === 'addDir' || event === 'unlinkDir')
        )
          void this.#reopenContent(epoch).catch((error: unknown) =>
            this.#fail(error),
          );
        else this.#signal(changed);
      },
    );
    this.#contentWatcher = content.watcher;
    this.#entryWatcher = watchDirectory(
      this.#root,
      /** 감시가 수집한 경로를 현재 연결 세대에 전달한다. */ (
        _event,
        filename,
      ) => {
        if (filename?.toString() === codocsDirectoryName)
          void this.#reopenContent(epoch).catch((error: unknown) =>
            this.#fail(error),
          );
      },
    );
    this.#entryWatcher.on(
      'error',
      /** 현재 연결에서 난 오류만 자동 복구에 전달한다. */ (error) => {
        if (this.#active(epoch))
          void this.#recover(error).catch((failure: unknown) =>
            this.#fail(failure),
          );
      },
    );
    try {
      await Promise.all([root.ready, content.ready]);
    } finally {
      this.#openingContent = false;
    }
    if (!this.#active(epoch)) return;
    if (this.#reopenRequested) {
      this.#reopenRequested = false;
      await this.#reopenContent(epoch);
    }
    await this.trackTargets([...this.#targets]);
  }
  /** 조상 자체의 상태만 확인하고 보호된 형제 파일을 열거하지 않는다. */
  async #watchParent(parent: string, epoch: number): Promise<void> {
    /** 무관한 형제 변경을 제외하고 조상 자체의 삭제·교체를 구분한다. */
    const identity = async (): Promise<string | null> => {
      try {
        const value = await stat(parent);
        return JSON.stringify([value.dev, value.ino, value.birthtimeMs]);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    };
    let previous = await identity();
    if (!this.#active(epoch)) return;
    let checking = false;
    const timer = setInterval(
      /** 이전 확인이 끝난 뒤 현재 세대의 조상만 확인한다. */ () => {
        if (checking || !this.#active(epoch)) return;
        checking = true;
        const check = identity()
          .then(
            /** 조상 식별자가 달라진 경우에만 재확인을 요청한다. */ (
              current,
            ) => {
              if (this.#active(epoch) && current !== previous)
                this.#signal(parent);
              previous = current;
            },
          )
          .catch(
            /** 현재 세대의 실제 접근 실패는 기존 자동 복구에 전달한다. */ (
              error: unknown,
            ) => {
              if (this.#active(epoch))
                void this.#recover(error).catch((failure: unknown) =>
                  this.#fail(failure),
                );
            },
          )
          .finally(
            /** 종료 대기 목록에서 완료한 확인을 제거한다. */ () => {
              checking = false;
              this.#parentChecks.delete(check);
            },
          );
        this.#parentChecks.add(check);
      },
      100,
    );
    this.#parentTimers.add(timer);
  }

  /** 외부 대상과 그 조상만 감시하며 등록별 독립 ready를 공유한다. */
  async trackTargets(realPaths: readonly string[]): Promise<void> {
    if (this.#closed) return;
    const epoch = this.#epoch;
    const codocs = path.join(this.#root, codocsDirectoryName);
    const pending: Promise<void>[] = [];
    for (const supplied of realPaths) {
      const target = path.resolve(supplied);
      if (containsWorkspacePath(codocs, target)) continue;
      this.#targets.add(target);
      let registration = this.#registrations.get(target);
      if (!registration) {
        const ancestors = new Set<string>();
        for (
          let parent = path.dirname(target);
          ;
          parent = path.dirname(parent)
        ) {
          ancestors.add(parent);
          if (parent === path.dirname(parent)) break;
        }
        const parentReady: Promise<void>[] = [];
        for (const parent of ancestors) {
          let prepared = this.#parentRegistrations.get(parent);
          if (!prepared) {
            prepared = this.#watchParent(parent, epoch);
            this.#parentRegistrations.set(parent, prepared);
          }
          parentReady.push(prepared);
        }
        const content = this.#connect(
          target,
          { followSymlinks: false },
          epoch,
          (_event, changed) => this.#signal(changed),
        );
        const supplement = this.#connect(
          target,
          { followSymlinks: false, usePolling: true, interval: 100 },
          epoch,
          (_event, changed) => this.#signal(changed),
        );
        registration = Promise.all([
          ...parentReady,
          content.ready,
          supplement.ready,
        ])
          .then(() => undefined)
          .catch(
            /** 감시가 수집한 경로를 현재 연결 세대에 전달한다. */ (
              error: unknown,
            ) => {
              if (this.#active(epoch))
                void this.#recover(error).catch((failure: unknown) =>
                  this.#fail(failure),
                );
              throw error;
            },
          );
        this.#registrations.set(target, registration);
      }
      pending.push(registration);
    }
    await Promise.all(pending);
  }
  /** 실제 .codocs 교체만 재연결하고 준비 이후 하위 범위 재확인을 요청한다. */
  #reopenContent(epoch: number): Promise<void> {
    if (!this.#active(epoch)) return Promise.resolve();
    if (this.#openingContent) {
      this.#reopenRequested = true;
      return Promise.resolve();
    }
    if (this.#reopening) {
      this.#reopenRequested = true;
      return this.#reopening;
    }
    const operation = (
      /** 수집한 변경과 연결 상태를 현재 작업에 반영한다. */ async (): Promise<void> => {
        do {
          this.#reopenRequested = false;
          const identity = await this.#readContentIdentity();
          if (!this.#active(epoch)) return;
          if (
            identity?.dev === this.#contentIdentity?.dev &&
            identity?.ino === this.#contentIdentity?.ino
          )
            continue;
          for (const [directory, connection] of this.#directoryRegistrations) {
            await this.#retire(connection.watcher);
            this.#directoryRegistrations.delete(directory);
          }
          const current = this.#contentWatcher;
          if (current) await this.#retire(current);
          if (!this.#active(epoch)) return;
          const codocs = path.join(this.#root, codocsDirectoryName);
          const next = this.#connect(
            codocs,
            { followSymlinks: true },
            epoch,
            /** 수집한 변경과 연결 상태를 현재 작업에 반영한다. */ (
              event,
              changed,
            ) => {
              if (
                path.resolve(changed) === codocs &&
                (event === 'addDir' || event === 'unlinkDir')
              )
                void this.#reopenContent(epoch).catch((error: unknown) =>
                  this.#fail(error),
                );
              else this.#signal(changed);
            },
          );
          this.#contentWatcher = next.watcher;
          await next.ready;
          if (!this.#active(epoch)) return;
          this.#contentIdentity = identity;
          this.#signal(codocs);
        } while (this.#reopenRequested && this.#active(epoch));
      }
    )().catch((error: unknown) => this.#recover(error));
    this.#reopening = operation;
    void operation
      .finally(() => {
        if (this.#reopening === operation) this.#reopening = undefined;
      })
      .catch((error: unknown) => this.#fail(error));
    return operation;
  }
  /** 개별 연결 교체도 ready 대기를 취소하고 자원 집합에서 제거한다. */
  async #retire(watcher: FSWatcher): Promise<void> {
    this.#waiters.get(watcher)?.();
    this.#connections.delete(watcher);
    const closing = watcher.close();
    this.#retiring.add(closing);
    try {
      await closing;
    } finally {
      this.#retiring.delete(closing);
    }
  }

  /** 모든 연결과 준비 대기를 정리한다. 등록 대상 목록은 복구에 재사용한다. */
  async #disconnect(): Promise<void> {
    const parentRegistrations = [...this.#parentRegistrations.values()];
    for (const timer of this.#parentTimers) clearInterval(timer);
    this.#parentTimers.clear();
    for (const cancel of this.#waiters.values()) cancel();
    const entry = this.#entryWatcher;
    this.#entryWatcher = undefined;
    const entryClosed = entry
      ? new Promise<void>(
          /** OS 감시 close 이벤트까지 정리를 기다린다. */ (resolve) => {
            entry.once('close', resolve);
            entry.close();
          },
        )
      : Promise.resolve();
    this.#directoryRegistrations.clear();
    const connections = [...this.#connections];
    this.#connections.clear();
    this.#registrations.clear();
    this.#parentRegistrations.clear();
    await Promise.all([
      ...this.#parentChecks,
      Promise.allSettled(parentRegistrations),
      entryClosed,
      ...connections.map((watcher) => watcher.close()),
      ...this.#retiring,
    ]);
  }
  /** 처음 한 번 시작하며 종료된 신호원은 다시 열지 않는다. */
  start(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#starting ??= this.#open(this.#epoch)
      .then(
        /** 시작이 끝나도 종료되거나 복구 중인 상태를 덮어쓰지 않는다. */ () => {
          if (
            !this.#closed &&
            this.#state.state === workspaceLifecycleStates.starting
          )
            this.#state = {
              state: workspaceLifecycleStates.ready,
              ready: true,
            };
        },
      )
      .catch((error: unknown) => this.#recover(error));
    return this.#starting;
  }
  /** 오류 한 번에 자동 재연결을 한 번만 허용한다. */
  async #recover(error: unknown): Promise<void> {
    if (this.#closed || this.#reconnecting) return;
    if (this.#recoveryUsed) {
      this.#fail(error);
      return;
    }
    this.#recoveryUsed = true;
    await this.#reconnect();
    if (this.#state.ready)
      this.#signal(path.join(this.#root, codocsDirectoryName));
  }
  /** 실제 오류의 원인과 수동 복구 안내를 보존한다. */
  #fail(error: unknown): void {
    if (!this.#closed)
      this.#state = {
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause: error instanceof Error ? error.message : String(error),
        guidance: watcherRecoveryGuidance,
      };
  }
  /** 재연결 중 close 또는 이전 연결 완료가 자원을 부활시키지 못하게 한다. */
  #reconnect(): Promise<void> {
    if (this.#reconnecting) return this.#reconnecting;
    const epoch = ++this.#epoch;
    this.#state = { state: workspaceLifecycleStates.recovering, ready: false };
    const operation = (
      /** 수집한 변경과 연결 상태를 현재 작업에 반영한다. */ async (): Promise<void> => {
        try {
          await this.#disconnect();
          if (!this.#active(epoch)) return;
          await this.#open(epoch);
          if (this.#active(epoch))
            this.#state = {
              state: workspaceLifecycleStates.ready,
              ready: true,
            };
        } catch (error: unknown) {
          this.#fail(error);
        }
      }
    )();
    this.#reconnecting = operation;
    void operation
      .then(() => {
        if (this.#reconnecting === operation) this.#reconnecting = undefined;
      })
      .catch((error: unknown) => this.#fail(error));
    return operation;
  }
  /** 수동 복구는 자동 복구 기회를 되돌리고 모든 감시 연결을 준비한다. */
  async refresh(): Promise<WorkspaceReadiness> {
    if (!this.#closed) {
      this.#recoveryUsed = false;
      await this.#reconnect();
    }
    return this.readiness;
  }
  /** 준비 대기·타이머·구독·모든 OS 연결을 종료한다. */
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#epoch++;
    this.#state = { state: workspaceLifecycleStates.closed, ready: false };
    if (this.#timer) clearTimeout(this.#timer);
    this.#pending.clear();
    this.#listeners.clear();
    this.#closing = this.#disconnect().then(async () => {
      await Promise.all([this.#starting, this.#reconnecting, this.#reopening]);
      await Promise.all([...this.#retiring]);
    });
    return this.#closing;
  }
}
/** 독립 신호원이 필요한 소비자를 위해 시작과 준비까지 완료한다. */
export async function createWorkspaceWatcher(
  projectRoot: string,
): Promise<WorkspaceWatcher> {
  const watcher = new WorkspaceWatcher(projectRoot);
  await watcher.start();
  return watcher;
}
