import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  openSource,
  openSourceCommand,
  trustGeneratedOpenSourceHoverContents,
  type OpenSourceDocument,
  type OpenSourceHost,
} from './index.js';

const sourceUri =
  'file:///workspace/.codocs/%ED%95%9C%EA%B8%80%20%EB%AC%B8%EC%84%9C.yaml';

/** 테스트 원문의 UTF-8 byte revision을 계산한다. */
function revision(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 열린 문서와 탭 상태를 독립적으로 지정할 수 있는 host를 만든다. */
function host(input: {
  document: OpenSourceDocument;
  opened?: boolean;
  viewColumn?: number;
}): OpenSourceHost<OpenSourceDocument> & {
  openDocument: ReturnType<typeof vi.fn>;
  showDocument: ReturnType<typeof vi.fn>;
} {
  return {
    findOpenDocument: (uri) =>
      input.opened && uri === input.document.uri ? input.document : undefined,
    findExistingViewColumn: (uri) =>
      uri === input.document.uri ? input.viewColumn : undefined,
    openDocument: vi.fn(() => Promise.resolve(input.document)),
    showDocument: vi.fn(() => Promise.resolve()),
  };
}

describe('openSource: 확인된 YAML 원문 열기', () => {
  it('한글과 공백 URI의 새 CRLF 탭을 열고 UTF-16 범위를 선택한다', async () => {
    const text = 'id: sample\r\ndefinition: 😀설명\r\n';
    const document = { uri: sourceUri, text };
    const vscodeHost = host({ document });
    const range = {
      start: { line: 1, character: 12 },
      end: { line: 1, character: 16 },
    };

    const opened = await openSource(
      { uri: sourceUri, range, catalogVersion: 7, revision: revision(text) },
      vscodeHost,
    );

    expect(opened).toBe(true);
    expect(vscodeHost.openDocument).toHaveBeenCalledWith(sourceUri);
    expect(vscodeHost.showDocument).toHaveBeenCalledWith(document, {
      preview: false,
      selection: range,
    });
  });

  it('이미 열린 dirty YAML은 같은 탭에서 현재 내용을 보존하고 오래된 범위를 적용하지 않는다', async () => {
    const document = {
      uri: sourceUri,
      text: 'id: dirty\ndefinition: 저장하지 않은 내용\n',
    };
    const vscodeHost = host({ document, opened: true, viewColumn: 3 });
    const before = document.text;

    const opened = await openSource(
      {
        uri: sourceUri,
        range: {
          start: { line: 1, character: 12 },
          end: { line: 1, character: 16 },
        },
        catalogVersion: 7,
        revision: revision('id: original\ndefinition: 이전 내용\n'),
      },
      vscodeHost,
    );

    expect(opened).toBe(true);
    expect(vscodeHost.openDocument).not.toHaveBeenCalled();
    expect(vscodeHost.showDocument).toHaveBeenCalledWith(document, {
      preview: false,
      viewColumn: 3,
    });
    expect(document.text).toBe(before);
  });

  it('보이지 않는 기존 탭도 원래 열에서 재사용하고 확인된 범위를 선택한다', async () => {
    const text = 'id: sample\ndefinition: 확인된 본문\n';
    const document = { uri: sourceUri, text };
    const vscodeHost = host({ document, opened: true, viewColumn: 6 });
    const range = {
      start: { line: 1, character: 12 },
      end: { line: 1, character: 18 },
    };

    await openSource(
      { uri: sourceUri, range, catalogVersion: 7, revision: revision(text) },
      vscodeHost,
    );

    expect(vscodeHost.openDocument).not.toHaveBeenCalled();
    expect(vscodeHost.showDocument).toHaveBeenCalledWith(document, {
      preview: false,
      viewColumn: 6,
      selection: range,
    });
  });

  it('현재 LF 원문 밖의 범위는 같은 revision이어도 선택하지 않는다', async () => {
    const text = 'id: sample\ndefinition: 짧음\n';
    const document = { uri: sourceUri, text };
    const vscodeHost = host({ document, opened: true });

    await openSource(
      {
        uri: sourceUri,
        range: {
          start: { line: 1, character: 12 },
          end: { line: 9, character: 0 },
        },
        catalogVersion: 7,
        revision: revision(text),
      },
      vscodeHost,
    );

    expect(vscodeHost.showDocument).toHaveBeenCalledWith(document, {
      preview: false,
    });
  });

  it.each([
    null,
    { uri: 'https://example.com/source.yaml', catalogVersion: 7 },
    { uri: sourceUri, catalogVersion: -1 },
    {
      uri: sourceUri,
      catalogVersion: 7,
      range: {
        start: { line: 2, character: 0 },
        end: { line: 1, character: 0 },
      },
    },
  ])('잘못된 명령 인자 %j는 문서나 탭을 열지 않는다', async (argument) => {
    const document = { uri: sourceUri, text: 'id: sample\n' };
    const vscodeHost = host({ document });

    const opened = await openSource(argument, vscodeHost);

    expect(opened).toBe(false);
    expect(vscodeHost.openDocument).not.toHaveBeenCalled();
    expect(vscodeHost.showDocument).not.toHaveBeenCalled();
  });

  it('SDK Hover contents 배열의 생성된 원문 링크에는 전용 명령 하나만 허용한다', () => {
    const markdown = {
      value: `[원문](command:${openSourceCommand}?%5B%7B%7D%5D)`,
    };
    const contents = [markdown, 'legacy text'];

    trustGeneratedOpenSourceHoverContents(contents);

    expect(contents).toEqual([
      {
        value: `[원문](command:${openSourceCommand}?%5B%7B%7D%5D)`,
        isTrusted: { enabledCommands: [openSourceCommand] },
      },
      'legacy text',
    ]);
    expect(openSourceCommand).toBe('codocs.openSource');
  });

  it('전용 원문 링크가 아닌 Markdown은 실행 권한을 부여하지 않는다', () => {
    const markdown = { value: '[외부](https://example.com)' };

    trustGeneratedOpenSourceHoverContents([markdown]);

    expect(markdown).toEqual({ value: '[외부](https://example.com)' });
  });
});
