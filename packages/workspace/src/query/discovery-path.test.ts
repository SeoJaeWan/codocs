import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoveryPath } from './discovery-path.js';

describe('discoveryPath: 입력 경로를 발견 경로 표기로 통일', () => {
  it.each([
    {
      name: 'win32 규칙에서 `/`로 쓴 경로는 그대로 둔다',
      pathModule: path.win32,
      input: '.codocs/한글 공간/Mixed.yaml',
      expected: '.codocs/한글 공간/Mixed.yaml',
    },
    {
      name: 'win32 규칙에서 `\\` 구분자를 `/`로 바꾸고 대소문자·Unicode를 보존한다',
      pathModule: path.win32,
      input: '.codocs\\한글 공간\\Mixed.yaml',
      expected: '.codocs/한글 공간/Mixed.yaml',
    },
    {
      name: 'win32 규칙에서 `\\`와 `/`가 섞여도 모두 `/`로 통일한다',
      pathModule: path.win32,
      input: '.codocs\\A/B.yaml',
      expected: '.codocs/A/B.yaml',
    },
    {
      name: 'win32 규칙에서 링크 뒤 `..` 구간을 지우지 않는다',
      pathModule: path.win32,
      input: '.codocs\\연결\\..\\가.yaml',
      expected: '.codocs/연결/../가.yaml',
    },
    {
      name: 'posix 규칙에서 `/` 경로와 링크 뒤 `..` 구간을 그대로 둔다',
      pathModule: path.posix,
      input: '.codocs/연결/../가.yaml',
      expected: '.codocs/연결/../가.yaml',
    },
    {
      name: 'posix 규칙에서 `\\`는 구분자가 아니라 파일 이름의 문자이므로 바꾸지 않는다',
      pathModule: path.posix,
      input: '.codocs/A\\B.yaml',
      expected: '.codocs/A\\B.yaml',
    },
  ])('$name', ({ pathModule, input, expected }) => {
    expect(discoveryPath(input, pathModule)).toBe(expected);
  });
});
