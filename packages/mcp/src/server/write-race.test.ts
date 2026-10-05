import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

type Result = {
  success: boolean;
  saved?: boolean;
  changed?: boolean;
  revision?: string;
  indexUpdated?: boolean;
  diagnostics?: { code: string }[];
  results?: {
    conflict: boolean;
    revision: string;
    document?: { definition: string };
    sources?: unknown[];
  }[];
};
let temporary: string;
let project: string;
let gate: string;
let output: string;
let entry: string;
let evidence: unknown[];
let clients: { client: Client; transport: StdioClientTransport }[];
const hash = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  await mkdir('.workbench', { recursive: true });
  temporary = await mkdtemp(path.resolve('.workbench/write-race-'));
  output = path.join(temporary, 'evidence');
  await mkdir(output);
  entry = path.join(temporary, 'instrumented.mjs');
  await build({
    entryPoints: [
      path.resolve('packages/mcp/src/test-support/write-race-child.mjs'),
    ],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: {
      '@codocs/core': path.resolve('packages/core/src/index.ts'),
      '@codocs/workspace': path.resolve('packages/workspace/src/index.ts'),
    },
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  });
});
beforeEach(async () => {
  project = await mkdtemp(path.join(temporary, 'project-'));
  gate = path.join(project, 'gate');
  await mkdir(gate);
  await mkdir(path.join(project, '.codocs'));
  await writeFile(
    path.join(project, '.codocs/a.yaml'),
    '_codocs:\n  id: a\n  name: A\ndefinition: original\n',
  );
  clients = [];
  evidence = [
    {
      kind: 'environment',
      platform: process.platform,
      node: process.version,
      project,
      bundleSha256: hash(await readFile(entry)),
    },
  ];
});
afterEach(async (context) => {
  for (const actor of ['A', 'B'])
    await writeFile(path.join(gate, actor + '.release'), '');
  const cleanup = await Promise.allSettled(
    clients.map(async ({ client, transport }) => {
      const pid = transport.pid;
      await client.close();
      if (pid) expect(() => process.kill(pid, 0)).toThrow();
      return { pid, residual: false };
    }),
  );
  evidence.push({ kind: 'cleanup', cleanup });
  await writeFile(
    path.join(output, context.task.id + '.json'),
    JSON.stringify({ title: context.task.name, evidence }, null, 2),
  );
  await rm(project, { recursive: true, force: true });
  expect(cleanup.every((result) => result.status === 'fulfilled')).toBe(true);
});
afterAll(() => {
  console.log('Write race evidence: ' + output);
});

