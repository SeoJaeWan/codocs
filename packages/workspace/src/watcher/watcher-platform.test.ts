import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watcherBoundary as boundary } from '../test-support/watcher.js';
import { lstat } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(() => Promise.resolve()),
  realpath: vi.fn((input: string) => Promise.resolve(input)),
  lstat: vi.fn(() =>
    Promise.resolve({
      dev: 1,
      ino: 1,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }),
  ),
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  ...(await import('../test-support/watcher.js')).directoryMock(),
}));
vi.mock('chokidar', async () =>
  (await import('../test-support/watcher.js')).chokidarMock(),
);
const root = path.resolve('자료 공간');
const contract = {
  root,
  codocs: path.join(root, '.codocs'),
};
afterEach(() => {
  vi.clearAllMocks();
  boundary.connections.length = 0;
  boundary.directory = undefined;
  boundary.closeGate = undefined;
});
import { createWorkspaceWatcher } from './index.js';

describe('현재 OS 경로와 watcher 이벤트·종료 처리', () => {
  it('프로젝트와 .codocs만 감시하며 연결 추적을 열지 않는다', async () => {
    boundary.connections.length = 0;
    const watcher = await createWorkspaceWatcher(contract.root);
    try {
      expect(boundary.connections.map((entry) => entry.paths)).toEqual([
        contract.root,
        contract.codocs,
      ]);
      expect(
        boundary.connections.every(
          (entry) => entry.options.followSymlinks === false,
        ),
      ).toBe(true);
      expect(vi.mocked(lstat)).toHaveBeenCalledWith(contract.codocs);
    } finally {
      await watcher.close();
    }
  });

  it('OS별 이벤트 표기와 중복 신호를 받으면 실제 경로 계산 뒤 한 배치로 알린다', async () => {
    boundary.connections.length = 0;
    const watcher = await createWorkspaceWatcher(contract.root);
    const received: string[][] = [];
    watcher.subscribe((batch) => received.push([...batch.paths]));
    try {
      const content = boundary.connections[1]!;
      const target = path
        .join(contract.codocs, '한글.yaml')
        .split(path.sep)
        .join('/');
      content.emitter.emit('all', 'add', target);
      content.emitter.emit('all', 'change', target);
      watcher.drain();
      expect(received).toEqual([[path.join(contract.codocs, '한글.yaml')]]);
    } finally {
      await watcher.close();
    }
  });

  it('OS 연결 close가 지연되면 반복 종료 요청도 완료를 기다리고 늦은 신호를 버린다', async () => {
    boundary.connections.length = 0;
    const watcher = await createWorkspaceWatcher(contract.root);
    let release!: () => void;
    boundary.closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listener = vi.fn();
    watcher.subscribe(listener);
    let completed = false;
    const closing = watcher.close();
    expect(watcher.close()).toBe(closing);
    const observed = closing.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    boundary.connections[1]!.emitter.emit('all', 'change', contract.codocs);
    watcher.drain();
    expect(listener).not.toHaveBeenCalled();
    release();
    await observed;
    boundary.closeGate = undefined;
    expect(completed).toBe(true);
    expect(
      boundary.connections.every(
        (entry) => entry.close.mock.calls.length === 1,
      ),
    ).toBe(true);
  });
});
