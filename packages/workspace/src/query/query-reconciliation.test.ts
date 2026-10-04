import * as core from '@codocs/core';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceLifecycleStates } from '../lifecycle/index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from './index.js';

const boundary = vi.hoisted(() => ({
  afterRead: undefined as undefined | ((file: string) => Promise<void>),
  afterReadDirectory: undefined as
    undefined | ((file: string) => Promise<void>),
  reads: new Map<string, number>(),
  fullLoads: 0,
  scopedLoads: [] as string[],
  failScopedOnce: undefined as string | undefined,
  emit: (_paths: string[]) => {
    void _paths;
  },
  pending: [] as string[],
  onDrain: undefined as undefined | (() => void),
  starts: 0,
  closes: 0,
  watchFailed: false,
}));
vi.mock('../loader/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../loader/index.js')>();
  return {
    ...actual,
    loadWorkspace: (...args: Parameters<typeof actual.loadWorkspace>) => {
      boundary.fullLoads++;
      return actual.loadWorkspace(...args);
    },
    loadWorkspacePath: (
      ...args: Parameters<typeof actual.loadWorkspacePath>
    ) => {
      const scope = String(args[1]);
      boundary.scopedLoads.push(scope);
      if (boundary.failScopedOnce === scope) {
        boundary.failScopedOnce = undefined;
        throw new Error('injected scoped observation failure');
      }
      return actual.loadWorkspacePath(...args);
    },
  };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const bytes = await actual.readFile(...args);
      const file = typeof args[0] === 'string' ? args[0] : '';
      boundary.reads.set(file, (boundary.reads.get(file) ?? 0) + 1);
      await boundary.afterRead?.(file);
      return bytes;
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const entries = await actual.readdir(...args);
      await boundary.afterReadDirectory?.(
        typeof args[0] === 'string' ? args[0] : '',
      );
      return entries;
    },
  };
});
// 공통 보정·게시의 결정적인 경합 검사다. 실제 OS 감시는 query-initialization에서 별도로 연결한다.
vi.mock('../watcher/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../watcher/index.js')>();
  class WorkspaceWatcher {
    get readiness() {
      return boundary.watchFailed
        ? {
            state: workspaceLifecycleStates.failed,
            ready: false,
            cause: 'injected watcher failure',
          }
        : { state: workspaceLifecycleStates.ready, ready: true };
    }
    subscribe(listener: (batch: { paths: string[] }) => void): () => void {
      boundary.emit = (paths) => listener({ paths });
      return () => {};
    }
    start(): Promise<void> {
      boundary.starts++;
      return Promise.resolve();
    }
    async settle(): Promise<void> {}
    drain(): void {
      const pending = boundary.pending.splice(0);
      if (pending.length) boundary.emit(pending);
      boundary.onDrain?.();
    }
    async refresh(): Promise<void> {}
    close(): Promise<void> {
      boundary.closes++;
      return Promise.resolve();
    }
  }
  const exportName = 'WorkspaceWatcher';
  return { ...actual, [exportName]: WorkspaceWatcher };
});
let project: string;
let session: WorkspaceQuerySession | undefined;
beforeEach(async () => {
  const parent = path.resolve('.workbench/fixtures');
  await mkdir(parent, { recursive: true });
  project = await mkdtemp(path.join(parent, 'reconciliation-'));
  await mkdir(path.join(project, '.codocs'));
  boundary.reads.clear();
  boundary.fullLoads = 0;
  boundary.scopedLoads.length = 0;
  boundary.failScopedOnce = undefined;
  boundary.pending.length = 0;
  boundary.starts = 0;
  boundary.closes = 0;
  boundary.watchFailed = false;
});
afterEach(async () => {
  boundary.afterRead = undefined;
  boundary.afterReadDirectory = undefined;
  boundary.onDrain = undefined;
  boundary.failScopedOnce = undefined;
  boundary.watchFailed = false;
  await session?.close();
  session = undefined;
  vi.restoreAllMocks();
  await rm(project, { recursive: true, force: true });
});
/** 경합을 실제 읽기 완료와 외부 변경 사이에 고정한다. */
function barrier(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('최초 전체 순회 중 변경 범위 보정', () => {
  it('변경이 없으면 각 원문을 한 번 읽고 파싱해 같은 초기화를 공유한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    const raw =
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n';
    await writeFile(target, raw);
    const parse = vi.spyOn(core, 'parseYaml');
    session = createWorkspaceQuerySession({ cwd: project });
    const [list, get] = await Promise.all([
      session.list(),
      session.get(['alpha']),
    ]);
    expect(list).toMatchObject({ success: true, totalCount: 1 });
    expect(get).toMatchObject({
      success: true,
      results: [{ found: true, document: { definition: '본문' } }],
    });
    expect(boundary.reads.get(target)).toBe(1);
    expect(parse).toHaveBeenCalledOnce();
    expect(boundary.starts).toBe(1);
    expect(session.catalogVersion).toBe(1);
  });

  it('A를 재읽는 중 A가 다시 바뀌면 늦은 결과를 버리고 B의 읽기와 파싱을 재사용한다', async () => {
    const alpha = path.join(project, '.codocs', 'alpha.yaml');
    const beta = path.join(project, '.codocs', 'beta.yaml');
    const before = 'id: [\n';
    const middle =
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 중간\n';
    const latest =
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 최신\n';
    const stable =
      'id: beta\nname: beta\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 고정\n';
    await writeFile(alpha, before);
    await writeFile(beta, stable);
    const parse = vi.spyOn(core, 'parseYaml');
    boundary.afterRead = async (file) => {
      if (file !== alpha) return;
      const count = boundary.reads.get(alpha)!;
      if (count > 2) return;
      if (count === 2) expect(boundary.reads.get(beta)).toBe(1);
      await writeFile(alpha, count === 1 ? middle : latest);
      boundary.emit([alpha, alpha]);
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const result = await session.get(['alpha', 'beta']);
    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [
        {
          found: true,
          revision: createHash('sha256').update(latest).digest('hex'),
          document: { definition: '최신' },
          diagnostics: [],
        },
        { found: true, document: { definition: '고정' } },
      ],
    });
    expect(boundary.reads.get(alpha)).toBe(3);
    expect(boundary.reads.get(beta)).toBe(1);
    expect(parse.mock.calls.filter(([raw]) => raw === stable)).toHaveLength(1);
    expect(session.catalogVersion).toBe(1);
  });

  it('첫 readdir 반환 뒤 파일이 추가되면 나머지 순회를 유지하고 누락 경로만 추가한다', async () => {
    const codocs = path.join(project, '.codocs');
    const old = path.join(codocs, 'old.yaml');
    const added = path.join(codocs, 'added.yaml');
    await writeFile(
      old,
      'id: old\nname: old\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n',
    );
    boundary.afterReadDirectory = async (directory) => {
      if (directory !== codocs) return;
      boundary.afterReadDirectory = undefined;
      await writeFile(
        added,
        'id: added\nname: added\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 추가\n',
      );
      boundary.emit([added]);
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const result = await session.list();
    expect(result).toMatchObject({
      success: true,
      totalCount: 2,
      items: [{ id: 'added' }, { id: 'old' }],
    });
    expect(boundary.reads.get(old)).toBe(1);
    expect(boundary.reads.get(added)).toBe(1);
  });

  it.each(['삭제', '교체 저장'] as const)(
    '첫 읽기 반환 경계에서 %s하면 최종 존재와 원문을 게시한다',
    async (operation) => {
      const target = path.join(project, '.codocs', 'alpha.yaml');
      const latest =
        'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 교체\n';
      await writeFile(
        target,
        'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n',
      );
      boundary.afterRead = async (file) => {
        if (file !== target) return;
        boundary.afterRead = undefined;
        if (operation === '삭제') await rm(target);
        else {
          const temporary = path.join(project, 'replacement.yaml');
          await writeFile(temporary, latest);
          await rename(temporary, target);
        }
        boundary.emit([target]);
      };
      session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.get(['alpha']);
      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        results:
          operation === '삭제'
            ? [{ found: false }]
            : [
                {
                  found: true,
                  revision: createHash('sha256').update(latest).digest('hex'),
                },
              ],
      });
    },
  );

  it.each(['이동', '교체', '재생성'] as const)(
    '첫 폴더 열거 뒤 폴더를 %s하면 최종 하위 문서만 게시한다',
    async (operation) => {
      const directory = path.join(project, '.codocs', 'folder');
      const moved = path.join(project, '.codocs', 'moved');
      await mkdir(directory);
      await writeFile(
        path.join(directory, 'old.yaml'),
        'id: old\nname: old\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n',
      );
      boundary.afterReadDirectory = async (selected) => {
        if (selected !== directory) return;
        boundary.afterReadDirectory = undefined;
        if (operation === '이동') await rename(directory, moved);
        else {
          if (operation === '교체')
            await rename(directory, path.join(project, 'saved'));
          else await rm(directory, { recursive: true });
          await mkdir(directory);
          await writeFile(
            path.join(directory, 'new.yaml'),
            'id: new\nname: new\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 새 문서\n',
          );
        }
        boundary.emit([directory, ...(operation === '이동' ? [moved] : [])]);
      };
      session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.list();
      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        totalCount: 1,
        items: [{ id: operation === '이동' ? 'old' : 'new' }],
      });
    },
  );
});