/** 각 프로세스의 공개 get이 기준 원문을 반환할 때까지 준비를 확인한다. */
async function start(actor: string, stage = ''): Promise<Client> {
  const client = new Client({ name: 'write-race-' + actor, version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: project,
    stderr: 'pipe',
    env: Object.fromEntries([
      ...Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
      ['CODOCS_RACE_GATE', gate],
      ['CODOCS_RACE_STAGE', stage],
      ['CODOCS_RACE_ACTOR', actor],
    ]),
  });
  clients.push({ client, transport });
  await client.connect(transport);
  evidence.push({ kind: 'process', actor, pid: transport.pid, project, stage });
  await expect
    .poll(
      async () =>
        (await call(client, 'codocs_get', { ids: ['a'] })).results?.[0]
          ?.document?.definition,
    )
    .toBe('original');
  return client;
}
/** 도구 요청과 원래 응답을 그대로 보존한다. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Result> {
  evidence.push({
    kind: 'request',
    client: clients.findIndex((item) => item.client === client),
    name,
    args,
  });
  const response = await client.callTool({ name, arguments: args });
  const result = response.structuredContent as Result;
  evidence.push({ kind: 'response', result });
  return result;
}
/** 저장 경계의 완성된 도달 파일을 확인한다. */
async function arrived(actor: string, boundary: string): Promise<void> {
  await expect
    .poll(async () => {
      try {
        return JSON.parse(
          await readFile(path.join(gate, actor + '.arrived'), 'utf8'),
        ) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    })
    .toMatchObject({ actor, boundary, project });
  evidence.push({
    kind: 'arrival',
    actor,
    boundary,
    value: JSON.parse(
      await readFile(path.join(gate, actor + '.arrived'), 'utf8'),
    ) as unknown,
  });
}
async function release(actor: string): Promise<void> {
  evidence.push({ kind: 'release', actor });
  await writeFile(path.join(gate, actor + '.release'), '');
}
async function bytes(relative = '.codocs/a.yaml'): Promise<Buffer> {
  const value = await readFile(path.join(project, relative));
  const identity = await stat(path.join(project, relative));
  evidence.push({
    kind: 'file',
    relative,
    bytes: value.toString(),
    sha256: hash(value),
    identity: {
      dev: identity.dev,
      ino: identity.ino,
      size: identity.size,
      mtimeMs: identity.mtimeMs,
      ctimeMs: identity.ctimeMs,
    },
  });
  return value;
}

describe('실제 독립 MCP 작성자의 저장 경계', () => {
  it('다른 작성자가 저장한 뒤 이전 revision을 요청하면 후보 계산에서 거부하고 최신 파일을 보존한다', async () => {
    const a = await start('A');
    const b = await start('B');
    const revision = hash(await bytes());
    expect(
      await call(a, 'codocs_write', {
        mode: 'update',
        id: 'a',
        revision,
        set: { definition: 'writer A' },
      }),
    ).toMatchObject({ success: true, saved: true });
    await expect
      .poll(
        async () =>
          (await call(b, 'codocs_get', { ids: ['a'] })).results?.[0]?.document
            ?.definition,
      )
      .toBe('writer A');
    const before = await bytes();
    const staleRequest = {
      mode: 'update',
      id: 'a',
      revision,
      set: { definition: 'stale B' },
    };
    const deadline = Date.now() + 15000;
    let rejected = await call(b, 'codocs_write', staleRequest);
    // get의 마지막 완료 snapshot은 다음 쓰기 시점의 준비 상태를 보장하지 않는다.
    // 미저장·무변경 준비 응답만 같은 stale revision으로 제한 재요청한다.
    while (
      rejected.success === false &&
      rejected.saved === false &&
      rejected.changed === false &&
      rejected.diagnostics?.length === 1 &&
      rejected.diagnostics[0]?.code === 'index_not_ready' &&
      Date.now() < deadline
    ) {
      expect(await bytes()).toEqual(before);
      await delay(25);
      rejected = await call(b, 'codocs_write', staleRequest);
    }
    expect(rejected).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      diagnostics: [{ code: 'change_revision_mismatch' }],
    });
    expect(await bytes()).toEqual(before);
  });
  it('수정 후보 계산 뒤 다른 작성자가 저장하면 디스크 직전 revision 검사에서 거부하고 파일을 보존한다', async () => {
    const a = await start('A');
    const b = await start('B', 'beforeApply');
    const revision = hash(await bytes());
    const waiting = call(b, 'codocs_write', {
      mode: 'update',
      id: 'a',
      revision,
      set: { definition: 'stale B' },
    });
    await arrived('B', 'beforeApply');
    expect(
      await call(a, 'codocs_write', {
        mode: 'update',
        id: 'a',
        revision,
        set: { definition: 'writer A' },
      }),
    ).toMatchObject({ saved: true });
    const before = await bytes();
    await release('B');
    expect(await waiting).toMatchObject({
      success: false,
      saved: false,
      diagnostics: [{ code: 'revision_conflict' }],
    });
    expect(await bytes()).toEqual(before);
  });
  it('같은 경로의 두 create가 link에 도달하면 뒤 저장을 거부하고 첫 파일을 보존한다', async () => {
    const a = await start('A', 'link');
    const b = await start('B', 'link');
    const first = call(a, 'codocs_write', {
      mode: 'create',
      path: '.codocs/new.yaml',
      document: {
        _codocs: { id: 'new-a', name: 'New A' },
        definition: 'first',
      },
    });
    const second = call(b, 'codocs_write', {
      mode: 'create',
      path: '.codocs/new.yaml',
      document: {
        _codocs: { id: 'new-b', name: 'New B' },
        definition: 'second',
      },
    });
    await Promise.all([arrived('A', 'link'), arrived('B', 'link')]);
    await release('A');
    const saved = await first;
    const before = await bytes('.codocs/new.yaml');
    expect(saved).toMatchObject({
      success: true,
      saved: true,
      revision: hash(before),
    });
    await release('B');
    expect(await second).toMatchObject({
      success: false,
      saved: false,
      diagnostics: [{ code: 'file_exists' }],
    });
    expect(await bytes('.codocs/new.yaml')).toEqual(before);
  });
  it('같은 revision의 두 update가 rename에 도달하면 순서대로 저장하고 마지막 본문을 양쪽에서 조회한다', async () => {
    const a = await start('A', 'rename');
    const b = await start('B', 'rename');
    const revision = hash(await bytes());
    const first = call(a, 'codocs_write', {
      mode: 'update',
      id: 'a',
      revision,
      set: { definition: 'writer A' },
    });
    const second = call(b, 'codocs_write', {
      mode: 'update',
      id: 'a',
      revision,
      set: { definition: 'writer B' },
    });
    await Promise.all([arrived('A', 'rename'), arrived('B', 'rename')]);
    await release('A');
    const savedA = await first;
    const middle = await bytes();
    expect(middle.toString()).toContain('writer A');
    expect(savedA).toMatchObject({
      success: true,
      saved: true,
      revision: hash(middle),
    });
    await release('B');
    const savedB = await second;
    const final = await bytes();
    expect(final.toString()).toContain('writer B');
    expect(savedB).toMatchObject({
      success: true,
      saved: true,
      revision: hash(final),
    });
    for (const client of [a, b])
      await expect
        .poll(
          async () =>
            (await call(client, 'codocs_get', { ids: ['a'] })).results?.[0],
          { timeout: 15000 },
        )
        .toMatchObject({
          revision: hash(final),
          document: { definition: 'writer B' },
        });
  });
  it('다른 경로의 동일 ID create가 최종 검사를 통과하면 두 파일과 충돌 조회를 남긴다', async () => {
    const a = await start('A', 'link');
    const b = await start('B', 'link');
    const first = call(a, 'codocs_write', {
      mode: 'create',
      path: '.codocs/one.yaml',
      document: { _codocs: { id: 'shared', name: 'One' }, definition: 'first' },
    });
    const second = call(b, 'codocs_write', {
      mode: 'create',
      path: '.codocs/two.yaml',
      document: {
        _codocs: { id: 'shared', name: 'Two' },
        definition: 'second',
      },
    });
    await Promise.all([arrived('A', 'link'), arrived('B', 'link')]);
    await release('A');
    expect(await first).toMatchObject({ saved: true });
    await release('B');
    expect(await second).toMatchObject({ saved: true });
    expect((await bytes('.codocs/one.yaml')).toString()).toContain('first');
    expect((await bytes('.codocs/two.yaml')).toString()).toContain('second');
    for (const client of [a, b])
      await expect
        .poll(
          async () =>
            (await call(client, 'codocs_get', { ids: ['shared'] })).results?.[0]
              ?.conflict,
        )
        .toBe(true);
  });
});
