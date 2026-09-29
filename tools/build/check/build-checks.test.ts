import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { packageMcp, packageVSIX } from '../release.mjs';
import { verifyRelease } from '../verify-release.mjs';

const root = process.cwd();
const fixture = mkdtempSync(path.join(tmpdir(), 'codocs-final-package-'));
afterAll(
  /** 실행별 패키징 자원만 정리한다. */ () => {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  },
);

/** 실제 빌드 출력 전체를 상대 경로로 읽는다. */
function outputFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? outputFiles(path.join(directory, entry.name)).map(
          (file) => entry.name + '/' + file,
        )
      : [entry.name],
  );
}

describe('최종 제품 구성과 최소 MCP 설치 확인', () => {
  it.each(['core', 'workspace', 'mcp', 'language-server', 'vscode'])(
    '%s의 실행·선언 출력을 만들고 테스트를 제외한다',
    (folder) => {
      const directory = path.join(root, 'packages', folder, 'dist');
      const extension = ['language-server', 'vscode'].includes(folder)
        ? 'cjs'
        : 'js';
      expect(existsSync(path.join(directory, 'index.' + extension))).toBe(true);
      expect(existsSync(path.join(directory, 'index.d.ts'))).toBe(true);
      expect(
        outputFiles(directory).every(
          (file) =>
            !/(^|\/)(test-support)\/|\.(test|spec)\.[cm]?[jt]s(?:\.map)?$/u.test(
              file,
            ),
        ),
      ).toBe(true);
    },
  );
  it('MCP tarball과 VSIX의 manifest·자산·번들을 검사하고 설치된 MCP에 연결해 도구 등록만 확인한다', async () => {
    const tgz = await packageMcp(root, fixture);
    const vsix = path.join(fixture, 'codocs.vsix');
    await packageVSIX(root, vsix);
    const evidence = await verifyRelease(tgz, vsix);
    expect(evidence.passed).toBe(true);
    expect(evidence).toMatchObject({ cleaned: true });
    expect(evidence).toMatchObject({
      mcp: {
        closed: true,
        tools: [
          'codocs_list',
          'codocs_get',
          'codocs_refresh',
          'codocs_validate',
          'codocs_write',
          'codocs_guide',
        ],
      },
    });
    expect(existsSync(evidence.temporary)).toBe(false);
    const files = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' });
    expect(files).toContain('package/dist/runtime/cli.js');
    const server = readFileSync(
      path.join(root, 'packages/vscode/dist/server/index.cjs'),
    );
    expect(server).toEqual(
      readFileSync(path.join(root, 'packages/language-server/dist/index.cjs')),
    );
  });
});
