import type { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { osContracts } from '../../../../tools/test-support/os-contracts.js';

const boundary = vi.hoisted(() => ({
  platform: 'win32',
  connections: [] as {
    paths: string;
    options: {
      depth?: number;
      followSymlinks?: boolean;
      ignored?: (path: string) => boolean;
    };
    emitter: EventEmitter;
    close: ReturnType<typeof vi.fn>;
  }[],
  directory: undefined as
    | (EventEmitter & { notify: (event: string, name: string | null) => void })
    | undefined,
  closeGate: undefined as Promise<void> | undefined,
}));
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    default: new Proxy(actual.posix, {
      get(_target, key): unknown {
        return Reflect.get(
          boundary.platform === 'win32' ? actual.win32 : actual.posix,
          key,
        ) as unknown;
      },
    }),
  };
});
vi.mock('node:fs/promises', () => ({
  stat: () => Promise.resolve({ dev: 1, ino: 1 }),
}));
vi.mock('node:fs', async () => {
  const events = await import('node:events');
  return {
    watch: (
      _path: string,
      notify: (event: string, name: string | null) => void,
    ) => {
      const emitter = Object.assign(new events.EventEmitter(), {
        notify,
        close: () => queueMicrotask(() => emitter.emit('close')),
      });
      boundary.directory = emitter;
      return emitter;
    },
  };
});
vi.mock('chokidar', async () => {
  const events = await import('node:events');
  return {
    default: {
      watch: (
        paths: string,
        options: { ignored?: (path: string) => boolean },
      ) => {
        const emitter = Object.assign(new events.EventEmitter(), {
          close: vi.fn(async () => {
            await boundary.closeGate;
          }),
        });
        boundary.connections.push({
          paths,
          options,
          emitter,
          close: emitter.close,
        });
        queueMicrotask(() => emitter.emit('ready'));
        return emitter;
      },
    },
  };
});
import { createWorkspaceWatcher } from './index.js';

describe.each(osContracts)('$platform 감시 syscall 경계', (contract) => {
  it('외부 대상 조상을 등록하면 무관한 보호 폴더를 metadata 탐색에서도 제외한다', async () => {
    boundary.platform = contract.platform;
    boundary.connections.length = 0;
    const watcher = await createWorkspaceWatcher(contract.root);
    try {
      await watcher.trackTargets([contract.child]);
      const parents = boundary.connections.filter(
        (entry) => entry.options.depth === 0,
      );
      expect(parents.length).toBeGreaterThan(0);
      const protectedPath =
        contract.platform === 'win32'
          ? 'C:\\System Volume Information'
          : '/System';
      for (const parent of parents) {
        expect(parent.options.followSymlinks).toBe(false);
        expect(parent.options.ignored?.(protectedPath)).toBe(true);
        expect(parent.options.ignored?.(contract.target)).toBe(false);
        expect(parent.options.ignored?.(contract.target + '-형제')).toBe(true);
      }
    } finally {
      await watcher.close();
    }
  });

  it('OS별 이벤트 표기와 중복 신호를 받으면 실제 경로 계산 뒤 한 배치로 알린다', async () => {
    boundary.platform = contract.platform;
    boundary.connections.length = 0;
    const watcher = await createWorkspaceWatcher(contract.root);
    const received: string[][] = [];
    watcher.subscribe((batch) => received.push([...batch.paths]));
    try {
      const content = boundary.connections[1]!;
      const target =
        contract.platform === 'win32'
          ? 'C:/자료 공간/.codocs/한글.yaml'
          : '/자료 공간/.codocs/한글.yaml';
      content.emitter.emit(
        'all',
        contract.platform === 'win32' ? 'add' : 'change',
        target,
      );
      content.emitter.emit('all', 'change', target);
      watcher.drain();
      expect(received).toEqual([
        [
          contract.platform === 'win32'
            ? 'C:\\자료 공간\\.codocs\\한글.yaml'
            : '/자료 공간/.codocs/한글.yaml',
        ],
      ]);
    } finally {
      await watcher.close();
    }
  });

  it('OS 연결 close가 지연되면 반복 종료 요청도 완료를 기다리고 늦은 신호를 버린다', async () => {
    boundary.platform = contract.platform;
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
