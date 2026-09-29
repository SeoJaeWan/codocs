import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CodocsWriteResponse } from '../query/index.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { createSourceCli } from '../../test-support/source-cli.js';

let sourceCli: Awaited<ReturnType<typeof createSourceCli>>;
let cli: string;
const original =
  'id: target\nname: 계약\ndomains: [업무]\ndefinition: |\n  alpha\n  beta\n  gamma\n  omega\n';
const code =
  '// @codocs [[계약]]#L5 @codocs [[계약]]#L6-L7\n// @codocs [[계약]]#L8\n// @codocs [[계약]]\n// @codocs [[업무:계약]]#L6\n';
let project: string;
let client: Client;
let transport: StdioClientTransport;
/** 제품 dist와 분리한 소스 CLI 번들을 이 파일의 사례가 함께 사용한다. */
beforeAll(async () => {
  sourceCli = await createSourceCli();
  cli = sourceCli.entry;
});

/** 사례가 끝난 뒤 실행별 소스 CLI 번들을 정리한다. */
afterAll(async () => {
  await sourceCli.close();
});

/** VS Code 환경이나 세션 없이 저장 코드가 있는 사유 프로젝트에 stdio를 고정한다. */
beforeEach(async () => {
  await mkdir('.workbench', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/mcp-write-impact-'));
  await mkdir(path.join(project, '.codocs'));
  await writeFile(path.join(project, '.codocs/target.yaml'), original);
  await writeFile(path.join(project, 'saved-only.txt'), code);
  client = new Client({ name: 'saved-file-impact-test', version: '1' });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, '--project', project],
    cwd: project,
    stderr: 'pipe',
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && !entry[0].startsWith('VSCODE_'),
      ),
    ),
  });
  await client.connect(transport);
  const ready = await client.callTool({
    name: 'codocs_get',
    arguments: { ids: ['target'] },
  });
  expect(ready.structuredContent).toMatchObject({
    success: true,
    results: [{ found: true }],
  });
});
/** stdio 프로세스의 종료를 확인한 뒤 각 사례의 저장 파일을 정리한다. */
afterEach(async () => {
  const pid = transport?.pid;
  await client?.close();
  if (pid) expect(() => process.kill(pid, 0)).toThrow();
  await rm(project, { recursive: true, force: true });
});

