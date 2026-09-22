import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageClientOptions } from 'vscode-languageclient/node.js';

const boundary = vi.hoisted(() => {
  const disposable = { dispose: vi.fn() };
  const folder = {
    uri: { fsPath: '/fixture', toString: () => 'file:///fixture' },
    name: 'fixture',
    index: 0,
  };
  const document = {
    uri: {
      scheme: 'file',
      fsPath: '/fixture/source.yaml',
      toString: () => 'file:///fixture/source.yaml',
    },
    text: 'first',
    getText() {
      return this.text;
    },
    version: 1,
    isClosed: false,
  };
  return {
    disposable,
    folder,
    document,
    owner: folder,
    notifications: new Map<string, (input?: unknown) => void>(),
    send: vi.fn(),
    notify: vi.fn().mockResolvedValue(undefined),
    options: undefined as LanguageClientOptions | undefined,
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
  ['StatusBarAlignment']: { ['Left']: 1 },
  window: {
    createStatusBarItem: () => ({
      name: '',
      text: '',
      tooltip: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    }),
  },
  workspace: {
    workspaceFolders: [boundary.folder],
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
  ['State']: { ['Running']: 2, ['Starting']: 1 },
  ['TransportKind']: { ipc: 1 },
  ['HoverRequest']: { type: 'hover' },
  ['DocumentLinkRequest']: { type: 'links' },
  ['LanguageClient']: class {
    state = 2;
    /** SDK에 전달한 동기화 경계를 테스트에 노출한다. */
    constructor(
      _id: string,
      _name: string,
      _server: unknown,
      options: LanguageClientOptions,
    ) {
      boundary.options = options;
    }
    protocol2CodeConverter = {
      asDocumentLinks: (value: unknown) => Promise.resolve(value),
      asHover: (value: unknown) => value,
    };
    /** 테스트 요청의 응답 경계를 노출한다. */
    sendRequest(...args: unknown[]) {
      return boundary.send(...args) as Promise<unknown>;
    }
    /** 실제 전송 직전의 알림 입력을 관측한다. */
    sendNotification(...args: unknown[]) {
      return boundary.notify(...args) as Promise<void>;
    }
    /** 완료 알림을 결정적으로 전달한다. */
    onNotification(name: string, callback: (input?: unknown) => void) {
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
  boundary.notify.mockReset().mockResolvedValue(undefined);
});

describe('VscodeFolderClient 응답과 완료 알림 경합', () => {
  it('진단 관측을 아직 받지 않았으면 빈 성공으로 안내하지 않는다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    expect(client.diagnosticDetails().text).toContain('관측을 기다리고');
    boundary.notifications.get('codocs/diagnosticStatus')!([
      { workspaceUri: boundary.folder.uri.toString(), failures: [] },
    ]);
    expect(client.diagnosticDetails().text).toContain('재검사 성공');
    await client.stop();
  });

  it('이전 client 세션의 늦은 실패 알림은 새 상태 항목에 게시하지 않는다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    const previous = boundary.notifications.get('codocs/diagnosticStatus')!;
    await client.restart();
    previous([
      {
        workspaceUri: boundary.folder.uri.toString(),
        failures: [{ reason: 'old session failure', previousDiagnostics: [] }],
      },
    ]);
    expect(client.diagnosticDetails().failures).toEqual([]);
    expect(client.diagnosticDetails().text).toContain('관측을 기다리고');
    await client.stop();
  });
  it('연속 전체 편집은 버전별 원문을 한 번씩 전송하고 SDK 지연 큐에 중복 등록하지 않는다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    const document = boundary.document as unknown as vscode.TextDocument;
    const next = vi.fn();
    await boundary.options!.middleware!.didOpen!(document, next);
    next.mockClear();
    const pending: unknown[] = [];
    for (const [version, text] of [
      [2, 'second'],
      [3, 'third'],
    ] as const) {
      boundary.document.version = version;
      boundary.document.text = text;
      pending.push(
        boundary.options!.middleware!.didChange!(
          { document } as vscode.TextDocumentChangeEvent,
          next,
        ),
      );
    }
    await Promise.all(pending);
    expect(boundary.notify.mock.calls).toEqual([
      [
        'textDocument/didChange',
        {
          textDocument: { uri: document.uri.toString(), version: 2 },
          contentChanges: [{ text: 'second' }],
        },
      ],
      [
        'textDocument/didChange',
        {
          textDocument: { uri: document.uri.toString(), version: 3 },
          contentChanges: [{ text: 'third' }],
        },
      ],
    ]);
    expect(next).not.toHaveBeenCalled();
    expect(boundary.options!.synchronize).toBeUndefined();
    await client.stop();
  });

  it('편집 전송 실패는 미관측 rejection을 만들지 않고 SDK 호출자에게 반환한다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    const document = boundary.document as unknown as vscode.TextDocument;
    await boundary.options!.middleware!.didOpen!(document, vi.fn());
    const failure = new Error('Channel closed');
    boundary.notify.mockRejectedValueOnce(failure);
    await expect(
      boundary.options!.middleware!.didChange!(
        { document } as vscode.TextDocumentChangeEvent,
        vi.fn(),
      ),
    ).rejects.toBe(failure);
    expect(boundary.notify).toHaveBeenCalledTimes(1);
    await client.stop();
  });
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
          uri: { fsPath: '/other', toString: () => 'file:///other' },
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
          uri: { fsPath: '/other', toString: () => 'file:///other' },
        };
      if (change === '서버 재시작') boundary.state!({ newState: 2 });
      if (change === '서버 중지') await client.stop();
      finish({ uri: 'file:///fixture/target.yaml' });
      expect(await pending).toBeNull();
      await client.stop();
    },
  );
});
