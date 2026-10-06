import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renameRequestFailureCodes } from '../rename/index.js';
import { LanguageServerSession } from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

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
  await rmWithRetry(root, { recursive: true, force: true });
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
      kind: 'document',
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

    expect(result?.kind).toBe('document');
    expect(result?.placeholder).toBe('주문');
    expect(result?.targetPath).toBe(path.join('.codocs', 'order.yaml'));
    expect(result?.range).toEqual({
      start: { line, character },
      end: { line, character: character + '주문'.length },
    });
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

/** 섹션이 있는 문서를 만들고 작업 공간을 다시 읽는다. */
async function writeSectionFiles(): Promise<void> {
  await writeFile(
    path.join(root, '.codocs/refund.yaml'),
    [
      '_codocs:',
      '  id: refund',
      '  name: 환불',
      '환불정책: 기준',
      "'예외': 없음",
      '"따옴표": 값',
      '본문: 참고 [[환불:예외]] 와 [[환불]]',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, '.codocs/pay.yaml'),
    document(
      'pay',
      '결제',
      '참고 [[환불:환불정책]] [[환불:없는섹션]] [[주문]]',
    ),
  );
  await session.refreshWorkspaces();
}

/** 줄 안에서 찾은 문자열 시작 위치에 커서를 두고 prepareRename을 요청한다. */
async function prepareAt(file: string, needle: string, delta = 0) {
  const text = await open(file);
  const lines = text.split('\n');
  const line = lines.findIndex((row) => row.includes(needle));
  const character = lines[line]!.indexOf(needle) + delta;
  return {
    line,
    character,
    result: await session.prepareRename({
      textDocument: { uri: uriOf(file) },
      position: { line, character },
    }),
  };
}

