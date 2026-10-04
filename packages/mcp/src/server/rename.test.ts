import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSourceCli } from '../../test-support/source-cli.js';

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
  await rm(project, { recursive: true, force: true });
});

/** 문서 원문을 가진 임시 프로젝트를 만들고 실제 stdio 서버에 연결한다. */
async function start(files: Record<string, string>): Promise<Client> {
  await mkdir('.workbench', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/mcp-rename-'));
  await mkdir(path.join(project, '.codocs'), { recursive: true });
  for (const [name, text] of Object.entries(files))
    await writeFile(path.join(project, '.codocs', name), text);
  client = new Client({ name: 'rename-test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [sourceCli.entry],
      cwd: project,
      stderr: 'pipe',
    }),
  );
  return client;
}

interface Candidate {
  path: string;
  name?: string;
  domains: string[];
}

/** 테스트가 읽는 응답 필드만 가진 공통 결과 형태다. */
interface Reply {
  success: boolean;
  status: string;
  changes: unknown[];
  files: unknown[];
  conflicts: unknown[];
  impacts: {
    path: string;
    occurrenceIndex: number;
    reason: string;
    before: { candidates: Candidate[] };
  }[];
  revisions: Record<string, string>;
  results: { found: boolean; revision: string; document: { name: string } }[];
}

/** 도구 호출 결과의 JSON 본문과 구조 결과가 같음을 확인하고 꺼낸다. */
async function call(
  tool: string,
  args: Record<string, unknown>,
): Promise<Reply> {
  const response = (await client!.callTool({
    name: tool,
    arguments: args,
  })) as {
    structuredContent: Record<string, unknown>;
    content: { text: string }[];
    isError: boolean;
  };
  expect(JSON.parse(response.content[0]!.text)).toEqual(
    response.structuredContent,
  );
  expect(response.isError).toBe(!response.structuredContent.success);
  return response.structuredContent as unknown as Reply;
}

/** 프로젝트의 .codocs 파일 원문을 읽는다. */
function read(name: string): Promise<string> {
  return readFile(path.join(project, '.codocs', name), 'utf8');
}

/** 문서 원문을 만든다. */
function doc(id: string, name: string, domain: string, body: string): string {
  return `id: ${id}\nname: '${name}'\ndomains:\n  - '${domain}'\ndefinition: |\n  ${body}\n`;
}

const order = doc('order', '주문', '판매', '주문의 의미다.');
const referrer = doc(
  'ref',
  '참조',
  '판매',
  '[[주문]]을 쓰고 [[주문]]을 다시 쓴다.',
);

describe('codocs_rename preview', () => {
  it('preview는 파일을 바꾸지 않고 상태·변경 목록·파일별 revisions를 반환한다', async () => {
    await start({ 'order.yaml': order, 'ref.yaml': referrer });
    const result = await call('codocs_rename', {
      mode: 'preview',
      id: 'order',
      newName: '새주문',
    });
    expect(result).toMatchObject({
      success: true,
      status: 'ready',
      oldName: '주문',
      newName: '새주문',
      impacts: [],
      conflicts: [],
    });
    expect(result.changes).toHaveLength(3);
    expect(Object.keys(result.revisions)).toHaveLength(2);
    expect(await read('order.yaml')).toBe(order);
    expect(await read('ref.yaml')).toBe(referrer);
  });

  it('원래 모호한 참조는 후보의 도메인·이름·경로와 영향 이유를 반환한다', async () => {
    await start({
      'order.yaml': order,
      'other.yaml': doc('other-order', '주문', '물류', '다른 주문이다.'),
      'ref.yaml': referrer,
    });
    const result = await call('codocs_rename', {
      mode: 'preview',
      id: 'order',
      newName: '새주문',
    });
    expect(result.status).toBe('unresolved');
    expect(result.changes).toHaveLength(1);
    expect(result.impacts).toHaveLength(2);
    const first = result.impacts[0]!;
    expect(first.reason).toBe('changed_resolution');
    expect(
      first.before.candidates
        .map((item) => [item.name, item.domains[0]])
        .sort(),
    ).toEqual([
      ['주문', '물류'],
      ['주문', '판매'],
    ]);
    expect(first.before.candidates.every((item) => item.path)).toBe(true);
  });

  it('같은 도메인에 새 이름의 문서가 있으면 blocked와 충돌을 반환하고 파일을 바꾸지 않는다', async () => {
    await start({
      'order.yaml': order,
      'taken.yaml': doc('taken', '새주문', '판매', '이미 있다.'),
      'ref.yaml': referrer,
    });
    const result = await call('codocs_rename', {
      mode: 'preview',
      id: 'order',
      newName: '새주문',
    });
    expect(result).toMatchObject({
      success: true,
      status: 'blocked',
      blockingReason: 'name_conflict',
    });
    expect(result.conflicts).toHaveLength(1);
    expect(await read('order.yaml')).toBe(order);
  });

  it('없는 ID이면 not_found로 실패한다', async () => {
    await start({ 'order.yaml': order });
    expect(
      await call('codocs_rename', {
        mode: 'preview',
        id: 'missing',
        newName: '새주문',
      }),
    ).toMatchObject({ success: false, error: { code: 'not_found' } });
  });
});

