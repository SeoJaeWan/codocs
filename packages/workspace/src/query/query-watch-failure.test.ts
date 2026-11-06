import type { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceLifecycleStates } from '../lifecycle/index.js';

// OS 감지가 아닌 감시 실패 뒤 조회 세션의 재동기화 계약을 격리한다.
const fake = vi.hoisted(() => ({
  watchers: [] as (EventEmitter & {
    close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  })[],
  failNext: false,
}));

vi.mock('chokidar', async () => {
  const events = await import('node:events');
  return {
    default: {
      watch: () => {
        const watcher = Object.assign(new events.EventEmitter(), {
          close: vi.fn(() => Promise.resolve()),
          add: () => undefined,
        });
        fake.watchers.push(watcher);
        const fail = fake.failNext;
        fake.failNext = false;
        queueMicrotask(() =>
          watcher.emit(fail ? 'error' : 'ready', new Error('watch failed')),
        );
        return watcher;
      },
    },
  };
});

import { createWorkspaceQuerySession } from './index.js';
import type { WorkspaceQuerySession } from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

/** 순환이 생겨도 테스트가 끝나도록 재동기화 횟수의 상한을 둔다. */
const synchronizeLimit = 20;

let project: string;
let session: WorkspaceQuerySession | undefined;

beforeEach(async () => {
  fake.watchers.length = 0;
  fake.failNext = false;
  const parent = path.resolve('.workbench/fixtures');
  await mkdir(parent, { recursive: true });
  project = await mkdtemp(path.join(parent, 'query-watch-failure-'));
  await mkdir(path.join(project, '.codocs'));
  await writeFile(
    path.join(project, '.codocs', 'alpha.yaml'),
    '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
  );
});

afterEach(async () => {
  try {
    await session?.close();
  } finally {
    session = undefined;
    await rmWithRetry(project, { recursive: true, force: true });
  }
});

describe('감시 실패 뒤 재동기화', () => {
  it('감시가 failed인 동안 대기 변경이 남아도 재동기화를 반복하지 않고 요청에 응답한다', async () => {
    let starts = 0;
    session = createWorkspaceQuerySession({ cwd: project }, (kind) => {
      if (kind !== 'index-start') return;
      starts += 1;
      if (starts > synchronizeLimit) throw new Error('재동기화가 반복됨');
    });
    await session.list();
    starts = 0;

    // 문서를 고친 변경 배치가 전달되기 전에 감시가 끊기고 자동 재연결도 실패한다.
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 바뀐 본문\n',
    );
    const root = fake.watchers[0]!;
    root.emit('all', 'change', target);
    fake.failNext = true;
    root.emit('error', new Error('connection lost'));

    await vi.waitFor(
      () => {
        expect(session!.readiness.state).toBe(workspaceLifecycleStates.failed);
        expect(starts).toBeGreaterThan(0);
      },
      { timeout: 5_000 },
    );
    // 순환이 있으면 I/O 차례가 오기 전에 상한까지 반복한다.
    await new Promise((resolve) => setImmediate(resolve));

    expect(starts).toBe(1);
    expect(await session.list()).toMatchObject({
      success: true,
      items: [{ id: 'alpha', confirmation: 'unconfirmed' }],
    });
  });
});