describe('codocs_write 저장 파일 기준 영향 stdio', () => {
  it.each([
    {
      name: '구간 내부 변경',
      set: { definition: 'alpha\nchanged\ngamma\nomega\n' },
      included: [
        '@codocs [[계약]]#L6-L7',
        '@codocs [[계약]]',
        '@codocs [[업무:계약]]#L6',
      ],
      reason: 'region_changed',
    },
    {
      name: '구간 앞 행 삽입',
      set: { definition: 'inserted\nalpha\nbeta\ngamma\nomega\n' },
      included: [
        '@codocs [[계약]]#L5',
        '@codocs [[계약]]#L6-L7',
        '@codocs [[계약]]#L8',
        '@codocs [[계약]]',
        '@codocs [[업무:계약]]#L6',
      ],
      reason: 'preceding_line_shift',
    },
    {
      name: '구간 뒤 변경',
      set: { definition: 'alpha\nbeta\ngamma\nchanged\n' },
      included: ['@codocs [[계약]]#L8', '@codocs [[계약]]'],
      reason: 'region_changed',
    },
    {
      name: '구간 삭제',
      set: { definition: 'alpha\n' },
      included: [
        '@codocs [[계약]]#L6-L7',
        '@codocs [[계약]]#L8',
        '@codocs [[계약]]',
        '@codocs [[업무:계약]]#L6',
      ],
      reason: 'region_changed',
    },
    {
      name: '이름과 도메인 변경',
      set: { name: '새 계약', domains: ['개발'] },
      included: [
        '@codocs [[계약]]#L5',
        '@codocs [[계약]]#L6-L7',
        '@codocs [[계약]]#L8',
        '@codocs [[계약]]',
        '@codocs [[업무:계약]]#L6',
      ],
      reason: 'name_changed',
    },
  ])(
    '$name 요청을 실제 저장하면 변경 전 출현과 저장 결과를 함께 반환한다',
    async ({ set, included, reason }) => {
      const request = {
        mode: 'update',
        id: 'target',
        revision: createHash('sha256').update(original).digest('hex'),
        set,
      };
      const response = await client.callTool({
        name: 'codocs_write',
        arguments: request,
      });
      const result = response.structuredContent as CodocsWriteResponse;
      expect(response.isError).toBe(false);
      expect(response.content).toEqual([
        { type: 'text', text: JSON.stringify(result) },
      ]);
      expect(result).toMatchObject({
        success: true,
        saved: true,
        changed: true,
        indexUpdated: true,
        writeImpact: {
          basis: 'saved_files',
          collection: { status: 'complete', confirmedCount: 5 },
          calculation: { status: 'complete', failures: [] },
        },
      });
      if (!result.success) return;
      expect(result.revision).toBe(
        createHash('sha256')
          .update(await readFile(path.join(project, '.codocs/target.yaml')))
          .digest('hex'),
      );
      expect(
        result.writeImpact?.impacts.map((impact) => impact.marker),
      ).toEqual(included);
      expect(
        result.writeImpact?.impacts.some((impact) =>
          impact.reasons.some((value) => value === reason),
        ),
      ).toBe(true);
      expect(
        result.writeImpact?.impacts.every(
          (impact) => impact.sourcePath === 'saved-only.txt',
        ),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toContain('alpha');
      expect(result).not.toHaveProperty('rawYaml');
      expect(await readFile(path.join(project, 'saved-only.txt'), 'utf8')).toBe(
        code,
      );
    },
  );
  it('반복 행 중 하나를 삭제하면 명시 번호를 유지하고 possible로 응답한다', async () => {
    const repeated = original.replace('  gamma\n', '  beta\n');
    await writeFile(path.join(project, '.codocs/target.yaml'), repeated);
    await client.callTool({ name: 'codocs_refresh', arguments: {} });
    const response = await client.callTool({
      name: 'codocs_write',
      arguments: {
        mode: 'update',
        id: 'target',
        revision: createHash('sha256').update(repeated).digest('hex'),
        set: { definition: 'alpha\nbeta\nomega\n' },
      },
    });
    const result = response.structuredContent as CodocsWriteResponse;
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    if (!result.success) return;
    expect(
      result.writeImpact?.impacts.find(
        (impact) => impact.marker === '@codocs [[계약]]#L6-L7',
      ),
    ).toMatchObject({
      certainty: 'possible',
      destination: { kind: 'rows', startLine: 6, endLine: 7 },
      reasons: ['ambiguous_correspondence'],
    });
  });
  it('실제 stdio에서 안내 계산과 색인 갱신이 실패해도 저장과 복구 결과를 유지한다', async () => {
    const originalPid = transport.pid;
    await client.close();
    if (originalPid) expect(() => process.kill(originalPid, 0)).toThrow();
    const entry = path.join(project, 'failure-server.mjs');
    await build({
      stdin: {
        contents: `
          import { createWorkspaceQuerySession } from '@codocs/workspace';
          import { createCodocsServer } from '@codocs/mcp';
          import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
          const session = createWorkspaceQuerySession({ project: process.cwd(), cwd: process.cwd() }, undefined, {
            beforeWriteImpactCalculation() { throw new Error('calculation unavailable'); },
            beforeIndexUpdate() { return Promise.reject(new Error('index unavailable')); },
          });
          const server = createCodocsServer(session);
          let closing;
          function close() { return closing ??= (async () => { await server.close(); await session.close(); })(); }
          process.stdin.once('end', close);
          process.once('SIGTERM', async () => { await close(); process.exit(0); });
          await server.connect(new StdioServerTransport());
        `,
        resolveDir: path.resolve('packages/mcp'),
        sourcefile: 'write-impact-failure-child.mjs',
      },
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      alias: {
        '@codocs/core': path.resolve('packages/core/src/index.ts'),
        '@codocs/workspace': path.resolve('packages/workspace/src/index.ts'),
        '@codocs/mcp': path.resolve('packages/mcp/src/index.ts'),
      },
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: 'silent',
    });
    client = new Client({ name: 'saved-failure-impact-test', version: '1' });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: project,
      stderr: 'pipe',
    });
    await client.connect(transport);
    const response = await client.callTool({
      name: 'codocs_write',
      arguments: {
        mode: 'update',
        id: 'target',
        revision: createHash('sha256').update(original).digest('hex'),
        set: { name: '새 계약' },
      },
    });
    const result = response.structuredContent as CodocsWriteResponse;
    expect(response.isError).toBe(false);
    expect(response.content).toEqual([
      { type: 'text', text: JSON.stringify(result) },
    ]);
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: false,
      writeImpact: { calculation: { status: 'incomplete' }, impacts: [] },
    });
    if (!result.success) return;
    expect(result.revision).toBe(
      createHash('sha256')
        .update(await readFile(path.join(project, '.codocs/target.yaml')))
        .digest('hex'),
    );
    expect(result.writeImpact?.calculation.failures[0]).toContain(
      'calculation unavailable',
    );
    expect(
      result.diagnostics.find((item) => item.code === 'index_update_failed')
        ?.suggestion,
    ).toContain('codocs_refresh');
    const refreshed = await client.callTool({
      name: 'codocs_refresh',
      arguments: {},
    });
    expect(refreshed.structuredContent).toMatchObject({ success: true });
    const detail = await client.callTool({
      name: 'codocs_get',
      arguments: { ids: ['target'] },
    });
    expect(detail.structuredContent).toMatchObject({
      success: true,
      results: [
        {
          found: true,
          revision: result.revision,
          document: { name: '새 계약' },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('alpha');
  });
  it('검증된 무변경이면 실제 stdio에도 영향 안내를 추가하지 않는다', async () => {
    const response = await client.callTool({
      name: 'codocs_write',
      arguments: {
        mode: 'update',
        id: 'target',
        revision: createHash('sha256').update(original).digest('hex'),
        set: { name: '계약' },
      },
    });
    expect(response.structuredContent).toMatchObject({
      success: true,
      saved: false,
      changed: false,
    });
    expect(response.structuredContent).not.toHaveProperty('writeImpact');
    expect(response.structuredContent).not.toHaveProperty('indexUpdated');
    expect(
      await readFile(path.join(project, '.codocs/target.yaml'), 'utf8'),
    ).toBe(original);
  });
  it('저장 revision이 충돌하면 실제 stdio에도 영향 안내를 만들지 않는다', async () => {
    const response = await client.callTool({
      name: 'codocs_write',
      arguments: {
        mode: 'update',
        id: 'target',
        revision: 'stale',
        set: { name: '새 계약' },
      },
    });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      success: false,
      saved: false,
      changed: false,
    });
    expect(response.structuredContent).not.toHaveProperty('writeImpact');
    expect(
      await readFile(path.join(project, '.codocs/target.yaml'), 'utf8'),
    ).toBe(original);
  });
});
