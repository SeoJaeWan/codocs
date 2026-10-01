import { build } from 'esbuild';
import { trackChildClosure } from '../../../../tools/test/support/child-process.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  documentMatchRequestMethod,
  workspaceRefreshRequestMethod,
} from '../server-session/index.js';

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
      }, 5_000);
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
        'id: target\nname: 대상\ndefinition: 설명\nstatus: deprecated\n';
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
            text: 'id: source\nname: 출처\ndefinition: "[[대상]]"\n',
          },
        });
        const response = await client.request(3, 'textDocument/documentLink', {
          textDocument: { uri },
        });
        const links = response.result as { range: unknown; target: string }[];
        expect(links).toHaveLength(ambiguous ? 0 : 1);
        const hovered = await client.request(4, 'textDocument/hover', {
          textDocument: { uri },
          position: { line: 2, character: 15 },
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
        await vi.waitFor(() =>
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
                  : 'deprecated_reference',
                severity: ambiguous ? 1 : 2,
              }),
            ]) as unknown,
          }),
        );
        client.send('textDocument/didChange', {
          textDocument: { uri, version: 2 },
          contentChanges: [
            {
              text: 'id: source\nname: 출처\ndefinition: 삭제\ndomains: [업무]\n',
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
        await vi.waitFor(() =>
          expect(
            client.notifications
              .filter(
                (item) => item.method === 'textDocument/publishDiagnostics',
              )
              .at(-1)?.params,
          ).toMatchObject({ uri, version: 2, diagnostics: [] }),
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
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('initialize·전체 문서 변경·현재 매칭·shutdown을 실제 LSP 프레임으로 처리한다', async () => {
    const fixtureParent = path.resolve('.workbench/fixtures');
    await mkdir(fixtureParent, { recursive: true });
    const root = await mkdtemp(path.join(fixtureParent, 'server-process-'));
    const output = path.join(root, 'server.cjs');
    await mkdir(path.join(root, '.codocs'));
    await writeFile(
      path.join(root, '.codocs/반납 구역.yaml'),
      'id: return-zone\r\nname: Return Zone\r\ndefinition: 한글 본문\r\ndomains: [test]\r\n',
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

      const first = await client.request(2, documentMatchRequestMethod, {
        textDocument: { uri: documentUri },
        version: 1,
      });
      expect(first.error).toBeUndefined();
      expect(first.result).toMatchObject({
        success: true,
        version: 1,
        candidates: [{ id: 'return-zone' }],
      });
      const hover = await client.request(20, 'textDocument/hover', {
        textDocument: { uri: documentUri },
        position: { line: 0, character: 20 },
      });
      expect(hover.error).toBeUndefined();
      expect(hover.result).toMatchObject({
        contents: { kind: 'markdown' },
        range: {
          start: { line: 0, character: 15 },
          end: { line: 0, character: 25 },
        },
      });
      expect(
        (hover.result as { contents: { value: string } }).contents.value,
      ).toContain('Return Zone');
      expect(
        (hover.result as { contents: { value: string } }).contents.value,
      ).toContain('command:codocs.openSource');

      client.send('textDocument/didChange', {
        textDocument: { uri: documentUri, version: 2 },
        contentChanges: [{ text: 'no match here' }],
      });
      const changed = await client.request(3, documentMatchRequestMethod, {
        textDocument: { uri: documentUri },
        version: 2,
      });
      expect(changed.error).toBeUndefined();
      expect(changed.result).toMatchObject({
        success: true,
        version: 2,
        candidates: [],
      });

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
      await rm(root, { recursive: true, force: true });
    }
  });

  it('다중 루트·catalog 생명주기와 재시작 뒤 최신 원문을 실제 프로세스에서 처리한다', async () => {
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
        'id: parent-zone\nname: Parent Zone\ndefinition: parent\ndomains: [test]\n',
        'utf8',
      ),
      writeFile(
        path.join(nested, '.codocs/nested-zone.yaml'),
        'id: nested-zone\nname: Nested Zone\ndefinition: nested\ndomains: [test]\n',
        'utf8',
      ),
      writeFile(
        path.join(sibling, '.codocs/sibling-zone.yaml'),
        'id: sibling-zone\nname: Sibling Zone\ndefinition: sibling\ndomains: [test]\n',
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
    const nestedUri = pathToFileURL(path.join(nested, 'source.java')).href;
    const siblingUri = pathToFileURL(path.join(sibling, 'source.ts')).href;
    const missingUri = pathToFileURL(path.join(missing, 'source.txt')).href;
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
          languageId: 'java',
          version: 5,
          text: '// parentZone\nString value = "nestedZone";\n😀 nestedZone(',
        },
      });
      firstClient.send('textDocument/didOpen', {
        textDocument: {
          uri: siblingUri,
          languageId: 'typescript',
          version: 1,
          text: 'siblingZone',
        },
      });
      firstClient.send('textDocument/didOpen', {
        textDocument: {
          uri: missingUri,
          languageId: 'plaintext',
          version: 1,
          text: 'createdZone',
        },
      });

      const nestedResult = await firstClient.request(
        2,
        documentMatchRequestMethod,
        { textDocument: { uri: nestedUri }, version: 5 },
      );
      expect(nestedResult.error).toBeUndefined();
      expect(nestedResult.result).toMatchObject({
        success: true,
        version: 5,
        workspaceUri: pathToFileURL(nested).href,
        candidates: [{ id: 'nested-zone' }],
        evidence: [
          { token: 'nestedZone' },
          {
            token: 'nestedZone',
            range: {
              start: { line: 2, character: 3 },
              end: { line: 2, character: 13 },
            },
          },
        ],
      });
      expect(
        (
          nestedResult.result as { candidates: { id: string }[] }
        ).candidates.map((candidate) => candidate.id),
      ).toEqual(['nested-zone']);
      const nestedHover = await firstClient.request(13, 'textDocument/hover', {
        textDocument: { uri: nestedUri },
        position: { line: 2, character: 5 },
      });
      expect(nestedHover.result).toMatchObject({
        contents: { kind: 'markdown' },
        range: {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 13 },
        },
      });
      expect(
        (nestedHover.result as { contents: { value: string } }).contents.value,
      ).toContain('Nested Zone');
      expect(
        (nestedHover.result as { contents: { value: string } }).contents.value,
      ).not.toContain('Parent Zone');

      const siblingResult = await firstClient.request(
        3,
        documentMatchRequestMethod,
        { textDocument: { uri: siblingUri }, version: 1 },
      );
      expect(siblingResult.result).toMatchObject({
        success: false,
        code: 'workspace_not_found',
      });

      const beforeCreation = await firstClient.request(
        4,
        documentMatchRequestMethod,
        { textDocument: { uri: missingUri }, version: 1 },
      );
      expect(beforeCreation.result).toMatchObject({
        success: false,
        code: 'workspace_not_found',
      });
      firstClient.send('workspace/didChangeWorkspaceFolders', {
        event: {
          added: [workspaceFolders[3]],
          removed: [workspaceFolders[1]],
        },
      });
      // 제거되는 작업 공간은 진행 중인 최초 수집이 끝난 뒤 닫히므로 추가 반영을 기다린다.
      await vi.waitFor(
        async () => {
          const afterFolderChange = await firstClient.request(
            5,
            documentMatchRequestMethod,
            { textDocument: { uri: missingUri }, version: 1 },
          );
          expect(afterFolderChange.result).toMatchObject({
            success: true,
            candidates: [],
          });
        },
        { timeout: 5000 },
      );
      await expect(access(path.join(missing, '.codocs'))).rejects.toThrow();
      await mkdir(path.join(missing, '.codocs'));
      await writeFile(
        path.join(missing, '.codocs/created-zone.yaml'),
        'id: created-zone\nname: Created Zone\ndefinition: created\ndomains: [test]\n',
        'utf8',
      );
      await firstClient.request(6, workspaceRefreshRequestMethod, {
        workspaceUri: pathToFileURL(missing).href,
      });
      await vi.waitFor(
        async () => {
          const created = await firstClient.request(
            7,
            documentMatchRequestMethod,
            { textDocument: { uri: missingUri }, version: 1 },
          );
          expect(created.result).toMatchObject({
            success: true,
            candidates: [{ id: 'created-zone' }],
          });
        },
        { timeout: 5_000, interval: 100 },
      );

      await writeFile(
        path.join(missing, '.codocs/created-zone.yaml'),
        'id: changed-zone\nname: Changed Zone\ndefinition: changed\ndomains: [test]\n',
        'utf8',
      );
      firstClient.send('textDocument/didChange', {
        textDocument: { uri: missingUri, version: 2 },
        contentChanges: [{ text: '/* changedZone */' }],
      });
      await firstClient.request(8, workspaceRefreshRequestMethod, {
        workspaceUri: pathToFileURL(missing).href,
      });
      const changed = await firstClient.request(9, documentMatchRequestMethod, {
        textDocument: { uri: missingUri },
        version: 2,
      });
      expect(changed.result).toMatchObject({
        success: true,
        version: 2,
        candidates: [{ id: 'changed-zone' }],
      });
      const changedHover = await firstClient.request(14, 'textDocument/hover', {
        textDocument: { uri: missingUri },
        position: { line: 0, character: 5 },
      });
      expect(changedHover.result).toMatchObject({
        contents: { kind: 'markdown' },
        range: {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 14 },
        },
      });
      expect(
        (changedHover.result as { contents: { value: string } }).contents.value,
      ).toContain('Changed Zone');

      const shutdown = await firstClient.request(10, 'shutdown', null);
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
            languageId: 'plaintext',
            version: 7,
            text: '// 😀 unsaved\n"changedZone"(',
          },
        });
        const resynchronized = await restartedClient.request(
          11,
          documentMatchRequestMethod,
          { textDocument: { uri: missingUri }, version: 7 },
        );
        expect(resynchronized.result).toMatchObject({
          success: true,
          version: 7,
          candidates: [{ id: 'changed-zone' }],
          evidence: [
            {
              token: 'changedZone',
              range: {
                start: { line: 1, character: 1 },
                end: { line: 1, character: 12 },
              },
            },
          ],
        });
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
      await rm(root, { recursive: true, force: true });
    }
  });
});
