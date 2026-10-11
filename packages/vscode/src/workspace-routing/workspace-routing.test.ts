import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  isOwnedByWorkspaceRoot,
  nearestWorkspaceRoot,
  nestedWorkspaceRoots,
  routeOwnedRequest,
} from './index.js';

describe('nearestWorkspaceRoot: workspace 문서 소유권', () => {
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

describe('nestedWorkspaceRoots: 별도 workspace folder로 열린 하위 폴더', () => {
  it('선택한 folder 안에 열린 folder만 고르고 자기 자신과 바깥·이름 접두사만 같은 folder는 고르지 않는다', () => {
    const parent = { fsPath: path.resolve('/projects/app'), uri: 'parent' };
    const nested = {
      fsPath: path.resolve('/projects/app/packages/feature'),
      uri: 'nested',
    };
    const sibling = {
      fsPath: path.resolve('/projects/application'),
      uri: 'sibling',
    };
    const outside = { fsPath: path.resolve('/projects'), uri: 'outside' };
    const roots = [parent, nested, sibling, outside];

    expect(nestedWorkspaceRoots(parent, roots)).toEqual([nested]);
    expect(nestedWorkspaceRoots(nested, roots)).toEqual([]);
  });
});
