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
    start: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    commands: new Map<string, (argument?: unknown) => unknown>(),
    output: vi.fn(),
    revealOutput: vi.fn(),
    showError: vi.fn(),
    showDocument: vi.fn(),
    openDocument: vi.fn(),
    watchers: [] as {
      pattern: string;
      handlers: { create: unknown[]; change: unknown[]; delete: unknown[] };
    }[],
    options: undefined as LanguageClientOptions | undefined,
    state: undefined as ((event: { newState: number }) => void) | undefined,
    hints: undefined as
      | ((
          document: unknown,
          range: unknown,
          token: unknown,
        ) => Promise<unknown>)
      | undefined,
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
    createOutputChannel: () => ({
      appendLine: boundary.output,
      show: boundary.revealOutput,
      dispose: vi.fn(),
    }),
    showErrorMessage: boundary.showError,
    showTextDocument: boundary.showDocument,
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
    onDidChangeWorkspaceFolders: () => boundary.disposable,
    openTextDocument: boundary.openDocument,
    createFileSystemWatcher: (pattern: { pattern?: string }) => {
      const handlers = {
        create: [] as unknown[],
        change: [] as unknown[],
        delete: [] as unknown[],
      };
      boundary.watchers.push({ pattern: String(pattern.pattern), handlers });
      return {
        ...boundary.disposable,
        onDidCreate: (handler: unknown) => {
          handlers.create.push(handler);
          return boundary.disposable;
        },
        onDidChange: (handler: unknown) => {
          handlers.change.push(handler);
          return boundary.disposable;
        },
        onDidDelete: (handler: unknown) => {
          handlers.delete.push(handler);
          return boundary.disposable;
        },
      };
    },
  },
  languages: {
    registerDocumentLinkProvider: (
      _selector: unknown,
      provider: { provideDocumentLinks: typeof boundary.links },
    ) => {
      boundary.links = provider.provideDocumentLinks;
      return boundary.disposable;
    },
    registerInlayHintsProvider: (
      _selector: unknown,
      provider: { provideInlayHints: typeof boundary.hints },
    ) => {
      boundary.hints = provider.provideInlayHints;
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
  commands: {
    registerCommand: (
      name: string,
      callback: (argument?: unknown) => unknown,
    ) => {
      boundary.commands.set(name, callback);
      return boundary.disposable;
    },
  },
  ['Uri']: { parse: (value: string) => ({ toString: () => value }) },
  ['RelativePattern']: class {
    pattern: string;
    /** 감시 대상 패턴을 테스트에서 확인할 수 있게 보관한다. */
    constructor(_base: unknown, pattern: string) {
      this.pattern = pattern;
    }
  },
}));
vi.mock('vscode-languageclient/node.js', () => ({
  ['CloseAction']: {},
  ['ErrorAction']: {},
  ['State']: { ['Running']: 2, ['Starting']: 1 },
  ['TransportKind']: { ipc: 1 },
  ['HoverRequest']: { type: 'hover' },
  ['DocumentLinkRequest']: { type: 'links' },
  ['InlayHintRequest']: { type: 'hints' },
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
      asInlayHints: (value: unknown) => value,
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
    async start() {
      await boundary.start();
    }
    /** 외부 자원을 만들지 않았으므로 정리만 완료한다. */
    async dispose() {
      await boundary.dispose();
    }
  },
}));
import { VscodeExtensionRuntime, VscodeFolderClient } from './index.js';
import { openSourceFailureReasons } from '../open-source/index.js';
import type * as vscode from 'vscode';

beforeEach(() => {
  boundary.send.mockReset();
  boundary.owner = boundary.folder;
  boundary.document.version = 1;
  boundary.document.isClosed = false;
  boundary.notify.mockReset().mockResolvedValue(undefined);
  boundary.start.mockReset().mockResolvedValue(undefined);
  boundary.dispose.mockReset().mockResolvedValue(undefined);
  boundary.output.mockReset();
  boundary.revealOutput.mockReset();
  boundary.showError.mockReset();
  boundary.showDocument.mockReset();
  boundary.openDocument.mockReset();
  boundary.commands.clear();
  boundary.watchers.length = 0;
});

describe('VscodeExtensionRuntime 원문 이동 실패 출력', () => {
  it.each([
    {
      failure: '대상 확인 거부',
      reason: openSourceFailureReasons.confirmationRejected,
    },
    {
      failure: '출처 닫기',
      reason: openSourceFailureReasons.sourceInvalidated,
    },
    { failure: '파일 접근', reason: openSourceFailureReasons.fileAccessFailed },
  ])(
    '$failure 클릭 실패는 Output에 한 번 기록하고 패널·팝업·편집기를 열지 않는다',
    async ({ failure, reason }) => {
      const runtime = new VscodeExtensionRuntime({
        extensionPath: '/unused',
      } as vscode.ExtensionContext);
      await runtime.activate();
      boundary.document.text = '저장하지 않은 현재 작업';
      boundary.document.isClosed = failure === '출처 닫기';
      boundary.send.mockResolvedValue(
        failure === '대상 확인 거부'
          ? null
          : { uri: 'file:///fixture/target.yaml' },
      );
      boundary.openDocument.mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' }),
      );
      const command = boundary.commands.get('codocs.openSource')!;
      const selection = {
        sourceUri: boundary.document.uri.toString(),
        token: 'a'.repeat(32),
      };
      expect(await command(selection)).toBe(false);
      expect(await command(selection)).toBe(false);
      expect(boundary.output).toHaveBeenCalledTimes(1);
      expect(boundary.output.mock.calls[0]![0]).toContain(reason);
      expect(boundary.output.mock.calls[0]![0]).toContain(selection.sourceUri);
      expect(boundary.revealOutput).not.toHaveBeenCalled();
      expect(boundary.showError).not.toHaveBeenCalled();
      expect(boundary.showDocument).not.toHaveBeenCalled();
      expect(boundary.document.text).toBe('저장하지 않은 현재 작업');
      await runtime.deactivate();
    },
  );
});

