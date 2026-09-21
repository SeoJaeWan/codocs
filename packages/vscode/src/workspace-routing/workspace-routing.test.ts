/* eslint-disable codocs/korean-jsdoc -- 테스트 콜백이다. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOwnedByWorkspaceRoot, nearestWorkspaceRoot } from './index.js';

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
});
