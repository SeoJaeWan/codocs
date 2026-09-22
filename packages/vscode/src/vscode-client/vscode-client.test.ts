import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => {
  const disposable = { dispose: vi.fn() };
  const folder = {
    uri: { toString: () => 'file:///fixture' },
    name: 'fixture',
    index: 0,
  };
  const document = {
    uri: { scheme: 'file', toString: () => 'file:///fixture/source.yaml' },
    version: 1,
    isClosed: false,
  };
  return {
    disposable,
    folder,
    document,
    owner: folder,
    notifications: new Map<string, () => void>(),
    send: vi.fn(),
    state: undefined as ((event: { newState: number }) => void) | undefined,
    links: undefined as
      ((document: unknown, token: unknown) => Promise<unknown>) | undefined,
    hover: undefined as
      | ((
          document: unknown,
          position: unknown,
          token: unknown,
        ) => Promise<unknown>)
      | undefined,
  };
});
vi.mock('vscode', () => ({
  workspace: {
    textDocuments: [boundary.document],
    getWorkspaceFolder: () => boundary.owner,
    createFileSystemWatcher: () => ({
      ...boundary.disposable,
      onDidCreate: () => boundary.disposable,
      onDidChange: () => boundary.disposable,
      onDidDelete: () => boundary.disposable,
    }),
  },
  languages: {
    registerDocumentLinkProvider: (
      _selector: unknown,
      provider: { provideDocumentLinks: typeof boundary.links },
    ) => {
      boundary.links = provider.provideDocumentLinks;
      return boundary.disposable;
    },
    registerHoverProvider: (
      _selector: unknown,
      provider: { provideHover: typeof boundary.hover },
    ) => {
      boundary.hover = provider.provideHover;
      return boundary.disposable;
    },
  },
  ['Uri']: { parse: (value: string) => ({ toString: () => value }) },
  ['RelativePattern']: class {},
}));
vi.mock('vscode-languageclient/node.js', () => ({
  ['CloseAction']: {},
  ['ErrorAction']: {},
  ['State']: { ['Running']: 2 },
  ['TransportKind']: { ipc: 1 },
  ['HoverRequest']: { type: 'hover' },
  ['DocumentLinkRequest']: { type: 'links' },
  ['LanguageClient']: class {
    protocol2CodeConverter = {
      asDocumentLinks: (value: unknown) => Promise.resolve(value),
      asHover: (value: unknown) => value,
    };
    /** 테스트 요청의 응답 경계를 노출한다. */
    sendRequest(...args: unknown[]) {
      return boundary.send(...args) as Promise<unknown>;
    }
    /** 완료 알림을 결정적으로 전달한다. */
    onNotification(name: string, callback: () => void) {
      boundary.notifications.set(name, callback);
      return boundary.disposable;
    }
    /** 서버 교체 없이 자동 재시작하는 경계도 노출한다. */
    onDidChangeState(callback: (event: { newState: number }) => void) {
      boundary.state = callback;
      return boundary.disposable;
    }
    /** 실행 중인 SDK를 대신한다. */
    isRunning() {
      return true;
    }
    /** 외부 서버를 만들지 않는다. */
    async start() {}
    /** 외부 자원을 만들지 않았으므로 정리만 완료한다. */
    async dispose() {}
  },
}));
import { VscodeFolderClient } from './index.js';
import type * as vscode from 'vscode';

beforeEach(() => {
  boundary.send.mockReset();
  boundary.owner = boundary.folder;
  boundary.document.version = 1;
  boundary.document.isClosed = false;
});

describe('VscodeFolderClient 응답과 완료 알림 경합', () => {
  it.each(['편집', '닫기', '취소', '소유권 변경', '서버 재시작'])(
    '%s 뒤 도착한 본문 링크를 최신 재조회로 되살리지 않는다',
    async (change) => {
      const client = new VscodeFolderClient(
        boundary.folder as vscode.WorkspaceFolder,
        '/unused',
        { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
      );
      await client.start();
      let finish!: (value: unknown) => void;
      boundary.send.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const token = { isCancellationRequested: false };
      const pending = boundary.links!(boundary.document, token);
      boundary.notifications.get('codocs/snapshotChanged')!();
      if (change === '편집') boundary.document.version++;
      if (change === '닫기') boundary.document.isClosed = true;
      if (change === '취소') token.isCancellationRequested = true;
      if (change === '소유권 변경')
        boundary.owner = {
          ...boundary.folder,
          uri: { toString: () => 'file:///other' },
        };
      if (change === '서버 재시작') boundary.state!({ newState: 2 });
      finish([{ target: 'stale' }]);
      expect(await pending).toEqual([]);
      expect(boundary.send).toHaveBeenCalledTimes(1);
      await client.stop();
    },
  );
  it('확인 응답 사이에 snapshot 알림이 와도 같은 출처와 서버의 성공을 유지한다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    let finish!: (value: unknown) => void;
    boundary.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = client.confirmSource({
      sourceUri: boundary.document.uri.toString(),
      token: 'a'.repeat(32),
    });
    boundary.notifications.get('codocs/snapshotChanged')!();
    const expected = { uri: 'file:///fixture/target.yaml' };
    finish(expected);
    expect(await pending).toEqual(expected);
    await client.stop();
  });

  it.each(['링크', 'Hover'])(
    '%s 응답 사이에 관측이 교체되면 낡은 응답을 버리고 최신 결과를 반환한다',
    async (kind) => {
      const client = new VscodeFolderClient(
        boundary.folder as vscode.WorkspaceFolder,
        '/unused',
        { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
      );
      await client.start();
      let finish!: (value: unknown) => void;
      boundary.send.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const latest =
        kind === '링크' ? [{ target: 'new' }] : { contents: ['new'] };
      boundary.send.mockResolvedValueOnce(latest);
      const token = { isCancellationRequested: false };
      const pending =
        kind === '링크'
          ? boundary.links!(boundary.document, token)
          : boundary.hover!(boundary.document, {}, token);
      boundary.notifications.get('codocs/snapshotChanged')!();
      finish(kind === '링크' ? [{ target: 'stale' }] : { contents: ['stale'] });
      expect(await pending).toEqual(latest);
      expect(boundary.send).toHaveBeenCalledTimes(2);
      await client.stop();
    },
  );

  it.each(['편집', '닫기', '소유권 변경', '서버 재시작', '서버 중지'])(
    '%s 중 확인 응답이 오면 대상 URI를 폐기한다',
    async (change) => {
      const client = new VscodeFolderClient(
        boundary.folder as vscode.WorkspaceFolder,
        '/unused',
        { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
      );
      await client.start();
      let finish!: (value: unknown) => void;
      boundary.send.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = client.confirmSource({
        sourceUri: boundary.document.uri.toString(),
        token: 'a'.repeat(32),
      });
      if (change === '편집') boundary.document.version++;
      if (change === '닫기') boundary.document.isClosed = true;
      if (change === '소유권 변경')
        boundary.owner = {
          ...boundary.folder,
          uri: { toString: () => 'file:///other' },
        };
      if (change === '서버 재시작') boundary.state!({ newState: 2 });
      if (change === '서버 중지') await client.stop();
      finish({ uri: 'file:///fixture/target.yaml' });
      expect(await pending).toBeNull();
      await client.stop();
    },
  );
});
