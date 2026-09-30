import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { WorkspaceQuerySession } from '@codocs/workspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCodocsServer } from './index.js';
import { createSourceCli } from '../../test-support/source-cli.js';

const repeated =
  '주문 접수 뒤에는 재고를 확인하고 결제 승인 결과를 기록한 다음 배송 준비 상태로 넘긴다.';

let sourceCli: Awaited<ReturnType<typeof createSourceCli>>;
let fixture: string;

/** 같은 구절을 가진 저장 문서 두 개를 임시 프로젝트에 만든다. */
beforeAll(async () => {
  sourceCli = await createSourceCli();
  await mkdir('.workbench', { recursive: true });
  fixture = await mkdtemp(path.resolve('.workbench/mcp-duplicates-'));
  await mkdir(path.join(fixture, '.codocs'), { recursive: true });
  for (const id of ['alpha', 'bravo'])
    await writeFile(
      path.join(fixture, '.codocs', `${id}.yaml`),
      `id: ${id}\nname: ${id}\ndomains: [test]\ndefinition: ${repeated}\n`,
    );
});

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
  await sourceCli.close();
});

/** 구조화 결과를 꺼낸다. */
function structured(response: unknown): Record<string, unknown> {
  return (response as { structuredContent: Record<string, unknown> })
    .structuredContent;
}

// @codocs [[MCP:본문 중복 검토 요청]]
describe('codocs_duplicates stdio 도구', () => {
  // @codocs [[MCP:본문 중복 검토 요청]]#L10-L11
  it('일곱 도구를 나열하고 전체·초안 검토와 만료 커서를 실제 stdio로 반환한다', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [sourceCli.entry],
      cwd: fixture,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'codocs-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(7);
      const duplicates = tools.find(
        (tool) => tool.name === 'codocs_duplicates',
      );
      expect(duplicates?.description).toContain('0부터');
      const full = structured(
        await client.callTool({ name: 'codocs_duplicates', arguments: {} }),
      );
      expect(full).toMatchObject({
        success: true,
        status: 'complete',
        scope: 'all',
        totalCandidates: 1,
        nextCursor: null,
      });
      const draft = structured(
        await client.callTool({
          name: 'codocs_duplicates',
          arguments: {
            draft: {
              mode: 'create',
              path: '.codocs/charlie.yaml',
              document: {
                id: 'charlie',
                name: 'charlie',
                domains: ['test'],
                definition: repeated,
              },
            },
          },
        }),
      );
      expect(draft).toMatchObject({
        success: true,
        scope: 'draft',
        draft: { path: '.codocs/charlie.yaml' },
      });
      expect((draft.candidates as unknown[]).length).toBeGreaterThan(0);
      const expired = structured(
        await client.callTool({
          name: 'codocs_duplicates',
          arguments: { cursor: 'not-a-cursor' },
        }),
      );
      expect(expired).toMatchObject({
        success: false,
        status: 'expired',
        expiryReason: 'unrecognized',
        error: { code: 'cursor_expired' },
      });
      const both = structured(
        await client.callTool({
          name: 'codocs_duplicates',
          arguments: { cursor: 'x', draft: { mode: 'create' } },
        }),
      );
      expect(both).toMatchObject({
        success: false,
        error: { code: 'invalid_input' },
      });
    } finally {
      await client.close();
    }
  });

  it('검사 중 notifications/cancelled를 보내면 세션에 준 signal이 abort되고 그동안 codocs_get이 먼저 응답한다', async () => {
    let received: AbortSignal | undefined;
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const session = {
      /** 취소 전까지 끝나지 않는 검사를 흉내낸다. */
      duplicates: (_input: unknown, options?: { signal?: AbortSignal }) => {
        received = options?.signal;
        started();
        return new Promise((resolve) =>
          received?.addEventListener('abort', () =>
            resolve({
              success: false,
              status: 'cancelled',
              scanStatus: 'complete',
              error: { code: 'request_superseded' },
            }),
          ),
        );
      },
      get: () =>
        Promise.resolve({ success: true, scanStatus: 'complete', results: [] }),
      close: () => Promise.resolve(),
    } as unknown as WorkspaceQuerySession;
    const toServer = new PassThrough();
    const fromServer = new PassThrough();
    const server = createCodocsServer(session);
    await server.connect(new StdioServerTransport(toServer, fromServer));
    const lines: Record<string, unknown>[] = [];
    let buffer = '';
    fromServer.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        lines.push(
          JSON.parse(buffer.slice(0, index)) as Record<string, unknown>,
        );
        buffer = buffer.slice(index + 1);
      }
    });
    /** 한 줄 JSON-RPC 메시지를 보낸다. */
    const send = (message: unknown): void => {
      toServer.write(`${JSON.stringify(message)}\n`);
    };
    /** 조건이 참이 될 때까지 제한 시간 안에서 기다린다. */
    const until = async (condition: () => boolean): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!condition() && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(condition()).toBe(true);
    };
    try {
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw', version: '1' },
        },
      });
      await until(() => lines.some((line) => line.id === 1));
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'codocs_duplicates', arguments: {} },
      });
      await running;
      expect(received?.aborted).toBe(false);
      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'codocs_get', arguments: { ids: ['a'] } },
      });
      await until(() => lines.some((line) => line.id === 3));
      expect(lines.some((line) => line.id === 2)).toBe(false);
      send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 2, reason: 'test' },
      });
      await until(() => received?.aborted === true);
    } finally {
      await server.close();
    }
  });
});
