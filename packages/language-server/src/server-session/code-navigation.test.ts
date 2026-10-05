import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LanguageServerSession } from './index.js';
let root: string;
let session: LanguageServerSession;
const target =
  '_codocs:\n  id: target\n  name: 대상\n환불정책:\n  본문: 첫째\n지급정책:\n  본문: 둘째\n';
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
/** 출처의 문서 링크가 정해진 개수가 될 때까지 기다린다. */
async function waitForLinks(uri: string, count: number) {
  return vi.waitFor(
    async () => {
      const result = await session.documentLinks(uri);
      expect(result).toHaveLength(count);
      return result;
    },
    { timeout: 5000 },
  );
}
/** 출처 문서의 진단 목록을 읽는다. */
async function diagnosticsOf(uri: string) {
  const result = await session.diagnostics();
  return result!.documents.find((item) => item.uri === uri)?.diagnostics ?? [];
}
/** 첫 진단이 나타날 때까지 기다린다. */
async function waitForDiagnostic(uri: string) {
  return vi.waitFor(
    async () => {
      const found = (await diagnosticsOf(uri))[0];
      expect(found).toBeDefined();
      return found!;
    },
    { timeout: 5000 },
  );
}
/** 섹션 키 위 Hover 본문을 읽는다. */
async function hoverAtKey(uri: string): Promise<string> {
  const value = await session.hoverDocument({
    textDocument: { uri },
    position: { line: 3, character: 2 },
  });
  return (value!.contents as { value: string }).value;
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
  it('섹션 표기를 클릭하면 대상 문서의 섹션 키로 이동하는 목적지를 확인한다', async () => {
    const text = '😀 @codocs [[대상:환불정책]]';
    const uri = await open('implementation', text);
    const links = await waitForLinks(uri, 1);
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
    expect(await session.confirmSource(argument(links[0]!.target!))).toEqual({
      uri: pathToFileURL(path.join(root, '.codocs/target.yaml')).href,
      destination: {
        kind: 'occurrence',
        markerText: '환불정책',
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 4 },
        },
      },
    });
  });
  it('문서 전체 표기를 클릭하면 문서 맨 위로 이동하는 목적지를 확인한다', async () => {
    const uri = await open('implementation', '@codocs [[대상]]');
    const links = await waitForLinks(uri, 1);
    expect(await session.confirmSource(argument(links[0]!.target!))).toEqual({
      uri: pathToFileURL(path.join(root, '.codocs/target.yaml')).href,
      destination: { kind: 'top' },
    });
  });
  it('닫힘 뒤 #L2 접미사는 일반 글자로 두어 대괄호까지만 링크하고 진단하지 않는다', async () => {
    const uri = await open('implementation', '@codocs [[대상]]#L2');
    const links = await waitForLinks(uri, 1);
    expect(links[0]!.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 14 },
    });
    expect(await diagnosticsOf(uri)).toEqual([]);
  });
  it.each([
    ['@codocs [[대상:없는섹션]]', 'missing_section'],
    ['@codocs [[없는문서:환불정책]]', 'missing'],
    ['@codocs [[없는문서]]', 'missing'],
  ])('%s는 링크 없이 %s 진단을 낸다', async (text, status) => {
    const uri = await open('invalid', text);
    const diagnostic = await waitForDiagnostic(uri);
    expect(diagnostic.code).toBe(`codocs.codeReference.${status}`);
    expect(diagnostic.message).toBeTruthy();
    expect(diagnostic.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: text.length },
    });
    expect(await session.documentLinks(uri)).toEqual([]);
  });
  it('섹션 부재 진단은 문서 부재 진단과 다른 고정 메시지를 쓴다', async () => {
    const missingSection = await open('a', '@codocs [[대상:없음]]');
    const missingDocument = await open('b', '@codocs [[없음]]');
    const first = await waitForDiagnostic(missingSection);
    const second = await waitForDiagnostic(missingDocument);
    expect(first.message).not.toBe(second.message);
  });
  it('같은 이름의 문서가 둘이면 섹션 표기도 ambiguous 진단을 내고 링크하지 않는다', async () => {
    await writeFile(
      path.join(root, '.codocs/copy.yaml'),
      target.replace('id: target', 'id: copy'),
    );
    await session.refreshWorkspaces();
    const uri = await open('implementation', '@codocs [[대상:환불정책]]');
    const diagnostic = await waitForDiagnostic(uri);
    expect(diagnostic.code).toBe('codocs.codeReference.ambiguous');
    expect(await session.documentLinks(uri)).toEqual([]);
  });
  it('출처 표기를 편집하거나 닫으면 화면에 남은 링크를 거부한다', async () => {
    const uri = await open('source', '@codocs [[대상]]');
    const links = await waitForLinks(uri, 1);
    const selected = argument(links[0]!.target!);
    expect(await session.confirmSource(selected)).toEqual({
      uri: pathToFileURL(path.join(root, '.codocs/target.yaml')).href,
      destination: { kind: 'top' },
    });
    session.changeDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: '표기 제거' }],
    });
    expect(await session.confirmSource(selected)).toBeNull();
    session.closeDocument(uri);
    expect(await session.confirmSource(selected)).toBeNull();
  });
});
describe('섹션 역참조 Hover와 개수 Hint', () => {
  /** 섹션 표기 n개를 한 줄에 하나씩 가진 출처 원문이다. */
  const sources = (count: number) =>
    Array.from({ length: count }, () => '// @codocs [[대상:환불정책]]').join(
      '\n',
    );
  it.each([1, 3])(
    '섹션 키 Hover에 코드 출현 %i개가 같은 목록 형식으로 나오고 각 항목은 정확한 위치로 이동한다',
    async (count) => {
      const sourceUri = await open('implementation', sources(count));
      await session.documentLinks(sourceUri);
      const uri = await open('.codocs/target.yaml', target);
      const matches = await vi.waitFor(
        async () => {
          const markdown = await hoverAtKey(uri);
          // 한국어 완료 표시와 실제 개별 링크를 확인해 수집 중 응답을 구분한다.
          expect(markdown).toContain(`연결된 코드 · ${count}곳`);
          expect(markdown).not.toContain('수집 중');
          const found = [
            ...markdown.matchAll(/command:codocs.openSource\?([^)]*)/gu),
          ];
          expect(found).toHaveLength(count);
          return found;
        },
        { timeout: 5000 },
      );
      for (let index = 0; index < count; index++) {
        const selected = JSON.parse(
          decodeURIComponent(matches[index]![1]!),
        ) as unknown[];
        expect(await session.confirmSource(selected[0])).toEqual({
          uri: sourceUri,
          destination: {
            kind: 'occurrence',
            markerText: '@codocs [[대상:환불정책]]',
            range: {
              start: { line: index, character: 3 },
              end: { line: index, character: 3 + 19 },
            },
          },
        });
      }
    },
  );
  it('name 값 Hover에는 섹션 없는 표기만 나온다', async () => {
    const sourceUri = await open(
      'implementation',
      '@codocs [[대상]]\n@codocs [[대상:환불정책]]',
    );
    await session.documentLinks(sourceUri);
    const uri = await open('.codocs/target.yaml', target);
    const markdown = await vi.waitFor(
      async () => {
        const value = await session.hoverDocument({
          textDocument: { uri },
          position: { line: 2, character: 9 },
        });
        const text = (value!.contents as { value: string }).value;
        expect(text).toContain('연결된 코드 · 1곳');
        return text;
      },
      { timeout: 5000 },
    );
    expect(markdown).toContain('implementation:1:1');
    expect(markdown).not.toContain('implementation:2:1');
  });
  it('코드에 줄을 추가해 표기가 이동하면 Hover의 위치만 바뀐다', async () => {
    const sourceUri = await open(
      'implementation',
      '// @codocs [[대상:환불정책]]',
    );
    await session.documentLinks(sourceUri);
    const uri = await open('.codocs/target.yaml', target);
    await vi.waitFor(
      async () => expect(await hoverAtKey(uri)).toContain('implementation:1:4'),
      { timeout: 5000 },
    );
    session.changeDocument({
      textDocument: { uri: sourceUri, version: 2 },
      contentChanges: [{ text: '// 앞줄\n// @codocs [[대상:환불정책]]' }],
    });
    await session.documentLinks(sourceUri);
    await vi.waitFor(
      async () => {
        const markdown = await hoverAtKey(uri);
        expect(markdown).toContain('implementation:2:4');
        expect(markdown).not.toContain('implementation:1:4');
        expect(markdown).toContain('연결된 코드 · 1곳');
      },
      { timeout: 5000 },
    );
  });
  it('섹션 키 옆 Hint는 코드 N곳을 클릭 명령 없이 보이고 0곳이 되면 사라진다', async () => {
    const codeUri = await open('source', sources(2));
    await session.documentLinks(codeUri);
    const uri = await open('.codocs/target.yaml', target);
    const hints = await vi.waitFor(
      async () => {
        const result = await session.inlayHints(uri);
        expect(result.map((hint) => hint.label)).toEqual([
          [{ value: '코드 2곳' }],
        ]);
        return result;
      },
      { timeout: 5000 },
    );
    expect(hints[0]!.position).toEqual({ line: 3, character: 4 });
    expect(
      (hints[0]!.label as { command?: unknown }[])[0]!.command,
    ).toBeUndefined();
    session.changeDocument({
      textDocument: { uri: codeUri, version: 2 },
      contentChanges: [{ text: '표기 제거' }],
    });
    await session.documentLinks(codeUri);
    await vi.waitFor(
      async () => expect(await session.inlayHints(uri)).toEqual([]),
      { timeout: 5000 },
    );
    expect(session.documents.get(uri)!.getText()).toBe(target);
  });
  it('문서 전체 표기는 첫 행에 코드 N곳 Hint로 보이고 섹션 표기는 포함하지 않는다', async () => {
    const codeUri = await open(
      'source',
      '@codocs [[대상]] @codocs [[대상]] @codocs [[대상:환불정책]]',
    );
    await session.documentLinks(codeUri);
    const uri = await open('.codocs/target.yaml', target);
    await vi.waitFor(
      async () => {
        const result = await session.inlayHints(uri);
        expect(result.map((hint) => [hint.position, hint.label])).toEqual([
          [{ line: 0, character: 0 }, [{ value: '코드 2곳' }]],
          [{ line: 3, character: 4 }, [{ value: '코드 1곳' }]],
        ]);
      },
      { timeout: 5000 },
    );
  });
  it('이전 서버 세션이 발급한 코드 참조 링크를 새 세션에서 확인하면 이동 대상을 반환하지 않는다', async () => {
    const text = '@codocs [[대상:환불정책]]';
    const uri = await open('implementation', text);
    const links = await waitForLinks(uri, 1);
    // 첫 번째 세션에서 토큰이 발급되고 확인되는지 검증한다.
    const selected = argument(links[0]!.target!);
    expect(await session.confirmSource(selected)).toMatchObject({
      uri: pathToFileURL(path.join(root, '.codocs/target.yaml')).href,
      destination: { kind: 'occurrence', markerText: '환불정책' },
    });
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
      expect(await newSession.confirmSource(selected)).toBeNull();
    } finally {
      // 새 세션을 정리한다.
      await newSession.close();
    }
  });
});
