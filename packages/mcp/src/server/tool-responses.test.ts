import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  callWrapped,
  openInProcessProject,
  type InProcessProject,
} from '../../test-support/in-process.js';
import { createCodocsGuideHandler } from '../guide/index.js';
import { sourceGuideRoot } from '../../test-support/in-process.js';

let opened: InProcessProject | undefined;

afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

/** 문서 원문을 만든다. */
function doc(id: string, name: string, body: string): string {
  return `_codocs:\n  id: ${id}\n  name: ${name}\ndefinition: ${JSON.stringify(body)}\n`;
}

const alpha = doc('alpha', 'alpha', '본문');
const order = doc('order', '주문', '주문의 의미다.');
const referrer = doc('ref', '참조', '[[주문]]을 쓴다.');

describe('codocs_list 응답', () => {
  it('최상위 문서를 조회하면 JSON 텍스트와 같은 구조 결과를 오류 없이 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_list',
      {},
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({ success: true, items: [{ id: 'alpha' }] });
  });

  it('없는 parent를 주면 workspace의 not_found를 isError와 함께 전달한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(opened.client, 'codocs_list', {
      parent: 'missing',
    });

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'not_found' },
    });
  });
});

describe('codocs_get 응답', () => {
  it('문서·섹션·없는 이름을 함께 조회하면 항목별 결과를 입력 순서대로 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(opened.client, 'codocs_get', {
      addresses: ['alpha', 'missing', 'alpha:definition'],
    });

    expect(response.isError).toBe(false);
    expect(body.results).toMatchObject([
      { address: 'alpha', found: true, document: { definition: '본문' } },
      {
        address: 'missing',
        found: false,
        diagnostics: [{ code: 'not_found' }],
      },
      {
        address: 'alpha:definition',
        found: true,
        section: { name: 'definition', content: '본문' },
      },
    ]);
  });

  it('큰 정상 문서와 .inf 원문을 혼합 조회해도 본문·직접 참조·revision·진단을 절단 없이 반환한다', async () => {
    const targets = Array.from(
      { length: 20 },
      (_, index) => `target-${String(index).padStart(2, '0')}`,
    );
    const definition = `${targets.map((_, index) => `[[Target ${String(index).padStart(2, '0')}]]`).join(' ')} ${'x'.repeat(500_000)}`;
    const rawYaml = `_codocs:\n  id: invalid\n  name: Invalid\ndefinition: ${'y'.repeat(500_000)}\nvalue: .inf\n`;
    const files: Record<string, string> = {
      '.codocs/normal.yaml': `_codocs:\n  id: normal\n  name: Normal\ndefinition: ${JSON.stringify(definition)}\n`,
      '.codocs/invalid.yaml': rawYaml,
      '.codocs/conflict-a.yaml':
        '_codocs:\n  id: shared\n  name: Conflict A\ndefinition: 본문\n',
      '.codocs/conflict-b.yaml':
        '_codocs:\n  id: shared\n  name: Conflict B\ndefinition: 본문\n',
    };
    for (const [index, id] of targets.entries())
      files[`.codocs/${id}.yaml`] =
        `_codocs:\n  id: ${id}\n  name: Target ${String(index).padStart(2, '0')}\ndefinition: 대상\n`;
    opened = await openInProcessProject('mcp-res-', files);

    const { response, body } = await callWrapped(opened.client, 'codocs_get', {
      addresses: ['Normal', 'Invalid', 'Conflict A', 'Missing'],
    });

    expect(response.isError).toBe(false);
    const results = body.results as Record<string, unknown>[];
    expect(results[0]).toMatchObject({
      found: true,
      document: { definition },
      source: { path: '.codocs/normal.yaml' },
      references: targets.map(
        (_, index) => `Target ${String(index).padStart(2, '0')}`,
      ),
    });
    expect(results[1]).toMatchObject({
      found: true,
      rawYaml,
      source: { path: '.codocs/invalid.yaml' },
    });
    expect(results[1]).not.toHaveProperty('document');
    expect(results[1]?.revision).toBe(
      createHash('sha256').update(Buffer.from(rawYaml, 'utf8')).digest('hex'),
    );
    expect((results[1]?.diagnostics as unknown[]).length).toBeGreaterThan(0);
    expect(results[2]).toMatchObject({
      found: true,
      conflict: true,
      paths: ['.codocs/conflict-a.yaml', '.codocs/conflict-b.yaml'],
    });
    expect(results[3]).toMatchObject({
      found: false,
      diagnostics: [expect.objectContaining({ code: 'not_found' })],
    });
    expect(Buffer.byteLength(response.content[0]!.text)).toBeGreaterThan(
      1_000_000,
    );
  });
});