describe('게시와 공유 작업 정리의 변경 수집', () => {
  it('저장 임시 파일의 늦은 삭제 신호는 무시하고 일반 파일 생성·삭제는 재관측한다', async () => {
    const folder = path.join(project, '.codocs');
    const alpha = path.join(folder, 'alpha.yaml');
    const beta = path.join(folder, 'beta.yaml');
    await writeFile(
      alpha,
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n',
    );
    session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.list()).toMatchObject({
      success: true,
      scanStatus: 'complete',
      totalCount: 1,
    });
    const version = session.catalogVersion;
    boundary.emit([path.join(folder, '.codocs-write-deadbeef.tmp')]);
    await Promise.resolve();
    expect(session.catalogVersion).toBe(version);
    expect(session.scanStatus).toBe('complete');
    await writeFile(
      beta,
      'id: beta\nname: beta\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n',
    );
    boundary.emit([beta]);
    await vi.waitFor(async () =>
      expect(await session!.list()).toMatchObject({
        success: true,
        scanStatus: 'complete',
        totalCount: 2,
      }),
    );
    await rm(beta);
    boundary.emit([beta]);
    await vi.waitFor(async () =>
      expect(await session!.list()).toMatchObject({
        success: true,
        scanStatus: 'complete',
        totalCount: 1,
      }),
    );
  });

  it('저장 경로 관측 실패 뒤 최신 다른 경로를 보존하고 전체 순회 없이 한 번 복구한다', async () => {
    const starts: Record<string, unknown>[] = [];
    const folder = path.join(project, '.codocs');
    const alpha = path.join(folder, 'alpha.yaml');
    const beta = path.join(folder, 'beta.yaml');
    const before =
      'id: alpha\nname: 알파\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n';
    await writeFile(alpha, before);
    await writeFile(
      beta,
      'id: beta\nname: 베타\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n',
    );
    session = createWorkspaceQuerySession(
      { cwd: project },
      (kind, detail) => {
        if (kind === 'index-start') starts.push(detail);
      },
      {
        beforeIndexUpdate: async (attempt) => {
          if (attempt !== 1) return;
          await writeFile(
            beta,
            'id: beta\nname: 베타 최신\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n',
          );
          boundary.emit([beta]);
          await vi.waitFor(async () =>
            expect(await session!.get(['beta'])).toMatchObject({
              results: [{ found: true, document: { name: '베타 최신' } }],
            }),
          );
          boundary.failScopedOnce = alpha;
        },
      },
    );
    expect(await session.list()).toMatchObject({
      success: true,
      scanStatus: 'complete',
      totalCount: 2,
    });
    expect(boundary.fullLoads).toBe(1);
    const result = await session.write({
      mode: 'update',
      id: 'alpha',
      revision: createHash('sha256').update(before).digest('hex'),
      set: { definition: '알파 저장' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    // 저장 계층의 저장 전 충돌 검사는 전체 탐색 한 번을 별도로 수행한다.
    expect(boundary.fullLoads).toBe(2);
    expect(starts.filter((event) => event.full)).toHaveLength(1);
    expect(boundary.scopedLoads.filter((file) => file === alpha)).toHaveLength(
      2,
    );
    expect(boundary.reads.get(beta)).toBe(3);
    expect(await session.get(['alpha', 'beta'])).toMatchObject({
      results: [
        { found: true, document: { definition: '알파 저장' } },
        { found: true, document: { name: '베타 최신' } },
      ],
    });
  });

  it('배치 전달 전 첫 읽기가 끝나면 drain으로 변경을 반영한 뒤 최초 요청을 완료한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    const latest =
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 최신\n';
    await writeFile(
      target,
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n',
    );
    boundary.afterRead = async (file) => {
      if (file !== target) return;
      boundary.afterRead = undefined;
      await writeFile(target, latest);
      boundary.pending.push(target);
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const result = await session.get(['alpha']);
    expect(result).toMatchObject({
      success: true,
      results: [
        { revision: createHash('sha256').update(latest).digest('hex') },
      ],
    });
    expect(boundary.pending).toEqual([]);
  });

  it('마지막 drain 다음 microtask에 변경이 전달되면 공유 promise 정리 뒤 후속 갱신한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    const latest =
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이후\n';
    await writeFile(
      target,
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n',
    );
    let drains = 0;
    boundary.onDrain = () => {
      if (++drains !== 3) return;
      boundary.onDrain = undefined;
      queueMicrotask(() => boundary.emit([target]));
    };
    boundary.afterRead = async (file) => {
      if (file !== target) return;
      boundary.afterRead = undefined;
      await writeFile(target, latest);
    };
    session = createWorkspaceQuerySession({ cwd: project });
    await session.get(['alpha']);
    await vi.waitFor(async () =>
      expect(await session!.get(['alpha'])).toMatchObject({
        success: true,
        results: [
          { revision: createHash('sha256').update(latest).digest('hex') },
        ],
      }),
    );
    expect(session.catalogVersion).toBe(2);
  });

  it('초기 재확인 중 두 번째 조회가 들어오면 중간 snapshot 대신 같은 완료를 기다린다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    const reached = barrier();
    const released = barrier();
    const latest =
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 최신\n';
    await writeFile(
      target,
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n',
    );
    boundary.afterRead = async (file) => {
      if (file !== target) return;
      if (boundary.reads.get(target) === 1) {
        await writeFile(target, latest);
        boundary.emit([target]);
      } else {
        reached.release();
        await released.promise;
      }
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const first = session.get(['alpha']);
    await reached.promise;
    const second = session.get(['alpha']);
    let secondDone = false;
    const completed = second.then(() => {
      secondDone = true;
    });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    expect(session.catalogVersion).toBe(0);
    released.release();
    expect(await second).toEqual(await first);
    await completed;
    expect(session.catalogVersion).toBe(1);
  });

  it('읽기 중 close하면 늦게 완료한 원문을 게시하거나 새 감시를 시작하지 않는다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    const reached = barrier();
    const released = barrier();
    await writeFile(
      target,
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n',
    );
    boundary.afterRead = async () => {
      reached.release();
      await released.promise;
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const first = session.get(['alpha']);
    await reached.promise;
    await session.close();
    released.release();
    expect(await first).toMatchObject({ success: false });
    expect(session.catalogVersion).toBe(0);
    expect(session.readiness.state).toBe(workspaceLifecycleStates.closed);
    expect(boundary.starts).toBe(1);
    expect(boundary.closes).toBe(1);
  });
});

describe('준비 상태별 저장 차단', () => {
  const before =
    'id: alpha\nname: 알파\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 본문\n';
  const change = () => ({
    mode: 'update',
    id: 'alpha',
    revision: createHash('sha256').update(before).digest('hex'),
    set: { definition: '변경' },
  });

  it('최초 탐색이 끝나기 전에는 저장하지 않고 완료 뒤에만 반영한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(target, before);
    const reached = barrier();
    const released = barrier();
    boundary.afterRead = async (file) => {
      if (file !== target) return;
      boundary.afterRead = undefined;
      reached.release();
      await released.promise;
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const operation = session.write(change());
    await reached.promise;
    expect(await readFile(target, 'utf8')).toBe(before);
    released.release();
    expect(await operation).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
  });

  it('최초 전체 탐색 실패에는 저장을 시작하지 않는다', async () => {
    const folder = path.join(project, '.codocs');
    const target = path.join(folder, 'alpha.yaml');
    await writeFile(target, before);
    boundary.afterReadDirectory = (directory) =>
      directory === folder
        ? Promise.reject(new Error('root unavailable'))
        : Promise.resolve();
    session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.write(change())).toMatchObject({
      success: false,
      saved: false,
    });
    expect(await readFile(target, 'utf8')).toBe(before);
  });

  it('부분 탐색과 감시 실패에는 저장을 시작하지 않는다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(target, before);
    session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    boundary.afterRead = (file) =>
      file === target
        ? Promise.reject(new Error('injected read failure'))
        : Promise.resolve();
    boundary.emit([target]);
    await vi.waitFor(() => expect(session!.scanStatus).toBe('partial'));
    expect(await session.write(change())).toMatchObject({
      success: false,
      saved: false,
    });
    boundary.afterRead = undefined;
    await session.refresh();
    boundary.watchFailed = true;
    const watchResult = await session.write(change());
    expect(watchResult).toMatchObject({
      success: false,
      saved: false,
    });
    if (!watchResult.success)
      expect(watchResult.error.message).toContain('injected watcher failure');
    expect(await readFile(target, 'utf8')).toBe(before);
  });

  it('명시적 전체 refresh가 진행되는 동안 저장을 시작하지 않는다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(target, before);
    session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    const refreshing = session.refresh();
    expect(await session.write(change())).toMatchObject({
      success: false,
      saved: false,
    });
    await refreshing;
    expect(await readFile(target, 'utf8')).toBe(before);
  });
});

