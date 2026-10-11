import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceLifecycleStates } from '../lifecycle/index.js';
import { createWorkspaceWatcher, type WorkspaceWatcher } from './index.js';
import {
  renameWithRetry,
  rmWithRetry,
} from '../../../../tools/test/support/retrying-fs.js';

let project: string;
let watcher: WorkspaceWatcher | undefined;

beforeEach(async () => {
  const fixtureParent = path.resolve('.workbench/fixtures');
  await mkdir(fixtureParent, { recursive: true });
  project = await mkdtemp(path.join(fixtureParent, 'watcher-'));
});

afterEach(async () => {
  try {
    await watcher?.close();
  } finally {
    watcher = undefined;
    await rmWithRetry(project, { recursive: true, force: true });
  }
});

describe('createWorkspaceWatcher 파일 변화 신호', () => {
  it('문서가 있는 프로젝트의 감시를 시작하면 준비 완료 상태를 반환한다', async () => {
    const codocs = path.join(project, '.codocs');
    await mkdir(codocs);
    await writeFile(path.join(codocs, 'alpha.yaml'), 'id: alpha\n');

    watcher = await createWorkspaceWatcher(project);

    expect(watcher.readiness).toEqual({
      state: workspaceLifecycleStates.ready,
      ready: true,
    });
    expect(watcher.automaticRecoveryAttempts).toBe(0);
  });

  describe('내부 문서의 생성·수정·삭제 신호', () => {
    it.each(['alpha.yaml', 'nested/deep/alpha.yaml'])(
      '%s 파일을 생성하면 해당 절대 경로를 전달한다',
      async (relativePath) => {
        const codocs = path.join(project, '.codocs');
        await mkdir(codocs);
        watcher = await createWorkspaceWatcher(project);
        const paths: string[] = [];
        watcher.subscribe((batch) => paths.push(...batch.paths));
        const target = path.join(codocs, relativePath);

        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, 'id: alpha\n');

        await vi.waitFor(() => expect(paths).toContain(target), {
          timeout: 5_000,
        });
      },
    );

    it('기존 문서를 수정하면 해당 경로를 전달하고 작성한 원문을 보존한다', async () => {
      const codocs = path.join(project, '.codocs');
      await mkdir(codocs);
      const target = path.join(codocs, 'alpha.yaml');
      await writeFile(target, 'id: alpha\n');
      watcher = await createWorkspaceWatcher(project);
      const paths: string[] = [];
      watcher.subscribe((batch) => paths.push(...batch.paths));
      const raw = 'id: alpha\ndefinition: 변경된 원문\n';

      await writeFile(target, raw);

      await vi.waitFor(() => expect(paths).toContain(target), {
        timeout: 5_000,
      });
      expect(await readFile(target, 'utf8')).toBe(raw);
    });

    it('기존 문서를 삭제하면 삭제된 경로의 재확인 신호를 전달한다', async () => {
      const codocs = path.join(project, '.codocs');
      await mkdir(codocs);
      const target = path.join(codocs, 'alpha.yaml');
      await writeFile(target, 'id: alpha\n');
      watcher = await createWorkspaceWatcher(project);
      const paths: string[] = [];
      watcher.subscribe((batch) => paths.push(...batch.paths));

      await rmWithRetry(target);

      await vi.waitFor(() => expect(paths).toContain(target), {
        timeout: 5_000,
      });
    });

    it('문서를 다른 이름으로 이동하면 이전 경로와 새 경로를 전달한다', async () => {
      const codocs = path.join(project, '.codocs');
      await mkdir(codocs);
      const source = path.join(codocs, 'alpha.yaml');
      const destination = path.join(codocs, 'renamed.yaml');
      await writeFile(source, 'id: alpha\n');
      watcher = await createWorkspaceWatcher(project);
      const paths: string[] = [];
      watcher.subscribe((batch) => paths.push(...batch.paths));

      await renameWithRetry(source, destination);

      await vi.waitFor(
        () =>
          expect(paths).toEqual(expect.arrayContaining([source, destination])),
        { timeout: 5_000 },
      );
    });
  });

  describe('.codocs 생명주기와 교체 후 내부 문서 감시', () => {
    it('.codocs가 없는 프로젝트의 감시를 시작하면 이후 생성을 알린다', async () => {
      watcher = await createWorkspaceWatcher(project);
      const paths: string[] = [];
      watcher.subscribe((batch) => paths.push(...batch.paths));
      const codocs = path.join(project, '.codocs');

      await mkdir(codocs);

      await vi.waitFor(() => expect(paths).toContain(codocs), {
        timeout: 5_000,
      });
    });

    it('.codocs 생성 신호 직후 문서를 작성하면 새 문서 경로를 전달한다', async () => {
      watcher = await createWorkspaceWatcher(project);
      const paths: string[] = [];
      watcher.subscribe((batch) => paths.push(...batch.paths));
      const codocs = path.join(project, '.codocs');
      await mkdir(codocs);
      // 생성 신호 이후 작성하는 경합의 사전 조건이다.
      await vi.waitFor(() => expect(paths).toContain(codocs), {
        timeout: 5_000,
      });
      paths.length = 0;
      const target = path.join(codocs, 'alpha.yaml');

      await writeFile(target, 'id: alpha\n');

      await vi.waitFor(() => expect(paths).toContain(target), {
        timeout: 5_000,
      });
    });

    it('기존 .codocs를 삭제하면 디렉터리 경로의 재확인 신호를 전달한다', async () => {
      const codocs = path.join(project, '.codocs');
      await mkdir(codocs);
      watcher = await createWorkspaceWatcher(project);
      const paths: string[] = [];
      watcher.subscribe((batch) => paths.push(...batch.paths));

      await rmWithRetry(codocs, { recursive: true });

      await vi.waitFor(() => expect(paths).toContain(codocs), {
        timeout: 5_000,
      });
    });

    it('기존 .codocs를 이동하고 새 디렉터리를 만들면 새 내부 문서 변경을 전달한다', async () => {
      const codocs = path.join(project, '.codocs');
      await mkdir(codocs);
      await writeFile(path.join(codocs, 'old.yaml'), 'id: old\n');
      watcher = await createWorkspaceWatcher(project);
      const paths: string[] = [];
      watcher.subscribe((batch) => paths.push(...batch.paths));
      await renameWithRetry(codocs, path.join(project, 'saved'));
      await vi.waitFor(() => expect(paths).toContain(codocs), {
        timeout: 5_000,
      });
      paths.length = 0;
      await mkdir(codocs);
      await vi.waitFor(() => expect(paths).toContain(codocs), {
        timeout: 5_000,
      });
      paths.length = 0;
      const target = path.join(codocs, 'replacement.yaml');

      await writeFile(target, 'id: replacement\n');

      await vi.waitFor(() => expect(paths).toContain(target), {
        timeout: 5_000,
      });
    });
  });
});

