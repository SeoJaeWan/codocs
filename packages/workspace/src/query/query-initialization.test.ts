import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceWatcher } from '../watcher/index.js';
import { workspaceLifecycleStates } from '../lifecycle/index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from './index.js';

const boundary = vi.hoisted(() => ({
  afterRead: undefined as undefined | ((file: string) => Promise<void>),
  afterDirectory: undefined as undefined | ((file: string) => Promise<void>),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const entries = await actual.readdir(...args);
      await boundary.afterDirectory?.(
        typeof args[0] === 'string' ? args[0] : '',
      );
      return entries;
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const bytes = await actual.readFile(...args);
      await boundary.afterRead?.(typeof args[0] === 'string' ? args[0] : '');
      return bytes;
    },
  };
});
/** 실제 fixture로 심볼릭 링크 제공 여부를 확인하며 OS 이름으로 성공 조건을 나누지 않는다. */
async function supportsSymbolicLinks(): Promise<boolean> {
  const parent = path.resolve('.workbench/fixtures');
  await mkdir(parent, { recursive: true });
  const fixture = await mkdtemp(path.join(parent, 'link-capability-'));
  try {
    await symlink(
      path.join(fixture, 'target'),
      path.join(fixture, 'link'),
      'dir',
    );
    return true;
  } catch (error: unknown) {
    if (
      ['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      return false;
    throw error;
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
const symlinkSupported = await supportsSymbolicLinks();

let project: string;
let session: WorkspaceQuerySession | undefined;
beforeEach(async () => {
  const parent = path.resolve('.workbench/fixtures');
  await mkdir(parent, { recursive: true });
  project = await mkdtemp(path.join(parent, 'initialization-'));
  await mkdir(path.join(project, '.codocs'));
});
afterEach(async () => {
  boundary.afterRead = undefined;
  boundary.afterDirectory = undefined;
  await session?.close();
  session = undefined;
  vi.restoreAllMocks();
  await rm(project, { recursive: true, force: true });
});
describe('최초 조회와 실제 파일 감시 연결', () => {
  it('첫 readFile 반환 전에 수정하면 준비된 감시로 수집해 최신 원문을 게시한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 이전\n',
    );
    const watchers: WorkspaceWatcher[] = [];
    const originalStart = Object.getOwnPropertyDescriptor(
      WorkspaceWatcher.prototype,
      'start',
    )!.value as WorkspaceWatcher['start'];
    const start = vi
      .spyOn(WorkspaceWatcher.prototype, 'start')
      .mockImplementation(function (this: WorkspaceWatcher) {
        watchers.push(this);
        return originalStart.call(this);
      });
    boundary.afterRead = async (file) => {
      if (file !== target) return;
      boundary.afterRead = undefined;
      expect(start).toHaveBeenCalledOnce();
      await writeFile(
        target,
        'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 최신\n',
      );
      await vi.waitFor(
        () => expect(watchers[0]?.hasPendingChanges).toBe(true),
        { interval: 1 },
      );
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const result = await session.get(['alpha']);
    expect(result).toMatchObject({
      success: true,
      results: [{ found: true, document: { definition: '최신' } }],
    });
  });
});

describe('실제 감시와 초기 열거·대상 준비 경계', () => {
  it.each([
    '추가',
    '삭제',
    '교체 저장',
    '폴더 이동',
    '폴더 교체',
    '폴더 재생성',
  ] as const)(
    '첫 폴더 readdir 반환 뒤 %s하면 최종 목록을 반영한다',
    async (operation) => {
      const codocs = path.join(project, '.codocs');
      const directory = path.join(codocs, 'folder');
      const target = path.join(directory, 'alpha.yaml');
      const moved = path.join(codocs, 'moved');
      await mkdir(directory);
      await writeFile(
        target,
        'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 이전\n',
      );
      const events: string[] = [];
      const start = Object.getOwnPropertyDescriptor(
        WorkspaceWatcher.prototype,
        'start',
      )!.value as WorkspaceWatcher['start'];
      vi.spyOn(WorkspaceWatcher.prototype, 'start').mockImplementation(
        function (this: WorkspaceWatcher) {
          this.subscribe((batch) => events.push(...batch.paths));
          return start.call(this);
        },
      );
      boundary.afterDirectory = async (selected) => {
        if (selected !== directory) return;
        boundary.afterDirectory = undefined;
        if (operation === '추가')
          await writeFile(
            path.join(directory, 'beta.yaml'),
            'id: beta\nname: beta\ndomains: [업무]\ndefinition: 추가\n',
          );
        else if (operation === '삭제') await rm(target);
        else if (operation === '교체 저장') {
          const temporary = path.join(project, 'temporary.yaml');
          await writeFile(
            temporary,
            'id: beta\nname: beta\ndomains: [업무]\ndefinition: 교체\n',
          );
          await rename(temporary, target);
        } else if (operation === '폴더 이동') await rename(directory, moved);
        else {
          if (operation === '폴더 교체')
            await rename(directory, path.join(project, 'saved'));
          else await rm(directory, { recursive: true });
          await mkdir(directory);
          await writeFile(
            path.join(directory, 'beta.yaml'),
            'id: beta\nname: beta\ndomains: [업무]\ndefinition: 재생성\n',
          );
        }
        await vi.waitFor(
          () =>
            expect(
              events.some(
                (event) =>
                  event === directory || event.startsWith(directory + path.sep),
              ),
            ).toBe(true),
          { timeout: 5_000 },
        );
      };
      session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list();
      const expected =
        operation === '추가'
          ? ['alpha', 'beta']
          : operation === '삭제'
            ? []
            : operation === '폴더 이동'
              ? ['alpha']
              : ['beta'];
      expect(first.success).toBe(true);
      if (!first.success) throw new Error('최초 목록 실패');
      expect(first.items.map((item) => item.id)).toEqual(expected);
      expect(first.scanStatus).toBe('complete');
    },
  );

  it('감시 시작 시 .codocs가 없어도 이후 생성한 문서를 조회한다', async () => {
    const codocs = path.join(project, '.codocs');
    await rm(codocs, { recursive: true });
    session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.list()).toMatchObject({
      success: true,
      totalCount: 0,
    });
    await mkdir(codocs);
    await writeFile(
      path.join(codocs, 'alpha.yaml'),
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 생성\n',
    );
    await vi.waitFor(
      async () =>
        expect(await session!.get(['alpha'])).toMatchObject({
          success: true,
          results: [{ found: true, document: { definition: '생성' } }],
        }),
      { timeout: 5_000 },
    );
  });

  it.skipIf(!symlinkSupported)(
    '외부 대상 등록이 준비되는 동안 원문이 바뀌면 준비 뒤 읽은 revision을 게시한다',
    async () => {
      const external = path.join(project, 'external.yaml');
      const logical = path.join(project, '.codocs', 'linked.yaml');
      const latest =
        'id: linked\nname: linked\ndomains: [업무]\ndefinition: 최신\n';
      await writeFile(
        external,
        'id: linked\nname: linked\ndomains: [업무]\ndefinition: 이전\n',
      );
      await symlink(external, logical, 'file');
      const track = Object.getOwnPropertyDescriptor(
        WorkspaceWatcher.prototype,
        'trackTargets',
      )!.value as WorkspaceWatcher['trackTargets'];
      let changed = false;
      vi.spyOn(WorkspaceWatcher.prototype, 'trackTargets').mockImplementation(
        async function (this: WorkspaceWatcher, targets) {
          await track.call(this, targets);
          if (targets.includes(external) && !changed) {
            changed = true;
            await writeFile(external, latest);
          }
        },
      );
      session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.get(['linked']);
      expect(changed).toBe(true);
      expect(result).toMatchObject({
        success: true,
        results: [
          {
            found: true,
            document: { definition: '최신' },
            revision: createHash('sha256').update(latest).digest('hex'),
          },
        ],
      });
    },
  );

  it.skipIf(!symlinkSupported)(
    '빈 외부 폴더의 두 발견 경로에 파일이 생기면 별칭을 합치지 않고 두 경로를 게시한다',
    async () => {
      const external = path.join(project, 'external');
      await mkdir(external);
      await symlink(external, path.join(project, '.codocs', 'first'), 'dir');
      await symlink(external, path.join(project, '.codocs', 'second'), 'dir');
      session = createWorkspaceQuerySession({ cwd: project });
      expect(await session.list()).toMatchObject({
        success: true,
        totalCount: 0,
      });
      await writeFile(
        path.join(external, 'shared.yaml'),
        'id: shared\nname: shared\ndomains: [업무]\ndefinition: 외부\n',
      );
      await vi.waitFor(
        async () => {
          const result = await session!.getByPaths(
            [
              path.join('.codocs', 'first', 'shared.yaml'),
              path.join('.codocs', 'second', 'shared.yaml'),
            ],
            session!.catalogVersion,
          );
          expect(result).toMatchObject({
            success: true,
            results: [{ found: true }, { found: true }],
          });
        },
        { timeout: 5_000 },
      );
    },
  );
});

describe('최초 읽기 중 감시 실패 상태의 전달', () => {
  it('최초 읽기 완료 전에 감시가 failed가 되면 원인을 반환하고 관측을 게시하지 않는다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 본문\n',
    );
    boundary.afterRead = async (file) => {
      if (file !== target) return;
      boundary.afterRead = undefined;
      vi.spyOn(WorkspaceWatcher.prototype, 'readiness', 'get').mockReturnValue({
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause: 'connection interrupted',
        guidance: 'manual refresh',
      });
      await Promise.resolve();
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const result = await session.get(['alpha']);
    expect(result).toMatchObject({
      success: false,
      error: { message: 'connection interrupted manual refresh' },
    });
    expect(session.catalogVersion).toBe(0);
  });
});
