import { build } from 'esbuild';
import { trackChildClosure } from '../../../../tools/test/support/child-process.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { workspaceRefreshRequestMethod } from '../server-session/index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

const childClosures = new WeakMap<
  ChildProcessWithoutNullStreams,
  ReturnType<typeof trackChildClosure>
>();
/** spawn 직후 등록한 close 관측이 끝나야 실행 폴더를 지운다. */
async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  const lifecycle = childClosures.get(child);
  if (!lifecycle) throw new Error('자식 close 관측이 등록되지 않았습니다.');
  await lifecycle.stop();
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: unknown;
}

class StdioProtocolClient {
  readonly notifications: { method: string; params: unknown }[] = [];
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<
    number,
    { resolve(value: JsonRpcResponse): void; reject(reason: Error): void }
  >();
  #buffer = Buffer.alloc(0);
  #stderr = '';
  #protocolError: Error | undefined;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    childClosures.set(child, trackChildClosure(child));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.#stderr += chunk;
    });
    child.stdout.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#readFrames();
    });
  }

  get stderr(): string {
    return this.#stderr;
  }

  get unframedStdout(): Uint8Array {
    return this.#buffer;
  }

  send(method: string, params?: unknown): void {
    this.#write({
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  request(
    id: number,
    method: string,
    params: unknown,
  ): Promise<JsonRpcResponse> {
    if (this.#protocolError) return Promise.reject(this.#protocolError);
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`LSP 응답 대기 시간이 지났습니다: ${method} (${id})`));
        // 별도 프로세스 시작이 느린 Windows CI에서도 응답을 기다린다.
      }, 15_000);
      this.#pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  #write(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.#child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.#child.stdin.write(body);
  }

  #readFrames(): void {
    while (true) {
      const marker = this.#buffer.indexOf('\r\n\r\n');
      if (marker < 0) return;
      const header = this.#buffer.subarray(0, marker).toString('ascii');
      const lengthHeader = /(?:^|\r\n)Content-Length: (\d+)(?:\r\n|$)/iu.exec(
        header,
      );
      if (!lengthHeader) {
        this.#fail(new Error(`LSP stdout에 잘못된 헤더가 있습니다: ${header}`));
        return;
      }
      const length = Number(lengthHeader[1]);
      const frameEnd = marker + 4 + length;
      if (this.#buffer.length < frameEnd) return;
      const body = this.#buffer.subarray(marker + 4, frameEnd).toString('utf8');
      this.#buffer = this.#buffer.subarray(frameEnd);
      try {
        const response = JSON.parse(body) as JsonRpcResponse;
        if (
          'method' in response &&
          typeof response.method === 'string' &&
          'params' in response
        )
          this.notifications.push({
            method: response.method,
            params: response.params,
          });
        const pending = this.#pending.get(response.id);
        if (pending) {
          this.#pending.delete(response.id);
          pending.resolve(response);
        }
      } catch (error: unknown) {
        this.#fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }

  #fail(error: Error): void {
    this.#protocolError = error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

describe('language server stdio 프로세스', () => {
  it.each([false, true])(
    '복수 후보 %s인 YAML의 링크·resolve·진단을 실제 프로세스에서 최신 버전으로 갱신한다',
    async (ambiguous) => {
      await mkdir('.workbench/fixtures', { recursive: true });
      const root = await mkdtemp(
        path.resolve('.workbench/fixtures/protocol-links-'),
      );
      await mkdir(path.join(root, '.codocs'));
      const target =
        '_codocs:\n  id: target\n  name: 대상\ndefinition: 설명\n빈 section: ""\n';
      await writeFile(path.join(root, '.codocs/target.yaml'), target);
      if (ambiguous)
        await writeFile(
          path.join(root, '.codocs/other.yaml'),
          target.replace('id: target', 'id: other'),
        );
      const output = path.join(root, 'server.cjs');
      await build({
        entryPoints: [fileURLToPath(new URL('../index.ts', import.meta.url))],
        outfile: output,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20.19',
        alias: {
          '@codocs/core': path.resolve('packages/core/src/index.ts'),
          '@codocs/workspace': path.resolve('packages/workspace/src/index.ts'),
        },
      });
      const child = spawn(process.execPath, [output, '--stdio'], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const client = new StdioProtocolClient(child);
      const uri = pathToFileURL(path.join(root, '.codocs/live.yaml')).href;
      try {
        const initialized = await client.request(1, 'initialize', {
          processId: null,
          rootUri: pathToFileURL(root).href,
          capabilities: {},
        });
        expect(initialized.result).toMatchObject({
          capabilities: { documentLinkProvider: { resolveProvider: true } },
        });
        client.send('initialized', {});
        await client.request(2, workspaceRefreshRequestMethod, {});
        client.send('textDocument/didOpen', {
          textDocument: {
            uri,
            version: 1,
            languageId: 'yaml',
            text: '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n',
          },
        });
        const response = await client.request(3, 'textDocument/documentLink', {
          textDocument: { uri },
        });
        const links = response.result as { range: unknown; target: string }[];
        expect(links).toHaveLength(ambiguous ? 0 : 1);
        const hovered = await client.request(4, 'textDocument/hover', {
          textDocument: { uri },
          position: { line: 3, character: 15 },
        });
        expect(
          JSON.stringify(hovered.result).match(/command:codocs.openSource/gu),
        ).toHaveLength(ambiguous ? 2 : 1);
        if (!ambiguous) {
          expect(
            (await client.request(5, 'documentLink/resolve', links[0])).result,
          ).toEqual(links[0]);
          const selected = (
            JSON.parse(
              decodeURIComponent(links[0]!.target.split('?')[1]!),
            ) as unknown[]
          )[0];
          expect(
            (await client.request(6, 'codocs/confirmSource', selected)).result,
          ).toEqual({
            uri: pathToFileURL(path.join(root, '.codocs/target.yaml')).href,
          });
        }
        await vi.waitFor(
          () =>
            expect(
              client.notifications
                .filter(
                  (item) => item.method === 'textDocument/publishDiagnostics',
                )
                .at(-1)?.params,
            ).toMatchObject({
              uri,
              version: 1,
              diagnostics: expect.arrayContaining([
                expect.objectContaining({
                  code: ambiguous
                    ? 'reference_ambiguous'
                    : 'reference_target_error',
                  severity: ambiguous ? 1 : 2,
                }),
              ]) as unknown,
            }),
          { timeout: 5_000 },
        );
        client.send('textDocument/didChange', {
          textDocument: { uri, version: 2 },
          contentChanges: [
            {
              text: '_codocs:\n  id: source\n  name: 출처\ndefinition: 삭제\n',
            },
          ],
        });
        expect(
          (
            await client.request(7, 'textDocument/documentLink', {
              textDocument: { uri },
            })
          ).result,
        ).toEqual([]);
        await vi.waitFor(
          () =>
            expect(
              client.notifications
                .filter(
                  (item) => item.method === 'textDocument/publishDiagnostics',
                )
                .at(-1)?.params,
            ).toMatchObject({ uri, version: 2, diagnostics: [] }),
          { timeout: 5_000 },
        );
        client.send('textDocument/didClose', { textDocument: { uri } });
        expect(
          (
            await client.request(8, 'textDocument/documentLink', {
              textDocument: { uri },
            })
          ).result,
        ).toEqual([]);
        await client.request(9, 'shutdown', null);
        client.send('exit');
      } finally {
        await stopChild(child);
        await rmWithRetry(root, { recursive: true, force: true });
      }
    },
  );

  it('initialize·전체 문서 변경·코드 식별자 Hover 없음·shutdown을 실제 LSP 프레임으로 처리한다', async () => {
    const fixtureParent = path.resolve('.workbench/fixtures');
    await mkdir(fixtureParent, { recursive: true });
    const root = await mkdtemp(path.join(fixtureParent, 'server-process-'));
    const output = path.join(root, 'server.cjs');
    await mkdir(path.join(root, '.codocs'));
    await writeFile(
      path.join(root, '.codocs/반납 구역.yaml'),
      '_codocs:\r\n  id: return-zone\r\n  name: Return Zone\r\ndefinition: 한글 본문\r\n',
      'utf8',
    );
    await build({
      entryPoints: [fileURLToPath(new URL('../index.ts', import.meta.url))],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.19',
      alias: {
        '@codocs/core': path.resolve('packages/core/src/index.ts'),
        '@codocs/workspace': path.resolve('packages/workspace/src/index.ts'),
      },
    });
    const child = spawn(process.execPath, [output, '--stdio'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const client = new StdioProtocolClient(child);
    try {
      const rootUri = pathToFileURL(root).href;
      const documentUri = pathToFileURL(path.join(root, 'Broken.java')).href;
      const initialized = await client.request(1, 'initialize', {
        processId: null,
        rootUri: null,
        capabilities: { workspace: { workspaceFolders: true } },
        workspaceFolders: [{ uri: rootUri, name: 'fixture' }],
      });
      expect(initialized.error).toBeUndefined();
      expect(initialized.result).toMatchObject({
        capabilities: {
          textDocumentSync: { openClose: true, change: 1 },
          hoverProvider: true,
        },
      });
      client.send('initialized', {});
      client.send('textDocument/didOpen', {
        textDocument: {
          uri: documentUri,
          languageId: 'java',
          version: 1,
          text: 'class Broken { returnZone(',
        },
      });

      const hover = await client.request(2, 'textDocument/hover', {
        textDocument: { uri: documentUri },
        position: { line: 0, character: 20 },
      });
      expect(hover.error).toBeUndefined();
      expect(hover.result).toBeNull();

      client.send('textDocument/didChange', {
        textDocument: { uri: documentUri, version: 2 },
        contentChanges: [{ text: 'no match here' }],
      });
      const changed = await client.request(3, 'textDocument/hover', {
        textDocument: { uri: documentUri },
        position: { line: 0, character: 3 },
      });
      expect(changed.error).toBeUndefined();
      expect(changed.result).toBeNull();

      const shutdown = await client.request(4, 'shutdown', null);
      expect(shutdown.error).toBeUndefined();
      client.send('exit');
      child.stdin.end();
      const exitCode = await new Promise<number | null>((resolve) =>
        child.once('exit', resolve),
      );
      expect(exitCode).toBe(0);
      expect(client.stderr).toBe('');
      expect(client.unframedStdout).toHaveLength(0);
    } finally {
      await stopChild(child);
      await rmWithRetry(root, { recursive: true, force: true });
    }
  });

  it('다중 루트·catalog 생명주기와 재시작 뒤 최신 원문을 실제 프로세스의 YAML 참조 Hover로 처리한다', async () => {
    const fixtureParent = path.resolve('.workbench/fixtures');
    await mkdir(fixtureParent, { recursive: true });
    const root = await mkdtemp(
      path.join(fixtureParent, 'cod15-server-process-'),
    );
    const parent = path.join(root, 'parent');
    const nested = path.join(parent, 'nested');
    const sibling = path.join(root, 'sibling');
    const missing = path.join(root, 'missing');
    const output = path.join(root, 'server.cjs');
    await Promise.all([
      mkdir(path.join(parent, '.codocs'), { recursive: true }),
      mkdir(path.join(nested, '.codocs'), { recursive: true }),
      mkdir(path.join(sibling, '.codocs'), { recursive: true }),
      mkdir(missing, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(parent, '.codocs/parent-zone.yaml'),
        '_codocs:\n  id: parent-zone\n  name: Parent Zone\ndefinition: parent\n',
        'utf8',
      ),
      writeFile(
        path.join(nested, '.codocs/nested-zone.yaml'),
        '_codocs:\n  id: nested-zone\n  name: Nested Zone\ndefinition: nested\n',
        'utf8',
      ),
      writeFile(
        path.join(sibling, '.codocs/sibling-zone.yaml'),
        '_codocs:\n  id: sibling-zone\n  name: Sibling Zone\ndefinition: sibling\n',
        'utf8',
      ),
    ]);
    await build({
      entryPoints: [fileURLToPath(new URL('../index.ts', import.meta.url))],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.19',
      alias: {
        '@codocs/core': path.resolve('packages/core/src/index.ts'),
        '@codocs/workspace': path.resolve('packages/workspace/src/index.ts'),
      },
    });

    const workspaceFolders = [parent, nested, sibling, missing].map(
      (workspaceRoot) => ({
        uri: pathToFileURL(workspaceRoot).href,
        name: path.basename(workspaceRoot),
      }),
    );
    const nestedUri = pathToFileURL(
      path.join(nested, '.codocs/live.yaml'),
    ).href;
    const nestedParentUri = pathToFileURL(
      path.join(nested, '.codocs/live-parent.yaml'),
    ).href;
    const siblingUri = pathToFileURL(
      path.join(sibling, '.codocs/live.yaml'),
    ).href;
    const missingUri = pathToFileURL(
      path.join(missing, '.codocs/live.yaml'),
    ).href;
    /** 이름 참조 한 개를 가진 YAML 원문을 만든다. */
    const reference = (name: string): string =>
      `_codocs:\n  id: live\n  name: 출처\ndefinition: "[[${name}]]"\n`;
    /** 참조 위치의 Hover 응답을 요청한다. */
    const hoverAt = (
      client: StdioProtocolClient,
      id: number,
      uri: string,
    ): Promise<JsonRpcResponse> =>
      client.request(id, 'textDocument/hover', {
        textDocument: { uri },
        position: { line: 3, character: 17 },
      });
    /** Hover 응답의 Markdown 본문을 꺼낸다. */
    const hoverText = (response: JsonRpcResponse): string =>
      (response.result as { contents: { value: string } } | null)?.contents
        .value ?? '';
    const firstChild = spawn(process.execPath, [output, '--stdio'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const firstClient = new StdioProtocolClient(firstChild);
    try {
      const initialized = await firstClient.request(1, 'initialize', {
        processId: null,
        rootUri: null,
        capabilities: { workspace: { workspaceFolders: true } },
        workspaceFolders: [workspaceFolders[1]],
      });
      expect(initialized.error).toBeUndefined();
      firstClient.send('initialized', {});
      firstClient.send('textDocument/didOpen', {
        textDocument: {
          uri: nestedUri,
          languageId: 'yaml',
          version: 5,
          text: reference('Nested Zone'),
        },
      });
      firstClient.send('textDocument/didOpen', {
        textDocument: {
          uri: nestedParentUri,
          languageId: 'yaml',
          version: 1,
          text: reference('Parent Zone'),
        },
      });
      firstClient.send('textDocument/didOpen', {
        textDocument: {
          uri: siblingUri,
          languageId: 'yaml',
          version: 1,
          text: reference('Sibling Zone'),
        },
      });
      firstClient.send('textDocument/didOpen', {
        textDocument: {
          uri: missingUri,
          languageId: 'yaml',
          version: 1,
          text: reference('Created Zone'),
        },
      });

      // 가장 가까운 작업 공간의 catalog만 사용하므로 부모 문서는 연결하지 않는다.
      const nestedHover = await hoverAt(firstClient, 2, nestedUri);
      expect(nestedHover.error).toBeUndefined();
      expect(hoverText(nestedHover)).toContain('Nested Zone');
      expect(hoverText(nestedHover)).not.toContain('Parent Zone');
      expect(
        hoverText(await hoverAt(firstClient, 3, nestedParentUri)),
      ).not.toContain('Parent Zone');

      // 작업 공간 밖 문서는 어떤 catalog와도 연결하지 않는다.
      expect((await hoverAt(firstClient, 4, siblingUri)).result).toBeNull();
      expect((await hoverAt(firstClient, 5, missingUri)).result).toBeNull();
      firstClient.send('workspace/didChangeWorkspaceFolders', {
        event: {
          added: [workspaceFolders[3]],
          removed: [workspaceFolders[1]],
        },
      });
      await firstClient.request(6, workspaceRefreshRequestMethod, {
        workspaceUri: pathToFileURL(missing).href,
      });
      expect((await hoverAt(firstClient, 7, missingUri)).result).toBeNull();
      await expect(access(path.join(missing, '.codocs'))).rejects.toThrow();
      await mkdir(path.join(missing, '.codocs'));
      await writeFile(
        path.join(missing, '.codocs/created-zone.yaml'),
        '_codocs:\n  id: created-zone\n  name: Created Zone\ndefinition: created\n',
        'utf8',
      );
      await firstClient.request(8, workspaceRefreshRequestMethod, {
        workspaceUri: pathToFileURL(missing).href,
      });
      await vi.waitFor(
        async () => {
          expect(
            hoverText(await hoverAt(firstClient, 9, missingUri)),
          ).toContain('Created Zone');
        },
        { timeout: 5_000, interval: 100 },
      );

      await writeFile(
        path.join(missing, '.codocs/created-zone.yaml'),
        '_codocs:\n  id: changed-zone\n  name: Changed Zone\ndefinition: changed\n',
        'utf8',
      );
      firstClient.send('textDocument/didChange', {
        textDocument: { uri: missingUri, version: 2 },
        contentChanges: [{ text: reference('Changed Zone') }],
      });
      await firstClient.request(10, workspaceRefreshRequestMethod, {
        workspaceUri: pathToFileURL(missing).href,
      });
      const changedHover = await hoverAt(firstClient, 11, missingUri);
      expect(hoverText(changedHover)).toContain('Changed Zone');

      const shutdown = await firstClient.request(12, 'shutdown', null);
      expect(shutdown.error).toBeUndefined();
      firstClient.send('exit');
      firstChild.stdin.end();
      await expect(
        new Promise<number | null>((resolve) =>
          firstChild.once('exit', resolve),
        ),
      ).resolves.toBe(0);
      expect(firstClient.stderr).toBe('');
      expect(firstClient.unframedStdout).toHaveLength(0);

      const restartedChild = spawn(process.execPath, [output, '--stdio'], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const restartedClient = new StdioProtocolClient(restartedChild);
      try {
        await restartedClient.request(10, 'initialize', {
          processId: null,
          rootUri: null,
          capabilities: { workspace: { workspaceFolders: true } },
          workspaceFolders: [workspaceFolders[3]],
        });
        restartedClient.send('initialized', {});
        restartedClient.send('textDocument/didOpen', {
          textDocument: {
            uri: missingUri,
            languageId: 'yaml',
            version: 7,
            text: reference('Changed Zone'),
          },
        });
        const resynchronized = await hoverAt(restartedClient, 11, missingUri);
        expect(hoverText(resynchronized)).toContain('Changed Zone');
        await restartedClient.request(12, 'shutdown', null);
        restartedClient.send('exit');
        restartedChild.stdin.end();
        await expect(
          new Promise<number | null>((resolve) =>
            restartedChild.once('exit', resolve),
          ),
        ).resolves.toBe(0);
        expect(restartedClient.stderr).toBe('');
        expect(restartedClient.unframedStdout).toHaveLength(0);
      } finally {
        await stopChild(restartedChild);
      }
    } finally {
      await stopChild(firstChild);
      await rmWithRetry(root, { recursive: true, force: true });
    }
  });

  it('prepareRename·planRename·applyRename 요청을 실제 LSP 프레임으로 처리해 파일에 반영한다', async () => {
    const fixtureParent = path.resolve('.workbench/fixtures');
    await mkdir(fixtureParent, { recursive: true });
    const root = await mkdtemp(path.join(fixtureParent, 'server-rename-'));
    const output = path.join(root, 'server.cjs');
    await mkdir(path.join(root, '.codocs'));
    const order = '_codocs:\n  id: order\n  name: 주문\ndefinition: 설명\n';
    await writeFile(path.join(root, '.codocs/order.yaml'), order, 'utf8');
    await writeFile(
      path.join(root, '.codocs/ref.yaml'),
      '_codocs:\n  id: ref\n  name: 참조\ndefinition: 본문 [[주문]]\n',
      'utf8',
    );
    await build({
      entryPoints: [fileURLToPath(new URL('../index.ts', import.meta.url))],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.19',
      alias: {
        '@codocs/core': path.resolve('packages/core/src/index.ts'),
        '@codocs/workspace': path.resolve('packages/workspace/src/index.ts'),
      },
    });
    const child = spawn(process.execPath, [output, '--stdio'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const client = new StdioProtocolClient(child);
    try {
      const rootUri = pathToFileURL(root).href;
      const orderUri = pathToFileURL(
        path.join(root, '.codocs/order.yaml'),
      ).href;
      await client.request(1, 'initialize', {
        processId: null,
        rootUri: null,
        capabilities: { workspace: { workspaceFolders: true } },
        workspaceFolders: [{ uri: rootUri, name: 'fixture' }],
      });
      client.send('initialized', {});
      client.send('textDocument/didOpen', {
        textDocument: {
          uri: orderUri,
          languageId: 'yaml',
          version: 1,
          text: order,
        },
      });
      await client.request(2, workspaceRefreshRequestMethod, {});
      const targetPath = path.join('.codocs', 'order.yaml');

      const prepared = await client.request(3, 'codocs/prepareRename', {
        textDocument: { uri: orderUri },
        position: { line: 2, character: 9 },
      });
      const planned = await client.request(4, 'codocs/planRename', {
        textDocument: { uri: orderUri },
        targetPath,
        newName: '새주문',
      });
      const revisions = (planned.result as { revisions: object }).revisions;
      const applied = await client.request(5, 'codocs/applyRename', {
        textDocument: { uri: orderUri },
        targetPath,
        newName: '새주문',
        revisions,
      });

      expect(prepared.result).toMatchObject({
        placeholder: '주문',
        targetPath,
      });
      expect(planned.result).toMatchObject({ success: true, status: 'ready' });
      expect(applied.result).toMatchObject({ success: true, changed: true });
      expect(
        await readFile(path.join(root, '.codocs/ref.yaml'), 'utf8'),
      ).toContain('[[새주문]]');
      await client.request(6, 'shutdown', null);
      client.send('exit');
      child.stdin.end();
    } finally {
      await stopChild(child);
      await rmWithRetry(root, { recursive: true, force: true });
    }
  });
});
