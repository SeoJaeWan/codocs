import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { sha256 } from '../build/release-contract.mjs';
import {
  assertActivation,
  assertReleasePrSource,
  releaseBranch,
} from './release-flow.mjs';
import { createGitFixtureEnvironment } from '../test/git-config.mjs';
import {
  root,
  git,
  fixtureEnv,
  repositoryFixture,
  changeset,
  commit,
  versions,
  officialAction,
  githubFixture,
  runOfficial,
  officialCli,
} from './release-fixture.mjs';
import { verifyVersionedCandidate } from './release-candidate-fixture.mjs';
const require = createRequire(import.meta.url);
const YAML = require(
  require.resolve('yaml', { paths: [path.join(root, 'packages/core')] }),
);

test('공식 CLI 최종 버전 실물 후보의 관리 소비·부분 재시도·변조 거부를 결합한다', /** OS 실행 증거는 명시적 fixture이며 native 기능 검사를 실행하지 않는다. */ async () => {
  const result = await verifyVersionedCandidate();
  assert.equal(result.summary.nativeOS, null);
  assert.deepEqual(result.summary.observations, []);
  const files = await readdir(result.evidence);
  assert.equal(
    files.some((file) =>
      /^(installed-package|functional-|lifecycle-)/u.test(file),
    ),
    false,
  );
  for (const job of ['macos', 'windows']) {
    const receipt = JSON.parse(
      await readFile(
        path.join(
          result.evidence,
          'source/.workbench/incoming-evidence',
          `codocs-evidence-${job}-101-2`,
          'evidence.json',
        ),
      ),
    );
    assert.equal(receipt.fixtureOnly, true);
    assert.equal(receipt.fixtureSourcePlatform, process.platform);
  }
});

