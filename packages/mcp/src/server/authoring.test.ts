import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
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
import { createSourceCli } from '../../test-support/source-cli.js';

let project: string;
let client: Client;
let sourceCli: Awaited<ReturnType<typeof createSourceCli>>;

beforeAll(async () => {
  sourceCli = await createSourceCli();
});
afterAll(async () => {
  await sourceCli.close();
});

beforeEach(async () => {
  await mkdir('.workbench', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/mcp-authoring-'));
  client = new Client({ name: 'authoring-test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [sourceCli.entry],
      cwd: project,
      stderr: 'pipe',
    }),
  );
});
afterEach(async () => {
  await client.close();
  await rm(project, { recursive: true, force: true });
});

/** SDK 결과의 전송 포장과 JSON 본문의 일치를 확인한다. */
function payload(response: unknown): Record<string, unknown> {
  const result = response as {
    structuredContent: Record<string, unknown>;
    content: { type: string; text: string }[];
    isError: boolean;
  };
  expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  expect(result.isError).toBe(!result.structuredContent.success);
  return result.structuredContent;
}

describe('가이드 작성 절차의 실제 MCP와 파일 반영', () => {
  it('최신 get revision으로 선택 section을 unset하면 나머지 원문을 보존하고 검증한다', async () => {
    const document = {
      _codocs: { id: 'a', name: '가상 A' },
      definition: '의미',
      예시: '선택 예문',
    };
    await client.callTool({
      name: 'codocs_write',
      arguments: { mode: 'create', path: '.codocs/a.yaml', document },
    });
    const fetched = payload(
      await client.callTool({
        name: 'codocs_get',
        arguments: { addresses: ['가상 A'] },
      }),
    );
    const before = (fetched.results as { revision: string }[])[0]!;
    const result = payload(
      await client.callTool({
        name: 'codocs_write',
        arguments: {
          mode: 'update',
          id: 'a',
          revision: before.revision,
          unset: ['예시'],
        },
      }),
    );
    const bytes = await readFile(path.join(project, '.codocs/a.yaml'));
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
      revision: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(bytes.toString()).not.toContain('예시:');
    const after = payload(
      await client.callTool({
        name: 'codocs_get',
        arguments: { addresses: ['가상 A'] },
      }),
    );
    expect(after.results).toMatchObject([
      {
        document: {
          _codocs: { id: document._codocs.id, name: document._codocs.name },
          definition: document.definition,
        },
      },
    ]);
    expect(
      payload(
        await client.callTool({ name: 'codocs_validate', arguments: {} }),
      ),
    ).toMatchObject({ success: true, diagnostics: [] });
  });

  it('A 생성 뒤 A 참조 B를 만들고 최신 A에 B를 set하면 양방향 연결을 저장한다', async () => {
    await client.callTool({
      name: 'codocs_write',
      arguments: {
        mode: 'create',
        path: '.codocs/a.yaml',
        document: {
          _codocs: { id: 'a', name: '가상 A' },
          definition: 'A의 의미',
        },
      },
    });
    await client.callTool({
      name: 'codocs_write',
      arguments: {
        mode: 'create',
        path: '.codocs/b.yaml',
        document: {
          _codocs: { id: 'b', name: '가상 B' },
          definition: '[[가상 A]]를 사용하는 절차',
        },
      },
    });
    const fetched = payload(
      await client.callTool({
        name: 'codocs_get',
        arguments: { addresses: ['가상 A'] },
      }),
    );
    const revision = (fetched.results as { revision: string }[])[0]!.revision;
    const result = payload(
      await client.callTool({
        name: 'codocs_write',
        arguments: {
          mode: 'update',
          id: 'a',
          revision,
          set: { definition: 'A의 의미. 사용 절차는 [[가상 B]]에서 확인한다.' },
        },
      }),
    );
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    expect(
      await readFile(path.join(project, '.codocs/a.yaml'), 'utf8'),
    ).toContain('[[가상 B]]');
    expect(
      await readFile(path.join(project, '.codocs/b.yaml'), 'utf8'),
    ).toContain('[[가상 A]]');
    expect(
      payload(
        await client.callTool({
          name: 'codocs_get',
          arguments: { addresses: ['가상 A', '가상 B'] },
        }),
      ).results,
    ).toMatchObject([
      {
        id: 'a',
        references: ['가상 B'],
        referencedBy: ['가상 B'],
      },
      {
        id: 'b',
        references: ['가상 A'],
        referencedBy: ['가상 A'],
      },
    ]);
    expect(
      payload(
        await client.callTool({ name: 'codocs_validate', arguments: {} }),
      ),
    ).toMatchObject({ success: true, diagnostics: [] });
  });

  it('오래된 revision이 거부되면 최신 설명을 재조회하고 검토한 수정으로 다른 변경을 보존한다', async () => {
    const created = payload(
      await client.callTool({
        name: 'codocs_write',
        arguments: {
          mode: 'create',
          path: '.codocs/a.yaml',
          document: {
            _codocs: { id: 'a', name: '가상 A' },
            definition: '초기 설명',
          },
        },
      }),
    );
    await client.callTool({
      name: 'codocs_write',
      arguments: {
        mode: 'update',
        id: 'a',
        revision: created.revision,
        set: { definition: '다른 작성자의 조건' },
      },
    });
    const file = path.join(project, '.codocs/a.yaml');
    const before = await readFile(file);
    const rejected = payload(
      await client.callTool({
        name: 'codocs_write',
        arguments: {
          mode: 'update',
          id: 'a',
          revision: created.revision,
          set: { definition: '내 설명' },
        },
      }),
    );
    expect(rejected).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'change_revision_mismatch' },
    });
    expect(await readFile(file)).toEqual(before);
    const fetched = payload(
      await client.callTool({
        name: 'codocs_get',
        arguments: { addresses: ['가상 A'] },
      }),
    );
    const latest = (
      fetched.results as {
        revision: string;
        document: { definition: string };
      }[]
    )[0]!;
    expect(latest.document.definition).toBe('다른 작성자의 조건');
    const reviewed = latest.document.definition + '. 검토 후 추가한 내 설명';
    const result = payload(
      await client.callTool({
        name: 'codocs_write',
        arguments: {
          mode: 'update',
          id: 'a',
          revision: latest.revision,
          set: { definition: reviewed },
        },
      }),
    );
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    expect(await readFile(file, 'utf8')).toContain(reviewed);
  });
});
