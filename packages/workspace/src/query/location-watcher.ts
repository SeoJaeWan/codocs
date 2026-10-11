import chokidar, { type FSWatcher } from 'chokidar';
import type { Stats } from 'node:fs';
import path from 'node:path';
import type { CodeWatchExclusion } from '../watcher/code-reference-watcher.js';

/**
 * 하위 .codocs 위치 판정에 필요한 폴더·규칙 파일 변경만 감시한다.
 * Git 명령을 실행하지 않고 `.git` 안쪽은 보지 않는다.
 */
export class CodocsLocationWatcher {
  #watcher: FSWatcher | undefined;
  #closed = false;
  #cancel: (() => void) | undefined;

  /**
   * 프로젝트 루트 전체를 감시하도록 준비하며 시작은 start가 맡는다.
   * @param projectRoot 감시할 프로젝트 루트 절대 경로다.
   * @param changed 변경 경로와 chokidar 이벤트 종류를 받는다.
   * @param failed 감시 오류를 받는다.
   * @param excluded 감시하지 않을 경로인지 판단한다.
   */
  constructor(
    readonly projectRoot: string,
    readonly changed: (paths: readonly string[], event?: string) => void,
    readonly failed: (error: unknown) => void,
    readonly excluded: CodeWatchExclusion = /** 기본값은 제외하지 않는다. */ () =>
      false,
  ) {}

  /** 감시를 등록하고 ready 또는 오류로 등록이 끝나면 돌아온다. */
  async start(): Promise<void> {
    if (this.#closed) return;
    const watcher = chokidar.watch(this.projectRoot, {
      followSymlinks: false,
      ignoreInitial: true,
      /** `.git` 안쪽은 위치 판정과 무관하므로 보지 않는다. */
      ignored: (input: string, stats?: Stats): boolean =>
        path.relative(this.projectRoot, input).split(path.sep).includes('.git')
          ? true
          : this.excluded(input, stats),
    });
    this.#watcher = watcher;
    watcher.on(
      'all',
      /** 변경 경로를 이벤트 종류와 함께 전달한다. */ (event, input) => {
        if (!this.#closed) this.changed([input], event);
      },
    );
    watcher.on('error', (error) => {
      if (!this.#closed) this.failed(error);
    });
    await new Promise<void>(
      /** ready 또는 error로 등록 대기를 완료한다. */ (resolve) => {
        /** 종료나 ready는 같은 대기를 한 번만 해제한다. */
        const complete = (): void => {
          this.#cancel = undefined;
          resolve();
        };
        this.#cancel = complete;
        watcher.once('ready', complete);
        watcher.once('error', complete);
      },
    );
  }

  /** 대기 중인 등록을 취소하고 감시를 종료한다. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#cancel?.();
    await this.#watcher?.close();
    this.#watcher = undefined;
  }
}