describe('prepareRename 섹션 위치', () => {
  beforeEach(writeSectionFiles);

  it('루트 섹션 키 위에서는 따옴표를 제외한 키 범위로 섹션 이름 변경을 시작한다', async () => {
    const plain = await prepareAt('.codocs/refund.yaml', '환불정책', 1);
    expect(plain.result).toEqual({
      kind: 'section',
      section: '환불정책',
      placeholder: '환불정책',
      targetPath: path.join('.codocs', 'refund.yaml'),
      range: {
        start: { line: plain.line, character: 0 },
        end: { line: plain.line, character: 4 },
      },
    });
    const quoted = await prepareAt('.codocs/refund.yaml', "'예외'", 2);
    expect(quoted.result?.section).toBe('예외');
    expect(quoted.result?.range).toEqual({
      start: { line: quoted.line, character: 1 },
      end: { line: quoted.line, character: 3 },
    });
    const double = await prepareAt('.codocs/refund.yaml', '"따옴표"', 2);
    expect(double.result?.section).toBe('따옴표');
    expect(double.result?.range.start.character).toBe(1);
  });

  it('_codocs 키와 섹션 값 위에서는 섹션 이름 변경을 시작하지 않는다', async () => {
    const key = await prepareAt('.codocs/refund.yaml', '_codocs', 2);
    expect(key.result).toBeNull();
    const value = await prepareAt('.codocs/refund.yaml', '기준', 1);
    expect(value.result).toBeNull();
  });

  it('다른 문서 섹션 참조의 섹션 부분은 대상 문서의 섹션 이름 변경, 이름 부분은 문서 이름 변경이다', async () => {
    const section = await prepareAt('.codocs/pay.yaml', '환불정책', 1);
    expect(section.result).toEqual({
      kind: 'section',
      section: '환불정책',
      placeholder: '환불정책',
      targetPath: path.join('.codocs', 'refund.yaml'),
      range: {
        start: { line: section.line, character: section.character - 1 },
        end: {
          line: section.line,
          character: section.character - 1 + '환불정책'.length,
        },
      },
    });
    const name = await prepareAt('.codocs/pay.yaml', '환불:환불정책', 1);
    expect(name.result).toEqual({
      kind: 'document',
      placeholder: '환불',
      targetPath: path.join('.codocs', 'refund.yaml'),
      range: {
        start: { line: name.line, character: name.character - 1 },
        end: { line: name.line, character: name.character - 1 + '환불'.length },
      },
    });
  });

  it('같은 문서의 섹션 참조는 섹션 부분에서 섹션, 이름 부분에서 그 문서 이름 변경을 시작한다', async () => {
    const section = await prepareAt('.codocs/refund.yaml', '환불:예외', 4);
    expect(section.result?.kind).toBe('section');
    expect(section.result?.section).toBe('예외');
    expect(section.result?.targetPath).toBe(
      path.join('.codocs', 'refund.yaml'),
    );
    const name = await prepareAt('.codocs/refund.yaml', '환불:예외', 1);
    expect(name.result?.kind).toBe('document');
    expect(name.result?.placeholder).toBe('환불');
  });

  it('섹션이 없는 참조의 섹션 부분과 구분 콜론, 대괄호 위에서는 시작하지 않는다', async () => {
    const missing = await prepareAt('.codocs/pay.yaml', '없는섹션', 1);
    expect(missing.result).toBeNull();
    const colon = await prepareAt('.codocs/pay.yaml', ':환불정책', 0);
    expect(colon.result?.kind).toBe('document');
    const bracket = await prepareAt('.codocs/pay.yaml', '[[주문]]', 0);
    expect(bracket.result).toBeNull();
  });

  it('섹션 이름 변경 미리보기 요청은 section을 세션에 전달한다', async () => {
    await open('.codocs/pay.yaml');
    const result = await session.planRename({
      textDocument: { uri: uriOf('.codocs/pay.yaml') },
      targetPath: path.join('.codocs', 'refund.yaml'),
      section: '환불정책',
      newName: '환불 규정',
    });

    expect(result).toMatchObject({
      success: true,
      status: 'ready',
      oldName: '환불정책',
      newName: '환불 규정',
      targetSection: '환불정책',
    });
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

describe('코드 파일 표기를 포함한 이름 변경 요청', () => {
  /** 코드 파일 하나가 있는 프로젝트에서 order 문서의 미리보기를 요청한다. */
  async function planWithCode() {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/code.ts'), '// @codocs [[주문]]#L2\n');
    await open('.codocs/order.yaml');
    const request = {
      textDocument: { uri: uriOf('.codocs/order.yaml') },
      targetPath: path.join('.codocs', 'order.yaml'),
      newName: '새주문',
    };
    const preview = await session.planRename(request);
    if (!preview.success || !('revisions' in preview)) throw new Error('plan');
    return { request, preview };
  }

  it('미리보기는 코드 파일을 revisions와 fileUris에 포함해 클라이언트가 저장하지 않은 수정을 확인하게 한다', async () => {
    const { preview } = await planWithCode();

    expect(Object.keys(preview.revisions)).toContain('src/code.ts');
    expect(preview.fileUris['src/code.ts']).toBe(uriOf('src/code.ts'));
    expect(preview.changes).toContainEqual(
      expect.objectContaining({ path: 'src/code.ts', fileKind: 'code' }),
    );
  });

  it('반영하면 코드 파일의 이름 부분만 고치고 fileUris에 코드 파일 결과를 포함한다', async () => {
    const { request, preview } = await planWithCode();
    const result = await session.applyRename({
      ...request,
      revisions: preview.revisions,
    });

    if (!result.success || !('files' in result)) throw new Error('apply');
    expect(result.files).toContainEqual(
      expect.objectContaining({ path: 'src/code.ts', state: 'changed' }),
    );
    expect(result.fileUris['src/code.ts']).toBe(uriOf('src/code.ts'));
    expect(await readFile(path.join(root, 'src/code.ts'), 'utf8')).toBe(
      '// @codocs [[새주문]]#L2\n',
    );
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
