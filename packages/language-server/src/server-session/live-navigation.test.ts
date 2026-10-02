import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource } from 'vscode-languageserver/node.js';
import { LanguageServerSession } from './index.js';
import { SourceSelections } from '../navigation/index.js';

let root: string;
let session: LanguageServerSession;
let sourceUri: string;
const targetText =
  'id: target\nname: 대상\ndomains: [업무]\ndefinition: 원래 본문\nstatus: deprecated\n';

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
  await rm(root, { recursive: true, force: true });
});

describe('live YAML과 디스크 대상의 연결', () => {
  it('편집 뒤 native 대상 이름·경로를 바꾸고 이전 선택을 거부하며 새 본문 선택만 확인한다', async () => {
    const source =
      'id: source\nname: Source\ndefinition: "[[Old]]"\ndomains: [업무]\n';
    await writeFile(path.join(root, '.codocs/source.yaml'), source);
    await writeFile(
      path.join(root, '.codocs/대상 문서.yaml'),
      targetText.replace('name: 대상', 'name: Old'),
    );
    await writeFile(
      path.join(root, '.codocs/direct [이름] %.yaml'),
      'id: direct\nname: "Direct <name>"\ndefinition: Direct body\ndomains: [업무]\n',
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
  /**
   * @codocs [[참조]]#L54
   */
  it('열린 대상 문서의 저장하지 않은 이름은 출처 참조의 대상 판단에 쓰지 않는다', async () => {
    const source =
      'id: source\nname: Source\ndefinition: "[[대상]]"\ndomains: [업무]\n';
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
  it.each(['코드 Hover', 'YAML 본문'])(
    '%s의 특수 경로 링크는 resolve와 Host 해석 뒤 같은 출처·토큰으로 대상을 확인한다',
    async (kind) => {
      const targetPath = path.join(root, '.codocs/한글 % # %20 %23.yaml');
      await rename(path.join(root, '.codocs/대상 문서.yaml'), targetPath);
      await session.refreshWorkspaces();
      const uri = pathToFileURL(
        path.join(
          root,
          kind === '코드 Hover'
            ? '한글 % # %20.ts'
            : '.codocs/한글 % # %23.yaml',
        ),
      ).href;
      session.openDocument({
        textDocument: {
          uri,
          version: 1,
          languageId: kind === '코드 Hover' ? 'typescript' : 'yaml',
          text:
            kind === '코드 Hover'
              ? 'target'
              : 'id: source\nname: 출처\ndefinition: "[[대상]]"\n',
        },
      });
      const link =
        kind === 'YAML 본문'
          ? (await session.documentLinks(uri))[0]!
          : {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
              },
              target: /command:codocs.openSource\?([^)]*)/u.exec(
                (
                  (await session.hoverDocument({
                    textDocument: { uri },
                    position: { line: 0, character: 1 },
                  }))!.contents as { value: string }
                ).value,
              )![0],
            };
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
    },
  );
  it('같은 대상을 가리키는 다른 매칭 문서가 남아도 선택한 관계가 사라지면 이전 링크를 거부한다', async () => {
    await writeFile(
      path.join(root, '.codocs/alpha.yaml'),
      'id: alpha\nname: 알파\ndefinition: "[[관계 대상]]"\n',
    );
    const betaPath = path.join(root, '.codocs/beta.yaml');
    await writeFile(
      betaPath,
      'id: beta\nname: 베타\ndefinition: "[[관계 대상]]"\n',
    );
    const relatedPath = path.join(root, '.codocs/related.yaml');
    await writeFile(
      relatedPath,
      'id: related\nname: 관계 대상\ndefinition: 관계 본문\n',
    );
    await session.refreshWorkspaces();
    const uri = pathToFileURL(path.join(root, 'source.ts')).href;
    session.openDocument({
      textDocument: {
        uri,
        languageId: 'typescript',
        version: 1,
        text: 'alphaBeta',
      },
    });
    const hover = await session.hoverDocument({
      textDocument: { uri },
      position: { line: 0, character: 6 },
    });
    const markdown = (hover!.contents as { value: string }).value;
    const query = /command:codocs.openSource\?([^)]*)/u.exec(
      markdown.split('이 문서가 참조')[1]!,
    )![1]!;
    const selection = (JSON.parse(decodeURIComponent(query)) as unknown[])[0];
    expect(await session.confirmSource(selection)).toEqual({
      uri: pathToFileURL(relatedPath).href,
    });
    await writeFile(betaPath, 'id: beta\nname: 베타\ndefinition: 관계 제거\n');
    await session.refreshWorkspaces();
    expect(await session.confirmSource(selection)).toBeNull();
  });
  /**
   * @codocs [[참조]]#L55
   */
  it('대상 문서의 이름을 저장해 색인이 갱신되면 열린 문서의 참조를 다시 판단한다', async () => {
    const source =
      'id: source\nname: 출처\ndomains: [업무]\ndefinition: "[[대상]]"\n';
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
      { timeout: 3000 },
    );
  });
  it('감시가 상태 변경을 게시하면 수동 refresh 없이 폐기 경고를 갱신한다', async () => {
    session.openDocument({
      textDocument: {
        uri: sourceUri,
        version: 1,
        languageId: 'yaml',
        text: 'id: source\nname: 출처\ndomains: [업무]\ndefinition: "[[대상]]"\n',
      },
    });
    await session.documentDiagnostics(sourceUri);
    const changed = vi.fn();
    const unsubscribe = session.onDidChange(changed);
    await writeFile(
      path.join(root, '.codocs/대상 문서.yaml'),
      targetText.replace('status: deprecated', 'status: confirmed'),
    );
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), {
      timeout: 3000,
    });
    await vi.waitFor(
      async () => {
        const diagnostics = await session.documentDiagnostics(sourceUri);
        expect(diagnostics).toBeDefined();
        expect(
          diagnostics!.diagnostics.some(
            (item) => item.code === 'deprecated_reference',
          ),
        ).toBe(false);
      },
      { timeout: 3000 },
    );
    expect(await session.documentLinks(sourceUri)).toHaveLength(1);
    unsubscribe();
  });

  it('중첩 workspace의 참조는 가장 가까운 출처 색인에서 링크와 진단을 조회한다', async () => {
    const nested = path.join(root, 'nested');
    await mkdir(path.join(nested, '.codocs'), { recursive: true });
    await writeFile(
      path.join(nested, '.codocs/nested.yaml'),
      targetText
        .replace('id: target', 'id: nested')
        .replace('status: deprecated', 'status: confirmed'),
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
        text: 'id: source\nname: 출처\ndomains: [업무]\ndefinition: "[[대상]]"\n',
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
    '줄바꿈 %j에서 미저장 참조의 UTF-16 범위와 폐기 경고를 보존한다',
    async (newline) => {
      const text = [
        'id: source',
        'name: 출처',
        'definition: "😀 [[대상]] [[대상]]"',
        'examples: ["[[업무:대상]]"]',
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
        start: { line: 2, character: 16 },
        end: { line: 2, character: 22 },
      });
      const warnings = diagnostics!.diagnostics.filter(
        (item) => item.code === 'deprecated_reference',
      );
      expect(warnings).toHaveLength(links.length);
      for (const [index, warning] of warnings.entries()) {
        expect(warning.severity).toBe(2);
        expect(warning.range).toEqual(links[index]!.range);
        expect(warning.message).toContain('폐기');
      }
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
        text: 'id: source\nname: 출처\ndefinition: "[[대상]]"\n',
      },
    });
    expect(await session.documentLinks(sourceUri)).toEqual([]);
    const hover = await session.hoverDocument({
      textDocument: { uri: sourceUri },
      position: { line: 2, character: 15 },
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
          text: 'id: source\nname: 출처\ndefinition: "[[대상]]"\n',
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
            { text: 'id: source\nname: 출처\ndefinition: 삭제\n' },
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
          text: 'id: source\nname: 출처\ndefinition: "[[대상]]"\n',
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
      if (action === 'move') await rename(original, moved);
      if (action === 'delete') await rm(original);
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
