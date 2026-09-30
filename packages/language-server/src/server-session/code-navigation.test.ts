import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LanguageServerSession } from './index.js';
let root: string;
let session: LanguageServerSession;
const target =
  'id: target\nname: 대상\ndomains: [업무]\ndefinition: |\n  본문\n  두 번째\n  세 번째\n';
/** 공개 링크의 서버 선택 인자만 복원한다. */
function argument(link: string): unknown {
  return (JSON.parse(decodeURIComponent(link.split('?')[1]!)) as unknown[])[0];
}
/** 실제 파일을 저장하고 같은 출처를 열린 LSP 원문으로 등록한다. */
async function open(relative: string, text: string): Promise<string> {
  await writeFile(path.join(root, relative), text);
  const uri = pathToFileURL(path.join(root, relative)).href;
  session.openDocument({
    textDocument: { uri, languageId: 'plaintext', version: 1, text },
  });
  return uri;
}
beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  root = await mkdtemp(path.resolve('.workbench/fixtures/ide-'));
  await mkdir(path.join(root, '.codocs'));
  await writeFile(path.join(root, '.codocs/target.yaml'), target);
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
describe('명시 링크와 출처 확인', () => {
  it('확장자 없는 UTF-8 원문의 범위 표기는 전체 span 링크와 명시 번호를 반환한다', async () => {
    const text = '😀 @codocs [[업무:대상]]#L5-L6';
    const uri = await open('implementation', text);
    const links = await vi.waitFor(
      async () => {
        const result = await session.documentLinks(uri);
        expect(result).toHaveLength(1);
        expect(
          await session.confirmSource(argument(result[0]!.target!)),
        ).not.toBeNull();
        return result;
      },
      { timeout: 5000 },
    );
    expect(links[0]!.range).toEqual({
      start: { line: 0, character: 3 },
      end: { line: 0, character: text.length },
    });
    expect(
      await session.hoverDocument({
        textDocument: { uri },
        position: { line: 0, character: 17 },
      }),
    ).toBeNull();
    await vi.waitFor(
      async () => {
        const current = await session.documentLinks(uri);
        expect(
          await session.confirmSource(argument(current[0]!.target!)),
        ).toEqual({
          uri: pathToFileURL(path.join(root, '.codocs/target.yaml')).href,
          destination: { kind: 'rows', startLine: 5, endLine: 6 },
        });
      },
      { timeout: 5000 },
    );
  });
  it.each(['#L0', '#L7-L5', '#L999', '#wat'])(
    '잘못된 행 표기 %s는 전체 밑줄을 제공하고 ID 호버를 차단한다',
    async (suffix) => {
      const text = '@codocs [[대상]]' + suffix;
      const uri = await open('invalid', text);
      expect(await session.documentLinks(uri)).toEqual([]);
      expect(
        await session.hoverDocument({
          textDocument: { uri },
          position: { line: 0, character: 11 },
        }),
      ).not.toBeNull();
      const result = await session.diagnostics();
      const diagnostic = result!.documents.find((item) => item.uri === uri)!
        .diagnostics[0]!;
      expect(diagnostic.range).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: text.length },
      });
      expect(diagnostic.message).toBeTruthy();
    },
  );
  it('출처 표기를 편집하거나 닫으면 화면에 남은 링크를 거부한다', async () => {
    const uri = await open('source', '@codocs [[대상]]');
    // 파일 감시의 새 세대에서 발급·확인된 링크가 준비된 뒤 무효화를 검증한다.
    const links = await vi.waitFor(
      async () => {
        const result = await session.documentLinks(uri);
        expect(result).toHaveLength(1);
        expect(
          await session.confirmSource(argument(result[0]!.target!)),
        ).not.toBeNull();
        return result;
      },
      { timeout: 5000 },
    );
    const selected = argument(links[0]!.target!);
    session.changeDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: '표기 제거' }],
    });
    expect(await session.confirmSource(selected)).toBeNull();
    session.closeDocument(uri);
    expect(await session.confirmSource(selected)).toBeNull();
  });
});
describe('정확한 역참조와 문서 전체 Hint', () => {
  it('같은 행 복수 출현의 겹친 행 범위는 열이 다른 개별 링크를 반환한다', async () => {
    const source = '@codocs [[대상]]#L5-L6 @codocs [[대상]]#L6-L7';
    const sourceUri = await open('implementation', source);
    await session.documentLinks(sourceUri);
    const uri = await open('.codocs/target.yaml', target);
    // 발급 직후 수집 세대가 바뀌면 이전 토큰이 거부되므로, Hover를 다시 요청해
    // 새로 발급된 두 번째 링크가 기대 위치로 확인될 때까지 기다린다.
    await vi.waitFor(
      async () => {
        const value = await session.hoverDocument({
          textDocument: { uri },
          position: { line: 5, character: 2 },
        });
        const markdown = (value!.contents as { value: string }).value;
        expect(markdown).not.toContain('collecting');
        // 한국어 완료 표시와 실제 개별 링크를 확인해 수집 중 응답을 구분한다.
        expect(markdown).toContain('연결된 코드 · 2곳');
        expect(markdown).not.toContain('수집 중');
        expect(markdown).toContain('implementation:1:1');
        expect(markdown).toContain('implementation:1:22');
        const matches = [
          ...markdown.matchAll(/command:codocs.openSource\?([^)]*)/gu),
        ];
        expect(matches).toHaveLength(2);
        expect(
          await session.confirmSource(
            (JSON.parse(decodeURIComponent(matches[1]![1]!)) as unknown[])[0],
          ),
        ).toEqual({
          uri: sourceUri,
          destination: {
            kind: 'occurrence',
            markerText: '@codocs [[대상]]#L6-L7',
            range: {
              start: { line: 0, character: 21 },
              end: { line: 0, character: source.length },
            },
          },
        });
      },
      { timeout: 5000 },
    );
    await vi.waitFor(
      async () => expect(await session.documentLinks(uri)).toHaveLength(2),
      { timeout: 5000 },
    ); // 5행과 7행은 각각 단일 출현이다.
  });
  it('기존 YAML 이름 링크와 겹치면 이름 이동과 코드 호버를 함께 보존한다', async () => {
    const text = target.replace('  두 번째', '  [[다른]]');
    await writeFile(
      path.join(root, '.codocs/other.yaml'),
      'id: other\nname: 다른\ndefinition: 다른 본문\n',
    );
    const sourceUri = await open('source', '@codocs [[대상]]#L6');
    await session.documentLinks(sourceUri);
    await writeFile(path.join(root, '.codocs/target.yaml'), text);
    await session.refreshWorkspaces();
    const uri = await open('.codocs/target.yaml', text);
    const links = await vi.waitFor(
      async () => {
        const result = await session.documentLinks(uri);
        expect(result.some((link) => link.range.start.character === 2)).toBe(
          true,
        );
        expect(result.some((link) => link.range.start.character === 0)).toBe(
          true,
        );
        return result;
      },
      { timeout: 5000 },
    );
    expect(links).toHaveLength(2);
    const h = await session.hoverDocument({
      textDocument: { uri },
      position: { line: 5, character: 4 },
    });
    expect((h!.contents as { value: string }).value).toContain('source:1:1');
  });
  it('문서 전체 출현은 2→1→0으로 갱신하고 행 출현은 Hint에 포함하지 않는다', async () => {
    const source = '@codocs [[대상]] @codocs [[대상]] @codocs [[대상]]#L5';
    const codeUri = await open('source', source);
    await session.documentLinks(codeUri);
    const uri = await open('.codocs/target.yaml', target);
    const before = await vi.waitFor(
      async () => {
        const result = await session.inlayHints(uri);
        expect(result[0]!.label).toEqual([
          { value: '문서 전체에 연결된 코드 · 2곳' },
        ]);
        return result;
      },
      { timeout: 5000 },
    );
    expect(before).toHaveLength(1);
    expect(before[0]!.label).toEqual([
      { value: '문서 전체에 연결된 코드 · 2곳' },
    ]);
    session.changeDocument({
      textDocument: { uri: codeUri, version: 2 },
      contentChanges: [{ text: '@codocs [[대상]] @codocs [[대상]]#L5' }],
    });
    await session.documentLinks(codeUri);
    const one = await vi.waitFor(
      async () => {
        const result = await session.inlayHints(uri);
        expect(
          (result[0]!.label as { command?: unknown }[])[0]!.command,
        ).toBeDefined();
        return result;
      },
      { timeout: 5000 },
    );
    const label = one[0]!.label as { command?: unknown }[];
    expect(label[0]!.command).toBeDefined();
    session.changeDocument({
      textDocument: { uri: codeUri, version: 3 },
      contentChanges: [{ text: '@codocs [[대상]]#L5' }],
    });
    await session.documentLinks(codeUri);
    await vi.waitFor(
      async () => expect(await session.inlayHints(uri)).toEqual([]),
      { timeout: 5000 },
    );
    expect(session.documents.get(uri)!.getText()).toBe(target);
  });
  it('이전 서버 세션이 발급한 코드 참조 링크를 새 세션에서 확인하면 이동 대상을 반환하지 않는다', async () => {
    const text = '@codocs [[업무:대상]]#L5-L6';
    const uri = await open('implementation', text);
    const links = await vi.waitFor(
      async () => {
        const result = await session.documentLinks(uri);
        expect(result).toHaveLength(1);
        // 발급 직후 수집 세대가 바뀌는 구간을 지나 현재 세션 확인까지 기다린다.
        expect(
          await session.confirmSource(argument(result[0]!.target!)),
        ).not.toBeNull();
        return result;
      },
      { timeout: 5000 },
    );
    // 첫 번째 세션에서 토큰이 발급되고 확인되는지 검증한다.
    const selected = argument(links[0]!.target!);
    const firstSessionConfirm = await session.confirmSource(selected);
    expect(firstSessionConfirm).not.toBeNull();
    // 새로운 세션을 생성한다.
    const newSession = new LanguageServerSession();
    try {
      await newSession.initialize({
        processId: null,
        rootUri: pathToFileURL(root).href,
        capabilities: {},
      });
      await newSession.refreshWorkspaces();
      // 새로운 세션에서 같은 문서를 연다.
      newSession.openDocument({
        textDocument: { uri, languageId: 'plaintext', version: 1, text },
      });
      // 첫 번째 세션에서 발급한 토큰을 새 세션에서 확인하면 null을 반환한다.
      const newSessionConfirm = await newSession.confirmSource(selected);
      expect(newSessionConfirm).toBeNull();
    } finally {
      // 새 세션을 정리한다.
      await newSession.close();
    }
  });
});
