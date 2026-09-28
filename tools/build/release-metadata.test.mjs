import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { packageMcp, packageVSIX } from './release.mjs';
import { releaseMetadata } from './release-metadata.mjs';

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
      const vsix = path.join(root, 'out/fixture.vsix');
      await packageVSIX(root, vsix);
      const tgz = await packageMcp(root, path.join(root, 'out'));
      for (const [archive, prefix, web] of [
        [vsix, 'extension', true],
        [tgz, 'package', false],
      ]) {
        const extracted = path.join(root, web ? 'vsix' : 'npm');
        await mkdir(extracted);
        execFileSync(
          process.platform === 'win32'
            ? path.join(process.env.SystemRoot, 'System32/tar.exe')
            : 'tar',
          ['-xf', archive, '-C', extracted],
        );
        const directory = path.join(extracted, prefix);
        const expected =
          '# Fixture\n\n[Guide](' +
          (web
            ? 'https://github.com/SeoJaeWan/codocs/blob/main/docs/guide/README.md'
            : 'dist/docs/guide/README.md') +
          ')\nIssue #123\n';
        for (const file of ['README.md', 'README.ko.md']) {
          const bytes = await readFile(
            path.join(
              directory,
              web && file === 'README.md' ? 'readme.md' : file,
            ),
          );
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
          await readFile(
            path.join(directory, web ? 'LICENSE.txt' : 'LICENSE'),
            'utf8',
          ),
          'MIT fixture\nCopyright fixture\n',
        );
        assert.deepEqual(
          await readFile(path.join(directory, 'logo.png')),
          logo,
        );
        if (web)
          assert.deepEqual(
            await readFile(
              path.join(directory, 'dist/THIRD-PARTY-NOTICES.txt'),
            ),
            notice,
          );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