describe('경로 보정 실패의 보존과 수동 전체 복구', () => {
  it('변경 파일의 재읽기가 실패하면 이전 본문과 revision을 미확인으로 보존한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    const before =
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n';
    await writeFile(target, before);
    session = createWorkspaceQuerySession({ cwd: project });
    await session.get(['alpha']);
    boundary.afterRead = (file) => {
      if (file === target)
        return Promise.reject(new Error('injected read failure'));
      return Promise.resolve();
    };
    boundary.emit([target]);
    await vi.waitFor(() => expect(session!.scanStatus).toBe('partial'));
    const result = await session.get(['alpha']);
    expect(result).toMatchObject({
      success: true,
      scanStatus: 'partial',
      results: [
        {
          found: true,
          confirmation: 'unconfirmed',
          document: { definition: '이전' },
          revision: createHash('sha256').update(before).digest('hex'),
        },
      ],
    });
  });

  it('일반 파일 보정 도중 수동 refresh를 요청하면 보정 뒤 전체 파일을 새로 읽는다', async () => {
    const alpha = path.join(project, '.codocs', 'alpha.yaml');
    const beta = path.join(project, '.codocs', 'beta.yaml');
    await writeFile(
      alpha,
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 이전\n',
    );
    await writeFile(
      beta,
      'id: beta\nname: beta\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: 고정\n',
    );
    session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    const reached = barrier();
    const released = barrier();
    boundary.afterRead = async (file) => {
      if (file !== alpha || boundary.reads.get(alpha) !== 2) return;
      reached.release();
      await released.promise;
    };
    boundary.emit([alpha]);
    await reached.promise;
    const refreshing = session.refresh();
    released.release();
    expect(await refreshing).toMatchObject({
      success: true,
      scanStatus: 'complete',
      fileCount: 2,
    });
    expect(boundary.reads.get(alpha)).toBe(3);
    expect(boundary.reads.get(beta)).toBe(2);
  });
});

describe('전체 탐색 실패 뒤 확인 범위 복구', () => {
  it('전체 폴더 열거 실패 뒤 파일 하나의 신호가 오면 전체 범위를 다시 확인한다', async () => {
    const codocs = path.join(project, '.codocs');
    const alpha = path.join(codocs, 'alpha.yaml');
    const beta = path.join(codocs, 'beta.yaml');
    await writeFile(
      alpha,
      'id: alpha\nname: alpha\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: A\n',
    );
    await writeFile(
      beta,
      'id: beta\nname: beta\ndomains: [업무]\ndeprecatedAliases: []\ndefinition: B\n',
    );
    boundary.afterReadDirectory = (directory) => {
      if (directory === codocs)
        return Promise.reject(new Error('root unavailable'));
      return Promise.resolve();
    };
    session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.list()).toMatchObject({
      success: false,
      scanStatus: 'failed',
    });
    boundary.afterReadDirectory = undefined;
    boundary.emit([alpha]);
    await vi.waitFor(async () =>
      expect(await session!.list()).toMatchObject({
        success: true,
        scanStatus: 'complete',
        items: [{ id: 'alpha' }, { id: 'beta' }],
      }),
    );
    expect(boundary.reads.get(beta)).toBe(1);
  });
});
