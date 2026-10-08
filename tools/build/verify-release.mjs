import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdir,
  readdir,
  mkdtemp,
  readFile,
  writeFile,
  access,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { releaseMetadata } from './release-metadata.mjs';
import { readProductVersions } from './release-contract.mjs';
import { assertReleaseAssets } from './release-assets.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'packages/mcp/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
} = require('@modelcontextprotocol/sdk/client/stdio.js');

/** yauzl로 zip을 열어 게으른 항목 읽기 모드의 핸들을 돌려준다. */
function openZip(file) {
  return new Promise(
    /** 열기 결과를 약속에 연결한다. */ (resolve, reject) => {
      yauzl.open(file, { lazyEntries: true }, (error, zipfile) =>
        error ? reject(error) : resolve(zipfile),
      );
    },
  );
}

/** zip 항목을 하나씩 읽어 visit에 넘기고, 오류나 끝에서 파일을 닫는다. 이름의 대소문자는 그대로 둔다. */
async function walkZip(file, visit) {
  const zipfile = await openZip(file);
  await new Promise(
    /** 항목 순회 결과를 약속에 연결한다. */ (resolve, reject) => {
      zipfile.on('error', reject);
      zipfile.on('end', resolve);
      zipfile.on(
        'entry',
        /** 항목을 방문하고 다음 항목을 읽는다. */ (entry) => {
          Promise.resolve(visit(entry, zipfile)).then(
            () => zipfile.readEntry(),
            reject,
          );
        },
      );
      zipfile.readEntry();
    },
  ).finally(() => zipfile.close());
}

/** 시스템 tar 없이 zip의 항목 이름을 대소문자 그대로 나열한다. */
export async function listZip(file) {
  const names = [];
  await walkZip(file, (entry) => {
    names.push(entry.fileName);
  });
  return names;
}

/** 절대 경로나 대상 폴더 밖으로 나가는 항목 이름을 거부하고 안전한 경로를 돌려준다. */
export function safeZipPath(directory, name) {
  const target = path.resolve(directory, name);
  const relative = path.relative(path.resolve(directory), target);
  if (
    !name ||
    /^[\\/]/u.test(name) ||
    /^[A-Za-z]:/u.test(name) ||
    name.split(/[\\/]/u).includes('..') ||
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  )
    throw new Error('Unsafe zip entry path: ' + name);
  return target;
}

/** 시스템 tar 없이 zip을 풀고, 폴더 항목은 폴더만 만들며 안전하지 않은 항목은 실패한다. */
export async function extractZip(file, directory) {
  await walkZip(
    file,
    /** 항목 하나를 안전하게 해제한다. */ async (entry, zipfile) => {
      const target = safeZipPath(directory, entry.fileName);
      if (entry.fileName.endsWith('/')) {
        await mkdir(target, { recursive: true });
        return;
      }
      await mkdir(path.dirname(target), { recursive: true });
      const stream = await new Promise(
        /** 읽기 스트림을 약속에 연결한다. */ (resolve, reject) => {
          zipfile.openReadStream(entry, (error, opened) =>
            error ? reject(error) : resolve(opened),
          );
        },
      );
      await pipeline(stream, createWriteStream(target));
    },
  );
}

/** npm의 실제 JS 진입점을 찾아 shell 해석 없이 설치한다. */
export async function installMcp(archive, consumer, expectedVersion) {
  const candidates = [
    path.join(
      path.dirname(process.execPath),
      'node_modules/npm/bin/npm-cli.js',
    ),
    path.resolve(
      path.dirname(process.execPath),
      '../lib/node_modules/npm/bin/npm-cli.js',
    ),
  ];
  let npm;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      npm = candidate;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!npm) throw new Error('현재 Node 설치의 npm CLI를 찾을 수 없습니다');
  await mkdir(consumer, { recursive: true });
  await writeFile(path.join(consumer, 'package.json'), '{"private":true}\n');
  execFileSync(
    process.execPath,
    [
      npm,
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      path.join(consumer, 'npm-cache'),
      path.resolve(archive),
    ],
    {
      cwd: consumer,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_PATH: '',
        npm_config_registry: 'https://registry.npmjs.org',
      },
    },
  );
  const directory = path.join(consumer, 'node_modules/co-documentation');
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.name, 'co-documentation');
  assert.equal(
    manifest.version,
    expectedVersion ?? (await readProductVersions(root)).npm,
  );
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.engines.node, '24.x');
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.exports, undefined);
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.bin, { codocs: './dist/runtime/cli.js' });
  assert.equal(manifest.type, 'module');
  await access(path.join(directory, manifest.bin.codocs));
  await access(path.join(directory, 'dist/THIRD-PARTY-NOTICES.txt'));
  await assertReleaseAssets(root, path.join(directory, 'dist'));
  return {
    directory,
    entry: path.join(directory, manifest.bin.codocs),
    bin: path.join(
      consumer,
      'node_modules/.bin/codocs' + (process.platform === 'win32' ? '.cmd' : ''),
    ),
  };
}

/** 저장소 밖에 설치한 bin의 시작·SDK 연결·도구 등록만 확인한다. */
export async function verifyMcp(archive, temporary, expectedVersion) {
  const installed = await installMcp(
    archive,
    path.join(temporary, 'consumer'),
    expectedVersion,
  );
  const version = expectedVersion ?? (await readProductVersions(root)).npm;
  const project = path.join(temporary, '한글 project');
  await mkdir(path.join(project, '.codocs'), { recursive: true });
  const client = new Client({ name: 'release-verifier', version: '1' });
  const transport = new StdioClientTransport({
    command: installed.bin,
    args: ['--project', project],
    cwd: temporary,
    env: { ...process.env, NODE_PATH: '' },
    stderr: 'pipe',
  });
  let stderr = '';
  let tools;
  try {
    await client.connect(transport);
    transport.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    assert.deepEqual(client.getServerVersion(), {
      name: 'co-documentation',
      version,
    });
    tools = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(tools, [
      'codocs_list',
      'codocs_get',
      'codocs_search',
      'codocs_refresh',
      'codocs_validate',
      'codocs_write',
      'codocs_rename',
      'codocs_guide',
    ]);
  } finally {
    await client.close();
  }
  return { ...installed, tools, stderr, closed: true };
}

