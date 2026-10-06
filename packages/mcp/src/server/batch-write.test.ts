import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSourceCli } from '../../test-support/source-cli.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

/** 요청의 `/` 구분 경로를 서버가 결과에 담는 OS 구분자 표기로 바꾼다. */
const native = (requestPath: string): string =>
  path.join(...requestPath.split('/'));

let sourceCli: Awaited<ReturnType<typeof createSourceCli>>;
let project: string;
let client: Client | undefined;

beforeAll(async () => {
  sourceCli = await createSourceCli();
});
afterAll(async () => {
  await sourceCli.close();
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  await rmWithRetry(project, { recursive: true, force: true });
});

/** 실제 파일을 가진 임시 프로젝트를 만들고 실제 stdio 서버에 연결한다. */
async function start(files: Record<string, string>): Promise<void> {
  await mkdir('.workbench', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/mcp-batch-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, name)), { recursive: true });
    await writeFile(path.join(project, name), text);
  }
  client = new Client({ name: 'batch-test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [sourceCli.entry],
      cwd: project,
      stderr: 'pipe',
    }),
  );
}

interface ChangeResult {
  index: number;
  mode: string;
  id: string;
  path: string;
  previousPath?: string;
  state: string;
  revision?: string;
}

type Reply = Record<string, unknown> & {
  success: boolean;
  changes?: ChangeResult[];
  diagnostics?: {
    code: string;
    path?: string;
    fieldPath?: unknown[];
  }[];
  error?: { code: string };
};

/** 도구 호출 결과의 JSON 본문과 구조 결과가 같음을 확인하고 꺼낸다. */
async function call(
  tool: string,
  args: Record<string, unknown>,
): Promise<Reply> {
  const response = (await client!.callTool({
    name: tool,
    arguments: args,
  })) as unknown as {
    structuredContent: Reply;
    content: { text: string }[];
    isError: boolean;
  };
  expect(JSON.parse(response.content[0]!.text)).toEqual(
    response.structuredContent,
  );
  expect(response.isError).toBe(!response.structuredContent.success);
  return response.structuredContent;
}

/** 이름으로 최신 revision을 조회한다. */
async function revisionOf(name: string): Promise<string> {
  const got = await call('codocs_get', { addresses: [name] });
  return (got.results as { revision: string }[])[0]!.revision;
}

/** 프로젝트 안 파일 원문을 읽는다. */
function read(name: string): Promise<string> {
  return readFile(path.join(project, name), 'utf8');
}

/** 프로젝트 안 경로가 있는지 확인한다. */
async function exists(name: string): Promise<boolean> {
  try {
    await access(path.join(project, name));
    return true;
  } catch {
    return false;
  }
}

/** 이름 주소를 조회했을 때 문서가 있는지 확인한다. */
async function found(name: string): Promise<boolean> {
  const got = await call('codocs_get', { addresses: [name] });
  return (got.results as { status?: string; document?: unknown }[]).every(
    (item) => item.document !== undefined,
  );
}

