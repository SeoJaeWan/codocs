import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** 실제 CLI 소스를 실행별 임시 번들로 준비하고 제품 dist와 분리한다. */
export async function createSourceCli(): Promise<{
  entry: string;
  close(): Promise<void>;
}> {
  await mkdir(path.join(root, '.workbench'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.workbench/mcp-source-'));
  const entry = path.join(directory, 'dist/runtime/cli.mjs');
  try {
    await build({
      absWorkingDir: root,
      entryPoints: ['packages/mcp/src/cli.ts'],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      alias: {
        '@codocs/core': path.join(root, 'packages/core/src/index.ts'),
        '@codocs/workspace': path.join(root, 'packages/workspace/src/index.ts'),
      },
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: 'silent',
    });
    await cp(
      path.join(root, 'packages/mcp/package.json'),
      path.join(directory, 'package.json'),
    );
    await cp(
      path.join(root, 'docs/guide'),
      path.join(directory, 'dist/docs/guide'),
      { recursive: true },
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    entry,
    /** CLI 프로세스가 모두 종료된 뒤 실행별 번들만 정리한다. */
    close: () => rm(directory, { recursive: true, force: true, maxRetries: 3 }),
  };
}
