import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
const io = vi.hoisted(() => ({
  denied: '',
  held: '',
  entered: undefined as (() => void) | undefined,
  pending: undefined as Promise<void> | undefined,
  reads: 0,
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    /** 실제 읽기의 시작을 제어하고 나머지 파일 IO는 원래 구현으로 실행한다. */
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (typeof args[0] === 'string' && args[0] === io.held) {
        io.reads++;
        io.entered?.();
        await io.pending;
      }
      return actual.readFile(...args);
    },
    /** 지정한 실제 경로의 접근 실패만 재현한다. */
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (typeof args[0] === 'string' && args[0] === io.denied)
        throw Object.assign(new Error('접근 거부'), { code: 'EACCES' });
      return actual.lstat(...args);
    },
  };
});
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '@codocs/workspace';
import { createCodocsServer } from './index.js';
import { createCodocsGuideHandler } from '../guide/index.js';

let project: string;
/** 실제 IO 경계의 도달과 해제를 따로 제어한다. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
let session: WorkspaceQuerySession;
let client: Client;
let server: ReturnType<typeof createCodocsServer>;
const guide = createCodocsGuideHandler(
  pathToFileURL(path.resolve('docs/guide') + path.sep),
);

beforeEach(async () => {
  await mkdir('.workbench', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/mcp-state-'));
  await mkdir(path.join(project, '.codocs'));
  io.denied = '';
  io.held = '';
  io.reads = 0;
  io.pending = undefined;
  io.entered = undefined;
});
afterEach(async () => {
  io.denied = '';
  io.held = '';
  await client?.close();
  await server?.close();
  await session?.close();
  await rm(project, { recursive: true, force: true });
});

/** 실제 세션과 SDK 서버를 메모리 전송으로 연결해 IO 제어 경계를 유지한다. */
async function connect(current: WorkspaceQuerySession): Promise<void> {
  session = current;
  server = createCodocsServer(current, guide);
  client = new Client({ name: 'state-test', version: '1' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

/** MCP 포장과 본문 동등성을 확인하며 결과를 읽는다. */
function payload(response: unknown): Record<string, unknown> {
  const value = response as {
    structuredContent: Record<string, unknown>;
    content: { text: string }[];
    isError: boolean;
  };
  expect(JSON.parse(value.content[0]!.text)).toEqual(value.structuredContent);
  expect(value.isError).toBe(!value.structuredContent.success);
  return value.structuredContent;
}

describe('색인 상태와 독립된 MCP guide', () => {
  it.each(['initialization', 'refresh'])(
    '%s의 실제 읽기가 대기 중이면 guide는 스캔을 추가하지 않고 응답한다',
    async (phase) => {
      const target = path.join(project, '.codocs/a.yaml');
      await writeFile(
        target,
        'id: a\nname: A\ndefinition: 본문\ndomains: [test]\n',
      );
      await connect(createWorkspaceQuerySession({ cwd: project }));
      if (phase === 'refresh')
        await client.callTool({ name: 'codocs_list', arguments: {} });
      const gate = deferred();
      const entered = deferred();
      io.held = target;
      io.pending = gate.promise;
      io.entered = entered.resolve;
      const operation = client.callTool({
        name: phase === 'refresh' ? 'codocs_refresh' : 'codocs_list',
        arguments: {},
      });
      try {
        await entered.promise;
        const reads = io.reads;
        expect(
          payload(
            await client.callTool({
              name: 'codocs_guide',
              arguments: { topic: 'validation' },
            }),
          ),
        ).toEqual(await guide({ topic: 'validation' }));
        expect(io.reads).toBe(reads);
      } finally {
        gate.resolve();
        await operation;
      }
    },
  );

  it('색인이 실패하면 guide는 실패한 세션 IO를 호출하지 않고 응답한다', async () => {
    io.denied = path.join(project, '.codocs');
    await connect(createWorkspaceQuerySession({ cwd: project }));
    expect(
      payload(await client.callTool({ name: 'codocs_refresh', arguments: {} })),
    ).toMatchObject({ success: false });
    const refresh = vi.spyOn(session, 'refresh');
    const list = vi.spyOn(session, 'list');
    expect(
      payload(await client.callTool({ name: 'codocs_guide', arguments: {} })),
    ).toEqual(await guide({}));
    expect(refresh).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});

describe('MCP 저장 후 색인 복구', () => {
  it('실제 저장 후 두 관측 오류가 나면 저장 revision을 보존하고 refresh로 복구한다', async () => {
    const attempts: number[] = [];
    await connect(
      createWorkspaceQuerySession({ cwd: project }, undefined, {
        beforeIndexUpdate: (attempt) => {
          attempts.push(attempt);
          return Promise.reject(new Error('관측 실패'));
        },
      }),
    );
    const created = payload(
      await client.callTool({
        name: 'codocs_write',
        arguments: {
          mode: 'create',
          path: '.codocs/a.yaml',
          document: {
            id: 'a',
            name: 'A',
            definition: '저장 원문',
            domains: ['test'],
          },
        },
      }),
    );
    const bytes = await readFile(path.join(project, '.codocs/a.yaml'));
    expect(attempts).toEqual([1, 2]);
    expect(created).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: false,
      revision: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(JSON.stringify(created.diagnostics)).toContain('codocs_refresh');
    expect(
      payload(await client.callTool({ name: 'codocs_refresh', arguments: {} })),
    ).toMatchObject({ success: true, scanStatus: 'complete' });
    expect(
      payload(
        await client.callTool({
          name: 'codocs_get',
          arguments: { ids: ['a'] },
        }),
      ).results,
    ).toMatchObject([
      { revision: created.revision, document: { definition: '저장 원문' } },
    ]);
    expect(await readFile(path.join(project, '.codocs/a.yaml'))).toEqual(bytes);
  });

  it.each([1, 2])(
    '%i번째 관측이 늦게 완료되면 create를 반복하지 않고 성공을 기다린다',
    async (delayed) => {
      const gate = deferred();
      const entered = deferred();
      const attempts: number[] = [];
      await connect(
        createWorkspaceQuerySession({ cwd: project }, undefined, {
          beforeIndexUpdate: (attempt) => {
            attempts.push(attempt);
            if (attempt === delayed) {
              entered.resolve();
              return gate.promise;
            } else throw new Error('첫 관측 실패');
          },
        }),
      );
      const write = vi.spyOn(session, 'write');
      let settled = false;
      const operation = client
        .callTool({
          name: 'codocs_write',
          arguments: {
            mode: 'create',
            path: '.codocs/a.yaml',
            document: {
              id: 'a',
              name: 'A',
              definition: '느린 관측',
              domains: ['test'],
            },
          },
        })
        .then((result) => {
          settled = true;
          return result;
        });
      try {
        await entered.promise;
        // 이전의 1초 실패 정책으로 돌아가는 회귀를 실제 도달한 관측 경계에서 검사한다.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(settled).toBe(false);
        expect(write).toHaveBeenCalledTimes(1);
        expect(
          await readFile(path.join(project, '.codocs/a.yaml'), 'utf8'),
        ).toContain('느린 관측');
      } finally {
        gate.resolve();
      }
      expect(payload(await operation)).toMatchObject({
        success: true,
        saved: true,
        indexUpdated: true,
      });
      expect(attempts).toEqual(delayed === 1 ? [1] : [1, 2]);
    },
  );
});

describe('MCP refresh 집계·중복·커서', () => {
  it('전체 탐색 실패 뒤 원인을 해소하면 refresh가 실제 파일을 다시 읽어 복구한다', async () => {
    await writeFile(
      path.join(project, '.codocs/a.yaml'),
      'id: a\nname: A\ndefinition: 복구 원문\ndomains: [test]\n',
    );
    io.denied = path.join(project, '.codocs');
    await connect(createWorkspaceQuerySession({ cwd: project }));
    const failed = payload(
      await client.callTool({ name: 'codocs_refresh', arguments: {} }),
    );
    expect(failed).toMatchObject({ success: false, scanStatus: 'failed' });
    expect(failed).not.toHaveProperty('countsComplete', true);
    io.denied = '';
    expect(
      payload(await client.callTool({ name: 'codocs_refresh', arguments: {} })),
    ).toMatchObject({
      success: true,
      scanStatus: 'complete',
      countsComplete: true,
      fileCount: 1,
      itemCount: 1,
    });
    expect(
      payload(
        await client.callTool({
          name: 'codocs_get',
          arguments: { ids: ['a'] },
        }),
      ).results,
    ).toMatchObject([{ found: true, document: { definition: '복구 원문' } }]);
  });
  it('전체 재구성하면 파일·목록 항목·진단 수를 구분한다', async () => {
    await writeFile(
      path.join(project, '.codocs/a.yaml'),
      'id: a\nname: A\ndefinition: 본문\ndomains: [test]\ncustom: true\n',
    );
    await writeFile(
      path.join(project, '.codocs/duplicate.yaml'),
      'id: a\nname: B\ndefinition: 본문\ndomains: [test]\n',
    );
    await writeFile(path.join(project, '.codocs/broken.yaml'), 'id: [\n');
    await writeFile(
      path.join(project, '.codocs/unidentified.yaml'),
      'name: 없음\n',
    );
    await connect(createWorkspaceQuerySession({ cwd: project }));
    const result = payload(
      await client.callTool({ name: 'codocs_refresh', arguments: {} }),
    );
    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      countsComplete: true,
      fileCount: 4,
      itemCount: 1,
      warningCount: 0,
    });
    const diagnostics = result.diagnostics as { severity: string }[];
    expect(result.errorCount).toBe(
      diagnostics.filter((d) => d.severity === 'error').length,
    );
    expect(result.errorCount).toBeGreaterThan(1);
    expect(
      payload(await client.callTool({ name: 'codocs_list', arguments: {} }))
        .totalCount,
    ).toBe(1);
  });

  it.each(['complete', 'partial'])(
    '%s refresh는 동시 요청의 작업을 공유하고 이전 커서를 만료한다',
    async (state) => {
      for (let n = 0; n < 51; n++)
        await writeFile(
          path.join(project, '.codocs', n + '.yaml'),
          `id: d-${n}\nname: D${n}\ndefinition: 본문\ndomains: [test]\n`,
        );
      await connect(createWorkspaceQuerySession({ cwd: project }));
      const first = payload(
        await client.callTool({ name: 'codocs_list', arguments: {} }),
      );
      expect(first.nextCursor).toBeTypeOf('string');
      if (state === 'partial') io.denied = path.join(project, '.codocs/1.yaml');
      const gate = deferred();
      const entered = deferred();
      io.held = path.join(project, '.codocs/0.yaml');
      io.pending = gate.promise;
      io.entered = entered.resolve;
      const refresh = vi.spyOn(session, 'refresh');
      const a = client.callTool({ name: 'codocs_refresh', arguments: {} });
      await entered.promise;
      const b = client.callTool({ name: 'codocs_refresh', arguments: {} });
      // 두 요청이 서버에 도달했음을 guide 왕복으로 확인한 뒤 IO를 해제한다.
      await client.callTool({ name: 'codocs_guide', arguments: {} });
      gate.resolve();
      const results = await Promise.all([a, b]);
      expect(payload(results[0])).toEqual(payload(results[1]));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(payload(results[0])).toMatchObject({
        success: true,
        scanStatus: state,
        countsComplete: state === 'complete',
        itemCount: 51,
      });
      expect(
        payload(
          await client.callTool({
            name: 'codocs_list',
            arguments: { cursor: first.nextCursor },
          }),
        ),
      ).toMatchObject({ success: false, error: { code: 'cursor_expired' } });
      if (state === 'partial') {
        expect(
          payload(
            await client.callTool({ name: 'codocs_validate', arguments: {} }),
          ),
        ).toMatchObject({ success: false });
        io.denied = '';
        expect(
          payload(
            await client.callTool({ name: 'codocs_refresh', arguments: {} }),
          ),
        ).toMatchObject({
          success: true,
          scanStatus: 'complete',
          countsComplete: true,
        });
      }
    },
  );
});