/** 파일 구조가 바뀐 직후 감시기가 시작한 색인 재구성이 끝날 때까지 기다린 뒤 전체 검증 결과를 꺼낸다. */
async function validateSettled(): Promise<Reply> {
  // 느린 CI에서 재구성이 늦어도 기다리고, 끝내 준비되지 않으면 다른 단정과 섞이지 않게 여기서 실패한다.
  const deadline = Date.now() + 10_000;
  for (;;) {
    const result = await call('codocs_validate', {});
    if (result.error?.code !== 'index_not_ready') return result;
    if (Date.now() >= deadline)
      throw new Error('색인 재구성이 10초 안에 끝나지 않았습니다.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const doc = (id: string, name: string, body: string, parent = ''): string =>
  `_codocs:\n  id: ${id}\n  name: ${name}\n${parent}definition: "${body}"\n`;
const a = doc('a', '가상A', 'A 본문');
const b = doc('b', '가상B', 'B 본문');
const c = doc('c', '가상C', 'C 본문');
const files = {
  '.codocs/a.yaml': a,
  '.codocs/b.yaml': b,
  '.codocs/c.yaml': c,
};
const refA = (id: string, name: string, revision: string) => ({
  mode: 'update',
  id,
  revision,
  set: { definition: `${name} 본문은 [[가상A]]를 따른다` },
});

describe('도구 목록의 codocs_write 입력', () => {
  it('최상위 type이 object이고 changes·delete·move를 노출한다', async () => {
    await start(files);
    const write = (await client!.listTools()).tools.find(
      (tool) => tool.name === 'codocs_write',
    )!;
    expect(write.inputSchema.type).toBe('object');
    const text = JSON.stringify(write.inputSchema);
    for (const word of ['changes', 'delete', 'move'])
      expect(text).toContain(word);
    expect(write.description).toContain('changes');
  });
});

describe('codocs_write changes 저장', () => {
  it('새 문서를 만들고 기존 두 문서가 그 문서를 참조하도록 고치는 요청을 한 번에 저장한다', async () => {
    await start({ '.codocs/b.yaml': b, '.codocs/c.yaml': c });
    const result = await call('codocs_write', {
      changes: [
        {
          mode: 'create',
          path: '.codocs/a.yaml',
          document: {
            _codocs: { id: 'a', name: '가상A' },
            definition: 'A 본문',
          },
        },
        refA('b', '가상B', await revisionOf('가상B')),
        refA('c', '가상C', await revisionOf('가상C')),
      ],
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    expect(
      result.changes?.map((item) => [item.index, item.mode, item.state]),
    ).toEqual([
      [0, 'create', 'changed'],
      [1, 'update', 'changed'],
      [2, 'update', 'changed'],
    ]);
    expect(result.changes?.every((item) => item.revision)).toBe(true);
    expect(await read('.codocs/b.yaml')).toContain('[[가상A]]');
    expect(await found('가상A')).toBe(true);
    expect(await validateSettled()).toMatchObject({
      diagnostics: [],
    });
  });

  it('한 항목에 검증 오류가 있으면 아무것도 저장하지 않고 모든 파일을 그대로 둔다', async () => {
    await start(files);
    const result = await call('codocs_write', {
      changes: [
        refA('b', '가상B', await revisionOf('가상B')),
        {
          mode: 'update',
          id: 'c',
          revision: await revisionOf('가상C'),
          set: { definition: '[[없는문서]]를 따른다' },
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
    });
    expect(await read('.codocs/a.yaml')).toBe(a);
    expect(await read('.codocs/b.yaml')).toBe(b);
    expect(await read('.codocs/c.yaml')).toBe(c);
  });

  it('두 문서의 revision이 오래되면 두 문서를 모두 진단하고 저장하지 않는다', async () => {
    await start(files);
    const result = await call('codocs_write', {
      changes: [
        {
          mode: 'update',
          id: 'b',
          revision: 'stale',
          set: { definition: 'x' },
        },
        {
          mode: 'update',
          id: 'c',
          revision: 'stale',
          set: { definition: 'y' },
        },
      ],
    });
    expect(result).toMatchObject({ success: false, saved: false });
    const mismatches = result.diagnostics!.filter(
      (item) => item.code === 'change_revision_mismatch',
    );
    expect(mismatches.map((item) => item.path).sort()).toEqual([
      native('.codocs/b.yaml'),
      native('.codocs/c.yaml'),
    ]);
    expect(await read('.codocs/b.yaml')).toBe(b);
    expect(await read('.codocs/c.yaml')).toBe(c);
  });

  it('빈 changes와 알 수 없는 최상위 속성은 invalid_input이며 파일을 바꾸지 않는다', async () => {
    await start(files);
    const revision = await revisionOf('가상B');
    const item = { mode: 'delete', id: 'b', revision };
    for (const input of [
      { changes: [] },
      { changes: [item], extra: true },
      { changes: [item], mode: 'delete' },
    ])
      expect(await call('codocs_write', input)).toMatchObject({
        success: false,
        saved: false,
        error: { code: 'invalid_input' },
      });
    expect(await read('.codocs/b.yaml')).toBe(b);
  });

  it('같은 문서 ID나 같은 경로가 두 번 나오면 invalid_input으로 전체를 거부한다', async () => {
    await start(files);
    const revision = await revisionOf('가상B');
    const update = {
      mode: 'update',
      id: 'b',
      revision,
      set: { definition: 'x' },
    };
    expect(
      await call('codocs_write', { changes: [update, { ...update }] }),
    ).toMatchObject({ success: false, error: { code: 'invalid_input' } });
    expect(
      await call('codocs_write', {
        changes: [
          { mode: 'move', id: 'b', revision, path: '.codocs/z.yaml' },
          {
            mode: 'create',
            path: '.codocs/z.yaml',
            document: { _codocs: { id: 'z', name: '가상Z' }, definition: 'z' },
          },
        ],
      }),
    ).toMatchObject({ success: false, error: { code: 'invalid_input' } });
    expect(await read('.codocs/b.yaml')).toBe(b);
    expect(await exists('.codocs/z.yaml')).toBe(false);
  });

  it('항목에서 name을 바꾸면 name_change_not_allowed로 거부한다', async () => {
    await start(files);
    const result = await call('codocs_write', {
      changes: [
        {
          mode: 'update',
          id: 'b',
          revision: await revisionOf('가상B'),
          set: { _codocs: { id: 'b', name: '새이름' } },
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'name_change_not_allowed' },
    });
    expect(await read('.codocs/b.yaml')).toBe(b);
  });
});

describe('codocs_write delete', () => {
  const refB = doc('b', '가상B', '[[가상A]]를 따른다');

  it('다른 문서가 참조하는 문서의 삭제는 reference_broken으로 거부하고 파일을 남긴다', async () => {
    await start({ '.codocs/a.yaml': a, '.codocs/b.yaml': refB });
    const result = await call('codocs_write', {
      mode: 'delete',
      id: 'a',
      revision: await revisionOf('가상A'),
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'reference_broken' },
    });
    expect(await read('.codocs/a.yaml')).toBe(a);
  });

  it('코드 파일이 @codocs로 참조하는 문서의 삭제는 거부한다', async () => {
    await start({
      '.codocs/a.yaml': a,
      'src/x.ts': '// @codocs [[가상A]]\nexport const x = 1;\n',
    });
    const result = await call('codocs_write', {
      mode: 'delete',
      id: 'a',
      revision: await revisionOf('가상A'),
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: 'reference_broken' },
    });
    expect(await read('.codocs/a.yaml')).toBe(a);
  });

  it('같은 요청에서 참조를 함께 고치면 삭제해 저장하고 색인에서 뺀다', async () => {
    await start({ '.codocs/a.yaml': a, '.codocs/b.yaml': refB });
    const result = await call('codocs_write', {
      changes: [
        { mode: 'delete', id: 'a', revision: await revisionOf('가상A') },
        {
          mode: 'update',
          id: 'b',
          revision: await revisionOf('가상B'),
          set: { definition: '독립 본문' },
        },
      ],
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    expect(result.changes).toMatchObject([
      {
        mode: 'delete',
        id: 'a',
        path: native('.codocs/a.yaml'),
        state: 'changed',
      },
      { mode: 'update', id: 'b', state: 'changed' },
    ]);
    expect(result.changes![0]!.revision).toBeUndefined();
    expect(await exists('.codocs/a.yaml')).toBe(false);
    expect(await found('가상A')).toBe(false);
  });

  it('단일 delete 요청도 저장하고 비게 된 폴더는 .codocs 바로 아래까지 제거하되 원래 빈 폴더는 남긴다', async () => {
    await start({
      '.codocs/x/y/a.yaml': a,
      '.codocs/b.yaml': b,
    });
    await mkdir(path.join(project, '.codocs/empty'));
    const result = await call('codocs_write', {
      mode: 'delete',
      id: 'a',
      revision: await revisionOf('가상A'),
    });
    expect(result).toMatchObject({ success: true, saved: true, id: 'a' });
    expect(await exists('.codocs/x')).toBe(false);
    expect(await exists('.codocs/empty')).toBe(true);
    expect((await readdir(path.join(project, '.codocs'))).sort()).toEqual([
      'b.yaml',
      'empty',
    ]);
  });

  it('자식 문서의 parent가 새로 끊기는 삭제는 거부하고 자식 위치를 진단에 담으며 자식도 함께 삭제하면 저장한다', async () => {
    const child = doc('c', '가상C', 'C 본문', '  parent:\n    - 가상A\n');
    await start({ '.codocs/a.yaml': a, '.codocs/c.yaml': child });
    const revisionA = await revisionOf('가상A');
    const rejected = await call('codocs_write', {
      mode: 'delete',
      id: 'a',
      revision: revisionA,
    });
    expect(rejected).toMatchObject({
      success: false,
      error: { code: 'reference_broken' },
    });
    expect(rejected.diagnostics).toContainEqual(
      expect.objectContaining({
        path: native('.codocs/c.yaml'),
        fieldPath: ['_codocs', 'parent', 0],
      }),
    );
    expect(await read('.codocs/a.yaml')).toBe(a);
    const saved = await call('codocs_write', {
      changes: [
        { mode: 'delete', id: 'a', revision: revisionA },
        { mode: 'delete', id: 'c', revision: await revisionOf('가상C') },
      ],
    });
    expect(saved).toMatchObject({ success: true, saved: true });
    expect(await exists('.codocs/a.yaml')).toBe(false);
    expect(await exists('.codocs/c.yaml')).toBe(false);
  });
});

describe('codocs_write move', () => {
  it('문서를 새 경로로 옮겨도 같은 이름으로 조회되고 참조가 유지된다', async () => {
    const refB = doc('b', '가상B', '[[가상A]]를 따른다');
    await start({ '.codocs/a.yaml': a, '.codocs/b.yaml': refB });
    const result = await call('codocs_write', {
      mode: 'move',
      id: 'a',
      revision: await revisionOf('가상A'),
      path: '.codocs/moved/a.yaml',
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      id: 'a',
      previousPath: native('.codocs/a.yaml'),
      source: { path: native('.codocs/moved/a.yaml') },
    });
    expect(await read('.codocs/moved/a.yaml')).toBe(a);
    expect(await exists('.codocs/a.yaml')).toBe(false);
    expect(await found('가상A')).toBe(true);
    expect(await validateSettled()).toMatchObject({
      diagnostics: [],
    });
  });

  it('changes 안의 move는 항목 결과에 previousPath를 담고 기존 파일이 있는 경로로의 move는 거부한다', async () => {
    await start(files);
    const moved = await call('codocs_write', {
      changes: [
        {
          mode: 'move',
          id: 'a',
          revision: await revisionOf('가상A'),
          path: '.codocs/sub/a.yaml',
        },
      ],
    });
    expect(moved.changes).toMatchObject([
      {
        mode: 'move',
        id: 'a',
        path: native('.codocs/sub/a.yaml'),
        previousPath: native('.codocs/a.yaml'),
        state: 'changed',
      },
    ]);
    const rejected = await call('codocs_write', {
      mode: 'move',
      id: 'b',
      revision: await revisionOf('가상B'),
      path: '.codocs/c.yaml',
    });
    expect(rejected).toMatchObject({ success: false, saved: false });
    expect(await read('.codocs/b.yaml')).toBe(b);
    expect(await read('.codocs/c.yaml')).toBe(c);
  });
});
