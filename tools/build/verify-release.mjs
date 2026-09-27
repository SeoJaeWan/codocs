import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  access,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'packages/mcp/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
} = require('@modelcontextprotocol/sdk/client/stdio.js');

/** npm의 실제 JS 진입점을 찾아 shell 해석 없이 설치한다. */
export async function installMcp(archive, consumer) {
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
  assert.equal(manifest.version, '0.0.1');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.engines.node, '24.x');
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.exports, undefined);
  assert.equal(manifest.dependencies, undefined);
  return {
    directory,
    entry: path.join(directory, manifest.bin.codocs),
    bin: path.join(
      consumer,
      'node_modules/.bin/codocs' + (process.platform === 'win32' ? '.cmd' : ''),
    ),
  };
}

/** 설치된 bin으로 MCP 전체 흐름과 번들 자산 및 EOF 종료를 확인한다. */
export async function verifyMcp(archive, temporary) {
  const consumer = path.join(temporary, 'consumer');
  const installed = await installMcp(archive, consumer);
  const project = path.join(temporary, '한글 project');
  await mkdir(project);
  await cp(
    path.join(installed.directory, 'dist/examples/.codocs'),
    path.join(project, '.codocs'),
    { recursive: true },
  );
  const client = new Client({ name: 'release-verifier', version: '1' });
  const transport = new StdioClientTransport({
    command: installed.bin,
    args: ['--project', project],
    cwd: temporary,
    env: { ...process.env, NODE_PATH: '' },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  const observations = [];
  let exit;
  /** 성공 응답을 검사하고 원문을 증거로 보존한다. */
  async function call(name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, false, JSON.stringify(response));
    assert.deepEqual(
      JSON.parse(response.content[0].text),
      response.structuredContent,
    );
    observations.push({
      name,
      input: args,
      response: response.structuredContent,
    });
    return response.structuredContent;
  }
  try {
    await client.connect(transport);
    // 고정 SDK의 실제 자식을 관찰해 close()의 강제 종료를 정상 EOF로 오인하지 않는다.
    const child = transport._process;
    assert.ok(child);
    exit = new Promise(
      /** 실제 자식 종료 결과를 보존한다. */ (resolve) =>
        child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    assert.deepEqual(client.getServerVersion(), {
      name: 'co-documentation',
      version: '0.0.1',
    });
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      [
        'codocs_list',
        'codocs_get',
        'codocs_refresh',
        'codocs_validate',
        'codocs_write',
        'codocs_guide',
      ],
    );
    for (const [topic, file] of Object.entries({
      overview: 'README.md',
      schema: 'schema.md',
      writing: 'writing.md',
      examples: 'examples.md',
      updating: 'updating.md',
      validation: 'validation.md',
    })) {
      const guide = await call('codocs_guide', { topic });
      assert.equal(
        guide.content,
        await readFile(
          path.join(installed.directory, 'dist/docs/guide', file),
          'utf8',
        ),
      );
    }
    await call('codocs_refresh');
    await call('codocs_list');
    const got = await call('codocs_get', { ids: ['sample-order'] });
    assert.equal(got.results[0].document.id, 'sample-order');
    await call('codocs_validate');
    const created = await call('codocs_write', {
      mode: 'create',
      path: '.codocs/release-probe.yaml',
      document: {
        id: 'release-probe',
        name: 'Release probe',
        definition: 'Before update',
        domains: ['Release'],
      },
    });
    assert.equal(created.saved, true);
    const current = await call('codocs_get', { ids: ['release-probe'] });
    const updated = await call('codocs_write', {
      mode: 'update',
      id: 'release-probe',
      revision: current.results[0].revision,
      set: { definition: 'After update' },
    });
    assert.equal(updated.saved, true);
    assert.equal(
      (await call('codocs_get', { ids: ['release-probe'] })).results[0].document
        .definition,
      'After update',
    );
    await call('codocs_refresh');
    await call('codocs_validate', { path: '.codocs/release-probe.yaml' });
  } finally {
    await client.close();
  }
  const ended = await exit;
  assert.deepEqual(ended, { code: 0, signal: null }, '정상 EOF 종료');
  return { ...installed, observations, stderr, exit: ended, closed: true };
}

/** 명시한 기존 산출물을 재빌드 없이 검사하고 외부 소비자 증거를 남긴다. */
export async function verifyRelease(tgz, vsix) {
  assert.equal(process.versions.node.split('.')[0], '24');
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
    for (const [file, flags] of [
      [tgz, '-tzf'],
      [vsix, '-tf'],
    ]) {
      const files = execFileSync('tar', [flags, file], { encoding: 'utf8' })
        .split(/\r?\n/u)
        .filter(Boolean);
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
    execFileSync('tar', ['-xf', vsix, '-C', extracted]);
    const extension = path.join(extracted, 'extension');
    const manifest = JSON.parse(
      await readFile(path.join(extension, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.publisher + '.' + manifest.name, 'seojaewan.codocs');
    assert.equal(manifest.version, '0.0.1');
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
        file.endsWith('.md')
          ? Buffer.from(
              (await readFile(path.join(root, file), 'utf8')).replace(
                /\]\((?!https?:)([^)]+)\)/gu,
                (_, link) =>
                  '](https://github.com/SeoJaeWan/codocs/blob/main/' +
                  link +
                  ')',
              ),
            )
          : await readFile(path.join(root, file)),
      );
    for (const file of [
      'dist/index.cjs',
      'dist/server/index.cjs',
      'dist/THIRD-PARTY-NOTICES.txt',
      'dist/server/THIRD-PARTY-NOTICES.txt',
    ])
      await access(path.join(extension, file));
    evidence.mcp = await verifyMcp(tgz, temporary);
    for (const file of ['README.md', 'README.ko.md', 'LICENSE', 'logo.png'])
      assert.deepEqual(
        await readFile(path.join(evidence.mcp.directory, file)),
        file.endsWith('.md')
          ? Buffer.from(
              (await readFile(path.join(root, file), 'utf8')).replace(
                /\]\((docs\/guide\/|examples\/)/gu,
                '](dist/$1',
              ),
            )
          : await readFile(path.join(root, file)),
      );
    evidence.passed = true;
  } catch (error) {
    evidence.error = error.stack ?? String(error);
    throw error;
  } finally {
    await writeFile(
      path.join(output, 'result.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log('Release verification: ' + output);
  }
  return evidence;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [tgz, vsix, ...extra] = process.argv.slice(2);
  if (!tgz || !vsix || extra.length)
    throw new Error('Usage: node tools/build/verify-release.mjs <tgz> <vsix>');
  await verifyRelease(path.resolve(tgz), path.resolve(vsix));
}