// @codocs [[VS Code:언어 서버 연결]]
describe('VscodeFolderClient 갱신 요청 신호', () => {
  it('.codocs 폴더 생성·삭제에만 refresh를 요청하고 내용 파일 변경과 폴더 변경에는 요청하지 않는다', async () => {
    boundary.send.mockResolvedValue(undefined);
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    expect(boundary.watchers.map((watcher) => watcher.pattern)).toEqual([
      '.codocs',
    ]);
    const { create, change, delete: remove } = boundary.watchers[0]!.handlers;
    expect(change).toEqual([]);
    for (const handler of [...create, ...remove] as (() => void)[]) handler();
    expect(boundary.send).toHaveBeenCalledTimes(2);
    expect(boundary.send).toHaveBeenCalledWith(expect.anything(), {
      workspaceUri: 'file:///fixture',
    });
    await client.stop();
  });
});

describe('VscodeFolderClient 응답과 완료 알림 경합', () => {
  it('같은 파일을 가리켜도 출처 URI 문자열이 다르면 서버 확인 요청을 보내지 않는다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    await expect(
      client.confirmSource({
        sourceUri: 'file:///fixture/%73ource.yaml',
        token: 'a'.repeat(32),
      }),
    ).rejects.toMatchObject({
      reason: openSourceFailureReasons.sourceInvalidated,
    });
    expect(boundary.send).not.toHaveBeenCalled();
    await client.stop();
  });
  it('이전 서버 종료가 시간 초과되어도 수동 재시작은 새 세션을 시작한다', async () => {
    const appendLine = vi.fn();
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine } as unknown as vscode.OutputChannel,
    );
    await client.start();
    const previous = boundary.notifications.get('codocs/diagnosticStatus')!;
    boundary.dispose.mockRejectedValueOnce(
      new Error('Stopping the server timed out'),
    );
    await client.restart();
    expect(boundary.start).toHaveBeenCalledTimes(2);
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('새 세션으로 복구'),
    );
    previous([
      {
        workspaceUri: boundary.folder.uri.toString(),
        failures: [{ reason: 'old', previousDiagnostics: [] }],
      },
    ]);
    expect(client.diagnosticDetails().failures).toEqual([]);
    await client.stop();
    expect(boundary.dispose).toHaveBeenCalledTimes(2);
  });

  it('종료 오류 뒤 새 서버의 시작도 실패하면 호출자에게 실패를 전달한다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    boundary.dispose.mockRejectedValueOnce(
      new Error('Stopping the server timed out'),
    );
    boundary.start.mockRejectedValueOnce(new Error('new server failed'));
    await expect(client.restart()).rejects.toThrow('new server failed');
    await client.stop();
  });

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

  // @codocs [[VS Code:언어 서버 연결]]#L43
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
  // @codocs [[VS Code:원문 열기]]#L16
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
      await expect(pending).rejects.toMatchObject({
        reason: openSourceFailureReasons.sourceInvalidated,
      });
      await client.stop();
    },
  );
});

describe('source-owning Inlay Hint provider', () => {
  // @codocs [[VS Code:언어 서버 연결]]#L50-L51
  it('소유한 source의 힌트만 요청하고 서버가 생성한 tooltip command만 신뢰한다', async () => {
    const client = new VscodeFolderClient(
      boundary.folder as vscode.WorkspaceFolder,
      '/unused',
      { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
    );
    await client.start();
    const hints = [
      {
        label: [{ value: '문서 전체에 연결된 코드 · 2곳' }],
        tooltip: { value: '[source:1:1](command:codocs.openSource?[])' },
      },
    ];
    boundary.send.mockResolvedValue(hints);
    const token = { isCancellationRequested: false };
    expect(await boundary.hints!(boundary.document, {}, token)).toBe(hints);
    expect(boundary.send).toHaveBeenCalledWith(
      'hints',
      expect.objectContaining({
        textDocument: { uri: boundary.document.uri.toString() },
      }),
      token,
    );
    expect(hints[0]!.tooltip).toMatchObject({
      isTrusted: { enabledCommands: ['codocs.openSource'] },
    });
    boundary.owner = {
      ...boundary.folder,
      uri: { ...boundary.folder.uri, toString: () => 'file:///other' },
    };
    expect(await boundary.hints!(boundary.document, {}, token)).toEqual([]);
    await client.stop();
  });
});
