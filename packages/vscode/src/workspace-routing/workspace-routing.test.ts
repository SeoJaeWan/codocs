import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  isOwnedByWorkspaceRoot,
  nearestWorkspaceRoot,
  routeOwnedRequest,
} from './index.js';

// @codocs [[VS Code:언어 서버 연결]]
describe('nearestWorkspaceRoot: workspace 문서 소유권', () => {
  // @codocs [[VS Code:언어 서버 연결]]#L20
  it('중첩된 workspace에서는 문서에 가장 가까운 루트를 선택한다', () => {
    const parent = { fsPath: path.resolve('/projects/app'), uri: 'parent' };
    const nested = {
      fsPath: path.resolve('/projects/app/packages/feature'),
      uri: 'nested',
    };
    const document = path.join(nested.fsPath, 'src/index.ts');

    expect(nearestWorkspaceRoot(document, [parent, nested])).toBe(nested);
    expect(isOwnedByWorkspaceRoot(document, parent, [parent, nested])).toBe(
      false,
    );
    expect(isOwnedByWorkspaceRoot(document, nested, [parent, nested])).toBe(
      true,
    );
  });

  // @codocs [[VS Code:언어 서버 연결]]#L21
  it('workspace 밖 문서와 이름 접두사만 같은 경로는 선택하지 않는다', () => {
    const root = { fsPath: path.resolve('/projects/app'), uri: 'root' };

    expect(nearestWorkspaceRoot('/projects/application/a.ts', [root])).toBe(
      undefined,
    );
    expect(nearestWorkspaceRoot('/outside/a.ts', [root])).toBe(undefined);
  });

  it('중첩 workspace의 Hover는 가장 가까운 루트에서만 요청한다', async () => {
    const parent = { fsPath: path.resolve('/projects/app'), uri: 'parent' };
    const nested = {
      fsPath: path.resolve('/projects/app/packages/feature'),
      uri: 'nested',
    };
    const document = path.join(nested.fsPath, 'src/index.ts');
    const roots = [parent, nested];
    const parentRequest = vi.fn(() => Promise.resolve('parent hover'));
    const nestedRequest = vi.fn(() => Promise.resolve('nested hover'));

    const parentHover = await routeOwnedRequest(
      document,
      parent,
      roots,
      parentRequest,
    );
    const nestedHover = await routeOwnedRequest(
      document,
      nested,
      roots,
      nestedRequest,
    );

    expect(parentHover).toBeUndefined();
    expect(parentRequest).not.toHaveBeenCalled();
    expect(nestedHover).toBe('nested hover');
    expect(nestedRequest).toHaveBeenCalledOnce();
  });
});
