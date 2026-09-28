import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test, describe } from 'node:test';
import {
  actionRevision,
  git,
  releaseBranch,
  assertActivation,
  assertPreparation,
  assertReleasePrSource,
  latestReleaseRun,
  assertRequiredCheck,
} from './release-flow.mjs';
import {
  repositoryFixture,
  changeset,
  commit,
  officialAction,
  githubFixture,
  runOfficial,
  fixtureEnv,
  root,
  appTokenRevision,
  appTokenManifestSha256,
  officialAppTokenManifest,
} from './release-fixture.mjs';

const coreRequire = createRequire(
  path.join(root, 'packages/core/package.json'),
);
const YAML = coreRequire('yaml');

describe('공식 GitHub App 토큰 Action 연결', /** 고정 primary manifest와 실제 workflow 입력을 대조한다. */ () => {
  for (const [name, permissions] of Object.entries({
    prepare: {
      'permission-contents': 'write',
      'permission-pull-requests': 'write',
      'permission-actions': 'read',
      'permission-checks': 'read',
      'permission-administration': 'read',
    },
    publish: {
      'permission-contents': 'read',
      'permission-pull-requests': 'read',
      'permission-actions': 'read',
      'permission-checks': 'read',
      'permission-administration': 'read',
    },
    sync: {
      'permission-contents': 'write',
      'permission-pull-requests': 'write',
      'permission-administration': 'read',
    },
  }))
    test(`${name} workflow는 실제 Node24 manifest의 고정 commit과 호환 입력·기존 권한을 사용한다`, /** 실제 primary 원문과 소비 workflow를 파싱하여 계약을 확인한다. */ async () => {
      const raw = await officialAppTokenManifest();
      assert.equal(
        createHash('sha256').update(raw).digest('hex'),
        appTokenManifestSha256,
      );
      const manifest = YAML.parse(raw.toString('utf8'));
      assert.equal(manifest.runs.using, 'node24');
      assert.ok(manifest.outputs.token);
      const workflow = YAML.parse(
        await readFile(
          path.join(root, `.github/workflows/release-${name}.yml`),
          'utf8',
        ),
      );
      const tokenSteps = Object.values(workflow.jobs).flatMap((job) =>
        job.steps.filter((step) =>
          step.uses?.startsWith('actions/create-github-app-token@'),
        ),
      );
      assert.equal(tokenSteps.length, 1);
      const step = tokenSteps[0];
      assert.match(appTokenRevision, /^[a-f0-9]{40}$/u);
      assert.equal(
        step.uses,
        `actions/create-github-app-token@${appTokenRevision}`,
      );
      assert.equal(step.id, 'app');
      assert.deepEqual(step.with, {
        'app-id': '${{ vars.CODOCS_RELEASE_APP_ID }}',
        'private-key': '${{ secrets.CODOCS_RELEASE_APP_PRIVATE_KEY }}',
        ...permissions,
      });
      for (const input of Object.keys(step.with))
        assert.ok(Object.hasOwn(manifest.inputs, input), input);
      for (const [input, contract] of Object.entries(manifest.inputs))
        if (contract.required && !Object.hasOwn(contract, 'default'))
          assert.ok(Object.hasOwn(step.with, input), input);
    });
});

