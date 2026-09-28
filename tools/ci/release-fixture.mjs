import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  actionRevision,
  releaseBranch,
  git as repositoryGit,
} from './release-flow.mjs';

/** 인접 테스트의 독립 Git/API workspace 기준 디렉터리다. */
export const root = fileURLToPath(new URL('../../', import.meta.url));
/** Node24와 기존 App 입력을 제공하는 공식 v3.2.0 commit이다. */
export const appTokenRevision = 'bcd2ba49218906704ab6c1aa796996da409d3eb1';
/** 해당 commit의 action.yml 원문을 독립 다운로드로 확인한 SHA-256이다. */
export const appTokenManifestSha256 =
  '2c4c77d1cafa8d792ab4a9d449799221baf95176a47692ad9a0b350b0a2618ed';
/** 전체 release Action의 독립 primary manifest 원문과 고정 commit 계약이다. */
export const releaseActionManifests = {
  'actions/checkout': {
    revision: '3d3c42e5aac5ba805825da76410c181273ba90b1',
    sha256: 'd59219cb79590abdb877deaa14e3b65a00c05318bf5a6f3b989b9162b5d08c35',
  },
  'pnpm/action-setup': {
    revision: 'ea17c68df8912ef543352723c149a84f56e3d413',
    sha256: '9e252c0620f3de7d239b01455c8b50b3424e347d7547d991abf71694686bf82c',
  },
  'actions/setup-node': {
    revision: '820762786026740c76f36085b0efc47a31fe5020',
    sha256: '5d765941ab5d8bef27f08e81b0b041cdb2df2050ea0261dc925d157a2bafbd2b',
  },
  'actions/upload-artifact': {
    revision: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    sha256: 'c5979822866a72362e609844b6ebe77d4b7e759af68cc1c2c425dcf51481fab4',
  },
  'actions/create-github-app-token': {
    revision: appTokenRevision,
    sha256: appTokenManifestSha256,
  },
  'changesets/action/version': {
    revision: actionRevision,
    sha256: '2f2c5ee86f3a35ab3b61f5911f11a9a5d481a8cf41470a8ae4a0e296c9fa6815',
  },
};
/** family의 고정 primary manifest 원문을 읽고 실패를 검증 결과로 남긴다. */
export async function officialReleaseActionManifest(family) {
  const contract = releaseActionManifests[family];
  assert.ok(contract, `unknown release Action: ${family}`);
  const [owner, repository, ...directory] = family.split('/');
  const response = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repository}/${contract.revision}/${[...directory, 'action.yml'].join('/')}`,
  );
  assert.ok(response.ok, `official ${family} manifest: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
