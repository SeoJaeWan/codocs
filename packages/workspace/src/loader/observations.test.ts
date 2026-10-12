import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsWorkspacePath } from './observations.js';

describe('containsWorkspacePath: 같은 경로 또는 하위 경로 판단', () => {
  it.each([
    {
      name: 'win32 규칙에서 같은 경로이면 포함한다',
      pathModule: path.win32,
      parent: 'C:\\work\\Project\\.codocs',
      child: 'C:\\work\\Project\\.codocs',
      expected: true,
    },
    {
      name: 'win32 규칙에서 하위 경로이면 포함한다',
      pathModule: path.win32,
      parent: 'C:\\work\\Project\\.codocs',
      child: 'C:\\work\\Project\\.codocs\\sub\\a.yaml',
      expected: true,
    },
    {
      name: 'win32 규칙에서 `..`로 시작하는 이름의 하위 폴더는 포함한다',
      pathModule: path.win32,
      parent: 'C:\\work\\Project\\.codocs',
      child: 'C:\\work\\Project\\.codocs\\..hidden\\a.yaml',
      expected: true,
    },
    {
      name: 'win32 규칙에서 상위 경로이면 포함하지 않는다',
      pathModule: path.win32,
      parent: 'C:\\work\\Project\\.codocs',
      child: 'C:\\work\\Project',
      expected: false,
    },
    {
      name: 'win32 규칙에서 다른 드라이브이면 포함하지 않는다',
      pathModule: path.win32,
      parent: 'C:\\work\\Project\\.codocs',
      child: 'D:\\work\\Project\\.codocs\\a.yaml',
      expected: false,
    },
    {
      name: 'posix 규칙에서 하위 경로이면 포함한다',
      pathModule: path.posix,
      parent: '/work/Project/.codocs',
      child: '/work/Project/.codocs/sub/a.yaml',
      expected: true,
    },
    {
      name: 'posix 규칙에서 형제 경로이면 포함하지 않는다',
      pathModule: path.posix,
      parent: '/work/Project/.codocs',
      child: '/work/Project/.codocs-other/a.yaml',
      expected: false,
    },
  ])('$name', ({ pathModule, parent, child, expected }) => {
    expect(containsWorkspacePath(parent, child, pathModule)).toBe(expected);
  });
});