describe('공식 릴리스 Action 연결', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('고정한 실제 version Action을 실행하면 같은 PR을 갱신하고 develop 원본에서 더 높은 버전을 다시 계산한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    const api = await githubFixture(fixture);
    try {
      const action = await officialAction(fixture.directory);
      const manifest = await readFile(
        path.join(action, 'version/action.yml'),
        'utf8',
      );
      assert.match(manifest, /using: node24/u);
      assert.match(manifest, /^  script:/mu);
      assert.match(manifest, /^  pr-base-branch:/mu);
      assert.match(manifest, /^  pr-draft:/mu);
      await changeset(fixture.cwd, 'a');
      await changeset(fixture.cwd, 'b');
      const firstSource = commit(fixture.cwd, 'two patches');
      git(fixture.cwd, ['push', 'origin', 'develop'], { env: fixtureEnv });
      await runOfficial({
        action,
        cwd: fixture.cwd,
        url: api.url,
        sha: firstSource,
      });
      assert.equal(api.state.pull.number, 35);
      assert.equal(api.state.pull.draft, true);
      assert.equal(api.state.pull.base, 'main');
      const firstHead = git(fixture.remote, [
        'rev-parse',
        `refs/heads/${releaseBranch}`,
      ]);
      assert.equal(
        JSON.parse(
          git(fixture.remote, [
            'show',
            `${firstHead}:packages/mcp/package.json`,
          ]),
        ).version,
        '1.2.4',
      );
      assert.equal(
        git(fixture.remote, ['rev-parse', `${firstHead}^`]),
        firstSource,
      );
      // ready 이후에도 같은 PR을 갱신하며 Draft로 되돌리는 GraphQL을 만들지 않는다.
      api.state.pull.draft = false;
      git(fixture.cwd, ['reset', '--hard', firstSource]);
      git(fixture.cwd, ['clean', '-fd']);
      git(fixture.cwd, ['checkout', 'develop']);
      await changeset(fixture.cwd, 'c', { '@codocs/mcp': 'minor' });
      const secondSource = commit(fixture.cwd, 'minor joins pending patches');
      git(fixture.cwd, ['push', 'origin', 'develop'], { env: fixtureEnv });
      const secondRunner = path.join(fixture.directory, 'second-runner');
      git(fixture.directory, ['clone', fixture.remote, secondRunner], {
        env: fixtureEnv,
      });
      git(secondRunner, ['checkout', 'develop'], { env: fixtureEnv });
      await runOfficial({
        action,
        cwd: secondRunner,
        url: api.url,
        sha: secondSource,
      });
      const secondHead = git(fixture.remote, [
        'rev-parse',
        `refs/heads/${releaseBranch}`,
      ]);
      assert.equal(
        JSON.parse(
          git(fixture.remote, [
            'show',
            `${secondHead}:packages/mcp/package.json`,
          ]),
        ).version,
        '1.3.0',
      );
      assert.equal(
        git(fixture.remote, ['rev-parse', `${secondHead}^`]),
        secondSource,
      );
      assert.equal(api.state.pull.number, 35);
      assert.equal(api.state.pull.draft, false);
      assert.equal(
        api.state.requests.filter(
          (request) =>
            request.method === 'POST' && request.pathname.endsWith('/pulls'),
        ).length,
        1,
      );
      assert.ok(
        api.state.requests.some((request) =>
          request.body?.query?.includes('UpdatePullRequest'),
        ),
      );
      assert.ok(
        !api.state.requests.some((request) =>
          request.body?.query?.includes('convertPullRequestToDraft'),
        ),
      );
      assert.equal(git(fixture.remote, ['rev-parse', 'main']), fixture.base);
      assert.equal(git(fixture.remote, ['rev-parse', 'develop']), secondSource);
      assert.ok(
        git(fixture.remote, [
          'show',
          `${secondHead}:packages/mcp/CHANGELOG.md`,
        ]).includes('변경 c'),
      );
      await writeFile(
        path.join(root, '.workbench/task003-r1-official-api-evidence.json'),
        JSON.stringify(
          {
            requests: api.state.requests,
            files: git(fixture.remote, ['ls-tree', '-r', secondHead]),
          },
          null,
          2,
        ),
      );
      assert.throws(
        () => git(fixture.remote, ['show', `${secondHead}:.changeset/a.md`]),
        /does not exist/u,
      );
    } finally {
      await api.dispose();
      await fixture.dispose();
    }
  });
  test('릴리스 workflow는 불변 version pin과 create Draft 입력을 사용하고 게시에서 빌드·전체 검사를 반복하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const prepare = await readFile(
      path.join(root, '.github/workflows/release-prepare.yml'),
      'utf8',
    );
    assert.ok(prepare.includes(`changesets/action/version@${actionRevision}`));
    assert.match(prepare, /script: node tools\/ci\/release-flow\.mjs version/u);
    assert.match(prepare, /pr-base-branch: main/u);
    assert.match(prepare, /pr-draft: create/u);
    assert.doesNotMatch(prepare, /pr-draft: always/u);
    const publish = await readFile(
      path.join(root, '.github/workflows/release-publish.yml'),
      'utf8',
    );
    assert.doesNotMatch(
      publish,
      /pnpm (build|check|release:pack|release:verify)/u,
    );
    assert.match(publish, /name: Release publish/u);
    assert.match(publish, /cancel-in-progress: false/u);
  });
});

