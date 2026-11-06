import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  callWrapped,
  openInProcessProject,
  type InProcessProject,
} from '../../test-support/in-process.js';

let opened: InProcessProject;
let project: string;

beforeEach(async () => {
  opened = await openInProcessProject('mcp-authoring-');
  project = opened.project;
});
afterEach(async () => {
  await opened.close();
});

/** 도구를 호출하고 전송 포장과 JSON 본문의 일치를 확인한 뒤 본문을 꺼낸다. */
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { response, body } = await callWrapped(opened.client, name, args);
  expect(response.isError).toBe(!body.success);
  return body;
}

describe('가이드 작성 절차의 MCP 도구 흐름과 파일 반영', () => {
  it('최신 get revision으로 선택 section을 unset하면 나머지 원문을 보존하고 검증한다', async () => {
    const document = {
      _codocs: { id: 'a', name: '가상 A' },
      definition: '의미',
      예시: '선택 예문',
    };
    await call('codocs_write', {
      mode: 'create',
      path: '.codocs/a.yaml',
      document,
    });
    const fetched = await call('codocs_get', { addresses: ['가상 A'] });
    const before = (fetched.results as { revision: string }[])[0]!;
    const result = await call('codocs_write', {
      mode: 'update',
      id: 'a',
      revision: before.revision,
      unset: ['예시'],
    });
    const bytes = await readFile(path.join(project, '.codocs/a.yaml'));
    // 실패 시 응답 전체(오류 코드·진단 포함)를 남겨 OS별 원인을 바로 확인한다.
    expect(result, JSON.stringify(result)).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
      revision: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(bytes.toString()).not.toContain('예시:');
    const after = await call('codocs_get', { addresses: ['가상 A'] });
    expect(after.results).toMatchObject([
      {
        document: {
          _codocs: { id: document._codocs.id, name: document._codocs.name },
          definition: document.definition,
        },
      },
    ]);
    expect(await call('codocs_validate', {})).toMatchObject({
      success: true,
      diagnostics: [],
    });
  });

  it('A 생성 뒤 A 참조 B를 만들고 최신 A에 B를 set하면 양방향 연결을 저장한다', async () => {
    await call('codocs_write', {
      mode: 'create',
      path: '.codocs/a.yaml',
      document: {
        _codocs: { id: 'a', name: '가상 A' },
        definition: 'A의 의미',
      },
    });
    await call('codocs_write', {
      mode: 'create',
      path: '.codocs/b.yaml',
      document: {
        _codocs: { id: 'b', name: '가상 B' },
        definition: '[[가상 A]]를 사용하는 절차',
      },
    });
    const fetched = await call('codocs_get', { addresses: ['가상 A'] });
    const revision = (fetched.results as { revision: string }[])[0]!.revision;
    const result = await call('codocs_write', {
      mode: 'update',
      id: 'a',
      revision,
      set: { definition: 'A의 의미. 사용 절차는 [[가상 B]]에서 확인한다.' },
    });
    expect(result, JSON.stringify(result)).toMatchObject({
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
      (await call('codocs_get', { addresses: ['가상 A', '가상 B'] })).results,
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
    expect(await call('codocs_validate', {})).toMatchObject({
      success: true,
      diagnostics: [],
    });
  });

  it('오래된 revision이 거절되면 최신 설명을 재조회하고 검토한 수정으로 다른 변경을 보존한다', async () => {
    const created = await call('codocs_write', {
      mode: 'create',
      path: '.codocs/a.yaml',
      document: {
        _codocs: { id: 'a', name: '가상 A' },
        definition: '초기 설명',
      },
    });
    await call('codocs_write', {
      mode: 'update',
      id: 'a',
      revision: created.revision,
      set: { definition: '다른 작성자의 조건' },
    });
    const file = path.join(project, '.codocs/a.yaml');
    const before = await readFile(file);
    const rejected = await call('codocs_write', {
      mode: 'update',
      id: 'a',
      revision: created.revision,
      set: { definition: '내 설명' },
    });
    expect(rejected).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'change_revision_mismatch' },
    });
    expect(await readFile(file)).toEqual(before);
    const fetched = await call('codocs_get', { addresses: ['가상 A'] });
    const latest = (
      fetched.results as {
        revision: string;
        document: { definition: string };
      }[]
    )[0]!;
    expect(latest.document.definition).toBe('다른 작성자의 조건');
    const reviewed = latest.document.definition + '. 검토 후 추가한 내 설명';
    const result = await call('codocs_write', {
      mode: 'update',
      id: 'a',
      revision: latest.revision,
      set: { definition: reviewed },
    });
    expect(result, JSON.stringify(result)).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    expect(await readFile(file, 'utf8')).toContain(reviewed);
  });

  it('create 결과의 source.path를 validate와 move 입력에 그대로 넣으면 성공한다', async () => {
    const result = await call('codocs_write', {
      mode: 'create',
      path: '.codocs/orders/order.yaml',
      document: {
        _codocs: { id: 'order', name: '가상주문' },
        definition: '주문 본문',
      },
    });
    const source = (result.source as { path: string }).path;
    await opened.settle();
    const checked = await call('codocs_validate', { path: source });
    expect(checked).toMatchObject({ success: true, path: source });
    const fetched = await call('codocs_get', { addresses: ['가상주문'] });
    const moved = await call('codocs_write', {
      mode: 'move',
      id: 'order',
      revision: (fetched.results as { revision: string }[])[0]!.revision,
      path: source.replace('order.yaml', 'moved.yaml'),
    });
    expect(moved).toMatchObject({
      success: true,
      previousPath: source,
      source: { path: '.codocs/orders/moved.yaml' },
    });
  });
});
