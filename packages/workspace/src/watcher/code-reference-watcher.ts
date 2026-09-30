import chokidar, { type FSWatcher } from 'chokidar';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const execute = promisify(execFile);
/** 코드와 프로젝트 Git 메타데이터의 변경을 문서 감시와 분리한다. */
export class CodeReferenceWatcher {
  #watchers: FSWatcher[] = [];
  #closed = false;
  #cancel = new Set<() => void>();
  /** 시작 전 구독을 고정하며 실패는 수집 계층에 전달한다. */
  constructor(
    readonly projectRoot: string,
    readonly changed: (paths: readonly string[]) => void,
    readonly failed: (error: unknown) => void,
  ) {}
  /** 모든 watch를 먼저 등록한 뒤 최초 reconciliation을 허용한다. */
  async start(): Promise<void> {
    if (this.#closed) return;
    let gitDirectory: string | undefined;
    try {
      const result = await execute(
        'git',
        ['-C', this.projectRoot, 'rev-parse', '--absolute-git-dir'],
        { encoding: 'utf8' },
      );
      gitDirectory = result.stdout.trim();
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'stderr' in error &&
        typeof error.stderr === 'string' &&
        error.stderr.includes('not a git repository')
      ))
        this.failed(error);
    }
    if (this.#closed) return;
    const root = chokidar.watch(this.projectRoot, {
      followSymlinks: false,
      ignoreInitial: true,
      /** Git 내부는 별도 index·HEAD 감시만 허용한다. */
      ignored: (input: string): boolean =>
        path
          .relative(this.projectRoot, input)
          .split(path.sep)
          .indexOf('.git') >= 0 &&
        path.relative(this.projectRoot, input).split(path.sep).at(-1) !==
          '.git',
    });
    const metadataPaths = new Set([
      path.join(this.projectRoot, '.git', 'index'),
      path.join(this.projectRoot, '.git', 'HEAD'),
      ...(gitDirectory
        ? [path.join(gitDirectory, 'index'), path.join(gitDirectory, 'HEAD')]
        : []),
    ]);
    const metadata = chokidar.watch([...metadataPaths], {
      followSymlinks: false,
      ignoreInitial: true,
      usePolling: true,
      interval: 100,
    });
    metadata.on(
      'raw',
      /** 원자 교체와 역순 mtime도 파일 정체·ctime 변화로 보완한다. */ (
        _event: string,
        input: string,
        detail: unknown,
      ) => {
        if (
          this.#closed ||
          typeof detail !== 'object' ||
          detail === null ||
          !('curr' in detail) ||
          !('prev' in detail)
        )
          return;
        const { curr, prev } = detail;
        if (
          typeof curr !== 'object' ||
          curr === null ||
          typeof prev !== 'object' ||
          prev === null
        )
          return;
        const current = curr as Record<string, unknown>;
        const previous = prev as Record<string, unknown>;
        if (
          ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(
            (key) => current[key] !== previous[key],
          )
        )
          this.changed([input]);
      },
    );
    const connections = [root, metadata];
    this.#watchers.push(...connections);
    await Promise.all(
      connections.map(
        /** 감시별 ready·error·종료를 같은 준비 수명에 연결한다. */ (
          watcher,
        ) => {
          watcher.on(
            'all',
            /** 등록한 source 경로 변경을 전달한다. */ (_event, input) => {
              if (!this.#closed) this.changed([input]);
            },
          );
          watcher.on('error', (error) => {
            if (!this.#closed) this.failed(error);
          });
          return new Promise<void>(
            /** ready 또는 error로 등록 대기를 완료한다. */ (resolve) => {
              /** 종료나 ready는 같은 대기를 한 번만 해제한다. */
              const complete = (): void => {
                this.#cancel.delete(complete);
                resolve();
              };
              this.#cancel.add(complete);
              watcher.once('ready', complete);
              watcher.once('error', complete);
            },
          );
        },
      ),
    );
  }
  /** ready가 오지 않은 연결도 취소하고 모든 watch를 종료한다. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const cancel of this.#cancel) cancel();
    await Promise.all(this.#watchers.map((watcher) => watcher.close()));
    this.#watchers = [];
  }
}
