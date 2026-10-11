import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource } from 'vscode-languageserver/node.js';
import { LanguageServerSession } from './index.js';
import { SourceSelections } from '../navigation/index.js';
import {
  renameWithRetry,
  rmWithRetry,
} from '../../../../tools/test/support/retrying-fs.js';

let root: string;
let session: LanguageServerSession;
let sourceUri: string;
const targetText =
  '_codocs:\n  id: target\n  name: 대상\ndefinition: 원래 본문\n';

beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  root = await mkdtemp(path.resolve('.workbench/fixtures/live-'));
  await mkdir(path.join(root, '.codocs'));
  await writeFile(path.join(root, '.codocs/대상 문서.yaml'), targetText);
  session = new LanguageServerSession();
  await session.initialize({
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: {},
  });
  await session.refreshWorkspaces();
  sourceUri = pathToFileURL(path.join(root, '.codocs/source.yaml')).href;
});
afterEach(async () => {
  await session.close();
  await rmWithRetry(root, { recursive: true, force: true });
});

describe('live YAML과 디스크 대상의 연결', () => {
  it('편집 뒤 native 대상 이름·경로를 바꾸고 이전 선택을 거부하며 새 본문 선택만 확인한다', async () => {
    const source =
      '_codocs:\n  id: source\n  name: Source\ndefinition: "[[Old]]"\n';
    await writeFile(path.join(root, '.codocs/source.yaml'), source);
    await writeFile(
      path.join(root, '.codocs/대상 문서.yaml'),
      targetText.replace('name: 대상', 'name: Old'),
    );
    await writeFile(
      path.join(root, '.codocs/direct [이름] %.yaml'),
      '_codocs:\n  id: direct\n  name: "Direct <name>"\ndefinition: Direct body\n',
    );
    await session.refreshWorkspaces();
    const capture = vi.spyOn(SourceSelections.prototype, 'capture');
    try {
      session.openDocument({
        textDocument: {
          uri: sourceUri,
          version: 1,
          languageId: 'yaml',
          text: source,
        },
      });
      const oldLinks = await session.documentLinks(sourceUri);
      expect(oldLinks).toHaveLength(1);
      expect(oldLinks[0]!.tooltip).toBe(
        '원문 열기: Old \\(\\.codocs/대상 문서\\.yaml\\)',
      );
      const oldSelection: unknown = capture.mock.results.at(-1)!.value;
      expect(await session.confirmSource(oldSelection)).not.toBeNull();
      session.changeDocument({
        textDocument: { uri: sourceUri, version: 2 },
        contentChanges: [
          { text: source.replace('[[Old]]', '[[Direct <name>]]') },
        ],
      });
      expect(await session.confirmSource(oldSelection)).toBeNull();
      const freshLinks = await session.documentLinks(sourceUri);
      expect(freshLinks).toHaveLength(1);
      expect(freshLinks[0]!.tooltip).toBe(
        '원문 열기: Direct \\<name\\> \\(\\.codocs/direct \\[이름\\] %\\.yaml\\)',
      );
      expect(freshLinks[0]!.target).toMatch(/^command:codocs\.openSource\?/u);
      const freshSelection: unknown = capture.mock.results.at(-1)!.value;
      expect(await session.confirmSource(freshSelection)).toEqual({
        uri: pathToFileURL(path.join(root, '.codocs/direct [이름] %.yaml'))
          .href,
      });
    } finally {
      capture.mockRestore();
    }
  });
  it('열린 대상 문서의 저장하지 않은 이름은 출처 참조의 대상 판단에 쓰지 않는다', async () => {
    const source =
      '_codocs:\n  id: source\n  name: Source\ndefinition: "[[대상]]"\n';
    await writeFile(path.join(root, '.codocs/source.yaml'), source);
    await session.refreshWorkspaces();
    session.openDocument({
      textDocument: {
        uri: pathToFileURL(path.join(root, '.codocs/대상 문서.yaml')).href,
        version: 1,
        languageId: 'yaml',
        text: targetText.replace('name: 대상', 'name: 다른 이름'),
      },
    });
    session.openDocument({
      textDocument: {
        uri: sourceUri,
        version: 1,
        languageId: 'yaml',
        text: source,
      },
    });
    const links = await session.documentLinks(sourceUri);
    expect(links).toHaveLength(1);
    expect(links[0]!.tooltip).toBe(
      '원문 열기: 대상 \\(\\.codocs/대상 문서\\.yaml\\)',
    );
  });
  it('YAML 본문의 특수 경로 링크는 resolve와 Host 해석 뒤 같은 출처·토큰으로 대상을 확인한다', async () => {
    const targetPath = path.join(root, '.codocs/한글 % # %20 %23.yaml');
    await renameWithRetry(
      path.join(root, '.codocs/대상 문서.yaml'),
      targetPath,
    );
    await session.refreshWorkspaces();
    const uri = pathToFileURL(
      path.join(root, '.codocs/한글 % # %23.yaml'),
    ).href;
    session.openDocument({
      textDocument: {
        uri,
        version: 1,
        languageId: 'yaml',
        text: '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n',
      },
    });
    const link = (await session.documentLinks(uri))[0]!;
    expect(session.resolveDocumentLink(link)).toEqual(link);
    const query = link.target!.slice(link.target!.indexOf('?') + 1);
    const selection = (
      JSON.parse(decodeURIComponent(decodeURIComponent(query))) as {
        sourceUri: string;
        token: string;
      }[]
    )[0]!;
    expect(selection.sourceUri).toBe(uri);
    expect(selection.token).toMatch(/^[\w-]{32}$/u);
    expect(await session.confirmSource(selection)).toEqual({
      uri: pathToFileURL(targetPath).href,
    });
  });
  it('대상 문서의 이름을 저장해 색인이 갱신되면 열린 문서의 참조를 다시 판단한다', async () => {
    const source =
      '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n';
    session.openDocument({
      textDocument: {
        uri: sourceUri,
        version: 1,
        languageId: 'yaml',
        text: source,
      },
    });
    expect(await session.documentLinks(sourceUri)).toHaveLength(1);
    await writeFile(
      path.join(root, '.codocs/대상 문서.yaml'),
      targetText.replace('name: 대상', 'name: 새 이름'),
    );
    await vi.waitFor(
      async () => {
        expect(await session.documentLinks(sourceUri)).toHaveLength(0);
      },
      { timeout: 10_000 },
    );
  });
  it('감시가 대상 이름 변경을 게시하면 수동 refresh 없이 참조 진단을 갱신한다', async () => {
    session.openDocument({
      textDocument: {
        uri: sourceUri,
        version: 1,
        languageId: 'yaml',
        text: '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n',
      },
    });
    await session.documentDiagnostics(sourceUri);
    const changed = vi.fn();
    const unsubscribe = session.onDidChange(changed);
    await writeFile(
      path.join(root, '.codocs/대상 문서.yaml'),
      targetText.replace('name: 대상', 'name: 새 이름'),
    );
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), {
      timeout: 10_000,
    });
    await vi.waitFor(
      async () => {
        const diagnostics = await session.documentDiagnostics(sourceUri);
        expect(diagnostics).toBeDefined();
        expect(
          diagnostics!.diagnostics.some(
            (item) => item.code === 'reference_not_found',
          ),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );
    expect(await session.documentLinks(sourceUri)).toHaveLength(0);
    unsubscribe();
  });

  it('중첩 workspace의 참조는 가장 가까운 출처 색인에서 링크와 진단을 조회한다', async () => {
    const nested = path.join(root, 'nested');
    await mkdir(path.join(nested, '.codocs'), { recursive: true });
    await writeFile(
      path.join(nested, '.codocs/nested.yaml'),
      targetText.replace('id: target', 'id: nested'),
    );
    await session.changeWorkspaceFolders(
      [{ uri: pathToFileURL(nested).href, name: 'nested' }],
      [],
    );
    await session.refreshWorkspaces();
    const uri = pathToFileURL(path.join(nested, '.codocs/source.yaml')).href;
    session.openDocument({
      textDocument: {
        uri,
        version: 1,
        languageId: 'yaml',
        text: '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n',
      },
    });
    const links = await session.documentLinks(uri);
    expect(links).toHaveLength(1);
    const selected = (
      JSON.parse(
        decodeURIComponent(links[0]!.target!.split('?')[1]!),
      ) as unknown[]
    )[0];
    expect(await session.confirmSource(selected)).toEqual({
      uri: pathToFileURL(path.join(nested, '.codocs/nested.yaml')).href,
    });
    expect((await session.documentDiagnostics(uri))!.diagnostics).toEqual([]);
  });

  it.each(['\n', '\r\n'])(
    '줄바꿈 %j에서 미저장 section 참조의 UTF-16 범위를 보존하고 문자열이 아닌 section의 참조는 링크로 만들지 않는다',
    async (newline) => {
      const text = [
        '_codocs:',
        '  id: source',
        '  name: 출처',
        'definition: "😀 [[대상]] [[대상]]"',
        'examples: ["[[대상]]"]',
        'metadata: "[[대상]]"',
        '',
      ].join(newline);
      session.openDocument({
        textDocument: { uri: sourceUri, version: 1, languageId: 'yaml', text },
      });
      const links = await session.documentLinks(sourceUri);
      const diagnostics = await session.documentDiagnostics(sourceUri);
      expect(links).toHaveLength(3);
      expect(links[0]?.range).toEqual({
        start: { line: 3, character: 16 },
        end: { line: 3, character: 22 },
      });
      expect(
        diagnostics!.diagnostics.some(
          (item) => item.code === 'deprecated_reference',
        ),
      ).toBe(false);
      const selected = JSON.parse(
        decodeURIComponent(links[0]!.target!.split('?')[1]!),
      ) as unknown[];
      expect(await session.confirmSource(selected[0])).toEqual({
        uri: pathToFileURL(path.join(root, '.codocs/대상 문서.yaml')).href,
      });
    },
  );

  it('동명 후보가 복수이면 본문 링크 없이 도메인과 경로로 구분한 개별 Hover 링크를 보존한다', async () => {
    await writeFile(
      path.join(root, '.codocs/other.yaml'),
      targetText.replace('id: target', 'id: other'),
    );
    await session.refreshWorkspaces();
    session.openDocument({
      textDocument: {
        uri: sourceUri,
        version: 1,
        languageId: 'yaml',
        text: '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n',
      },
    });
    expect(await session.documentLinks(sourceUri)).toEqual([]);
    const hover = await session.hoverDocument({
      textDocument: { uri: sourceUri },
      position: { line: 3, character: 15 },
    });
    expect(JSON.stringify(hover)).toContain('other');
    expect(JSON.stringify(hover)).toContain('대상 문서');
    expect(
      JSON.stringify(hover).match(/command:codocs.openSource/gu),
    ).toHaveLength(2);
    const diagnostics = await session.documentDiagnostics(sourceUri);
    expect(
      diagnostics?.diagnostics.some(
        (item) => item.code === 'deprecated_reference',
      ),
    ).toBe(false);
    // 본문은 이동하지 않고 각 Hover 후보는 선택한 발견 경로로 확인한다.
    const value = (hover!.contents as { value: string }).value;
    const queries = [...value.matchAll(/command:codocs.openSource\?([^)]*)/gu)];
    const targets = await Promise.all(
      queries.map((query) =>
        session.confirmSource(
          (JSON.parse(decodeURIComponent(query[1]!)) as unknown[])[0],
        ),
      ),
    );
    expect(targets).toEqual([
      { uri: pathToFileURL(path.join(root, '.codocs/other.yaml')).href },
      { uri: pathToFileURL(path.join(root, '.codocs/대상 문서.yaml')).href },
    ]);
  });

  it.each(['edit', 'close', 'cancel'])(
    '%s 뒤에는 이전 본문 링크를 적용하지 않는다',
    async (action) => {
      session.openDocument({
        textDocument: {
          uri: sourceUri,
          version: 1,
          languageId: 'yaml',
          text: '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n',
        },
      });
      const links = await session.documentLinks(sourceUri);
      const selected = (
        JSON.parse(
          decodeURIComponent(links[0]!.target!.split('?')[1]!),
        ) as unknown[]
      )[0];
      if (action === 'edit')
        session.changeDocument({
          textDocument: { uri: sourceUri, version: 2 },
          contentChanges: [
            {
              text: '_codocs:\n  id: source\n  name: 출처\ndefinition: 삭제\n',
            },
          ],
        });
      if (action === 'close') session.closeDocument(sourceUri);
      const cancellation = new CancellationTokenSource();
      if (action === 'cancel') cancellation.cancel();
      expect(
        await session.documentLinks(sourceUri, cancellation.token),
      ).toEqual([]);
      if (action !== 'cancel')
        expect(await session.confirmSource(selected)).toBeNull();
      cancellation.dispose();
    },
  );

  it.each(['content', 'move', 'delete', 'reuse'])(
    '표시 뒤 대상 %s 변경을 최신 관측으로 확인한다',
    async (action) => {
      session.openDocument({
        textDocument: {
          uri: sourceUri,
          version: 1,
          languageId: 'yaml',
          text: '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[대상]]"\n',
        },
      });
      const links = await session.documentLinks(sourceUri);
      const selected = (
        JSON.parse(
          decodeURIComponent(links[0]!.target!.split('?')[1]!),
        ) as unknown[]
      )[0];
      const original = path.join(root, '.codocs/대상 문서.yaml');
      const moved = path.join(root, '.codocs/moved.yaml');
      if (action === 'content')
        await writeFile(original, targetText.replace('원래 본문', '수정 본문'));
      if (action === 'move') await renameWithRetry(original, moved);
      if (action === 'delete') await rmWithRetry(original);
      if (action === 'reuse')
        await writeFile(
          original,
          targetText.replace('id: target', 'id: replacement'),
        );
      await session.refreshWorkspaces();
      expect(await session.confirmSource(selected)).toEqual(
        action === 'delete' || action === 'reuse'
          ? null
          : { uri: pathToFileURL(action === 'move' ? moved : original).href },
      );
    },
  );
});

