import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertNodeVersion } from '../toolchain.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const folders = ['core', 'workspace', 'mcp', 'language-server', 'vscode'];
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');

/** 별도 TypeScript 프로세스를 실행하고 실패 상태를 전달한다. */
function compile(folder, extra = []) {
  const result = spawnSync(
    process.execPath,
    [
      tsc,
      '-p',
      path.join(root, 'packages', folder, 'tsconfig.build.json'),
      ...extra,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`TypeScript failed: ${folder} (${result.status})`);
}

/** 출력 디렉터리만 초기화해 이전 빌드 파일이 남지 않게 한다. */
function clean() {
  for (const folder of folders)
    rmSync(path.join(root, 'packages', folder, 'dist'), {
      recursive: true,
      force: true,
    });
}

/** IDE 번들은 타입 검사와 독립적으로 생성한다. */
export async function bundleIde(entryPoints, outfile, external = []) {
  return build({
    entryPoints,
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.19',
    external,
    sourcemap: true,
    metafile: true,
  });
}

/** 가이드와 가상 프로젝트 및 서버 파일을 소비 패키지에 함께 배치한다. */
function copyAssets() {
  for (const folder of ['mcp', 'vscode']) {
    const output = path.join(root, 'packages', folder, 'dist');
    cpSync(path.join(root, 'docs/guide'), path.join(output, 'docs/guide'), {
      recursive: true,
    });
    cpSync(
      path.join(root, 'examples/.codocs'),
      path.join(output, 'examples/.codocs'),
      { recursive: true },
    );
  }
  cpSync(
    path.join(root, 'packages/language-server/dist/index.cjs'),
    path.join(root, 'packages/vscode/dist/server/index.cjs'),
  );
  cpSync(
    path.join(root, 'packages/language-server/dist/index.cjs.map'),
    path.join(root, 'packages/vscode/dist/server/index.cjs.map'),
  );
}

/** 런타임 출력과 선언 파일을 의존 순서대로 만들거나 독립 타입 검사를 수행한다. */
async function main(mode) {
  assertNodeVersion();
  if (!['build', 'bundle', 'typecheck'].includes(mode))
    throw new Error('Expected build, bundle, or typecheck');
  if (mode === 'typecheck') {
    // package exports의 실제 d.ts를 준비하며 JS/번들은 생성하지 않는다.
    for (const folder of folders) compile(folder, ['--emitDeclarationOnly']);
    const result = spawnSync(
      process.execPath,
      [tsc, '--noEmit', '-p', path.join(root, 'tsconfig.json')],
      { cwd: root, stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Root typecheck failed');
    for (const folder of folders) {
      const result = spawnSync(
        process.execPath,
        [
          tsc,
          '--noEmit',
          '-p',
          path.join(root, 'packages', folder, 'tsconfig.json'),
        ],
        { cwd: root, stdio: 'inherit' },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Typecheck failed: ${folder}`);
    }
    return;
  }
  clean();
  // 독립 bundle은 JS transpile에만 tsc --noCheck를 사용한다.
  for (const folder of ['core', 'workspace', 'mcp'])
    compile(folder, mode === 'bundle' ? ['--noCheck'] : []);
  for (const folder of ['language-server', 'vscode']) {
    if (mode === 'build') compile(folder, ['--emitDeclarationOnly']);
    await bundleIde(
      [path.join(root, 'packages', folder, 'src/index.ts')],
      path.join(root, 'packages', folder, 'dist/index.cjs'),
      folder === 'vscode' ? ['vscode'] : [],
    );
  }
  copyAssets();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv[2]);
}
