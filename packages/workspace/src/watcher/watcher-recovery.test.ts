import type { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceLifecycleStates } from '../lifecycle/index.js';

// OS 감지의 신뢰성이 아닌 오류 알림 이후의 공개 상태와 배치 계약을 격리한다.
const fake = vi.hoisted(() => ({
  watchers: [] as (EventEmitter & { close: ReturnType<typeof vi.fn> })[],
  failNext: false,
  manualReady: false,
  contentIdentity: undefined as { dev: number; ino: number } | undefined,
  statCalls: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      fake.statCalls += 1;
      return fake.contentIdentity ?? actual.stat(...args);
    },
  };
});

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
        if (!fake.manualReady)
          queueMicrotask(() =>
            watcher.emit(fail ? 'error' : 'ready', new Error('watch failed')),
          );
        return watcher;
      },
    },
  };
});

import {
  createWorkspaceWatcher,
  watcherRecoveryGuidance,
  type WorkspaceWatcher,
} from './index.js';

let project: string;
let watcher: WorkspaceWatcher | undefined;

beforeEach(async () => {
  fake.watchers.length = 0;
  fake.failNext = false;
  fake.manualReady = false;
  fake.contentIdentity = undefined;
  fake.statCalls = 0;
  project = await mkdtemp(path.join(tmpdir(), 'codocs-watcher-recovery-'));
});

afterEach(async () => {
  try {
    await watcher?.close();
  } finally {
    vi.useRealTimers();
    watcher = undefined;
    await rm(project, { recursive: true, force: true });
  }
});

describe('WorkspaceWatcher 신호 병합과 구독 수명', () => {
  it('초기 연결 중 .codocs 알림이 오면 준비 중인 내용 감시자를 닫지 않는다', async () => {
    const codocs = path.join(project, '.codocs');
    await mkdir(codocs);
    fake.manualReady = true;
    fake.contentIdentity = { dev: 1, ino: 1 };
    const starting = createWorkspaceWatcher(project);
    await vi.waitFor(() => expect(fake.watchers).toHaveLength(2));
    const contentWatcher = fake.watchers[1]!;

    fake.watchers[0]!.emit('all', 'addDir', codocs);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const connection of fake.watchers) connection.emit('ready');
    watcher = await starting;

    expect(watcher.readiness).toEqual({
      state: workspaceLifecycleStates.ready,
      ready: true,
    });
    expect(fake.watchers).toHaveLength(2);
    expect(contentWatcher.close).not.toHaveBeenCalled();
  });

  it('같은 .codocs 디렉터리 알림이 겹치면 내용 감시자를 다시 열지 않는다', async () => {
    const codocs = path.join(project, '.codocs');
    await mkdir(codocs);
    fake.contentIdentity = { dev: 1, ino: 1 };
    watcher = await createWorkspaceWatcher(project);
    const contentWatcher = fake.watchers[1]!;
    const initialStatCalls = fake.statCalls;

    fake.watchers[0]!.emit('all', 'addDir', codocs);
    contentWatcher.emit('all', 'addDir', codocs);
    await vi.waitFor(() => expect(fake.statCalls).toBe(initialStatCalls + 1));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(fake.watchers).toHaveLength(2);
    expect(contentWatcher.close).not.toHaveBeenCalled();
  });

  it('같은 경로의 변경 알림이 한 배치에 모이면 경로를 한 번만 전달한다', async () => {
    watcher = await createWorkspaceWatcher(project);
    const listener = vi.fn();
    watcher.subscribe(listener);
    const target = path.join(project, '.codocs', 'alpha.yaml');
    vi.useFakeTimers();

    fake.watchers.at(-1)!.emit('all', 'add', target);
    fake.watchers.at(-1)!.emit('all', 'change', target);
    await vi.advanceTimersByTimeAsync(50);

    expect(listener).toHaveBeenCalledExactlyOnceWith({ paths: [target] });
  });

  it('구독을 해제하면 이후 변경 배치를 해당 구독자에게 전달하지 않는다', async () => {
    watcher = await createWorkspaceWatcher(project);
    const listener = vi.fn();
    const unsubscribe = watcher.subscribe(listener);
    const activeListener = vi.fn();
    watcher.subscribe(activeListener);
    const target = path.join(project, '.codocs', 'alpha.yaml');
    vi.useFakeTimers();

    unsubscribe();
    fake.watchers.at(-1)!.emit('all', 'change', target);
    await vi.advanceTimersByTimeAsync(50);

    expect(listener).not.toHaveBeenCalled();
    expect(activeListener).toHaveBeenCalledExactlyOnceWith({ paths: [target] });
  });

  it('배치가 대기 중일 때 종료하면 감시자를 닫고 대기 알림을 취소한다', async () => {
    watcher = await createWorkspaceWatcher(project);
    const listener = vi.fn();
    watcher.subscribe(listener);
    const target = path.join(project, '.codocs', 'alpha.yaml');
    vi.useFakeTimers();
    fake.watchers.at(-1)!.emit('all', 'change', target);

    await watcher.close();
    await vi.advanceTimersByTimeAsync(50);

    expect(watcher.readiness).toEqual({
      state: workspaceLifecycleStates.closed,
      ready: false,
    });
    expect(listener).not.toHaveBeenCalled();
    for (const connection of fake.watchers)
      expect(connection.close).toHaveBeenCalled();
  });
});

