import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isWin32PathModule,
  splitPathInput,
  splitWorkspaceInput,
  toOsPath,
  toProjectPath,
} from './project-path.js';

describe('isWin32PathModule: 경로 규칙 판별', () => {
  it.each([
    {
      name: 'path.win32이면 true를 반환한다',
      pathModule: path.win32,
      win32: true,
    },
    {
      name: 'path.posix이면 false를 반환한다',
      pathModule: path.posix,
      win32: false,
    },
  ])('$name', ({ pathModule, win32 }) => {
    expect(isWin32PathModule(pathModule)).toBe(win32);
  });
});

describe('toProjectPath: 파일 시스템 경로를 / 구분 프로젝트 경로로 변환', () => {
  it.each([
    {
      name: 'win32 경로의 `\\` 구분자를 `/`로 바꾸고 대소문자·Unicode를 보존한다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      target: 'C:\\work\\Project\\.codocs\\한글 공간\\Mixed.yaml',
      expected: '.codocs/한글 공간/Mixed.yaml',
    },
    {
      name: 'posix 경로는 `/` 구분자와 대소문자·Unicode를 그대로 둔다',
      pathModule: path.posix,
      root: '/work/Project',
      target: '/work/Project/.codocs/한글 공간/Mixed.yaml',
      expected: '.codocs/한글 공간/Mixed.yaml',
    },
    {
      name: 'posix 경로의 `\\`는 구분자가 아니라 파일 이름의 문자이므로 바꾸지 않는다',
      pathModule: path.posix,
      root: '/work/Project',
      target: '/work/Project/.codocs/a\\b.yaml',
      expected: '.codocs/a\\b.yaml',
    },
    {
      name: 'win32 루트와 같은 경로이면 빈 문자열을 반환한다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      target: 'C:\\work\\Project',
      expected: '',
    },
    {
      name: 'win32 루트 밖 경로이면 `..`로 시작하는 `/` 경로를 반환한다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      target: 'C:\\work\\Other\\a.yaml',
      expected: '../Other/a.yaml',
    },
  ])('$name', ({ pathModule, root, target, expected }) => {
    expect(toProjectPath(root, target, pathModule)).toBe(expected);
  });

  it('같은 폴더 구조의 win32와 posix 경로는 같은 프로젝트 경로와 정렬 순서를 만든다', () => {
    // `/`(0x2F)는 `0`(0x30) 앞이고 `\`(0x5C)는 `0` 뒤라서 구분자 표기가 정렬을 바꾼다.
    const names = ['a0b.yaml', 'a/b.yaml', 'a-b.yaml'];

    const win32 = names.map((name) =>
      toProjectPath(
        'C:\\work',
        path.win32.join('C:\\work', '.codocs', ...name.split('/')),
        path.win32,
      ),
    );
    const posix = names.map((name) =>
      toProjectPath(
        '/work',
        path.posix.join('/work', '.codocs', ...name.split('/')),
        path.posix,
      ),
    );

    expect(win32).toEqual(posix);
    expect([...win32].sort()).toEqual([
      '.codocs/a-b.yaml',
      '.codocs/a/b.yaml',
      '.codocs/a0b.yaml',
    ]);
  });
});

describe('toOsPath: 프로젝트 경로를 OS 경로로 변환', () => {
  it.each([
    {
      name: 'win32 규칙이면 `/` 경로를 `\\` 구분의 루트 아래 경로로 바꾼다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      expected: 'C:\\work\\Project\\.codocs\\한글 공간\\Mixed.yaml',
    },
    {
      name: 'posix 규칙이면 `/` 구분의 루트 아래 경로를 만든다',
      pathModule: path.posix,
      root: '/work/Project',
      expected: '/work/Project/.codocs/한글 공간/Mixed.yaml',
    },
  ])('$name', ({ pathModule, root, expected }) => {
    expect(toOsPath(root, '.codocs/한글 공간/Mixed.yaml', pathModule)).toBe(
      expected,
    );
  });
});

describe('splitPathInput: 입력 경로의 구분자 분리', () => {
  it.each([
    {
      name: 'win32 규칙이면 `\\`와 `/`를 모두 구분자로 나눈다',
      pathModule: path.win32,
      input: '.codocs\\a/b.yaml',
      expected: ['.codocs', 'a', 'b.yaml'],
    },
    {
      name: 'posix 규칙이면 `/`만 구분자로 나누고 `\\`는 구간 안의 문자로 둔다',
      pathModule: path.posix,
      input: '.codocs\\a/b.yaml',
      expected: ['.codocs\\a', 'b.yaml'],
    },
  ])('$name', ({ pathModule, input, expected }) => {
    expect(splitPathInput(input, pathModule)).toEqual(expected);
  });
});

describe('splitWorkspaceInput: 작업 공간 입력의 구간 분리', () => {
  it.each([
    {
      name: 'win32 규칙에서 `\\` 구분 상대 경로를 구간으로 나눈다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      input: '.codocs\\sub\\a.yaml',
      expected: { success: true, segments: ['.codocs', 'sub', 'a.yaml'] },
    },
    {
      name: 'win32 규칙에서 `/` 구분 상대 경로도 같은 구간으로 나눈다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      input: '.codocs/sub/a.yaml',
      expected: { success: true, segments: ['.codocs', 'sub', 'a.yaml'] },
    },
    {
      name: 'posix 규칙에서 `\\`는 구분자가 아니므로 한 구간으로 둔다',
      pathModule: path.posix,
      root: '/work/Project',
      input: '.codocs\\sub\\a.yaml',
      expected: { success: true, segments: ['.codocs\\sub\\a.yaml'] },
    },
    {
      name: 'win32 규칙에서 프로젝트 안의 절대 경로는 루트 이후 구간만 남긴다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      input: 'C:\\work\\Project\\.codocs\\a.yaml',
      expected: { success: true, segments: ['.codocs', 'a.yaml'] },
    },
    {
      name: 'posix 규칙에서 프로젝트 안의 절대 경로는 루트 이후 구간만 남긴다',
      pathModule: path.posix,
      root: '/work/Project',
      input: '/work/Project/.codocs/a.yaml',
      expected: { success: true, segments: ['.codocs', 'a.yaml'] },
    },
    {
      name: 'win32 규칙에서 루트 밖 절대 경로이면 실패한다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      input: 'C:\\work\\Other\\.codocs\\a.yaml',
      expected: { success: false },
    },
    {
      name: 'win32 규칙에서 다른 드라이브의 상대 지정(D:a.yaml)이면 실패한다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      input: 'D:a.yaml',
      expected: { success: false },
    },
    {
      name: 'posix 규칙에서 루트 밖 절대 경로이면 실패한다',
      pathModule: path.posix,
      root: '/work/Project',
      input: '/work/Other/.codocs/a.yaml',
      expected: { success: false },
    },
    {
      name: '앞쪽의 `.` 구간은 제거하고 끝 구분자는 폴더 지정(`.`)으로 남긴다',
      pathModule: path.win32,
      root: 'C:\\work\\Project',
      input: '.\\.codocs\\sub\\',
      expected: { success: true, segments: ['.codocs', 'sub', '.'] },
    },
  ])('$name', ({ pathModule, root, input, expected }) => {
    expect(splitWorkspaceInput(root, input, pathModule)).toEqual(expected);
  });
});
