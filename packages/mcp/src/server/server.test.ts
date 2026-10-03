import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCodocsStdio } from './index.js';
import { createSourceCli } from '../../test-support/source-cli.js';

let sourceCli: Awaited<ReturnType<typeof createSourceCli>>;
let cli: string;
let fixture: string;
let projectA: string;
let projectB: string;

/** 실제 파일 두 벌로 서로 다른 프로젝트의 조회 결과를 구별한다. */
beforeAll(async () => {
  sourceCli = await createSourceCli();
  cli = sourceCli.entry;
  await mkdir('.workbench', { recursive: true });
  fixture = await mkdtemp(path.resolve('.workbench/mcp-server-'));
  projectA = path.join(fixture, 'a');
  projectB = path.join(fixture, 'b');
  for (const [project, id] of [
    [projectA, 'alpha'],
    [projectB, 'bravo'],
  ] as const) {
    await mkdir(path.join(project, '.codocs'), { recursive: true });
    await writeFile(
      path.join(project, '.codocs', `${id}.yaml`),
      `id: ${id}\nname: ${id}\ndomains: [test]\ndeprecatedAliases: []\ndefinition: 본문\n`,
    );
  }
});

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
  await sourceCli.close();
});

/** 소스 CLI와 공식 SDK Client를 실제 stdio로 연결한다. */
async function clientFor(
  cwd: string,
  args: readonly string[] = [],
): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, ...args],
    cwd,
    stderr: 'pipe',
    maxBufferSize: 16 * 1024 * 1024,
  });
  const client = new Client({ name: 'codocs-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

/** text와 structuredContent가 정확히 같은 공통 결과인지 확인한다. */
function payload(response: unknown): Record<string, unknown> {
  const received = response as {
    content: readonly { type: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  const text = received.content.find(
    /** JSON 텍스트 블록 하나를 선택한다. */ (item) => item.type === 'text',
  );
  expect(text?.type).toBe('text');
  const parsed = JSON.parse(text!.text!) as Record<string, unknown>;
  expect(received.structuredContent).toEqual(parsed);
  expect(received.isError).toBe(parsed.success === false);
  return parsed;
}

describe('소스 MCP stdio 서버', () => {
  it('초기화 후 쓰기를 포함한 도구를 제공하고 실제 문서를 목록·상세·검증·갱신한다', async () => {
    const { client, transport } = await clientFor(projectA);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual([
        'codocs_list',
        'codocs_get',
        'codocs_refresh',
        'codocs_validate',
        'codocs_write',
        'codocs_duplicates',
        'codocs_guide',
      ]);
      const listed = payload(
        await client.callTool({ name: 'codocs_list', arguments: {} }),
      );
      expect(listed.success).toBe(true);
      expect((listed.items as { id: string }[]).map((item) => item.id)).toEqual(
        ['alpha'],
      );
      const fetched = payload(
        await client.callTool({
          name: 'codocs_get',
          arguments: { ids: ['alpha', 'missing'] },
        }),
      );
      expect(fetched.success).toBe(true);
      expect(
        (fetched.results as { found: boolean }[]).map((item) => item.found),
      ).toEqual([true, false]);
      const refreshed = payload(
        await client.callTool({ name: 'codocs_refresh', arguments: {} }),
      );
      expect(refreshed).toMatchObject({
        success: true,
        fileCount: 1,
        itemCount: 1,
      });
      const errors = payload(
        await client.callTool({ name: 'codocs_get', arguments: { ids: [] } }),
      );
      expect(errors).toMatchObject({
        success: false,
        error: { code: 'invalid_input' },
      });
      expect(
        payload(
          await client.callTool({ name: 'codocs_validate', arguments: {} }),
        ),
      ).toMatchObject({
        success: true,
        scanStatus: 'complete',
        diagnostics: [],
      });
      expect(transport.stderr).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  it('큰 정상 문서와 .inf 원문을 혼합 조회해 본문·직접 참조·revision·진단을 전부 보존한다', async () => {
    const selected = path.join(fixture, 'large');
    const folder = path.join(selected, '.codocs');
    await mkdir(folder, { recursive: true });
    const targets = Array.from(
      { length: 20 },
      (_, index) => `target-${String(index).padStart(2, '0')}`,
    );
    const definition = `${targets.map((_, index) => `[[Target ${String(index).padStart(2, '0')}]]`).join(' ')} ${'x'.repeat(500_000)}`;
    const rawYaml = `id: invalid\nname: Invalid\ndomains: [test]\ndeprecatedAliases: []\ndefinition: ${'y'.repeat(500_000)}\nvalue: .inf\n`;
    await writeFile(
      path.join(folder, 'normal.yaml'),
      `id: normal\nname: Normal\ndomains: [test]\ndeprecatedAliases: []\ndefinition: ${JSON.stringify(definition)}\n`,
    );
    for (const [index, id] of targets.entries())
      await writeFile(
        path.join(folder, `${id}.yaml`),
        `id: ${id}\nname: Target ${String(index).padStart(2, '0')}\ndomains: [test]\ndeprecatedAliases: []\ndefinition: 대상\n`,
      );
    await writeFile(path.join(folder, 'invalid.yaml'), rawYaml);
    await writeFile(
      path.join(folder, 'conflict-a.yaml'),
      'id: shared\nname: Conflict A\ndomains: [test]\ndeprecatedAliases: []\ndefinition: 본문\n',
    );
    await writeFile(
      path.join(folder, 'conflict-b.yaml'),
      'id: shared\nname: Conflict B\ndomains: [test]\ndeprecatedAliases: []\ndefinition: 본문\n',
    );
    const { client } = await clientFor(selected);
    try {
      const response = payload(
        await client.callTool({
          name: 'codocs_get',
          arguments: { ids: ['normal', 'invalid', 'shared', 'missing'] },
        }),
      );
      const results = response.results as Record<string, unknown>[];
      expect(response.success).toBe(true);
      expect(results[0]).toMatchObject({
        found: true,
        document: { definition },
        source: { path: path.join('.codocs', 'normal.yaml') },
        references: targets,
      });
      expect(results[1]).toMatchObject({
        found: true,
        rawYaml,
        source: { path: path.join('.codocs', 'invalid.yaml') },
      });
      expect(results[1]).not.toHaveProperty('document');
      expect(results[1]?.revision).toBe(
        createHash('sha256').update(Buffer.from(rawYaml, 'utf8')).digest('hex'),
      );
      expect((results[1]?.diagnostics as unknown[]).length).toBeGreaterThan(0);
      expect(results[2]).toMatchObject({
        found: true,
        conflict: true,
        paths: [
          path.join('.codocs', 'conflict-a.yaml'),
          path.join('.codocs', 'conflict-b.yaml'),
        ],
      });
      expect(results[3]).toMatchObject({
        found: false,
        diagnostics: [expect.objectContaining({ code: 'not_found' })],
      });
      const responseBytes = Buffer.byteLength(JSON.stringify(response));
      console.info(`stdio-large-payload-bytes=${responseBytes}`);
      expect(responseBytes).toBeGreaterThan(1_000_000);
    } finally {
      await client.close();
    }
  });

  it('프로세스별 기본 cwd와 상대·절대 project 선택을 분리한다', async () => {
    const selected = await Promise.all([
      clientFor(projectA),
      clientFor(fixture, ['--project', 'b']),
      clientFor(projectA, ['--project', projectB]),
    ]);
    try {
      const results = await Promise.all(
        selected.map(async ({ client }) => {
          const result = payload(
            await client.callTool({ name: 'codocs_list', arguments: {} }),
          );
          return (result.items as { id: string }[]).map((item) => item.id);
        }),
      );
      expect(results).toEqual([['alpha'], ['bravo'], ['bravo']]);
    } finally {
      await Promise.all(selected.map(({ client }) => client.close()));
    }
  });

  it('raw child의 stdin EOF만으로 종료하고 stdout은 JSON-RPC만 보낸다', async () => {
    const child = spawn(process.execPath, [cli], {
      cwd: projectA,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      errors += chunk;
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw-test', version: '1.0.0' },
        },
      }) + '\n',
    );
    await viWaitFor(() => expect(output).toContain('"id":1'));
    child.stdin.end();
    const outcome = await Promise.race([
      once(child, 'exit'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('EOF timeout')), 5_000),
      ),
    ]);
    expect(outcome[0]).toBe(0);
    for (const line of output.trim().split('\n'))
      expect(JSON.parse(line) as Record<string, unknown>).toHaveProperty(
        'jsonrpc',
        '2.0',
      );
    expect(errors).toContain('Codocs MCP server ready');
  });

  it('초기화 이전 EOF도 강제 종료 없이 처리한다', async () => {
    const child = spawn(process.execPath, [cli], {
      cwd: projectA,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();
    const outcome = await Promise.race([
      once(child, 'exit'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('early EOF timeout')), 5_000),
      ),
    ]);
    expect(outcome[0]).toBe(0);
  });

  it('시작 실패와 중복 종료에도 연결을 정리한다', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    class FailingTransport extends StdioServerTransport {
      closed = 0;
      override start(): Promise<void> {
        return Promise.reject(new Error('transport start failed'));
      }
      override async close(): Promise<void> {
        this.closed++;
        await super.close();
      }
    }
    const failing = new FailingTransport(input, output);
    await expect(startCodocsStdio({ cwd: projectA }, failing)).rejects.toThrow(
      'transport start failed',
    );
    expect(failing.closed).toBeGreaterThan(0);
    const working = new StdioServerTransport(
      new PassThrough(),
      new PassThrough(),
    );
    const owner = await startCodocsStdio({ cwd: projectA }, working);
    await Promise.all([owner.close(), owner.close()]);
  });
});

/** 프로토콜 응답 도착을 고정 대기 대신 제한 시간 안에 확인한다. */
async function viWaitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}
