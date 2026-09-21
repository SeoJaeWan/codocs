/* eslint-disable @typescript-eslint/unbound-method, codocs/korean-jsdoc, jsdoc/require-jsdoc -- mock 메서드 자체의 호출 여부를 검증한다. */
import { describe, expect, it, vi } from 'vitest';
import {
  RollingRestartBudget,
  WorkspaceClientManager,
  type FolderClientBoundary,
  type WorkspaceFolderBoundary,
  type WorkspaceHostBoundary,
} from './index.js';

const first = { name: 'first', uri: 'file:///workspace/first' };
const second = { name: 'second', uri: 'file:///workspace/second' };

type FolderChangeListener = (event: {
  added: readonly WorkspaceFolderBoundary[];
  removed: readonly WorkspaceFolderBoundary[];
}) => void;

class FakeHost implements WorkspaceHostBoundary {
  readonly failures: string[] = [];
  #current: readonly WorkspaceFolderBoundary[];
  #listener: FolderChangeListener | undefined;

  constructor(folders: readonly WorkspaceFolderBoundary[]) {
    this.#current = folders;
  }

  folders(): readonly WorkspaceFolderBoundary[] {
    return this.#current;
  }

  onDidChangeFolders(listener: FolderChangeListener) {
    this.#listener = listener;
    return { dispose: () => (this.#listener = undefined) };
  }

  reportFailure(message: string): void {
    this.failures.push(message);
  }

  fire(
    added: readonly WorkspaceFolderBoundary[],
    removed: readonly WorkspaceFolderBoundary[],
  ): void {
    this.#current = [
      ...this.#current.filter(
        (folder) => !removed.some((item) => item.uri === folder.uri),
      ),
      ...added,
    ];
    this.#listener?.({ added, removed });
  }
}

function fakeClient(): FolderClientBoundary & {
  start: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(() => Promise.resolve()),
    restart: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
  };
}

describe('WorkspaceClientManager: 폴더별 client 생명주기', () => {
  it('활성화 시 workspace folder마다 독립 client를 하나씩 시작한다', async () => {
    const host = new FakeHost([first, second]);
    const clients = new Map<string, ReturnType<typeof fakeClient>>();
    const manager = new WorkspaceClientManager(host, (folder) => {
      const client = fakeClient();
      clients.set(folder.uri, client);
      return client;
    });

    await manager.activate();

    expect(manager.folderUris).toEqual([first.uri, second.uri]);
    expect(clients.get(first.uri)?.start).toHaveBeenCalledOnce();
    expect(clients.get(second.uri)?.start).toHaveBeenCalledOnce();
  });

  it('폴더 추가·제거 시 client를 만들고 제거한 process를 종료한다', async () => {
    const host = new FakeHost([first]);
    const clients = new Map<string, ReturnType<typeof fakeClient>>();
    const manager = new WorkspaceClientManager(host, (folder) => {
      const client = fakeClient();
      clients.set(folder.uri, client);
      return client;
    });
    await manager.activate();

    host.fire([second], [first]);
    await manager.settled();

    expect(manager.folderUris).toEqual([second.uri]);
    expect(clients.get(first.uri)?.stop).toHaveBeenCalledOnce();
    expect(clients.get(second.uri)?.start).toHaveBeenCalledOnce();
  });

  it('중첩 폴더가 추가되면 남은 client를 재시작해 열린 원문을 다시 동기화한다', async () => {
    const host = new FakeHost([first]);
    const clients = new Map<string, ReturnType<typeof fakeClient>>();
    const manager = new WorkspaceClientManager(host, (folder) => {
      const client = fakeClient();
      clients.set(folder.uri, client);
      return client;
    });
    await manager.activate();

    host.fire([second], []);
    await manager.settled();

    expect(clients.get(first.uri)?.restart).toHaveBeenCalledOnce();
    expect(clients.get(second.uri)?.start).toHaveBeenCalledOnce();
  });

  it('비활성화 시 listener와 모든 client를 정리한다', async () => {
    const host = new FakeHost([first, second]);
    const clients = new Map<string, ReturnType<typeof fakeClient>>();
    const manager = new WorkspaceClientManager(host, (folder) => {
      const client = fakeClient();
      clients.set(folder.uri, client);
      return client;
    });
    await manager.activate();

    await manager.deactivate();
    host.fire([{ name: 'later', uri: 'file:///later' }], []);
    await manager.settled();

    expect(manager.folderUris).toEqual([]);
    expect(clients.get(first.uri)?.stop).toHaveBeenCalledOnce();
    expect(clients.get(second.uri)?.stop).toHaveBeenCalledOnce();
    expect(clients.has('file:///later')).toBe(false);
  });

  it('수동 재시작은 저장 API 없이 각 client의 protocol restart를 호출한다', async () => {
    const host = new FakeHost([first]);
    const client = fakeClient();
    const manager = new WorkspaceClientManager(host, () => client);
    await manager.activate();

    await manager.restartAll();

    expect(client.restart).toHaveBeenCalledOnce();
  });
});

describe('RollingRestartBudget: 반복 종료 제한', () => {
  it('관찰 구간의 허용 횟수 뒤에는 자동 재시작을 중단한다', () => {
    const budget = new RollingRestartBudget(3, 1_000);

    expect(budget.recordFailure(0)).toBe(true);
    expect(budget.recordFailure(100)).toBe(true);
    expect(budget.recordFailure(200)).toBe(true);
    expect(budget.recordFailure(300)).toBe(false);
  });

  it('관찰 구간이 지나거나 사용자가 재시작하면 다시 시도할 수 있다', () => {
    const budget = new RollingRestartBudget(1, 100);

    expect(budget.recordFailure(0)).toBe(true);
    expect(budget.recordFailure(50)).toBe(false);
    expect(budget.recordFailure(200)).toBe(true);
    budget.reset();
    expect(budget.recordFailure(201)).toBe(true);
  });
});