describe('codocs_search 응답', () => {
  it('걸린 검색어는 address로, 걸리지 않은 검색어는 emptyQueries로 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_search',
      { queries: ['alpha', 'zzzqqq'] },
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({
      success: true,
      scanStatus: 'complete',
      emptyQueries: ['zzzqqq'],
    });
    const items = body.items as { address: string; queries: string[] }[];
    expect(items.map((item) => item.address)).toContain('alpha:definition');
    expect(items[0]?.queries).toEqual(['alpha']);
  });
});

describe('codocs_refresh 응답', () => {
  it('색인을 다시 구성하면 파일 수와 항목 수를 오류 없이 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_refresh',
      {},
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({ success: true, fileCount: 1, itemCount: 1 });
  });
});

describe('codocs_validate 응답', () => {
  it('문서 오류가 없으면 빈 진단을 오류 없이 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_validate',
      {},
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({
      success: true,
      scanStatus: 'complete',
      diagnostics: [],
    });
  });

  it('코드 파일 경로를 주면 workspace의 invalid_path를 isError와 함께 전달한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
      'src/a.ts': 'export const a = 1;\n',
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_validate',
      { path: 'src/a.ts' },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'invalid_path' },
    });
  });
});

describe('codocs_write 응답', () => {
  const created = {
    _codocs: { id: 'beta', name: 'beta' },
    definition: '새 본문',
  };

  it('새 문서를 만들면 저장 결과와 색인 게시를 오류 없이 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_write',
      { mode: 'create', path: '.codocs/beta.yaml', document: created },
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: true,
      source: { path: '.codocs/beta.yaml' },
    });
  });

  it('입력 형식을 어기면 저장하지 않은 invalid_input 실패를 진단과 함께 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_write',
      { changes: [] },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'invalid_input' },
      diagnostics: [{ code: 'invalid_input' }],
    });
  });

  it('오래된 revision이면 workspace의 change_revision_mismatch를 저장 없이 전달한다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/alpha.yaml': alpha,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_write',
      {
        mode: 'update',
        id: 'alpha',
        revision: 'stale',
        set: { definition: 'x' },
      },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'change_revision_mismatch' },
    });
  });
});

describe('codocs_write changes 항목 응답', () => {
  const b = doc('b', '가상B', 'B 본문');
  const c = doc('c', '가상C', 'C 본문');

  it('changes 안의 delete 항목은 문서 경로를 담고 revision은 담지 않는다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/b.yaml': b,
      '.codocs/c.yaml': c,
    });
    const fetched = await callWrapped(opened.client, 'codocs_get', {
      addresses: ['가상B'],
    });
    const revision = (fetched.body.results as { revision: string }[])[0]!
      .revision;

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_write',
      { changes: [{ mode: 'delete', id: 'b', revision }] },
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({
      success: true,
      saved: true,
      changes: [{ index: 0, mode: 'delete', id: 'b', path: '.codocs/b.yaml' }],
    });
    expect((body.changes as object[])[0]).not.toHaveProperty('revision');
  });

  it('changes 안의 move 항목은 새 경로와 previousPath를 담는다', async () => {
    opened = await openInProcessProject('mcp-res-', {
      '.codocs/b.yaml': b,
      '.codocs/c.yaml': c,
    });
    const fetched = await callWrapped(opened.client, 'codocs_get', {
      addresses: ['가상B'],
    });
    const revision = (fetched.body.results as { revision: string }[])[0]!
      .revision;

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_write',
      {
        changes: [
          { mode: 'move', id: 'b', revision, path: '.codocs/sub/b.yaml' },
        ],
      },
    );

    expect(response.isError).toBe(false);
    expect(body.changes).toMatchObject([
      {
        mode: 'move',
        id: 'b',
        path: '.codocs/sub/b.yaml',
        previousPath: '.codocs/b.yaml',
        state: 'changed',
      },
    ]);
  });
});

