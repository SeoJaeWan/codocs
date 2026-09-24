import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watcherBoundary as boundary } from '../test-support/watcher.js';
import { stat } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(() => Promise.resolve({ dev: 1, ino: 1 })),
}));
vi.mock('node:fs', async () =>
  (await import('../test-support/watcher.js')).directoryMock(),
);
vi.mock('chokidar', async () =>
  (await import('../test-support/watcher.js')).chokidarMock(),
);
const root = path.resolve('자료 공간');
const target = path.resolve('외부 자료');
const contract = {
  root,
  target,
  codocs: path.join(root, '.codocs'),
  child: path.join(target, '한글.yaml'),
};
afterEach(() => {
  vi.clearAllMocks();
  boundary.connections.length = 0;
  boundary.directory = undefined;
  boundary.closeGate = undefined;
});
import { createWorkspaceWatcher } from './index.js';

describe('현재 OS 경로와 watcher 이벤트·종료 처리', () => {
  it('외부 대상 조상을 등록하면 무관한 보호 폴더를 metadata 탐색에서도 제외한다', async () => {
    boundary.connections.length = 0;
    const watcher = await createWorkspaceWatcher(contract.root);
    try {
      await watcher.trackTargets([contract.child]);
      const parents = vi
        .mocked(stat)
        .mock.calls.map(([candidate]) => candidate);
      expect(parents).toContain(contract.target);
      const protectedPath = path.join(
        path.parse(contract.root).root,
        'unrelated',
      );
      expect(parents).not.toContain(protectedPath);
      expect(parents).not.toContain(contract.target + '-형제');
      expect(boundary.connections.map((entry) => entry.paths)).not.toContain(
        contract.target,
      );
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
