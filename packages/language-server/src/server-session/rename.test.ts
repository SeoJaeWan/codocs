import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renameRequestFailureCodes } from '../rename/index.js';
import { LanguageServerSession } from './index.js';

let root: string;
let session: LanguageServerSession;

/** 고정 문서 하나의 원문을 만든다. */
function document(id: string, name: string, definition: string) {
  return `_codocs:\n  id: ${id}\n  name: ${name}\ndefinition: ${definition}\n`;
}

/** 프로젝트 상대 경로의 file URI를 만든다. */
function uriOf(relative: string): string {
  return pathToFileURL(path.join(root, relative)).href;
}

/** 프로젝트 상대 경로의 원문을 열린 문서로 등록한다. */
async function open(relative: string, languageId = 'yaml'): Promise<string> {
  const text = await readFile(path.join(root, relative), 'utf8');
  session.openDocument({
    textDocument: { uri: uriOf(relative), languageId, version: 1, text },
  });
  return text;
}

beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  root = await mkdtemp(path.resolve('.workbench/fixtures/rename-'));
  await mkdir(path.join(root, '.codocs'));
  const files: Record<string, string> = {
    'order.yaml': document('order', '주문', '주문 설명'),
    'ref.yaml': document('ref', '참조', '본문 [[주문]] 끝'),
    'twin-a.yaml': document('twin-a', '쌍둥이', 'A 설명'),
    'twin-b.yaml': document('twin-b', '쌍둥이', 'B 설명'),
    'twin-ref.yaml': document('twin-ref', '쌍둥이참조', '본문 [[쌍둥이]] 끝'),
  };
  for (const [name, text] of Object.entries(files))
    await writeFile(path.join(root, '.codocs', name), text);
  await writeFile(path.join(root, 'code.txt'), 'order 주문\n');
  session = new LanguageServerSession();
  await session.initialize({
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: {},
  });
  await session.refreshWorkspaces();
});
afterEach(async () => {
  await session.close();
  await rm(root, { recursive: true, force: true });
});

describe('prepareRename 시작 위치 확인', () => {
  it('문서의 name 값 위에서는 그 문서의 현재 이름과 name 값 범위를 반환한다', async () => {
    const text = await open('.codocs/order.yaml');
    const line = text.split('\n').findIndex((row) => row.startsWith('  name:'));

    const result = await session.prepareRename({
      textDocument: { uri: uriOf('.codocs/order.yaml') },
      position: { line, character: 9 },
    });

    expect(result).toEqual({
      placeholder: '주문',
      range: {
        start: { line, character: 8 },
        end: { line, character: 10 },
      },
      targetPath: path.join('.codocs', 'order.yaml'),
    });
  });

  it('하나의 문서로 확정되는 참조 위에서는 참조가 가리키는 문서의 이름과 경로를 반환한다', async () => {
    const text = await open('.codocs/ref.yaml');
    const line = text.split('\n').findIndex((row) => row.includes('[[주문]]'));
    const character = text.split('\n')[line]!.indexOf('주문');

    const result = await session.prepareRename({
      textDocument: { uri: uriOf('.codocs/ref.yaml') },
      position: { line, character },
    });

    expect(result?.placeholder).toBe('주문');
    expect(result?.targetPath).toBe(path.join('.codocs', 'order.yaml'));
  });

  it('후보가 여럿인 참조 위에서는 시작할 수 없다', async () => {
    const text = await open('.codocs/twin-ref.yaml');
    const line = text
      .split('\n')
      .findIndex((row) => row.includes('[[쌍둥이]]'));
    const character = text.split('\n')[line]!.indexOf('쌍둥이');

    const result = await session.prepareRename({
      textDocument: { uri: uriOf('.codocs/twin-ref.yaml') },
      position: { line, character },
    });

    expect(result).toBeNull();
  });

  it('name 값과 참조가 아닌 본문 위에서는 시작할 수 없다', async () => {
    const text = await open('.codocs/ref.yaml');
    const line = text.split('\n').findIndex((row) => row.includes('본문'));

    const result = await session.prepareRename({
      textDocument: { uri: uriOf('.codocs/ref.yaml') },
      position: { line, character: text.split('\n')[line]!.indexOf('본문') },
    });

    expect(result).toBeNull();
  });

  it('.codocs 문서가 아닌 파일에서는 시작할 수 없다', async () => {
    await open('code.txt', 'plaintext');

    const result = await session.prepareRename({
      textDocument: { uri: uriOf('code.txt') },
      position: { line: 0, character: 7 },
    });

    expect(result).toBeNull();
  });

  it('열려 있지 않은 문서에서는 시작할 수 없다', async () => {
    const result = await session.prepareRename({
      textDocument: { uri: uriOf('.codocs/order.yaml') },
      position: { line: 1, character: 7 },
    });

    expect(result).toBeNull();
  });
});

