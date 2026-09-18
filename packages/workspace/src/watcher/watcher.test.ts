/* eslint-disable codocs/korean-jsdoc -- Vitest 콜백은 공개 선언 함수가 아니다. */
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceWatcher, type WorkspaceWatcher } from './index.js';

let project: string;
let watcher: WorkspaceWatcher | undefined;

beforeEach(async () => {
  const fixtureParent = path.resolve('.workbench/fixtures');
  await mkdir(fixtureParent, { recursive: true });
  project = await mkdtemp(path.join(fixtureParent, 'watcher-'));
});

afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
  await rm(project, { recursive: true, force: true });
});

describe('workspace watcher 신호', () => {
  it('.codocs 생성과 교체 후 새 문서 변경을 감지한다', async () => {
    watcher = await createWorkspaceWatcher(project);
    const batches: string[][] = [];
    watcher.subscribe((batch) => batches.push([...batch.paths]));
    const codocs = path.join(project, '.codocs');
    await mkdir(codocs);
    await vi.waitFor(() => expect(batches.flat()).toContain(codocs));
    await writeFile(path.join(codocs, 'alpha.yaml'), 'id: alpha\n');
    await vi.waitFor(() =>
      expect(batches.flat()).toContain(path.join(codocs, 'alpha.yaml')),
    );
    await rename(codocs, path.join(project, 'saved'));
    await vi.waitFor(() =>
      expect(batches.flat().filter((p) => p === codocs).length).toBeGreaterThan(
        1,
      ),
    );
    await mkdir(codocs);
    await vi.waitFor(() =>
      expect(batches.flat().filter((p) => p === codocs).length).toBeGreaterThan(
        2,
      ),
    );
    expect(watcher.readiness.ready).toBe(true);
  });

  it('연결된 외부 파일의 삭제와 재생성을 감지한다', async () => {
    await mkdir(path.join(project, '.codocs'));
    const external = path.join(project, 'external');
    await mkdir(external);
    const target = path.join(external, 'shared.yaml');
    await writeFile(target, 'id: shared\n');
    watcher = await createWorkspaceWatcher(project);
    await watcher.trackTargets([target]);
    const seen: string[] = [];
    watcher.subscribe((batch) => seen.push(...batch.paths));
    await rm(target);
    await vi.waitFor(() => expect(seen).toContain(target));
    seen.length = 0;
    await writeFile(target, 'id: shared\n');
    await vi.waitFor(() => expect(seen).toContain(target));
    seen.length = 0;
    await rename(external, path.join(project, 'external-saved'));
    await vi.waitFor(() => expect(seen).toContain(external));
    seen.length = 0;
    await mkdir(external);
    await vi.waitFor(() => expect(seen).toContain(external));
  });
});