describe('다른 작업 공간 폴더로 열린 하위 폴더의 .codocs 소유', () => {
  const zoneText = (id: string): string =>
    `_codocs:\n  id: ${id}\n  name: Zone\ndefinition: 본문\n`;
  const sourceText =
    '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[Zone]]"\n';
  let nested: string;
  let nestedFolder: { uri: string; name: string };

  beforeEach(async () => {
    nested = path.join(root, 'nested');
    nestedFolder = { uri: pathToFileURL(nested).href, name: 'nested' };
    await mkdir(path.join(nested, '.codocs'), { recursive: true });
    await writeFile(path.join(root, '.codocs/zone.yaml'), zoneText('outer'));
    await writeFile(path.join(nested, '.codocs/zone.yaml'), zoneText('inner'));
  });

  /** 출처 문서의 [[Zone]]이 가리키는 문서 URI와 진단 코드를 구한다. */
  async function resolveZone(
    directory: string,
  ): Promise<{ target: string | undefined; codes: (string | number)[] }> {
    const uri = pathToFileURL(path.join(directory, '.codocs/source.yaml')).href;
    session.openDocument({
      textDocument: { uri, version: 1, languageId: 'yaml', text: sourceText },
    });
    const links = await session.documentLinks(uri);
    const selected =
      links.length === 1
        ? (
            JSON.parse(
              decodeURIComponent(links[0]!.target!.split('?')[1]!),
            ) as unknown[]
          )[0]
        : undefined;
    const confirmed = selected ? await session.confirmSource(selected) : null;
    const diagnostics = (await session.documentDiagnostics(uri))!.diagnostics;
    return {
      target: confirmed?.uri,
      codes: diagnostics.map((item) => item.code!),
    };
  }

  it('하위 폴더가 별도 작업 공간 폴더로 열려 있으면 바깥 작업 공간은 자기 문서로 [[Zone]]을 해석하고 안쪽은 자기 문서로 해석한다', async () => {
    await session.changeWorkspaceFolders([nestedFolder], []);
    await session.refreshWorkspaces();

    const outer = await resolveZone(root);
    const inner = await resolveZone(nested);

    expect(outer).toEqual({
      target: pathToFileURL(path.join(root, '.codocs/zone.yaml')).href,
      codes: [],
    });
    expect(inner).toEqual({
      target: pathToFileURL(path.join(nested, '.codocs/zone.yaml')).href,
      codes: [],
    });
  });

  it('하위 폴더의 작업 공간 폴더를 닫으면 바깥 작업 공간이 그 .codocs를 다시 인정해 [[Zone]]이 모호해진다', async () => {
    await session.changeWorkspaceFolders([nestedFolder], []);
    await session.refreshWorkspaces();
    await session.changeWorkspaceFolders([], [nestedFolder]);

    await vi.waitFor(
      async () => {
        await session.refreshWorkspaces();
        const outer = await resolveZone(root);
        expect(outer.target).toBeUndefined();
        expect(outer.codes).toContain('reference_ambiguous');
      },
      { timeout: 10_000, interval: 100 },
    );
  });

  it('하위 폴더를 작업 공간 폴더로 추가하면 바깥 작업 공간은 그 .codocs를 제외해 모호함이 사라진다', async () => {
    await session.refreshWorkspaces();
    expect((await resolveZone(root)).codes).toContain('reference_ambiguous');

    await session.changeWorkspaceFolders([nestedFolder], []);

    await vi.waitFor(
      async () => {
        await session.refreshWorkspaces();
        const outer = await resolveZone(root);
        expect(outer.codes).toEqual([]);
        expect(outer.target).toBe(
          pathToFileURL(path.join(root, '.codocs/zone.yaml')).href,
        );
      },
      { timeout: 10_000, interval: 100 },
    );
  });
});