describe('planRename 미리보기 요청', () => {
  it('영향받는 파일의 revision과 file URI를 돌려주며 디스크는 바꾸지 않는다', async () => {
    await open('.codocs/order.yaml');
    const before = await readFile(path.join(root, '.codocs/ref.yaml'), 'utf8');
    const orderPath = path.join('.codocs', 'order.yaml');
    const refPath = path.join('.codocs', 'ref.yaml');

    const result = await session.planRename({
      textDocument: { uri: uriOf('.codocs/order.yaml') },
      targetPath: orderPath,
      newName: '새주문',
    });

    if (!result.success || !('status' in result)) throw new Error('preview');
    expect(result.status).toBe('ready');
    expect(Object.keys(result.revisions).sort()).toEqual([orderPath, refPath]);
    expect(result.fileUris).toEqual({
      [orderPath]: uriOf('.codocs/order.yaml'),
      [refPath]: uriOf('.codocs/ref.yaml'),
    });
    expect(await readFile(path.join(root, '.codocs/ref.yaml'), 'utf8')).toBe(
      before,
    );
  });

  it('모호한 참조의 선택을 전달하면 선택한 후보를 기준으로 계산한다', async () => {
    await open('.codocs/twin-a.yaml');
    const twinA = path.join('.codocs', 'twin-a.yaml');
    const twinRef = path.join('.codocs', 'twin-ref.yaml');

    const result = await session.planRename({
      textDocument: { uri: uriOf('.codocs/twin-a.yaml') },
      targetPath: twinA,
      newName: '새쌍둥이',
      selections: [
        { sourcePath: twinRef, occurrenceIndex: 0, targetPath: twinA },
      ],
    });

    if (!result.success || !('changes' in result)) throw new Error('preview');
    expect(result.changes.map((change) => change.path).sort()).toEqual([
      twinA,
      twinRef,
    ]);
  });

  it('출처 문서가 작업 공간에 속하지 않으면 workspace_not_found로 실패한다', async () => {
    const result = await session.planRename({
      textDocument: { uri: pathToFileURL(path.resolve('outside.yaml')).href },
      targetPath: '.codocs/order.yaml',
      newName: '새주문',
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: renameRequestFailureCodes.workspaceNotFound },
    });
  });

  it('작업 공간 세션이 이름 변경을 지원하지 않으면 rename_unsupported로 실패한다', async () => {
    await session.close();
    session = new LanguageServerSession(() => ({
      readiness: { state: 'ready', ready: true },
      catalogVersion: 1,
      match: vi.fn(),
      getByPaths: vi.fn(),
      refresh: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    await session.initialize({
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: {},
    });

    const result = await session.planRename({
      textDocument: { uri: uriOf('.codocs/order.yaml') },
      targetPath: '.codocs/order.yaml',
      newName: '새주문',
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: renameRequestFailureCodes.renameUnsupported },
    });
  });
});

describe('applyRename 반영 요청', () => {
  it('미리보기의 revision으로 요청하면 영향 파일에 새 이름과 참조를 쓴다', async () => {
    await open('.codocs/order.yaml');
    const orderPath = path.join('.codocs', 'order.yaml');
    const refPath = path.join('.codocs', 'ref.yaml');
    const request = {
      textDocument: { uri: uriOf('.codocs/order.yaml') },
      targetPath: orderPath,
      newName: '새주문',
    };
    const preview = await session.planRename(request);
    if (!preview.success || !('revisions' in preview)) throw new Error('plan');

    const result = await session.applyRename({
      ...request,
      revisions: preview.revisions,
    });

    expect(result.success).toBe(true);
    if (!('files' in result)) throw new Error('apply');
    expect(result.files.map((file) => [file.path, file.state]).sort()).toEqual([
      [orderPath, 'changed'],
      [refPath, 'changed'],
    ]);
    expect(
      await readFile(path.join(root, '.codocs/order.yaml'), 'utf8'),
    ).toContain('name: 새주문');
    expect(
      await readFile(path.join(root, '.codocs/ref.yaml'), 'utf8'),
    ).toContain('[[새주문]]');
  });

  it('파일이 미리보기 뒤에 바뀌면 거절하고 파일을 바꾸지 않는다', async () => {
    await open('.codocs/order.yaml');
    const orderPath = path.join('.codocs', 'order.yaml');
    const request = {
      textDocument: { uri: uriOf('.codocs/order.yaml') },
      targetPath: orderPath,
      newName: '새주문',
    };
    const preview = await session.planRename(request);
    if (!preview.success || !('revisions' in preview)) throw new Error('plan');
    const edited = document('ref', '참조', '본문 [[주문]] 수정됨');
    await writeFile(path.join(root, '.codocs/ref.yaml'), edited);

    const result = await session.applyRename({
      ...request,
      revisions: preview.revisions,
    });

    expect(result.success).toBe(false);
    expect(await readFile(path.join(root, '.codocs/ref.yaml'), 'utf8')).toBe(
      edited,
    );
    expect(
      await readFile(path.join(root, '.codocs/order.yaml'), 'utf8'),
    ).toContain('name: 주문');
  });
});
