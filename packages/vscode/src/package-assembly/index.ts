import path from 'node:path';

/** 설치된 확장 루트에서 번들된 language server 진입점을 계산한다. */
export function bundledServerPath(extensionRoot: string): string {
  return path.join(extensionRoot, 'dist/server/index.cjs');
}