/** 고정 commit의 공식 manifest 원문을 읽고 네트워크 실패를 검증 실패로 남긴다. */
export async function officialAppTokenManifest() {
  return officialReleaseActionManifest('actions/create-github-app-token');
}
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
/** 공식 CLI가 읽을 Changeset 원문을 쓴다. */
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
/** 공식 CLI로만 버전과 changelog를 생성한다. */
export function officialCli(cwd) {
  execFileSync(
    process.execPath,
    [path.join(root, 'node_modules/@changesets/cli/bin.js'), 'version'],
    { cwd, env: fixtureEnv, stdio: 'pipe' },
  );
}
/** 실제 pinned Action의 manifest와 배포 코드를 자체 fixture에 가져온다. */
export async function officialAction(directory) {
  const action = path.join(directory, 'official-action');
  git(
    directory,
    [
      'clone',
      '--no-checkout',
      'https://github.com/changesets/action.git',
      action,
    ],
    { env: fixtureEnv },
  );
  git(action, ['checkout', '--detach', actionRevision], { env: fixtureEnv });
  assert.equal(git(action, ['rev-parse', 'HEAD']), actionRevision);
  assert.equal(git(action, ['status', '--porcelain']), '');
  return action;
}
/** HTTP GitHub fixture의 ref를 실제 bare 저장소에서 읽는다. */
function ref(remote, name) {
  try {
    return git(remote, ['rev-parse', name]);
  } catch {
    return null;
  }
}
/** 공식 GraphQL commit 입력을 bare Git에 적용하며 계산은 upstream Action과 CLI가 담당한다. */
function apiCommit(remote, directory, input) {
  const branch = input.branch.id;
  assert.ok(
    branch.startsWith('refs/heads/changeset'),
    'fixture rejects protected branch writes',
  );
  assert.equal(
    ref(remote, branch),
    input.expectedHeadOid,
    'fixture commit CAS mismatch',
  );
  const env = {
    ...fixtureEnv,
    GIT_INDEX_FILE: path.join(directory, 'api-index'),
    GIT_DIR: remote,
    GIT_WORK_TREE: remote,
  };
  git(remote, ['read-tree', input.expectedHeadOid], { env });
  for (const entry of input.fileChanges.additions) {
    const blob = git(remote, ['hash-object', '-w', '--stdin'], {
      env,
      input: Buffer.from(entry.contents, 'base64'),
    });
    git(
      remote,
      ['update-index', '--add', '--cacheinfo', `100644,${blob},${entry.path}`],
      { env },
    );
  }
  for (const entry of input.fileChanges.deletions)
    git(remote, ['update-index', '--force-remove', entry.path], { env });
  const tree = git(remote, ['write-tree'], { env });
  const oid = git(remote, ['commit-tree', tree, '-p', input.expectedHeadOid], {
    env,
    input: input.message.headline + '\n',
  });
  git(remote, ['update-ref', branch, oid, input.expectedHeadOid], { env });
  return { createCommitOnBranch: { commit: { oid }, ref: { id: branch } } };
}
/** 공식 Action의 실제 REST/GraphQL을 HTTP로 받고 bare Git 및 PR 상태와 연결한다. */
export async function githubFixture({ remote, directory }) {
  const state = { pull: null, requests: [] };
  const server = createServer(
    /** API request 원문과 Git ref 결과를 기록한다. */ async (
      request,
      response,
    ) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const bytes = Buffer.concat(chunks).toString();
        const body = bytes ? JSON.parse(bytes) : null;
        const url = new URL(request.url, 'http://fixture.invalid');
        state.requests.push({
          method: request.method,
          pathname: url.pathname,
          body,
        });
        let result;
        if (url.pathname === '/graphql') {
          let data;
          if (body.query.includes('getRepositoryMetadata')) {
            const name = body.variables.targetRef;
            const oid = ref(remote, name);
            data = {
              repository: {
                id: 'repository',
                baseRef: null,
                targetBranch: oid ? { id: name, target: { oid } } : null,
              },
            };
          } else if (body.query.includes('createCommitOnBranch'))
            data = apiCommit(remote, directory, body.variables.input);
          else if (body.query.includes('UpdatePullRequest')) {
            assert.ok(state.pull, 'fixture existing PR required');
            state.pull.title = body.variables.title;
            state.pull.body = body.variables.body;
            if (body.query.includes('convertPullRequestToDraft'))
              state.pull.draft = true;
            data = {
              updatePullRequest: { pullRequest: { id: state.pull.node_id } },
            };
          } else throw new Error('unexpected fixture GraphQL query');
          result = { data };
        } else if (url.pathname.endsWith('/pulls')) {
          if (request.method === 'GET') result = state.pull ? [state.pull] : [];
          else {
            assert.equal(body.base, 'main');
            assert.equal(body.head, releaseBranch);
            assert.equal(state.pull, null, 'fixture duplicate release PR');
            state.pull = { ...body, number: 35, node_id: 'release-pr' };
            result = state.pull;
          }
        } else if (
          url.pathname.endsWith('/git/refs') &&
          request.method === 'POST'
        ) {
          assert.ok(
            body.ref.startsWith('refs/heads/changeset'),
            'fixture rejects protected branch writes',
          );
          git(remote, ['update-ref', body.ref, body.sha, ''], {
            env: fixtureEnv,
          });
          result = { node_id: body.ref };
        } else if (url.pathname.includes('/git/refs/')) {
          const name =
            'refs/' + decodeURIComponent(url.pathname.split('/git/refs/')[1]);
          assert.ok(
            name.startsWith('refs/heads/changeset'),
            'fixture rejects protected branch writes',
          );
          if (request.method === 'DELETE') {
            git(remote, ['update-ref', '-d', name], { env: fixtureEnv });
            response.writeHead(204);
            response.end();
            return;
          }
          git(remote, ['update-ref', name, body.sha], { env: fixtureEnv });
          result = { node_id: name };
        } else
          throw new Error(
            `unexpected fixture request ${request.method} ${url.pathname}`,
          );
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: error.message }));
      }
    },
  );
  await new Promise(
    /** 독립 포트 준비 완료를 기다린다. */ (resolve) =>
      server.listen(0, '127.0.0.1', resolve),
  );
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    /** 해당 API fixture만 종료한다. */ dispose: async () =>
      new Promise(
        /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
          resolve,
          reject,
        ) => server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
/** pin의 실제 version entrypoint를 fake token과 local API에만 연결해 실행한다. */
export async function runOfficial({ action, cwd, url, sha }) {
  const output = path.join(path.dirname(cwd), 'action-output');
  await writeFile(output, '');
  const child = spawn(
    process.execPath,
    [path.join(action, 'dist/version.js')],
    {
      cwd,
      env: {
        ...fixtureEnv,
        GITHUB_REPOSITORY: 'Fixture/release',
        GITHUB_REF: 'refs/heads/develop',
        GITHUB_SHA: sha,
        GITHUB_API_URL: url,
        GITHUB_GRAPHQL_URL: `${url}/graphql`,
        GITHUB_OUTPUT: output,
        'INPUT_GITHUB-TOKEN': 'fixture-token-not-a-credential',
        INPUT_SCRIPT: `${process.execPath} ${path.join(root, 'node_modules/@changesets/cli/bin.js')} version`,
        'INPUT_COMMIT-MESSAGE': 'Version Packages',
        'INPUT_PR-TITLE': 'Version Packages',
        'INPUT_PR-DRAFT': 'create',
        'INPUT_PR-BASE-BRANCH': 'main',
        'INPUT_PUSH-WITH-GIT-CLI': 'false',
        INPUT_CWD: cwd,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  const code = await new Promise(
    /** Action의 실제 종료 코드와 로그를 확인한다. */ (resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    },
  );
  assert.equal(code, 0, log);
  return log;
}
