import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  copyFile,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { createGitFixtureEnvironment } from '../test/git-config.mjs';
import { fileURLToPath } from 'node:url';
import { actionRevision, git as repositoryGit } from './release-flow.mjs';

/** 인접 테스트의 독립 Git/API workspace 기준 디렉터리다. */
export const root = fileURLToPath(new URL('../../', import.meta.url));
/** Node24와 기존 App 입력을 제공하는 공식 v3.2.0 commit이다. */
export const appTokenRevision = 'bcd2ba49218906704ab6c1aa796996da409d3eb1';
/** 저장소가 선택한 release Action의 고정 revision이다. */
export const releaseActionManifests = {
  'actions/checkout': { revision: '3d3c42e5aac5ba805825da76410c181273ba90b1' },
  'pnpm/action-setup': { revision: 'ea17c68df8912ef543352723c149a84f56e3d413' },
  'actions/setup-node': {
    revision: '820762786026740c76f36085b0efc47a31fe5020',
  },
  'actions/upload-artifact': {
    revision: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  },
  'actions/create-github-app-token': { revision: appTokenRevision },
  'changesets/action/version': { revision: actionRevision },
};
/** Git fixture에 고정 identity를 사용하고 사용자 credential 설정을 읽지 않는다. */
export const fixtureEnv = {
  ...createGitFixtureEnvironment(),
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
};
/** 모든 fixture Git 명령에 동일한 설정과 identity를 전달한다. */
export function git(cwd, args, options = {}) {
  return repositoryGit(cwd, args, { env: fixtureEnv, ...options });
}
/** 각 사례에 자체 workspace와 bare 원격을 만든다. */
export async function repositoryFixture() {
  await mkdir(path.join(root, '.workbench'), { recursive: true });
  const directory = await mkdtemp(
    path.join(root, '.workbench/release-fixture-'),
  );
  const cwd = path.join(directory, 'work');
  const remote = path.join(directory, 'remote.git');
  await mkdir(path.join(cwd, '.changeset'), { recursive: true });
  await copyFile(
    path.join(root, '.changeset/config.json'),
    path.join(cwd, '.changeset/config.json'),
  );
  await writeFile(path.join(cwd, '.gitignore'), 'node_modules/\n.workbench/\n');
  await writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({
      name: 'release-fixture',
      private: true,
      packageManager: 'pnpm@10.34.5',
      devDependencies: { '@changesets/cli': '3.0.3' },
    }),
  );
  await writeFile(
    path.join(cwd, 'pnpm-workspace.yaml'),
    "packages: ['packages/*']\n",
  );
  for (const [name, manifest] of Object.entries({
    mcp: { name: '@codocs/mcp', version: '1.2.3', private: true },
    vscode: { name: 'codocs', version: '2.3.4', private: true },
  })) {
    await mkdir(path.join(cwd, 'packages', name), { recursive: true });
    await writeFile(
      path.join(cwd, 'packages', name, 'package.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }
  git(cwd, ['init', '-b', 'develop'], { env: fixtureEnv });
  git(cwd, ['config', '--local', 'core.autocrlf', 'false']);
  git(cwd, ['config', '--local', 'core.longpaths', 'true']);
  git(cwd, ['config', 'user.name', 'Fixture']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  commit(cwd, 'initial');
  const base = git(cwd, ['rev-parse', 'HEAD']);
  git(cwd, ['branch', 'main']);
  git(directory, ['init', '--bare', remote], { env: fixtureEnv });
  git(cwd, ['remote', 'add', 'origin', remote]);
  git(cwd, ['push', 'origin', 'main', 'develop'], { env: fixtureEnv });
  return {
    directory,
    cwd,
    remote,
    base,
    /** 해당 사례가 만든 fixture만 삭제한다. */ dispose: async () =>
      rm(directory, { recursive: true, force: true }),
  };
}
/** 준비된 입력 파일을 fixture commit으로 확정한다. */
export function commit(cwd, message) {
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', message], { env: fixtureEnv });
  return git(cwd, ['rev-parse', 'HEAD']);
}
/** 소비 기록 식별에 사용할 Changeset 원문을 쓴다. */
export async function changeset(
  cwd,
  name,
  releases = { '@codocs/mcp': 'patch' },
) {
  await writeFile(
    path.join(cwd, '.changeset', `${name}.md`),
    `---\n${Object.entries(releases)
      .map(([product, bump]) => `${JSON.stringify(product)}: ${bump}`)
      .join('\n')}\n---\n\n변경 ${name}\n`,
  );
}
/** 제품 manifest version을 fixture의 원문에서 읽는다. */
export async function versions(cwd) {
  return {
    npm: JSON.parse(await readFile(path.join(cwd, 'packages/mcp/package.json')))
      .version,
    vscode: JSON.parse(
      await readFile(path.join(cwd, 'packages/vscode/package.json')),
    ).version,
  };
}
/** 자체 게시·동기화 판단에 필요한 이미 계산된 버전과 소비 기록만 준비한다. */
export async function versionedFixture(cwd) {
  const file = path.join(cwd, 'packages/mcp/package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.version = '1.2.4';
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  for (const name of ['a', 'b'])
    await rm(path.join(cwd, '.changeset', name + '.md'), { force: true });
}
