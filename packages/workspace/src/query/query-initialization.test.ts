import { createLink as symlink } from '../test-support/links.js';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import {
  renameWithRetry,
  rmWithRetry,
} from '../../../../tools/test/support/retrying-fs.js';
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
  await rmWithRetry(project, { recursive: true, force: true });
});
describe('최초 조회와 실제 파일 감시 연결', () => {
  it('첫 readFile 반환 전에 수정하면 완료 알림과 live 참조가 같은 최신 원문을 사용한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 이전\n',
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
        '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 최신\n',
      );
      await vi.waitFor(
        () => expect(watchers[0]?.hasPendingChanges).toBe(true),
        { interval: 1, timeout: 5_000 },
      );
    };
    session = createWorkspaceQuerySession({ cwd: project });
    const active = session;
    const versions: number[] = [];
    const references: ReturnType<WorkspaceQuerySession['references']>[] = [];
    session.onDidChangeSnapshot((event) => {
      versions.push(event.catalogVersion);
      references.push(
        active.references({
          sourcePath: '.codocs/source.yaml',
          text: '_codocs:\n  id: source\n  name: source\ndefinition: "[[alpha]]"\n',
          documentVersion: 1,
        }),
      );
    });
    const result = await session.get(['alpha']);
    expect(result).toMatchObject({
      success: true,
      results: [{ found: true, document: { definition: '최신' } }],
    });
    expect(versions).toEqual([session.catalogVersion]);
    expect(await Promise.all(references)).toMatchObject([
      {
        success: true,
        catalogVersion: session.catalogVersion,
        documentVersion: 1,
        diagnostics: [],
        targets: [
          {
            found: true,
            path: path.join('.codocs', 'alpha.yaml'),
            document: { definition: '최신' },
            revision: createHash('sha256')
              .update(
                '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 최신\n',
              )
              .digest('hex'),
          },
        ],
      },
    ]);
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
        '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 이전\n',
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
        const beforeMutation = events.length;
        if (operation === '추가')
          await writeFile(
            path.join(directory, 'beta.yaml'),
            '_codocs:\n  id: beta\n  name: beta\ndefinition: 추가\n',
          );
        else if (operation === '삭제') await rmWithRetry(target);
        else if (operation === '교체 저장') {
          const temporary = path.join(project, 'temporary.yaml');
          await writeFile(
            temporary,
            '_codocs:\n  id: beta\n  name: beta\ndefinition: 교체\n',
          );
          await renameWithRetry(temporary, target);
        } else if (operation === '폴더 이동')
          await renameWithRetry(directory, moved);
        else {
          if (operation === '폴더 교체')
            await renameWithRetry(directory, path.join(project, 'saved'));
          else await rmWithRetry(directory, { recursive: true });
          await mkdir(directory);
          await writeFile(
            path.join(directory, 'beta.yaml'),
            '_codocs:\n  id: beta\n  name: beta\ndefinition: 재생성\n',
          );
        }
        // 변경 중 앞선 신호(예: 옮긴 폴더의 사라짐)만으로 넘어가면 최종 파일이 반영되기 전 목록을 본다.
        // 최종 상태를 만드는 파일의 신호를 기다린다.
        const finalPath =
          operation === '삭제' || operation === '교체 저장'
            ? target
            : operation === '폴더 이동'
              ? path.join(moved, 'alpha.yaml')
              : path.join(directory, 'beta.yaml');
        await vi.waitFor(
          () => expect(events.slice(beforeMutation)).toContain(finalPath),
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
    await rmWithRetry(codocs, { recursive: true });
    session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.list()).toMatchObject({
      success: true,
    });
    await mkdir(codocs);
    await writeFile(
      path.join(codocs, 'alpha.yaml'),
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 생성\n',
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

  it('외부 정션은 색인하지 않고 일반 하위 폴더의 새 파일을 갱신한다', async () => {
    const external = path.join(project, 'external');
    const nested = path.join(project, '.codocs', 'nested');
    await mkdir(external);
    await mkdir(nested);
    await symlink(
      external,
      path.join(project, '.codocs', 'linked'),
      'junction',
    );
    session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.list()).toMatchObject({
      success: true,
      scanStatus: 'complete',
    });
    await writeFile(
      path.join(external, 'ignored.yaml'),
      '_codocs:\n  id: ignored\n  name: ignored\ndefinition: outside\n',
    );
    await writeFile(
      path.join(nested, 'ordinary.yaml'),
      '_codocs:\n  id: ordinary\n  name: ordinary\ndefinition: inside\n',
    );
    await vi.waitFor(
      async () => {
        expect(await session!.get(['ordinary', 'ignored'])).toMatchObject({
          success: true,
          results: [{ found: true }, { found: false }],
        });
      },
      { timeout: 5_000 },
    );
  });
});

describe('최초 읽기 중 감시 실패 상태의 전달', () => {
  it('최초 읽기 완료 전에 감시가 failed가 되면 원인을 반환하고 관측을 게시하지 않는다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
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
