import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LanguageServerSession } from './index.js';
import { SourceSelections } from '../navigation/index.js';
import { escapeMarkdown } from '../hover/index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

let root: string;
let session: LanguageServerSession;
const refund =
  '_codocs:\n  id: refund\n  name: 환불\n환불정책: 기준\n"예외": 없음\n';

beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  root = await mkdtemp(path.resolve('.workbench/fixtures/section-'));
  await mkdir(path.join(root, '.codocs'));
  await writeFile(path.join(root, '.codocs/refund.yaml'), refund);
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

/** 문서를 열고 링크와 각 링크에 발급된 선택을 함께 돌려준다. */
async function open(
  file: string,
  text: string,
  capture: MockInstance<SourceSelections['capture']>,
) {
  const uri = pathToFileURL(path.join(root, '.codocs', file)).href;
  await writeFile(path.join(root, '.codocs', file), text);
  await session.refreshWorkspaces();
  session.openDocument({
    textDocument: { uri, version: 1, languageId: 'yaml', text },
  });
  capture.mockClear();
  const links = await session.documentLinks(uri);
  const selections = capture.mock.results.map((item) => item.value as unknown);
  return { uri, links, selections };
}

describe('섹션 링크 이동', () => {
  it('[[환불]]은 문서 맨 위, [[환불:환불정책]]은 대상 파일의 섹션 키 범위를 확인한다', async () => {
    const capture = vi.spyOn(SourceSelections.prototype, 'capture');
    try {
      const source =
        '_codocs:\n  id: source\n  name: Source\n본문: "[[환불]] [[환불:환불정책]]"\n';
      const { links, selections } = await open('source.yaml', source, capture);
      expect(links).toHaveLength(2);
      expect(links.map((link) => link.tooltip)).toEqual([
        escapeMarkdown('원문 열기: 환불 (.codocs/refund.yaml)'),
        escapeMarkdown('환불:환불정책 · .codocs/refund.yaml'),
      ]);
      const targetUri = pathToFileURL(
        path.join(root, '.codocs/refund.yaml'),
      ).href;
      expect(await session.confirmSource(selections[0])).toEqual({
        uri: targetUri,
      });
      expect(await session.confirmSource(selections[1])).toEqual({
        uri: targetUri,
        destination: {
          kind: 'occurrence',
          range: {
            start: { line: 3, character: 0 },
            end: { line: 3, character: 4 },
          },
          markerText: '환불정책',
        },
      });
    } finally {
      capture.mockRestore();
    }
  });

  it('없는 섹션은 링크가 없고 클릭 직전 대상에서 섹션이 사라지면 열지 않는다', async () => {
    const capture = vi.spyOn(SourceSelections.prototype, 'capture');
    try {
      const { links, selections } = await open(
        'source.yaml',
        '_codocs:\n  id: source\n  name: Source\n본문: "[[환불:없음]] [[환불:환불정책]]"\n',
        capture,
      );
      expect(links).toHaveLength(1);
      await writeFile(
        path.join(root, '.codocs/refund.yaml'),
        refund.replace('환불정책', '다른정책'),
      );
      await session.refreshWorkspaces();
      expect(await session.confirmSource(selections[0])).toBeNull();
    } finally {
      capture.mockRestore();
    }
  });

  it('같은 문서의 [[환불:예외]]는 현재 편집 내용의 키로 이동하고 [[환불]]은 링크가 없다', async () => {
    const capture = vi.spyOn(SourceSelections.prototype, 'capture');
    try {
      const text = refund + '메모: "[[환불:예외]] [[환불]]"\n';
      const { uri, links, selections } = await open(
        'refund.yaml',
        text,
        capture,
      );
      expect(links).toHaveLength(1);
      expect(links[0]!.tooltip).toBe(
        escapeMarkdown('환불:예외 · .codocs/refund.yaml'),
      );
      expect(await session.confirmSource(selections[0])).toEqual({
        uri,
        destination: {
          kind: 'occurrence',
          range: {
            start: { line: 4, character: 0 },
            end: { line: 4, character: 4 },
          },
          markerText: '"예외"',
        },
      });
    } finally {
      capture.mockRestore();
    }
  });

  it('저장하지 않은 편집으로 만든 같은 문서 섹션도 현재 편집 내용에서 확인한다', async () => {
    const capture = vi.spyOn(SourceSelections.prototype, 'capture');
    try {
      const text = refund + '메모: "[[환불:새섹션]]"\n';
      const { uri, links } = await open('refund.yaml', text, capture);
      expect(links).toHaveLength(0);
      const edited = refund + '새섹션: 값\n메모: "[[환불:새섹션]]"\n';
      session.changeDocument({
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: edited }],
      });
      capture.mockClear();
      const fresh = await session.documentLinks(uri);
      expect(fresh).toHaveLength(1);
      const selection: unknown = capture.mock.results.at(-1)!.value;
      expect(await session.confirmSource(selection)).toMatchObject({
        destination: { markerText: '새섹션' },
      });
    } finally {
      capture.mockRestore();
    }
  });
});