describe('codocs_rename apply', () => {
  it('preview의 revisions를 그대로 보내면 이름과 참조를 고치고 색인 반영을 알린다', async () => {
    await start({ 'order.yaml': order, 'ref.yaml': referrer });
    const input = { id: 'order', newName: '새주문' };
    const preview = await call('codocs_rename', { mode: 'preview', ...input });
    const result = await call('codocs_rename', {
      mode: 'apply',
      ...input,
      revisions: preview.revisions,
    });
    expect(result).toMatchObject({
      success: true,
      status: 'ready',
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    expect(result.files).toHaveLength(2);
    expect(await read('ref.yaml')).toContain('[[새주문]]을 쓰고 [[새주문]]을');
    expect(await read('order.yaml')).toContain("name: '새주문'");
    expect(
      (await call('codocs_get', { ids: ['order'] })).results[0]!.document.name,
    ).toBe('새주문');
  });

  it('원래 모호한 참조는 선택이 없으면 원문 그대로 두고 unresolved로 반영한다', async () => {
    await start({
      'order.yaml': order,
      'other.yaml': doc('other-order', '주문', '물류', '다른 주문이다.'),
      'ref.yaml': referrer,
    });
    const input = { id: 'order', newName: '새주문' };
    const preview = await call('codocs_rename', { mode: 'preview', ...input });
    const result = await call('codocs_rename', {
      mode: 'apply',
      ...input,
      revisions: preview.revisions,
    });
    expect(result).toMatchObject({ success: true, status: 'unresolved' });
    expect(result.impacts).toHaveLength(2);
    expect(await read('ref.yaml')).toBe(referrer);
    expect(await read('order.yaml')).toContain("name: '새주문'");
  });

  it('preview가 준 경로로 대상을 고르면 선택한 참조만 선택 대상 기준으로 고친다', async () => {
    await start({
      'order.yaml': order,
      'other.yaml': doc('other-order', '주문', '물류', '다른 주문이다.'),
      'ref.yaml': referrer,
    });
    const input = { id: 'order', newName: '새주문' };
    const preview = await call('codocs_rename', { mode: 'preview', ...input });
    const first = preview.impacts[0]!;
    const picked = first.before.candidates.find(
      (item) => item.domains[0] === '판매',
    );
    const result = await call('codocs_rename', {
      mode: 'apply',
      ...input,
      selections: [
        {
          sourcePath: first.path,
          occurrenceIndex: first.occurrenceIndex,
          targetPath: picked!.path,
        },
      ],
      revisions: preview.revisions,
    });
    expect(result).toMatchObject({ success: true, status: 'unresolved' });
    expect(await read('ref.yaml')).toContain('[[새주문]]을 쓰고 [[주문]]을');
  });

  it('같은 도메인에 새 이름의 문서가 있으면 rename_blocked로 거절하고 파일을 바꾸지 않는다', async () => {
    await start({
      'order.yaml': order,
      'taken.yaml': doc('taken', '새주문', '판매', '이미 있다.'),
      'ref.yaml': referrer,
    });
    const input = { id: 'order', newName: '새주문' };
    const preview = await call('codocs_rename', { mode: 'preview', ...input });
    const result = await call('codocs_rename', {
      mode: 'apply',
      ...input,
      revisions: preview.revisions,
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'rename_blocked' },
      preview: { status: 'blocked' },
    });
    expect(await read('order.yaml')).toBe(order);
    expect(await read('ref.yaml')).toBe(referrer);
  });

  it('preview 뒤 영향 파일을 바꾸면 revision_conflict로 거절하고 아무 파일도 바꾸지 않는다', async () => {
    await start({ 'order.yaml': order, 'ref.yaml': referrer });
    const input = { id: 'order', newName: '새주문' };
    const preview = await call('codocs_rename', { mode: 'preview', ...input });
    const edited = `${referrer}# 사람이 고침\n`;
    await writeFile(path.join(project, '.codocs', 'ref.yaml'), edited);
    const result = await call('codocs_rename', {
      mode: 'apply',
      ...input,
      revisions: preview.revisions,
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'revision_conflict' },
    });
    expect(await read('ref.yaml')).toBe(edited);
    expect(await read('order.yaml')).toBe(order);
  });

  it('preview 뒤 영향 파일 집합이 달라지면 rename_affected_files_changed로 거절한다', async () => {
    await start({ 'order.yaml': order, 'ref.yaml': referrer });
    const input = { id: 'order', newName: '새주문' };
    const preview = await call('codocs_rename', { mode: 'preview', ...input });
    const added = doc('late', '늦은 문서', '판매', '[[주문]]을 쓴다.');
    await writeFile(path.join(project, '.codocs', 'late.yaml'), added);
    // 감시가 새 파일을 색인에 반영할 때까지 최신 상태를 조회로 확인한다.
    for (let attempt = 0; attempt < 100; attempt++) {
      const seen = await call('codocs_get', { ids: ['late'] });
      if (seen.results[0]!.found) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const result = await call('codocs_rename', {
      mode: 'apply',
      ...input,
      revisions: preview.revisions,
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'rename_affected_files_changed' },
    });
    expect(await read('late.yaml')).toBe(added);
    expect(await read('order.yaml')).toBe(order);
  });

  it('revisions가 없는 apply는 invalid_input이며 파일을 바꾸지 않는다', async () => {
    await start({ 'order.yaml': order, 'ref.yaml': referrer });
    const result = await call('codocs_rename', {
      mode: 'apply',
      id: 'order',
      newName: '새주문',
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'invalid_input' },
    });
    expect(await read('order.yaml')).toBe(order);
  });

  it('없는 ID의 apply는 not_found로 실패한다', async () => {
    await start({ 'order.yaml': order });
    expect(
      await call('codocs_rename', {
        mode: 'apply',
        id: 'missing',
        newName: '새주문',
        revisions: { 'x.yaml': 'r' },
      }),
    ).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'not_found' },
    });
  });
});

describe('codocs_write의 이름 변경 거부', () => {
  it('update의 set.name이 현재 이름과 다르면 저장하지 않고 codocs_rename을 안내한다', async () => {
    await start({ 'order.yaml': order });
    const fetched = await call('codocs_get', { ids: ['order'] });
    const result = await call('codocs_write', {
      mode: 'update',
      id: 'order',
      revision: fetched.results[0]!.revision,
      set: { name: '새주문' },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'name_change_not_allowed' },
    });
    expect(JSON.stringify(result)).toContain('codocs_rename');
    expect(await read('order.yaml')).toBe(order);
  });

  it('update의 set.name이 현재 이름과 같으면 변경 없음으로 처리한다', async () => {
    await start({ 'order.yaml': order });
    const fetched = await call('codocs_get', { ids: ['order'] });
    expect(
      await call('codocs_write', {
        mode: 'update',
        id: 'order',
        revision: fetched.results[0]!.revision,
        set: { name: '주문' },
      }),
    ).toMatchObject({ success: true, saved: false, changed: false });
  });
});