/** 고정 출력 폴더에서 tgz와 VSIX를 하나씩 고르며 개수가 다르면 개수를 밝히고 실패한다. */
export async function releaseFiles(directory) {
  const names = await readdir(directory);
  const tgz = names.filter((name) => name.endsWith('.tgz'));
  const vsix = names.filter((name) => name.endsWith('.vsix'));
  if (tgz.length !== 1 || vsix.length !== 1)
    throw new Error(
      'Expected exactly one .tgz and one .vsix in ' +
        directory +
        ', found ' +
        tgz.length +
        ' .tgz and ' +
        vsix.length +
        ' .vsix',
    );
  return {
    tgz: path.join(directory, tgz[0]),
    vsix: path.join(directory, vsix[0]),
  };
}

/** 명시한 기존 산출물을 재빌드 없이 검사하고 외부 소비자 증거를 남긴다. */
export async function verifyRelease(tgz, vsix, versions) {
  assert.equal(process.versions.node.split('.')[0], '24');
  versions ??= await readProductVersions(root);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'codocs-release-'));
  const output = path.join(
    root,
    '.workbench/release-verification',
    path.basename(temporary),
  );
  await mkdir(output, { recursive: true });
  const evidence = {
    platform: process.platform,
    arch: process.arch,
    os: os.release(),
    node: process.versions.node,
    temporary,
    passed: false,
    artifacts: [],
  };
  try {
    for (const [file, list] of [
      [
        tgz,
        /** tgz는 tar로 나열한다. */ () =>
          execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
            .split(/\r?\n/u)
            .filter(Boolean),
      ],
      [vsix, /** VSIX는 zip이라 yauzl로 나열한다. */ () => listZip(vsix)],
    ]) {
      const files = await list();
      assert.ok(
        files.every(
          (entry) =>
            !/(^|\/)(src|test|test-support|node_modules)\/|\.test\.|\.spec\.|\.map$|\.d\.ts$|logo\.prompt/u.test(
              entry,
            ),
        ),
        files.join('\n'),
      );
      evidence.artifacts.push({
        file,
        sha256: createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
        files,
      });
    }
    const extracted = path.join(temporary, 'vsix');
    await mkdir(extracted);
    await extractZip(vsix, extracted);
    const extension = path.join(extracted, 'extension');
    const manifest = JSON.parse(
      await readFile(path.join(extension, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.publisher + '.' + manifest.name, 'seojaewan.codocs');
    assert.equal(manifest.version, versions.vscode);
    assert.equal(manifest.main, './dist/index.cjs');
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.devDependencies, undefined);
    const sourceManifest = JSON.parse(
      await readFile(path.join(root, 'packages/vscode/package.json'), 'utf8'),
    );
    assert.deepEqual(manifest.engines, sourceManifest.engines);
    assert.deepEqual(
      manifest.activationEvents,
      sourceManifest.activationEvents,
    );
    assert.deepEqual(manifest.contributes, sourceManifest.contributes);
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.icon, 'logo.png');
    assert.equal(
      manifest.repository.url,
      'https://github.com/SeoJaeWan/codocs.git',
    );
    for (const file of ['README.md', 'README.ko.md', 'LICENSE', 'logo.png'])
      assert.deepEqual(
        await readFile(
          path.join(
            extension,
            file === 'LICENSE'
              ? 'LICENSE.txt'
              : file === 'README.md'
                ? 'readme.md'
                : file,
          ),
        ),
        await releaseMetadata(root, file, true),
      );
    for (const file of [
      'dist/index.cjs',
      'dist/server/index.cjs',
      'dist/THIRD-PARTY-NOTICES.txt',
      'dist/server/THIRD-PARTY-NOTICES.txt',
    ])
      await access(path.join(extension, file));
    await assertReleaseAssets(root, path.join(extension, 'dist'));
    assert.deepEqual(
      await readFile(path.join(extension, 'dist/server/index.cjs')),
      await readFile(
        path.join(root, 'packages/language-server/dist/index.cjs'),
      ),
    );
    evidence.mcp = await verifyMcp(tgz, temporary, versions.npm);
    for (const file of ['README.md', 'README.ko.md', 'LICENSE', 'logo.png'])
      assert.deepEqual(
        await readFile(path.join(evidence.mcp.directory, file)),
        await releaseMetadata(root, file),
      );
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.stack ?? String(error);
    throw error;
  } finally {
    try {
      await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
      evidence.cleaned = true;
    } catch (error) {
      evidence.cleaned = false;
      evidence.cleanupError = error.stack ?? String(error);
      if (evidence.passed) {
        evidence.passed = false;
        throw error;
      }
    } finally {
      await writeFile(
        path.join(output, 'result.json'),
        JSON.stringify(evidence, null, 2) + '\n',
      );
      console.log('Release verification: ' + output);
    }
  }
  return evidence;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && args.length !== 2)
    throw new Error(
      'Usage: node tools/build/verify-release.mjs [<tgz> <vsix>]',
    );
  const files =
    args.length === 0
      ? await releaseFiles(path.join(root, '.workbench/release'))
      : { tgz: path.resolve(args[0]), vsix: path.resolve(args[1]) };
  await verifyRelease(files.tgz, files.vsix);
}
