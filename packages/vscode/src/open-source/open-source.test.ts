import { describe, expect, it, vi } from 'vitest';
import {
  openSource,
  openSourceCommand,
  trustGeneratedOpenSourceHoverContents,
  type OpenSourceHost,
} from './index.js';

const argument = {
  sourceUri: 'file:///workspace/source.ts',
  token: 'a'.repeat(32),
};
const uri =
  'file:///workspace/.codocs/%ED%95%9C%EA%B8%80%20%EB%AC%B8%EC%84%9C.yaml';
const selection = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

describe('openSource', () => {
  it.each([
    {
      name: '새 탭',
      opened: false,
      text: 'id: sample\r\ndefinition: 😀설명\r\n',
    },
    { name: '기존 탭', opened: true, text: 'id: sample\ndefinition: 설명\n' },
    { name: 'dirty 탭', opened: true, text: '저장하지 않은 수정' },
  ])(
    '$name 원문을 확인하면 내용을 보존하고 (0,0) 빈 선택으로 연다',
    async ({ opened, text }) => {
      const document = { uri, text };
      const host: OpenSourceHost = {
        confirmSource: vi.fn(() => Promise.resolve({ uri })),
        findOpenDocument: () => (opened ? document : undefined),
        findExistingViewColumn: () => (opened ? 3 : undefined),
        openDocument: vi.fn(() => Promise.resolve(document)),
        showDocument: vi.fn(() => Promise.resolve()),
        reportError: vi.fn(),
      };
      expect(await openSource(argument, host)).toBe(true);
      expect(host.confirmSource).toHaveBeenCalledWith(argument);
      expect(host.openDocument).toHaveBeenCalledTimes(opened ? 0 : 1);
      expect(host.showDocument).toHaveBeenCalledWith(document, {
        preview: false,
        ...(opened ? { viewColumn: 3 } : {}),
        selection,
      });
      expect(document.text).toBe(text);
    },
  );

  it.each([null, { uri: 'https://example.com' }, { uri: 'command:evil' }])(
    '최신 확인이 %j이면 파일을 열지 않는다',
    async (result) => {
      const host: OpenSourceHost = {
        confirmSource: vi.fn(() => Promise.resolve(result)),
        findOpenDocument: vi.fn(),
        findExistingViewColumn: vi.fn(),
        openDocument: vi.fn(),
        showDocument: vi.fn(),
        reportError: vi.fn(),
      };
      expect(await openSource(argument, host)).toBe(false);
      expect(host.openDocument).not.toHaveBeenCalled();
      expect(host.showDocument).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { uri, catalogVersion: 1 },
    { ...argument, token: 'forged' },
    { ...argument, sourceUri: 'command:evil' },
  ])(
    '외부 인자 %j가 유효하지 않으면 검증 요청도 보내지 않는다',
    async (input) => {
      const host: OpenSourceHost = {
        confirmSource: vi.fn(),
        findOpenDocument: vi.fn(),
        findExistingViewColumn: vi.fn(),
        openDocument: vi.fn(),
        showDocument: vi.fn(),
        reportError: vi.fn(),
      };
      expect(await openSource(input, host)).toBe(false);
      expect(host.confirmSource).not.toHaveBeenCalled();
    },
  );

  it.each(['ENOENT', 'EACCES', 'internal'])(
    '검증 뒤 %s 오류가 나면 팝업 없이 실패하고 내부 오류만 기록한다',
    async (code) => {
      const error = Object.assign(new Error(code), { code });
      const host: OpenSourceHost = {
        confirmSource: () => Promise.resolve({ uri }),
        findOpenDocument: vi.fn(),
        findExistingViewColumn: vi.fn(),
        openDocument: vi.fn(() => Promise.reject(error)),
        showDocument: vi.fn(),
        reportError: vi.fn(),
      };
      expect(await openSource(argument, host)).toBe(false);
      expect(host.showDocument).not.toHaveBeenCalled();
      expect(host.reportError).toHaveBeenCalledTimes(
        code === 'internal' ? 1 : 0,
      );
    },
  );
});

describe('trustGeneratedOpenSourceHoverContents', () => {
  it('생성한 링크를 신뢰할 때 openSource 명령만 허용한다', () => {
    const markdown = {
      value: `[원문](command:${openSourceCommand}?encoded)`,
      isTrusted: false as unknown,
    };
    trustGeneratedOpenSourceHoverContents([markdown]);
    expect(markdown.isTrusted).toEqual({
      enabledCommands: [openSourceCommand],
    });
  });
  it('외부 명령만 있는 Markdown에는 신뢰를 추가하지 않는다', () => {
    const markdown = { value: '[외부](command:evil)' };
    trustGeneratedOpenSourceHoverContents([markdown]);
    expect(markdown).not.toHaveProperty('isTrusted');
  });
});