describe('WorkspaceWatcher.setNestedDirectories: 하위 .codocs 내용 감시', () => {
  it('하위 .codocs를 감시 대상으로 주면 그 안의 파일 생성 경로를 전달한다', async () => {
    const nested = path.join(project, 'packages', 'core', '.codocs');
    await mkdir(nested, { recursive: true });
    watcher = await createWorkspaceWatcher(project);
    const paths: string[] = [];
    watcher.subscribe((batch) => paths.push(...batch.paths));
    await watcher.setNestedDirectories([nested]);
    const target = path.join(nested, 'a.yaml');

    await writeFile(target, 'id: a\n');

    await vi.waitFor(() => expect(paths).toContain(target), {
      timeout: 5_000,
    });
  });

  it('감시 대상에서 뺀 하위 .codocs의 파일 변경은 전달하지 않는다', async () => {
    const codocs = path.join(project, '.codocs');
    const nested = path.join(project, 'packages', 'core', '.codocs');
    await mkdir(codocs);
    await mkdir(nested, { recursive: true });
    watcher = await createWorkspaceWatcher(project);
    await watcher.setNestedDirectories([nested]);
    await watcher.setNestedDirectories([]);
    const paths: string[] = [];
    watcher.subscribe((batch) => paths.push(...batch.paths));
    const ignored = path.join(nested, 'a.yaml');
    const observed = path.join(codocs, 'b.yaml');

    await writeFile(ignored, 'id: a\n');
    await writeFile(observed, 'id: b\n');

    // 같은 시점에 바꾼 루트 .codocs 파일이 전달된 뒤에도 뺀 .codocs의 파일은 없어야 한다.
    await vi.waitFor(() => expect(paths).toContain(observed), {
      timeout: 5_000,
    });
    expect(paths).not.toContain(ignored);
  });

  it('하위 .codocs 폴더가 같은 경로에서 교체되면 다시 감시해 새 폴더의 파일 생성 경로를 전달한다', async () => {
    const nested = path.join(project, 'packages', 'core', '.codocs');
    await mkdir(nested, { recursive: true });
    watcher = await createWorkspaceWatcher(project);
    await watcher.setNestedDirectories([nested]);
    await renameWithRetry(
      nested,
      path.join(project, 'packages', 'core', 'old'),
    );
    await mkdir(nested);
    await watcher.reopenNestedDirectory(nested);
    const paths: string[] = [];
    watcher.subscribe((batch) => paths.push(...batch.paths));
    const target = path.join(nested, 'a.yaml');

    await writeFile(target, 'id: a\n');

    await vi.waitFor(() => expect(paths).toContain(target), {
      timeout: 5_000,
    });
  });
});
