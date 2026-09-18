/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- Vitest 목업 콜백은 공개 선언 함수가 아니다. */
import type { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  watchers: [] as EventEmitter[],
  failNext: false,
}));

vi.mock('chokidar', async () => {
  const events = await import('node:events');
  return {
    default: {
      watch: () => {
        const watcher = Object.assign(new events.EventEmitter(), {
          close: () => Promise.resolve(),
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

import { createWorkspaceWatcher, watcherRecoveryGuidance } from './index.js';

describe('workspace watcher 복구', () => {
  it('감시 오류 뒤 자동 재연결을 한 번만 시도하고 실패 원인과 수동 안내를 남긴다', async () => {
    const project = await mkdtemp(
      path.join(tmpdir(), 'codocs-watcher-recovery-'),
    );
    const watcher = await createWorkspaceWatcher(project);
    expect(fake.watchers).toHaveLength(2);
    fake.failNext = true;
    fake.watchers[0]?.emit('error', new Error('connection lost'));

    await vi.waitFor(() => expect(watcher.readiness.state).toBe('failed'));
    expect(fake.watchers).toHaveLength(4);
    expect(watcher.automaticRecoveryAttempts).toBe(1);
    expect(watcher.readiness).toMatchObject({
      ready: false,
      cause: 'watch failed',
      guidance: watcherRecoveryGuidance,
    });

    const count = fake.watchers.length;
    fake.watchers[2]?.emit('error', new Error('again'));
    expect(fake.watchers).toHaveLength(count);
    await watcher.close();
    await rm(project, { recursive: true, force: true });
  });
});
