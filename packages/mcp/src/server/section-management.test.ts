import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSourceCli } from '../../test-support/source-cli.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

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
  project = await mkdtemp(path.resolve('.workbench/mcp-sections-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, name)), { recursive: true });
    await writeFile(path.join(project, name), text);
  }
  client = new Client({ name: 'section-test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [sourceCli.entry],
      cwd: project,
      stderr: 'pipe',
    }),
  );
}

type Reply = Record<string, unknown> & {
  success: boolean;
  diagnostics?: {
    code: string;
    severity?: string;
    path?: string;
    range?: unknown;
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

const refund =
  '# 상단 주석\n_codocs:\n  id: refund\n  name: 환불\n환불정책: |\n  정책 본문\n예시: |\n  예시 본문\n';
const policy =
  '_codocs:\n  id: policy\n  name: 정책\ndefinition: "[[환불:환불정책]]을 따른다"\n';

describe('도구 목록과 폐기된 duplicates', () => {
  it('codocs_duplicates를 나열하지 않고 호출하면 알 수 없는 도구 오류를 반환한다', async () => {
    await start({ '.codocs/refund.yaml': refund });
    const names = (await client!.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain('codocs_duplicates');
    expect(names).toHaveLength(7);
    await expect(
      client!.callTool({ name: 'codocs_duplicates', arguments: {} }),
    ).rejects.toThrow(/Unknown tool: codocs_duplicates/u);
    const write = (await client!.listTools()).tools.find(
      (tool) => tool.name === 'codocs_write',
    );
    expect(JSON.stringify(write?.inputSchema)).toContain('replace');
  });
});

describe('codocs_write replace', () => {
  it('문서 전체를 교체해 생략한 섹션을 삭제하고 최상위 주석을 보존한다', async () => {
    await start({ '.codocs/refund.yaml': refund });
    const revision = await revisionOf('환불');
    const result = await call('codocs_write', {
      mode: 'replace',
      id: 'refund',
      revision,
      document: {
        _codocs: { id: 'refund', name: '환불' },
        환불정책: '정책 본문\n',
      },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    const text = await read('.codocs/refund.yaml');
    expect(text).toContain('# 상단 주석');
    expect(text).not.toContain('예시');
    expect(text).toContain('환불정책');
  });

  it('같은 내용의 교체는 변경 없음으로 파일을 바꾸지 않는다', async () => {
    await start({ '.codocs/refund.yaml': refund });
    const result = await call('codocs_write', {
      mode: 'replace',
      id: 'refund',
      revision: await revisionOf('환불'),
      document: {
        _codocs: { id: 'refund', name: '환불' },
        예시: '예시 본문\n',
        환불정책: '정책 본문\n',
      },
    });
    expect(result).toMatchObject({ success: true, changed: false });
    expect(await read('.codocs/refund.yaml')).toBe(refund);
  });

  it('replace에 set·unset을 섞거나 알 수 없는 속성이 있으면 입력 오류이며 파일을 바꾸지 않는다', async () => {
    await start({ '.codocs/refund.yaml': refund });
    const revision = await revisionOf('환불');
    const document = { _codocs: { id: 'refund', name: '환불' } };
    for (const extra of [{ set: { a: 1 } }, { unset: ['예시'] }, { x: 1 }])
      expect(
        await call('codocs_write', {
          mode: 'replace',
          id: 'refund',
          revision,
          document,
          ...extra,
        }),
      ).toMatchObject({
        success: false,
        saved: false,
        error: { code: 'invalid_input' },
      });
    expect(await read('.codocs/refund.yaml')).toBe(refund);
  });

  it('교체가 다른 문서의 섹션 참조를 새로 깨뜨리면 reference_broken으로 거절하고 원문을 보존한다', async () => {
    await start({
      '.codocs/refund.yaml': refund,
      '.codocs/policy.yaml': policy,
    });
    const result = await call('codocs_write', {
      mode: 'replace',
      id: 'refund',
      revision: await revisionOf('환불'),
      document: {
        _codocs: { id: 'refund', name: '환불' },
        예시: '예시 본문\n',
      },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'reference_broken' },
    });
    expect(await read('.codocs/refund.yaml')).toBe(refund);
    expect(await read('.codocs/policy.yaml')).toBe(policy);
  });

  it('교체가 코드 파일의 @codocs 섹션 참조를 새로 깨뜨리면 reference_broken으로 거절한다', async () => {
    const code = '// @codocs [[환불:예시]]\nexport const a = 1;\n';
    await start({ '.codocs/refund.yaml': refund, 'src/a.ts': code });
    const result = await call('codocs_write', {
      mode: 'replace',
      id: 'refund',
      revision: await revisionOf('환불'),
      document: {
        _codocs: { id: 'refund', name: '환불' },
        환불정책: '정책 본문\n',
      },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'reference_broken' },
    });
    expect(await read('.codocs/refund.yaml')).toBe(refund);
    expect(await read('src/a.ts')).toBe(code);
  });

  it('이전부터 있던 무관한 오류는 교체를 막지 않는다', async () => {
    await start({
      '.codocs/refund.yaml': refund,
      '.codocs/broken.yaml':
        '_codocs:\n  id: broken\n  name: 깨짐\ndefinition: "[[없는문서]]"\n',
    });
    const result = await call('codocs_write', {
      mode: 'replace',
      id: 'refund',
      revision: await revisionOf('환불'),
      document: {
        _codocs: { id: 'refund', name: '환불' },
        환불정책: '다른 본문\n',
        예시: '예시 본문\n',
      },
    });
    expect(result).toMatchObject({ success: true, saved: true });
  });

  it('오래된 revision의 교체는 revision을 바꿔 재시도하지 않고 거절한다', async () => {
    await start({ '.codocs/refund.yaml': refund });
    const result = await call('codocs_write', {
      mode: 'replace',
      id: 'refund',
      revision: 'stale',
      document: { _codocs: { id: 'refund', name: '환불' } },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'change_revision_mismatch' },
    });
    expect(await read('.codocs/refund.yaml')).toBe(refund);
  });
});

describe('codocs_validate와 codocs_refresh의 코드 참조', () => {
  const brokenCode = '// @codocs [[환불:없는섹션]]\nexport const a = 1;\n';

  it('전체 검증은 코드 파일 경로와 위치를 가진 오류와 코드 수집 상태를 반환한다', async () => {
    await start({ '.codocs/refund.yaml': refund, 'src/a.ts': brokenCode });
    const result = await call('codocs_validate', {});
    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      codeScanStatus: 'complete',
      diagnosticsComplete: true,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'codocs.codeReference.missing_section',
        path: 'src/a.ts',
        range: expect.anything() as unknown,
      }),
    );
  });

  it('YAML 경로 검증은 그 YAML을 후보로 하는 코드 진단만 포함하고 코드 경로는 거절한다', async () => {
    await start({
      '.codocs/refund.yaml': refund,
      '.codocs/policy.yaml': policy,
      'src/a.ts': brokenCode,
    });
    const own = await call('codocs_validate', { path: '.codocs/refund.yaml' });
    expect(own.diagnostics?.map((item) => item.path)).toContain('src/a.ts');
    const other = await call('codocs_validate', {
      path: '.codocs/policy.yaml',
    });
    expect(other.diagnostics?.map((item) => item.path)).not.toContain(
      'src/a.ts',
    );
    expect(await call('codocs_validate', { path: 'src/a.ts' })).toMatchObject({
      success: false,
      error: { code: 'invalid_path' },
    });
  });

  it('첫 refresh가 코드 색인을 만들고 개수가 반환된 진단과 일치한다', async () => {
    await start({ '.codocs/refund.yaml': refund, 'src/a.ts': brokenCode });
    const result = await call('codocs_refresh', {});
    expect(result).toMatchObject({
      success: true,
      fileCount: 1,
      itemCount: 1,
      codeScanStatus: 'complete',
      countsComplete: true,
    });
    const diagnostics = result.diagnostics!;
    expect(result.errorCount).toBe(
      diagnostics.filter((item) => item.severity === 'error').length,
    );
    expect(result.warningCount).toBe(
      diagnostics.filter((item) => item.severity === 'warning').length,
    );
    expect(result.errorCount).toBeGreaterThan(0);
  });
});