test('실제 공식 Action의 ready 갱신·preflight·동기화·다음 공식 버전 계산을 결합한다', /** 공식 PR 갱신 이후 새 기록 보존과 다음 계산을 확인한다. */ async () => {
  const fixture = await repositoryFixture();
  const api = await githubFixture(fixture);
  try {
    const action = await officialAction(fixture.directory);
    await changeset(fixture.cwd, 'a', {
      '@codocs/mcp': 'patch',
      codocs: 'patch',
    });
    const firstSource = commit(fixture.cwd, 'release inputs');
    git(fixture.cwd, ['push', 'origin', 'develop'], { env: fixtureEnv });
    await runOfficial({
      action,
      cwd: fixture.cwd,
      url: api.url,
      sha: firstSource,
    });
    const oldHead = git(fixture.remote, ['rev-parse', releaseBranch]);
    api.state.pull.draft = false;
    const fresh = path.join(fixture.directory, 'fresh');
    git(fixture.directory, ['clone', fixture.remote, fresh], {
      env: fixtureEnv,
    });
    // clone은 원본의 local identity를 복사하지 않으므로 이 fixture에 직접 설정한다.
    git(fresh, ['config', '--local', 'user.name', 'Fixture'], {
      env: fixtureEnv,
    });
    git(fresh, ['config', '--local', 'user.email', 'fixture@example.invalid'], {
      env: fixtureEnv,
    });
    git(fresh, ['checkout', 'develop'], { env: fixtureEnv });
    await changeset(fresh, 'b', { '@codocs/mcp': 'minor' });
    const developSha = commit(fresh, 'ready source edit');
    git(fresh, ['push', 'origin', 'develop'], { env: fixtureEnv });
    await runOfficial({ action, cwd: fresh, url: api.url, sha: developSha });
    git(fresh, ['fetch', 'origin'], { env: fixtureEnv });
    const headSha = git(fresh, ['rev-parse', `origin/${releaseBranch}`]);
    assert.notEqual(headSha, oldHead);
    assert.equal(api.state.pull.draft, false);
    assertReleasePrSource({
      cwd: fresh,
      headSha,
      developSha,
      mainSha: fixture.base,
    });
    assert.throws(
      /** 이전 head는 최신 develop의 결과가 아니다. */ () =>
        assertReleasePrSource({
          cwd: fresh,
          headSha: oldHead,
          developSha,
          mainSha: fixture.base,
        }),
      /release PR no longer uses latest develop/u,
    );
    // upstream API commit은 runner에 변경 파일을 남긴다. 이 fixture의 알려진 산출물만 되돌린다.
    git(fresh, ['reset', '--hard', developSha], { env: fixtureEnv });
    git(fresh, ['clean', '-fd'], { env: fixtureEnv });
    git(fresh, ['checkout', 'main'], { env: fixtureEnv });
    git(fresh, ['merge', '--squash', headSha], { env: fixtureEnv });
    const mainSha = commit(fresh, 'release squash');
    git(fresh, ['checkout', 'develop'], { env: fixtureEnv });
    await changeset(fresh, 'next', { '@codocs/mcp': 'patch' });
    await writeFile(
      path.join(fresh, 'new-code.txt'),
      'concurrent next release\n',
    );
    const concurrent = commit(fresh, 'next release input');
    // 실제 sync의 하위 Git 호출이 개발자 설정·환경 identity에 기대지 않게 한다.
    const syncEnv = createGitFixtureEnvironment();
    for (const key of Object.keys(syncEnv))
      if (
        /^GIT_(AUTHOR|COMMITTER)_/u.test(key) ||
        /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/u.test(key) ||
        key === 'EMAIL'
      )
        delete syncEnv[key];
    syncEnv.GIT_CONFIG_COUNT = '1';
    syncEnv.GIT_CONFIG_KEY_0 = 'user.useConfigOnly';
    syncEnv.GIT_CONFIG_VALUE_0 = 'true';
    const sync = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import assert from 'node:assert/strict';
          import { readFileSync } from 'node:fs';
          import { buildSync } from ${JSON.stringify(new URL('./release-sync.mjs', import.meta.url).href)};
          assert.equal(readFileSync(process.env.GIT_CONFIG_GLOBAL, 'utf8'), '');
          assert.equal(readFileSync(process.env.GIT_CONFIG_SYSTEM, 'utf8'), '');
          assert.equal(Object.keys(process.env).some(key => /^GIT_(AUTHOR|COMMITTER)_/.test(key)), false);
          process.stdout.write(JSON.stringify(buildSync(JSON.parse(readFileSync(0, 'utf8')))));`,
        ],
        {
          cwd: fresh,
          env: syncEnv,
          input: JSON.stringify({
            cwd: fresh,
            mainSha,
            developSha: concurrent,
            releaseSha: headSha,
          }),
          encoding: 'utf8',
        },
      ),
    );
    assert.equal(
      git(fresh, ['show', '-s', '--format=%an <%ae>|%cn <%ce>', sync.head]),
      'Fixture <fixture@example.invalid>|Fixture <fixture@example.invalid>',
    );
    assert.equal(
      git(fresh, ['show', `${sync.head}:.changeset/next.md`]).includes(
        '변경 next',
      ),
      true,
    );
    assert.equal(
      git(fresh, ['show', `${sync.head}:new-code.txt`]),
      'concurrent next release',
    );
    assert.deepEqual(sync.consumed.map((item) => item.file).sort(), [
      '.changeset/a.md',
      '.changeset/b.md',
    ]);
    git(fresh, ['checkout', '-B', 'develop', sync.head], { env: fixtureEnv });
    officialCli(fresh);
    assert.deepEqual(await versions(fresh), { npm: '1.3.1', vscode: '2.3.5' });
    await writeFile(
      path.join(root, '.workbench/ci-split-r1-official.json'),
      JSON.stringify(
        {
          oldHead,
          headSha,
          developSha,
          mainSha,
          concurrent,
          sync,
          requests: api.state.requests,
          nextVersions: await versions(fresh),
          fixtureOnly: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await api.dispose();
    await fixture.dispose();
  }
});

test('합친 workflow pin·Node24·권한과 실제 공유 보호 gate를 대조한다', /** 실제 manifest와 권한 guard의 연결을 검증한다. */ async () => {
  const pins = new Map();
  for (const filename of [
    'test.yml',
    'ci-report.yml',
    'release-prepare.yml',
    'release-sync.yml',
    'release-publish.yml',
  ]) {
    const document = YAML.parse(
      await readFile(path.join(root, '.github/workflows', filename), 'utf8'),
    );
    for (const job of Object.values(document.jobs))
      for (const step of job.steps ?? []) {
        if (!step.uses) continue;
        const [action, revision] = step.uses.split('@');
        assert.match(revision, /^[a-f0-9]{40}$/u);
        pins.set(step.uses, { action, revision });
        assert.equal(step.with?.cache, undefined);
      }
    assert.equal(document.permissions.contents, 'read');
  }
  const manifests = [];
  for (const { action, revision } of pins.values()) {
    const [owner, repo, ...subpath] = action.split('/');
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${revision}/${subpath.length ? subpath.join('/') + '/' : ''}action.yml`;
    const response = await fetch(url);
    assert.equal(response.ok, true, `pinned manifest ${url}`);
    const raw = await response.text();
    assert.equal(YAML.parse(raw).runs.using, 'node24');
    manifests.push({
      action,
      revision,
      url,
      sha256: sha256(Buffer.from(raw)),
      runtime: 'node24',
    });
  }
  await writeFile(
    path.join(root, '.workbench/ci-split-r1-action-manifests.json'),
    JSON.stringify(manifests, null, 2),
  );
  const routes = [];
  /** 주입 gate 없이 TASK-003이 TASK-002의 실제 보호 판정을 사용하도록 한다. */
  async function protectionApi(method, route) {
    assert.equal(method, 'GET');
    routes.push(route);
    if (!route.endsWith('/protection'))
      return { permissions: { pull: true, push: true } };
    return {
      enforce_admins: { enabled: true },
      required_pull_request_reviews: { bypass_pull_request_allowances: {} },
      required_status_checks: { strict: true, contexts: ['required-ci'] },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    };
  }
  await assertActivation({
    enabled: 'true',
    appToken: 'fixture',
    repository: 'Fixture/release',
    api: protectionApi,
  });
  assert.deepEqual(routes.slice(0, 2), [
    '/repos/Fixture/release/branches/main/protection',
    '/repos/Fixture/release/branches/develop/protection',
  ]);
  await assert.rejects(
    assertActivation({
      enabled: 'true',
      appToken: 'fixture',
      repository: 'Fixture/release',
      /** strict 보호가 누락되면 실제 gate가 거부한다. */ api: async (
        method,
        route,
      ) => ({
        ...(await protectionApi(method, route)),
        required_status_checks: { strict: false, contexts: ['required-ci'] },
      }),
    }),
    /latest base required/u,
  );
});