describe('클라이언트가 알려 준 중첩 workspace 폴더의 .codocs 제외', () => {
  const zoneText = (id: string): string =>
    `_codocs:\n  id: ${id}\n  name: Zone\ndefinition: 본문\n`;
  const sourceText =
    '_codocs:\n  id: source\n  name: 출처\ndefinition: "[[Zone]]"\n';

  /** 루트와 하위 폴더에 같은 이름의 문서를 두고 하위 폴더가 별도 서버로 열렸다고 알린 서버 세션을 만든다. */
  async function outerSession(
    nestedWorkspaceFolderUris: unknown,
  ): Promise<{ outer: LanguageServerSession; sourceUri: string }> {
    const nested = path.join(root, 'nested');
    await mkdir(path.join(nested, '.codocs'), { recursive: true });
    await writeFile(path.join(root, '.codocs/zone.yaml'), zoneText('outer'));
    await writeFile(path.join(nested, '.codocs/zone.yaml'), zoneText('inner'));
    const outer = new LanguageServerSession();
    await outer.initialize({
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: {},
      initializationOptions: { nestedWorkspaceFolderUris },
    });
    await outer.refreshWorkspaces();
    const uri = pathToFileURL(path.join(root, '.codocs/source.yaml')).href;
    outer.openDocument({
      textDocument: { uri, version: 1, languageId: 'yaml', text: sourceText },
    });
    return { outer, sourceUri: uri };
  }

  it('initializationOptions로 하위 폴더가 별도 서버로 열렸다고 알리면 이 서버는 그 .codocs를 색인하지 않아 [[Zone]]이 모호하지 않다', async () => {
    const { outer, sourceUri: uri } = await outerSession([
      pathToFileURL(path.join(root, 'nested')).href,
    ]);
    try {
      const diagnostics = (await outer.documentDiagnostics(uri))!.diagnostics;
      expect(diagnostics).toEqual([]);
    } finally {
      await outer.close();
    }
  });

  it('알림으로 중첩 폴더 목록이 비면 이 서버가 하위 폴더의 .codocs를 다시 인정해 [[Zone]]이 모호해진다', async () => {
    const { outer, sourceUri: uri } = await outerSession([
      pathToFileURL(path.join(root, 'nested')).href,
    ]);
    try {
      outer.setNestedWorkspaceFolders([]);
      await vi.waitFor(
        async () => {
          await outer.refreshWorkspaces();
          const diagnostics = (await outer.documentDiagnostics(uri))!
            .diagnostics;
          expect(diagnostics.map((item) => item.code)).toContain(
            'reference_ambiguous',
          );
        },
        { timeout: 10_000, interval: 100 },
      );
    } finally {
      await outer.close();
    }
  });

  it('중첩 폴더 목록에 잘못된 값이 있으면 무시하고 이 서버가 하위 폴더의 .codocs를 인정한다', async () => {
    const { outer, sourceUri: uri } = await outerSession([
      'not a uri',
      42,
      'http://example.com/nested',
    ]);
    try {
      const diagnostics = (await outer.documentDiagnostics(uri))!.diagnostics;
      expect(diagnostics.map((item) => item.code)).toContain(
        'reference_ambiguous',
      );
    } finally {
      await outer.close();
    }
  });
});
