import assert from 'node:assert/strict';
import { createGitFixtureEnvironment } from '../test/git-config.mjs';
const env = createGitFixtureEnvironment();
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(root, 'node_modules/@changesets/cli/bin.js');
/** 실제 CLI가 소비하는 독립 workspace와 Git 기준을 준비한다. */
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-changesets-'));
  await mkdir(path.join(directory, '.changeset'));
  await copyFile(
    path.join(root, '.changeset/config.json'),
    path.join(directory, '.changeset/config.json'),
  );
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: 'release-fixture',
      private: true,
      packageManager: 'pnpm@10.34.5',
    }),
  );
  await writeFile(
    path.join(directory, 'pnpm-workspace.yaml'),
    "packages: ['packages/*']\n",
  );
  for (const [name, manifest] of Object.entries({
    mcp: {
      name: '@codocs/mcp',
      version: '1.2.3',
      private: true,
      dependencies: { '@codocs/core': 'workspace:^' },
    },
    vscode: { name: 'codocs', version: '2.3.4', private: true },
    core: { name: '@codocs/core', version: '1.2.3', private: true },
  })) {
    await mkdir(path.join(directory, 'packages', name), { recursive: true });
    await writeFile(
      path.join(directory, 'packages', name, 'package.json'),
      JSON.stringify(manifest),
    );
  }
  execFileSync('git', ['init', '-b', 'develop'], {
    cwd: directory,
    env,
    stdio: 'pipe',
  });
  execFileSync('git', ['add', '.'], { cwd: directory, env });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'fixture',
    ],
    { cwd: directory, env, stdio: 'pipe' },
  );
  return directory;
}
/** 원본 fixture의 미출시 기록으로 공식 CLI를 실행한다. */
function version(directory) {
  return execFileSync(process.execPath, [cli, 'version'], {
    cwd: directory,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}
for (const scenario of [
  {
    title: 'npm만',
    entries: [{ '@codocs/mcp': 'patch' }],
    mcp: '1.2.4',
    vscode: '2.3.4',
  },
  {
    title: '확장만',
    entries: [{ codocs: 'minor' }],
    mcp: '1.2.3',
    vscode: '2.4.0',
  },
  {
    title: '두 제품을',
    entries: [{ '@codocs/mcp': 'patch', codocs: 'minor' }],
    mcp: '1.2.4',
    vscode: '2.4.0',
  },
  {
    title: 'patch a~e를',
    entries: Array.from(
      { length: 5 },
      /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => ({
        '@codocs/mcp': 'patch',
      }),
    ),
    mcp: '1.2.4',
    vscode: '2.3.4',
  },
  {
    title: 'private 의존성의 major를',
    entries: [{ '@codocs/core': 'major' }],
    mcp: '1.2.4',
    vscode: '2.3.4',
  },
]) {
  test(`${scenario.title} 기록하고 공식 CLI를 실행하면 독립 버전을 계산하며 동일 소스 반복 결과가 같다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const directory = await fixture();
    try {
      for (const [index, releases] of scenario.entries.entries())
        await writeFile(
          path.join(directory, `.changeset/change-${index}.md`),
          `---\n${Object.entries(releases)
            .map(
              /** 입력 조건과 관찰 결과를 계약에 대조한다. */ ([name, bump]) =>
                `${JSON.stringify(name)}: ${bump}`,
            )
            .join('\n')}\n---\n\n독립 변경 ${index}\n`,
        );
      execFileSync('git', ['add', '.'], { cwd: directory, env });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '-m',
          'changesets',
        ],
        { cwd: directory, env, stdio: 'pipe' },
      );
      version(directory);
      const first = execFileSync('git', ['diff', '--', '.'], {
        cwd: directory,
        env,
        encoding: 'utf8',
      });
      const mcp = JSON.parse(
        await readFile(
          path.join(directory, 'packages/mcp/package.json'),
          'utf8',
        ),
      );
      const vscode = JSON.parse(
        await readFile(
          path.join(directory, 'packages/vscode/package.json'),
          'utf8',
        ),
      );
      assert.equal(mcp.version, scenario.mcp);
      assert.equal(vscode.version, scenario.vscode);
      if (scenario.title.startsWith('private'))
        assert.equal(mcp.dependencies['@codocs/core'], 'workspace:^');
      // 이전 다음 버전을 증가시키지 않고 동일 미출시 소스에서 다시 계산한다.
      execFileSync('git', ['restore', '.'], { cwd: directory, env });
      execFileSync('git', ['clean', '-fd'], {
        cwd: directory,
        env,
        stdio: 'pipe',
      });
      version(directory);
      assert.equal(
        execFileSync('git', ['diff', '--', '.'], {
          cwd: directory,
          env,
          encoding: 'utf8',
        }),
        first,
      );
      const changelog = await readFile(
        path.join(
          directory,
          scenario.title === '확장만'
            ? 'packages/vscode/CHANGELOG.md'
            : 'packages/mcp/CHANGELOG.md',
        ),
        'utf8',
      );
      assert.ok(
        changelog.includes(
          scenario.title === '확장만' ? '2.4.0' : scenario.mcp,
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