describe('codocs_rename 응답', () => {
  const request = { id: 'order', newName: '새주문' };
  const files = {
    '.codocs/order.yaml': order,
    '.codocs/ref.yaml': referrer,
  };

  it('preview는 파일을 바꾸지 않고 상태와 파일별 revisions를 오류 없이 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', files);

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_rename',
      { mode: 'preview', ...request },
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({
      success: true,
      status: 'ready',
      oldName: '주문',
      newName: '새주문',
    });
    expect(Object.keys(body.revisions as object)).toHaveLength(2);
  });

  it('preview의 revisions로 apply하면 저장 결과와 파일별 상태를 오류 없이 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', files);
    const preview = await callWrapped(opened.client, 'codocs_rename', {
      mode: 'preview',
      ...request,
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_rename',
      { mode: 'apply', ...request, revisions: preview.body.revisions },
    );

    expect(response.isError).toBe(false);
    expect(body).toMatchObject({
      success: true,
      status: 'ready',
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    expect(body.files).toHaveLength(2);
  });

  it('preview 입력 형식을 어기면 invalid_input 실패를 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', files);

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_rename',
      { mode: 'preview', ...request, extra: true },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'invalid_input' },
    });
    expect(body).not.toHaveProperty('saved');
  });

  it('revisions가 없는 apply는 파일을 바꾸지 않은 invalid_input 실패를 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', files);

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_rename',
      { mode: 'apply', ...request },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      files: [],
      error: { code: 'invalid_input' },
    });
  });

  it('없는 ID의 preview는 not_found 실패를 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', files);

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_rename',
      { mode: 'preview', id: 'missing', newName: '새주문' },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'not_found' },
    });
  });

  it('없는 ID의 apply는 파일을 바꾸지 않은 not_found 실패를 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-', files);

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_rename',
      {
        mode: 'apply',
        id: 'missing',
        newName: '새주문',
        revisions: { '.codocs/order.yaml': 'r' },
      },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      files: [],
      error: { code: 'not_found' },
    });
  });

  it('preview 뒤 영향 파일이 바뀌면 workspace의 revision_conflict를 저장 없이 전달한다', async () => {
    opened = await openInProcessProject('mcp-res-', files);
    const preview = await callWrapped(opened.client, 'codocs_rename', {
      mode: 'preview',
      ...request,
    });
    await writeFile(
      path.join(opened.project, '.codocs/ref.yaml'),
      `${referrer}# 사람이 고침\n`,
    );

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_rename',
      { mode: 'apply', ...request, revisions: preview.body.revisions },
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'revision_conflict' },
    });
  });
});

describe('codocs_guide 응답', () => {
  it('주제를 주면 가이드 원문 handler의 결과를 그대로 반환한다', async () => {
    opened = await openInProcessProject('mcp-res-');
    const expected = await createCodocsGuideHandler(sourceGuideRoot)({
      topic: 'validation',
    });

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_guide',
      { topic: 'validation' },
    );

    expect(response.isError).toBe(false);
    expect(body).toEqual(expected);
  });

  it('가이드 원문을 읽지 못하면 file_access_failed를 isError와 함께 전달한다', async () => {
    opened = await openInProcessProject(
      'mcp-res-',
      {},
      new URL('file:///codocs-missing-guide/'),
    );

    const { response, body } = await callWrapped(
      opened.client,
      'codocs_guide',
      {},
    );

    expect(response.isError).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'file_access_failed' },
    });
  });
});

describe('입력 형식 위반', () => {
  it.each([
    ['codocs_list', { cursor: 'x' }],
    ['codocs_get', { addresses: [] }],
    ['codocs_search', { queries: [] }],
    ['codocs_refresh', { extra: true }],
    ['codocs_validate', { path: null }],
    ['codocs_guide', { topic: '없는주제' }],
  ])(
    '%s는 입력 형식을 어기면 invalid_input을 isError와 함께 반환한다',
    async (name, args) => {
      opened = await openInProcessProject('mcp-res-', {
        '.codocs/alpha.yaml': alpha,
      });

      const { response, body } = await callWrapped(opened.client, name, args);

      expect(response.isError).toBe(true);
      expect(body).toMatchObject({
        success: false,
        error: { code: 'invalid_input' },
      });
    },
  );
});
