import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { packageMcp, packageVSIX } from './release.mjs';
import { releaseMetadata } from './release-metadata.mjs';
import { readZip } from '@vscode/vsce/out/zip.js';
import { assertReleaseAssets } from './release-assets.mjs';

for (const eol of ['\n', '\r\n'])
  test(`${eol === '\n' ? 'LF' : 'CRLF'} 체크아웃의 실제 tgz·VSIX가 같은 LF 설명·라이선스와 원본 바이너리를 담는다`, /** 실제 격리 자원을 준비하고 관측 뒤 정리한다. */ async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-metadata-'));
    const logo = await readFile(new URL('../../logo.png', import.meta.url));
    const notice = Buffer.from('Third-party original\r\nLicense bytes\r\n');
    try {
      for (const directory of [
        'packages/mcp/dist',
        'packages/vscode/dist',
        'docs/guide',
        'examples/.codocs',
        'out',
      ])
        await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(
        path.join(root, 'packages/mcp/package.json'),
        JSON.stringify({ version: '0.0.1', license: 'MIT' }),
      );
      await writeFile(
        path.join(root, 'packages/mcp/dist/cli.js'),
        'console.log("fixture");\n',
      );
      await writeFile(
        path.join(root, 'packages/vscode/package.json'),
        JSON.stringify({
          name: 'fixture',
          publisher: 'fixture',
          version: '0.0.1',
          engines: { vscode: '^1.100.0' },
          license: 'MIT',
          icon: 'logo.png',
          repository: {
            type: 'git',
            url: 'https://github.com/SeoJaeWan/codocs.git',
          },
        }),
      );
      await writeFile(
        path.join(root, 'packages/vscode/dist/THIRD-PARTY-NOTICES.txt'),
        notice,
      );
      for (const file of ['README.md', 'README.ko.md'])
        await writeFile(
          path.join(root, file),
          '# Fixture\n\n[Guide](docs/guide/README.md)\nIssue #123\n'.replaceAll(
            '\n',
            eol,
          ),
        );
      await writeFile(
        path.join(root, 'LICENSE'),
        'MIT fixture\nCopyright fixture\n'.replaceAll('\n', eol),
      );
      await writeFile(path.join(root, 'logo.png'), logo);
      const guide = '# Guide\n\n[Binary](image.bin)\n';
      const example = 'id: fixture\nname: Fixture\ndefinition: Example\n';
      await writeFile(
        path.join(root, 'docs/guide/README.md'),
        guide.replaceAll('\n', eol),
      );
      await writeFile(
        path.join(root, 'examples/.codocs/fixture.yaml'),
        example.replaceAll('\n', eol),
      );
      await writeFile(
        path.join(root, 'docs/guide/image.bin'),
        Buffer.from([0, 255, 13, 10, 128]),
      );
      const vsix = path.join(root, 'out/fixture.vsix');
      await packageVSIX(root, vsix);
      const tgz = await packageMcp(root, path.join(root, 'out'));
      for (const [archive, prefix, web] of [
        [vsix, 'extension', true],
        [tgz, 'package', false],
      ]) {
        const extracted = path.join(root, web ? 'vsix' : 'npm');
        await mkdir(extracted);
        const zipped = web
          ? await readZip(archive, (entry) => !entry.endsWith('/'))
          : undefined;
        if (zipped) {
          for (const [entry, bytes] of zipped) {
            // readZip 키는 소문자지만 실제 fixture의 원래 자산 경로로만 복원한다.
            const original =
              entry === 'extension/dist/docs/guide/readme.md'
                ? 'extension/dist/docs/guide/README.md'
                : entry;
            const target = path.join(extracted, original);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, bytes);
          }
        } else {
          execFileSync(
            process.platform === 'win32'
              ? path.join(process.env.SystemRoot, 'System32/tar.exe')
              : 'tar',
            ['-xf', archive, '-C', extracted],
          );
        }
        const directory = path.join(extracted, prefix);
        /** 실제 압축 파일의 원본 엔트리 바이트를 읽는다. */
        const archiveBytes = (file) =>
          zipped
            ? Promise.resolve(zipped.get((prefix + '/' + file).toLowerCase()))
            : readFile(path.join(directory, file));
        assert.deepEqual(
          await archiveBytes('dist/docs/guide/README.md'),
          Buffer.from(guide),
        );
        assert.deepEqual(
          await archiveBytes('dist/examples/.codocs/fixture.yaml'),
          Buffer.from(example),
        );
        assert.deepEqual(
          await archiveBytes('dist/docs/guide/image.bin'),
          Buffer.from([0, 255, 13, 10, 128]),
        );
        // 예상 원본만 반대 줄바꿈으로 바꾸어도 제품 자체의 LF 바이트를 그대로 비교한다.
        await writeFile(
          path.join(root, 'docs/guide/README.md'),
          guide.replaceAll('\n', eol === '\n' ? '\r\n' : '\n'),
        );
        await writeFile(
          path.join(root, 'examples/.codocs/fixture.yaml'),
          example.replaceAll('\n', eol === '\n' ? '\r\n' : '\n'),
        );

        await assertReleaseAssets(root, path.join(directory, 'dist'));
        const expected =
          '# Fixture\n\n[Guide](' +
          (web
            ? 'https://github.com/SeoJaeWan/codocs/blob/main/docs/guide/README.md'
            : 'dist/docs/guide/README.md') +
          ')\nIssue #123\n';
        for (const file of ['README.md', 'README.ko.md']) {
          const bytes = await archiveBytes(file);
          assert.deepEqual(bytes, Buffer.from(expected));
          // 반대 OS 체크아웃에서도 예상 바이트가 실제 압축 파일과 같아야 한다.
          await writeFile(
            path.join(root, file),
            '# Fixture\n\n[Guide](docs/guide/README.md)\nIssue #123\n'.replaceAll(
              '\n',
              eol === '\n' ? '\r\n' : '\n',
            ),
          );
          assert.deepEqual(bytes, await releaseMetadata(root, file, web));
        }
        assert.equal(
          (await archiveBytes(web ? 'LICENSE.txt' : 'LICENSE')).toString(
            'utf8',
          ),
          'MIT fixture\nCopyright fixture\n',
        );
        assert.deepEqual(await archiveBytes('logo.png'), logo);
        if (web)
          assert.deepEqual(
            await archiveBytes('dist/THIRD-PARTY-NOTICES.txt'),
            notice,
          );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
