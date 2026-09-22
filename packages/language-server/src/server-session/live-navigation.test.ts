import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource } from 'vscode-languageserver/node.js';
import { LanguageServerSession } from './index.js';

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
    // 공개 Workspace API가 ambiguous 선택을 확인하지 못하므로 오대상을 열지 않는다.
    const value = (hover!.contents as { value: string }).value;
    const query = /command:codocs.openSource\?([^)]*)/u.exec(value)![1]!;
    expect(
      await session.confirmSource(
        (JSON.parse(decodeURIComponent(query)) as unknown[])[0],
      ),
    ).toBeNull();
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
