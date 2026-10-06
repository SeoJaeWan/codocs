import { describe, expect, it, vi } from 'vitest';
import {
  openSource,
  openSourceCommand,
  trustGeneratedOpenSourceHoverContents,
  type OpenSourceHost,
  OpenSourceFailure,
  OpenSourceFailureReporter,
  openSourceFailureReasons,
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
      expect(host.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: openSourceFailureReasons.confirmationRejected,
          sourceUri: argument.sourceUri,
        }),
      );
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
      expect(host.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: openSourceFailureReasons.invalidSelection,
        }),
      );
    },
  );

  it.each(['ENOENT', 'EACCES', 'internal'])(
    '검증 뒤 %s 오류가 나면 표시하지 않고 파일 접근 실패와 상세를 기록한다',
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
      expect(host.reportError).toHaveBeenCalledTimes(1);
      expect(host.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: openSourceFailureReasons.fileAccessFailed,
          sourceUri: argument.sourceUri,
          cause: error,
        }),
      );
    },
  );
  it.each([
    { phase: 'confirm', reason: openSourceFailureReasons.confirmationFailed },
    { phase: 'show', reason: openSourceFailureReasons.displayFailed },
  ])(
    '$phase 오류가 나면 실패한 경계와 상세를 기록한다',
    async ({ phase, reason }) => {
      const error = new Error('test failure');
      const document = { uri, text: '미저장 내용' };
      const host: OpenSourceHost = {
        confirmSource: vi.fn(() =>
          phase === 'confirm'
            ? Promise.reject(error)
            : Promise.resolve({ uri }),
        ),
        findOpenDocument: () => document,
        findExistingViewColumn: () => 2,
        openDocument: vi.fn(),
        showDocument: vi.fn(() => Promise.reject(error)),
        reportError: vi.fn(),
      };
      expect(await openSource(argument, host)).toBe(false);
      expect(host.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ reason, cause: error }),
      );
      expect(document.text).toBe('미저장 내용');
      expect(host.openDocument).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: '행 번호 목적지처럼 지원하지 않는 종류이면',
      destination: { kind: 'rows', startLine: 2, endLine: 8 },
      text: '첫 행\n끝',
    },
    {
      name: '확인된 범위의 표기가 바뀌면',
      destination: {
        kind: 'occurrence',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        markerText: '@codocs [[대상]]',
      },
      text: '다른 표기의 원문',
    },
  ])(
    '$name 파일을 열지 않고 목적지 불가 실패를 기록한다',
    async ({ destination, text }) => {
      const document = { uri, text };
      const host: OpenSourceHost = {
        confirmSource: vi.fn(() => Promise.resolve({ uri, destination })),
        findOpenDocument: () => document,
        findExistingViewColumn: vi.fn(),
        openDocument: vi.fn(),
        showDocument: vi.fn(),
        reportError: vi.fn(),
      };
      expect(await openSource(argument, host)).toBe(false);
      expect(host.showDocument).not.toHaveBeenCalled();
      expect(host.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: openSourceFailureReasons.destinationUnavailable,
          sourceUri: argument.sourceUri,
        }),
      );
    },
  );
});

describe('OpenSourceFailureReporter', () => {
  it('사유·출처·상세가 같은 반복 실패만 억제하고 토큰은 출력하지 않는다', () => {
    const appendLine = vi.fn();
    const reporter = new OpenSourceFailureReporter(appendLine);
    const failure = new OpenSourceFailure(
      openSourceFailureReasons.fileAccessFailed,
      argument,
      new Error('EACCES'),
    );
    reporter.report(failure);
    reporter.report(
      new OpenSourceFailure(
        openSourceFailureReasons.confirmationRejected,
        argument,
      ),
    );
    reporter.report(
      new OpenSourceFailure(
        openSourceFailureReasons.fileAccessFailed,
        { ...argument, token: 'b'.repeat(32) },
        new Error('EACCES'),
      ),
    );
    reporter.report(
      new OpenSourceFailure(
        openSourceFailureReasons.fileAccessFailed,
        { ...argument, sourceUri: 'file:///other/source.ts' },
        new Error('EACCES'),
      ),
    );
    expect(appendLine).toHaveBeenCalledTimes(3);
    expect(appendLine.mock.calls[0]![0]).toContain('EACCES');
    expect(appendLine.mock.calls[0]![0]).toContain(argument.sourceUri);
    expect(appendLine.mock.calls[0]![0]).not.toContain(argument.token);
  });
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

describe('명시 목적지와 실제 buffer 선택', () => {
  it('섹션 키 위치를 현재 buffer의 같은 텍스트 위치로 선택한다', async () => {
    const { sourceSelection } = await import('./index.js');
    const range = {
      start: { line: 2, character: 0 },
      end: { line: 2, character: 4 },
    };
    expect(
      sourceSelection('_codocs:\n  name: 대상\n환불정책:\n  본문: 값', {
        kind: 'occurrence',
        range,
        markerText: '환불정책',
      }),
    ).toEqual(range);
  });
  it('저장 이후 편집으로 섹션 키 위치의 텍스트가 달라지면 선택하지 않는다', async () => {
    const { sourceSelection } = await import('./index.js');
    expect(
      sourceSelection('_codocs:\n  name: 대상\n삽입한 줄\n환불정책:\n', {
        kind: 'occurrence',
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 4 },
        },
        markerText: '환불정책',
      }),
    ).toBeUndefined();
  });
  it.each([
    { kind: 'rows', startLine: 2, endLine: 3 },
    { kind: 'rows', startLine: 0, endLine: 1 },
  ])(
    '행 번호 목적지 $startLine~$endLine은 지원하지 않아 선택하지 않는다',
    async (destination) => {
      const { sourceSelection } = await import('./index.js');
      expect(sourceSelection('첫 행\n끝', destination)).toBeUndefined();
    },
  );
  it('역참조의 정확한 UTF-16 span을 그대로 선택한다', async () => {
    const { sourceSelection } = await import('./index.js');
    const range = {
      start: { line: 0, character: 3 },
      end: { line: 0, character: 17 },
    };
    expect(
      sourceSelection('😀 @codocs [[대상]]', {
        kind: 'occurrence',
        range,
        markerText: '@codocs [[대상]]',
      }),
    ).toEqual(range);
  });
});

it('확인 뒤 실제 buffer에서 표기가 달라지면 같은 열 범위도 선택하지 않는다', async () => {
  const { sourceSelection } = await import('./index.js');
  expect(
    sourceSelection('다른 표기의 원문', {
      kind: 'occurrence',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      },
      markerText: '@codocs [[대상]]',
    }),
  ).toBeUndefined();
});