describe('준비 소스와 필수 검사 최신성', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('동기화된 최신 develop과 공식 status가 있으면 준비를 허용한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      assert.equal(
        assertPreparation({
          cwd: fixture.cwd,
          eventSha: fixture.base,
          developSha: fixture.base,
          mainSha: fixture.base,
          changesetStatus: { releases: [{ name: '@codocs/mcp' }] },
        }),
        true,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('공식 status에 릴리스가 없으면 빈 버전 PR을 만들지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      assert.equal(
        assertPreparation({
          cwd: fixture.cwd,
          eventSha: fixture.base,
          developSha: fixture.base,
          mainSha: fixture.base,
          changesetStatus: { releases: [] },
        }),
        false,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('오래된 develop 이벤트가 도착하면 현재 준비 결과를 덮어쓰기 전에 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      assert.throws(
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () =>
          assertPreparation({
            cwd: fixture.cwd,
            eventSha: 'a'.repeat(40),
            developSha: fixture.base,
            mainSha: fixture.base,
            changesetStatus: { releases: [] },
          }),
        /stale develop event/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('main에만 새로운 릴리스가 있으면 소비 기록 재사용 전에 준비를 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      git(fixture.cwd, ['checkout', 'main']);
      await writeFile(path.join(fixture.cwd, 'released.txt'), 'release\n');
      const mainSha = commit(fixture.cwd, 'release');
      git(fixture.cwd, ['checkout', 'develop']);
      assert.throws(
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () =>
          assertPreparation({
            cwd: fixture.cwd,
            eventSha: fixture.base,
            developSha: fixture.base,
            mainSha,
            changesetStatus: { releases: [] },
          }),
        /synchronization required/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('Action 실행 중 main이 병합되면 기존 parent를 가진 release PR의 최종 CI를 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      git(fixture.cwd, ['checkout', '-b', releaseBranch]);
      await writeFile(path.join(fixture.cwd, 'released.txt'), 'release\n');
      const headSha = commit(fixture.cwd, 'official result');
      git(fixture.cwd, ['checkout', 'main']);
      git(fixture.cwd, ['merge', '--squash', releaseBranch]);
      const mainSha = commit(fixture.cwd, 'release merged during older action');
      assert.throws(
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () =>
          assertReleasePrSource({
            cwd: fixture.cwd,
            headSha,
            developSha: fixture.base,
            mainSha,
          }),
        /synchronization required/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  for (const conclusion of ['failure', 'cancelled'])
    test(`최신 CI가 ${conclusion}이면 이전 성공 run으로 게시하지 않는다`, /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
      const pr = { number: 35, head: { sha: 'a'.repeat(40) } };
      const old = {
        id: 1,
        run_attempt: 1,
        event: 'pull_request',
        head_sha: pr.head.sha,
        name: 'Tests',
        pull_requests: [{ number: 35 }],
        status: 'completed',
        conclusion: 'success',
      };
      assert.throws(
        () => latestReleaseRun([old, { ...old, id: 2, conclusion }], pr),
        /latest release CI unsuccessful/u,
      );
    });
  test('새 required-ci 실패가 있으면 이전 성공 check를 게시 근거로 사용하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
    const sha = 'a'.repeat(40);
    assert.throws(
      /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () =>
        assertRequiredCheck(
          [
            {
              id: 1,
              name: 'required-ci',
              head_sha: sha,
              conclusion: 'success',
            },
            {
              id: 2,
              name: 'required-ci',
              head_sha: sha,
              conclusion: 'failure',
            },
          ],
          sha,
        ),
      /latest required-ci success required/u,
    );
  });
});

describe('수동 활성화와 권한 확인', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('수동 활성화가 없으면 API 쓰기 전에 차단한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    await assert.rejects(
      assertActivation({
        enabled: '',
        appToken: 'fixture',
        repository: 'Fixture/release',
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ api: async () => {
          throw new Error('must not call API');
        },
      }),
      /manual release activation required/u,
    );
  });
  test('보호 확인에 실패하면 봇 권한이 있어도 차단한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    await assert.rejects(
      assertActivation({
        enabled: 'true',
        appToken: 'fixture',
        repository: 'Fixture/release',
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ api: async () => ({
          permissions: { push: true, pull: true },
        }),
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ protection:
          async () => {
            throw new Error('required-ci missing');
          },
      }),
      /required-ci missing/u,
    );
  });
  test('App에 contents 쓰기 권한이 없으면 준비와 동기화를 차단한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    await assert.rejects(
      assertActivation({
        enabled: 'true',
        appToken: 'fixture',
        repository: 'Fixture/release',
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ api: async () => ({
          permissions: { pull: true },
        }),
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ protection:
          async () => {},
      }),
      /contents write permission required/u,
    );
  });
  test('게시 인증이 없으면 보호가 확인되어도 게시를 차단한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    await assert.rejects(
      assertActivation({
        enabled: 'true',
        appToken: 'fixture',
        repository: 'Fixture/release',
        publishing: true,
        credentials: { npm: 'fixture' },
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ api: async () => ({
          permissions: { pull: true },
        }),
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ protection:
          async () => {},
      }),
      /Marketplace publish authentication required/u,
    );
  });
});