describe('WorkspaceWatcher 감시 오류 복구', () => {
  it('최초 감시 연결에서 오류가 나면 자동 복구 후 준비 완료 상태를 반환한다', async () => {
    fake.failNext = true;

    watcher = await createWorkspaceWatcher(project);

    expect(watcher.readiness).toEqual({
      state: workspaceLifecycleStates.ready,
      ready: true,
    });
    expect(watcher.automaticRecoveryAttempts).toBe(1);
  });

  describe('자동 재연결 성공과 실패', () => {
    it('감시 오류 뒤 재연결이 성공하면 준비 상태와 재관측 신호를 제공한다', async () => {
      watcher = await createWorkspaceWatcher(project);
      const listener = vi.fn();
      watcher.subscribe(listener);

      fake.watchers[0]!.emit('error', new Error('connection lost'));

      expect(watcher.readiness.state).toBe(workspaceLifecycleStates.recovering);
      await vi.waitFor(() =>
        expect(watcher!.readiness).toEqual({
          state: workspaceLifecycleStates.ready,
          ready: true,
        }),
      );
      expect(watcher.automaticRecoveryAttempts).toBe(1);
      await vi.waitFor(() =>
        expect(listener).toHaveBeenCalledWith({
          paths: [path.join(project, '.codocs')],
        }),
      );
    });

    it('자동 재연결도 실패하면 실패 원인과 수동 복구 안내를 제공한다', async () => {
      watcher = await createWorkspaceWatcher(project);
      fake.failNext = true;

      fake.watchers[0]!.emit('error', new Error('connection lost'));

      await vi.waitFor(() =>
        expect(watcher!.readiness).toEqual({
          state: workspaceLifecycleStates.failed,
          ready: false,
          cause: 'watch failed',
          guidance: watcherRecoveryGuidance,
        }),
      );
      expect(watcher.automaticRecoveryAttempts).toBe(1);
    });

    it('자동 복구 성공 후 다시 오류가 나면 추가 재연결 없이 실패를 알린다', async () => {
      watcher = await createWorkspaceWatcher(project);
      fake.watchers[0]!.emit('error', new Error('first failure'));
      await vi.waitFor(() =>
        expect(watcher!.readiness.state).toBe(workspaceLifecycleStates.ready),
      );
      const connectionsBeforeError = [...fake.watchers];

      fake.watchers.at(-1)!.emit('error', new Error('second failure'));

      expect(watcher.readiness).toEqual({
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause: 'second failure',
        guidance: watcherRecoveryGuidance,
      });
      expect(watcher.automaticRecoveryAttempts).toBe(1);
      expect(fake.watchers).toEqual(connectionsBeforeError);
    });
  });

  describe('수동 재연결과 자동 복구 횟수 초기화', () => {
    it('자동 복구 실패 후 수동 refresh가 성공하면 준비 상태와 자동 복구 기회를 되돌린다', async () => {
      watcher = await createWorkspaceWatcher(project);
      fake.failNext = true;
      fake.watchers[0]!.emit('error', new Error('connection lost'));
      await vi.waitFor(() =>
        expect(watcher!.readiness.state).toBe(workspaceLifecycleStates.failed),
      );

      const readiness = await watcher.refresh();

      expect(readiness).toEqual({
        state: workspaceLifecycleStates.ready,
        ready: true,
      });
      expect(watcher.automaticRecoveryAttempts).toBe(0);
    });

    it('수동 refresh의 재연결이 실패하면 원인과 수동 안내를 반환한다', async () => {
      watcher = await createWorkspaceWatcher(project);
      fake.failNext = true;

      const readiness = await watcher.refresh();

      expect(readiness).toEqual({
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause: 'watch failed',
        guidance: watcherRecoveryGuidance,
      });
    });
  });
});
