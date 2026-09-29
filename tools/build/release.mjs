import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createVSIX } from '@vscode/vsce';
import { resolvePnpm, assertNodeVersion } from '../toolchain.mjs';
import { bundledNotices } from './notices.mjs';
import { releaseMetadata } from './release-metadata.mjs';
import { copyReleaseAssets } from './release-assets.mjs';
import { artifactName, readProductVersions } from './release-contract.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));

/** 공개 설명과 라이선스 및 원본 로고를 staging에 공급한다. */
export async function copyReleaseMetadata(root, staging, webLinks = false) {
  for (const file of ['README.md', 'README.ko.md', 'LICENSE', 'logo.png']) {
    await writeFile(
      path.join(staging, file),
      await releaseMetadata(root, file, webLinks),
    );
  }
}

/** 개발용 map과 선언을 제외하고 실행 파일을 복사한다. */
export async function copyRuntime(source, target) {
  await cp(source, target, {
    recursive: true,
    /** 개발 산출물은 공개 목록에서 제외한다. */
    filter: (filename) => !/\.(map|d\.ts)$/u.test(filename),
  });
}

/** 이미 빌드한 확장을 고유 staging에서 패키징하며 메타데이터 누락을 숨기지 않는다. */
export async function packageVSIX(root, archive) {
  await mkdir(path.dirname(archive), { recursive: true });
  const staging = await mkdtemp(
    path.join(path.dirname(archive), 'vsix-staging-'),
  );
  const manifest = JSON.parse(
    await readFile(path.join(root, 'packages/vscode/package.json'), 'utf8'),
  );
  delete manifest.scripts;
  delete manifest.devDependencies;
  delete manifest.dependencies;
  delete manifest.exports;
  delete manifest.private;
  manifest.files = ['dist', 'README.md', 'README.ko.md', 'LICENSE', 'logo.png'];
  await writeFile(
    path.join(staging, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await copyRuntime(
    path.join(root, 'packages/vscode/dist'),
    path.join(staging, 'dist'),
  );
  await copyReleaseAssets(root, path.join(staging, 'dist'));
  await copyReleaseMetadata(root, staging, true);
  await createVSIX({
    cwd: staging,
    packagePath: archive,
    dependencies: false,
    rewriteRelativeLinks: false,
  });
  return staging;
}

/** 내부 패키지를 ESM CLI에 묶어 공개 npm 하나만으로 실행 가능하게 조립한다. */
export async function packageMcp(root, output) {
  const staging = await mkdtemp(path.join(output, 'npm-staging-'));
  const source = JSON.parse(
    await readFile(path.join(root, 'packages/mcp/package.json'), 'utf8'),
  );
  const manifest = {
    name: 'co-documentation',
    version: source.version,
    description: 'Local project knowledge for AI assistants through MCP.',
    type: 'module',
    license: source.license,
    repository: source.repository,
    engines: { node: '24.x' },
    bin: { codocs: './dist/runtime/cli.js' },
    files: ['dist', 'README.md', 'README.ko.md', 'LICENSE', 'logo.png'],
  };
  await writeFile(
    path.join(staging, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: ['packages/mcp/dist/cli.js'],
    outfile: path.join(staging, 'dist/runtime/cli.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    metafile: true,
    banner: {
      js: "import { createRequire as codocsCreateRequire } from 'node:module'; const require = codocsCreateRequire(import.meta.url);",
    },
  });
  await writeFile(
    path.join(staging, 'dist/THIRD-PARTY-NOTICES.txt'),
    await bundledNotices(bundled.metafile, root),
  );
  await copyReleaseAssets(root, path.join(staging, 'dist'));
  await copyReleaseMetadata(root, staging);
  const archive = path.join(
    output,
    'co-documentation-' + manifest.version + '.tgz',
  );
  execFileSync(
    process.execPath,
    [resolvePnpm(), '--dir', staging, 'pack', '--out', archive],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  return archive;
}

/** 후보 산출물을 새 candidate 디렉터리에 한 번 만들고 그 경로를 반환한다. */
export async function packageRelease(root = repository, destination) {
  assertNodeVersion();
  const parent = destination ?? path.join(root, '.workbench/release');
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(path.join(parent, 'candidate-'));
  execFileSync(
    process.execPath,
    [path.join(root, 'tools/build/build.mjs'), 'build'],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  await packageMcp(root, output);
  const versions = await readProductVersions(root);
  await packageVSIX(
    root,
    path.join(output, artifactName('vscode', versions.vscode)),
  );
  console.log('Release candidate: ' + output);
  return output;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 2)
    throw new Error('Usage: node tools/build/release.mjs');
  await packageRelease();
}
