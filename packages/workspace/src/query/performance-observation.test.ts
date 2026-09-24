import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createWorkspaceQuerySession } from './index.js';

let project: string | undefined;

afterEach(async () => {
  if (project) await rm(project, { recursive: true, force: true });
  project = undefined;
});

it('관측자는 최초 조회를 시작하지 않고 실제 감시 준비와 완료 게시 순서만 받는다', async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/fixtures/observer-'));
  const codocs = path.join(project, '.codocs');
  await mkdir(codocs);
  await writeFile(
    path.join(codocs, 'alpha.yaml'),
    'id: alpha\nname: alpha\ndefinition: 최초\ndomains: [업무]\n',
  );
  const events: { kind: string; detail: Record<string, unknown> }[] = [];
  const session = createWorkspaceQuerySession(
    { cwd: project },
    (kind, detail) => events.push({ kind, detail }),
  );
  try {
    expect(events).toEqual([]);
    const result = await session.get(['alpha']);
    expect(result).toMatchObject({
      success: true,
      results: [{ found: true, document: { definition: '최초' } }],
    });
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        'index-start',
        'watcher-ready',
        'index-published',
      ]),
    );
    const start = events.findIndex((event) => event.kind === 'index-start');
    const watcher = events.findIndex((event) => event.kind === 'watcher-ready');
    const published = events.findIndex(
      (event) => event.kind === 'index-published',
    );
    expect(start).toBeLessThan(watcher);
    expect(watcher).toBeLessThan(published);
    expect(events[published]?.detail).toMatchObject({
      status: 'complete',
      initial: true,
      documents: 1,
    });
  } finally {
    await session.close();
  }
});
