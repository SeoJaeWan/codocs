/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- 프로토콜 시험 콜백은 공개 선언 함수가 아니다. */
import { build } from 'esbuild';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { documentMatchRequestMethod } from './server-session.js';

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: unknown;
}

class StdioProtocolClient {
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
        reject(new Error(`LSP 응답 대기 시간이 지났습니다: ${method}`));
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
  it('initialize·전체 문서 변경·현재 매칭·shutdown을 실제 LSP 프레임으로 처리한다', async () => {
    const fixtureParent = path.resolve('.workbench/fixtures');
    await mkdir(fixtureParent, { recursive: true });
    const root = await mkdtemp(path.join(fixtureParent, 'server-process-'));
    const output = path.join(root, 'server.cjs');
    await mkdir(path.join(root, '.codocs'));
    await writeFile(
      path.join(root, '.codocs/return-zone.yaml'),
      'id: return-zone\nname: Return Zone\ndefinition: test\ndomains: [test]\n',
      'utf8',
    );
    await build({
      entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.19',
    });
    const child = spawn(process.execPath, [output, '--stdio'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
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
        capabilities: { textDocumentSync: { openClose: true, change: 1 } },
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
      if (child.exitCode === null) child.kill();
      await rm(root, { recursive: true, force: true });
    }
  });
});
