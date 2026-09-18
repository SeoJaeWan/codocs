/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- 감시 이벤트 콜백은 선언 함수가 아니다. */
import chokidar, { type FSWatcher } from 'chokidar';
import {
  watch as watchDirectory,
  type FSWatcher as DirectoryWatcher,
} from 'node:fs';
import path from 'node:path';
import {
  workspaceLifecycleStates,
  type WorkspaceReadiness,
} from '../lifecycle/index.js';
import { codocsDirectoryName } from '../project-root/index.js';

/** 하나의 병합된 파일 변경 알림이다. */
export interface WorkspaceChangeBatch {
  paths: readonly string[];
}

/** 변화 감지 실패 후 사용자가 직접 호출할 복구 방법이다. */
export const watcherRecoveryGuidance =
  '파일 감시가 중단되었습니다. 원인을 확인한 뒤 codocs_refresh를 실행하세요.';

/** YAML 원문이나 Catalog를 보유하지 않는 파일 변화 신호원이다. */
export class WorkspaceWatcher {
  readonly #root: string;
  readonly #listeners = new Set<(batch: WorkspaceChangeBatch) => void>();
  #rootWatcher: FSWatcher | undefined;
  #entryWatcher: DirectoryWatcher | undefined;
  #contentWatcher: FSWatcher | undefined;
  #targetWatcher: FSWatcher | undefined;
  readonly #targetParents = new Set<string>();
  readonly #targetPaths = new Set<string>();
  #pending = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #state: WorkspaceReadiness = {
    state: workspaceLifecycleStates.starting,
    ready: false,
  };
  #recoveryUsed = false;
  #closed = false;
  #starting: Promise<void> | undefined;
  #reopening = false;

  /** 선택한 실제 프로젝트 경로를 감시 대상으로 고정한다. */
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

  /** 변화 배치를 구독하고 해제 함수를 반환한다. */
  subscribe(listener: (batch: WorkspaceChangeBatch) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 같은 경로의 다중 이벤트를 하나의 배치로 합친다. */
  #signal(changed: string): void {
    if (this.#closed) return;
    this.#pending.add(path.resolve(changed));
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      const paths = [...this.#pending].sort();
      this.#pending.clear();
      if (paths.length)
        for (const listener of this.#listeners) listener({ paths });
    }, 50);
  }

  /** 두 watcher를 시작해 프로젝트의 .codocs 교체와 내부 변경을 함께 감지한다. */
  async #open(): Promise<void> {
    const codocsPath = path.join(this.#root, codocsDirectoryName);
    const rootWatcher = chokidar.watch(this.#root, {
      depth: 1,
      ignoreInitial: true,
      persistent: true,
      usePolling: true,
      interval: 100,
    });
    const contentWatcher = chokidar.watch(codocsPath, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: true,
      awaitWriteFinish: false,
    });
    const targetWatcher = this.#targetParents.size
      ? chokidar.watch([...this.#targetParents], {
          depth: 0,
          ignoreInitial: true,
          awaitWriteFinish: false,
        })
      : undefined;
    this.#rootWatcher = rootWatcher;
    this.#contentWatcher = contentWatcher;
    this.#targetWatcher = targetWatcher;
    this.#entryWatcher = watchDirectory(this.#root, (_event, filename) => {
      if (filename?.toString() !== codocsDirectoryName) return;
      this.#signal(codocsPath);
      void this.#reopenContent().catch(() => undefined);
    });
    const failure = (error: unknown): void => {
      if (this.#state.state === workspaceLifecycleStates.ready)
        void this.#recover(error).catch(() => undefined);
    };
    rootWatcher.on('error', failure);
    this.#entryWatcher.on('error', failure);
    contentWatcher.on('error', failure);
    targetWatcher?.on('error', failure);
    rootWatcher.on('all', (event, changed) => {
      if (path.resolve(changed) === codocsPath) {
        this.#signal(changed);
        if (event === 'addDir' || event === 'unlinkDir')
          void this.#reopenContent().catch(failure);
      }
    });
    contentWatcher.on('all', (_event, changed) => this.#signal(changed));
    targetWatcher?.on('all', (_event, changed) => this.#signalTarget(changed));
    /** 시작 중 오류를 무한한 ready 대기로 남기지 않는다. */
    const ready = (watcher: FSWatcher): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        watcher.once('ready', resolve);
        watcher.once('error', reject);
      });
    await Promise.all([
      ready(rootWatcher),
      ready(contentWatcher),
      ...(targetWatcher ? [ready(targetWatcher)] : []),
    ]);
  }

  /** 연결 대상이나 그 조상 변화만 query에 전달한다. */
  #signalTarget(changed: string): void {
    const candidate = path.resolve(changed);
    for (const target of this.#targetPaths) {
      if (
        candidate === target ||
        target.startsWith(candidate + path.sep) ||
        candidate.startsWith(target + path.sep)
      ) {
        this.#signal(candidate);
        return;
      }
    }
  }

  /** 스캔이 확인한 연결 대상의 부모를 감시해 삭제 후 재생성도 감지한다. */
  async trackTargets(realPaths: readonly string[]): Promise<void> {
    const codocsPath = path.join(this.#root, codocsDirectoryName);
    const ready: Promise<void>[] = [];
    for (const realPath of realPaths) {
      if (realPath.startsWith(codocsPath + path.sep)) continue;
      const target = path.resolve(realPath);
      this.#targetPaths.add(target);
      let parent = path.dirname(target);
      while (parent !== path.dirname(parent)) {
        if (this.#targetParents.has(parent)) {
          parent = path.dirname(parent);
          continue;
        }
        this.#targetParents.add(parent);
        if (this.#targetWatcher) this.#targetWatcher.add(parent);
        else {
          const targetWatcher = chokidar.watch(parent, {
            depth: 0,
            ignoreInitial: true,
            awaitWriteFinish: false,
          });
          targetWatcher.on('all', (_event, changed) =>
            this.#signalTarget(changed),
          );
          targetWatcher.on('error', (error) => {
            void this.#recover(error).catch(() => undefined);
          });
          this.#targetWatcher = targetWatcher;
          ready.push(
            new Promise<void>((resolve) =>
              targetWatcher.once('ready', resolve),
            ),
          );
        }
        parent = path.dirname(parent);
      }
    }
    await Promise.all(ready);
  }

  /** .codocs 교체 후 새 트리를 다시 감시한다. */
  async #reopenContent(): Promise<void> {
    const current = this.#contentWatcher;
    if (!current || this.#closed || this.#reopening) return;
    this.#reopening = true;
    try {
      await current.close();
      if (this.#closed) return;
      const next = chokidar.watch(path.join(this.#root, codocsDirectoryName), {
        ignoreInitial: true,
        followSymlinks: true,
        awaitWriteFinish: false,
      });
      next.on('all', (_event, changed) => this.#signal(changed));
      next.on('error', (error) => {
        void this.#recover(error).catch(() => undefined);
      });
      this.#contentWatcher = next;
      await new Promise<void>((resolve) => next.once('ready', resolve));
      this.#signal(path.join(this.#root, codocsDirectoryName));
    } finally {
      this.#reopening = false;
    }
  }

  /** 처음 한 번 감시를 시작한다. */
  start(): Promise<void> {
    if (this.#starting) return this.#starting;
    this.#starting = this.#open()
      .then(() => {
        if (!this.#closed)
          this.#state = { state: workspaceLifecycleStates.ready, ready: true };
      })
      .catch(async (error: unknown) => this.#recover(error));
    return this.#starting;
  }

  /** 감시 실패 시 자동 재연결을 정확히 한 번 시도한다. */
  async #recover(error: unknown): Promise<void> {
    if (
      this.#closed ||
      this.#state.state === workspaceLifecycleStates.recovering
    )
      return;
    const cause = error instanceof Error ? error.message : String(error);
    if (this.#recoveryUsed) {
      this.#state = {
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause,
        guidance: watcherRecoveryGuidance,
      };
      return;
    }
    this.#recoveryUsed = true;
    this.#state = {
      state: workspaceLifecycleStates.recovering,
      ready: false,
      cause,
    };
    try {
      this.#entryWatcher?.close();
      await Promise.all([
        this.#rootWatcher?.close(),
        this.#contentWatcher?.close(),
        this.#targetWatcher?.close(),
      ]);
      await this.#open();
      this.#state = { state: workspaceLifecycleStates.ready, ready: true };
      this.#signal(path.join(this.#root, codocsDirectoryName));
    } catch (failure: unknown) {
      this.#state = {
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause: failure instanceof Error ? failure.message : String(failure),
        guidance: watcherRecoveryGuidance,
      };
    }
  }

  /** 수동 refresh의 재연결을 시도하며 자동 복구 횟수를 다시 허용한다. */
  async refresh(): Promise<WorkspaceReadiness> {
    if (this.#closed) return this.readiness;
    this.#recoveryUsed = false;
    this.#state = { state: workspaceLifecycleStates.recovering, ready: false };
    try {
      this.#entryWatcher?.close();
      await Promise.all([
        this.#rootWatcher?.close(),
        this.#contentWatcher?.close(),
        this.#targetWatcher?.close(),
      ]);
      await this.#open();
      this.#state = { state: workspaceLifecycleStates.ready, ready: true };
    } catch (error: unknown) {
      this.#state = {
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause: error instanceof Error ? error.message : String(error),
        guidance: watcherRecoveryGuidance,
      };
    }
    return this.readiness;
  }

  /** 타이머와 OS 감시자를 닫는다. */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#pending.clear();
    this.#listeners.clear();
    this.#entryWatcher?.close();
    await Promise.all([
      this.#rootWatcher?.close(),
      this.#contentWatcher?.close(),
      this.#targetWatcher?.close(),
    ]);
    this.#state = { state: workspaceLifecycleStates.closed, ready: false };
  }
}

/** 경로를 선택한 뒤 신호원을 시작한다. */
export async function createWorkspaceWatcher(
  projectRoot: string,
): Promise<WorkspaceWatcher> {
  const watcher = new WorkspaceWatcher(projectRoot);
  await watcher.start();
  return watcher;
}
