import assert from 'node:assert/strict';
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
  commit,
  root,
  appTokenRevision,
  releaseActionManifests,
} from './release-fixture.mjs';

const coreRequire = createRequire(
  path.join(root, 'packages/core/package.json'),
);
const YAML = coreRequire('yaml');

/** 이 회귀 fixture의 AND·동등 비교만 판정하며 GitHub 전체 표현식 엔진을 대신하지 않는다. */
function releaseJobEligible(condition, context) {
  assert.equal(typeof condition, 'string');
  return condition.split(/\s*&&\s*/u).every(
    /** fixture에서 지원하는 비교절을 독립 판정한다. */ (clause) => {
      const comparison = clause.match(/^([\w.]+) == ('[^']*'|true|[\w.]+)$/u);
      assert.ok(comparison, `unsupported fixture expression: ${clause}`);
      /** fixture의 확인된 context 경로만 읽고 미설정 변수는 공식 계약의 빈 문자열로 둔다. */
      function value(operand) {
        if (operand === 'true') return true;
        if (operand.startsWith("'")) return operand.slice(1, -1);
        return (
          operand
            .split('.')
            .reduce((current, key) => current?.[key], context) ?? ''
        );
      }
      const left = value(comparison[1]);
      const right = value(comparison[2]);
      return typeof left === 'string' && typeof right === 'string'
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
    },
  );
}

describe('release job 활성화와 기존 이벤트 조건', /** 실제 YAML 조건이 비활성 러너를 생략하고 기존 허용 범위를 유지하는지 확인한다. */ () => {
  const eligible = {
    vars: { CODOCS_RELEASE_ENABLED: 'true' },
    github: {
      ref: 'refs/heads/main',
      repository: 'Fixture/release',
      event: {
        pull_request: {
          merged: true,
          head: {
            ref: 'changeset-release/main',
            repo: { full_name: 'Fixture/release' },
          },
        },
      },
    },
  };
  for (const [workflowName, jobName] of [
    ['prepare', 'version'],
    ['publish', 'publish'],
    ['sync', 'synchronize'],
  ]) {
    test(`${workflowName}은 미설정·false에서 러너를 생략하고 true에서 기존 조건을 유지한다`, /** 파싱한 실제 job 조건에 허용·거부 이벤트를 넣으며 내부 step guard도 보존한다. */ async () => {
      const workflow = YAML.parse(
        await readFile(
          path.join(root, `.github/workflows/release-${workflowName}.yml`),
          'utf8',
        ),
      );
      const job = workflow.jobs[jobName];
      assert.equal(releaseJobEligible(job.if, eligible), true);
      for (const vars of [{}, { CODOCS_RELEASE_ENABLED: 'false' }])
        assert.equal(releaseJobEligible(job.if, { ...eligible, vars }), false);
      assert.equal(job.steps[0].name, 'Require manual activation');
      assert.equal(job.steps[0].run, 'test "$CODOCS_RELEASE_ENABLED" = true');
      assert.equal(
        job.steps[0].env.CODOCS_RELEASE_ENABLED,
        '${{ vars.CODOCS_RELEASE_ENABLED }}',
      );
      if (workflowName === 'publish')
        assert.equal(
          releaseJobEligible(job.if, {
            ...eligible,
            github: { ...eligible.github, ref: 'refs/heads/develop' },
          }),
          false,
        );
      if (workflowName === 'sync')
        for (const changed of [
          { merged: false },
          {
            head: {
              ref: 'feature/other',
              repo: { full_name: 'Fixture/release' },
            },
          },
          {
            head: {
              ref: 'changeset-release/main',
              repo: { full_name: 'Fork/release' },
            },
          },
        ])
          assert.equal(
            releaseJobEligible(job.if, {
              ...eligible,
              github: {
                ...eligible.github,
                event: {
                  pull_request: {
                    ...eligible.github.event.pull_request,
                    ...changed,
                  },
                },
              },
            }),
            false,
          );
    });
  }
});

describe('release workflow의 고정 revision과 자체 입력 연결', /** 저장소가 선택한 revision과 입력을 대조한다. */ () => {
  test('세 workflow는 고정 commit과 저장소의 런타임·캐시·artifact 입력을 사용한다', /** 전체 family와 모든 소비 step의 계약을 확인한다. */ async () => {
    const inventory = [];
    for (const [name, families] of Object.entries({
      prepare: [
        'actions/create-github-app-token',
        'actions/checkout',
        'pnpm/action-setup',
        'actions/setup-node',
        'changesets/action/version',
      ],
      sync: [
        'actions/create-github-app-token',
        'actions/checkout',
        'pnpm/action-setup',
        'actions/setup-node',
      ],
      publish: [
        'actions/create-github-app-token',
        'actions/checkout',
        'pnpm/action-setup',
        'actions/setup-node',
        'actions/upload-artifact',
      ],
    })) {
      const workflow = YAML.parse(
        await readFile(
          path.join(root, `.github/workflows/release-${name}.yml`),
          'utf8',
        ),
      );
      const steps = Object.values(workflow.jobs).flatMap((job) =>
        job.steps.filter((step) => step.uses),
      );
      inventory.push({ name, families, steps });
    }
    // 첫 실패가 다른 workflow의 uses를 가리지 않도록 전체 목록부터 수집한다.
    const usedFamilies = new Set();
    for (const { name, families, steps } of inventory) {
      assert.deepEqual(
        steps.map((step) => step.uses.split('@')[0]),
        families,
        name,
      );
      for (const step of steps) {
        assert.match(step.uses, /^[\w-]+\/[\w/-]+@[a-f0-9]{40}$/u);
        const [family, revision] = step.uses.split('@');
        usedFamilies.add(family);
        assert.equal(revision, releaseActionManifests[family].revision);
        if (family === 'actions/setup-node') {
          assert.equal(step.with['node-version'], '24.21.0');
          assert.equal(step.with['package-manager-cache'], false);
          assert.equal(Object.hasOwn(step.with, 'cache'), false);
        }
        if (family === 'pnpm/action-setup') {
          assert.deepEqual(step.with, { version: '10.34.5' });
        }
        if (family === 'actions/upload-artifact') {
          assert.deepEqual(step.with, {
            name: 'codocs-publish-${{ github.run_id }}-${{ github.run_attempt }}',
            path: '.workbench/publish/publish.json',
            'if-no-files-found': 'warn',
            'retention-days': 90,
          });
        }
      }
    }
    assert.deepEqual(
      [...usedFamilies].sort(),
      Object.keys(releaseActionManifests).sort(),
    );
  });
});

describe('공식 GitHub App 토큰 Action 연결', /** 고정 revision과 실제 workflow 입력을 대조한다. */ () => {
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
    test(`${name} workflow는 고정 commit과 필요한 토큰 입력·권한을 사용한다`, /** 소비 workflow의 선택한 토큰과 권한을 확인한다. */ async () => {
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
    });
});

describe('공식 릴리스 Action 연결', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
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
  test('릴리스 결과는 최신 develop을 직접 parent로 가진 경우에만 인정한다', /** 자체 판단의 입력과 고유 결과를 확인한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      await writeFile(path.join(fixture.cwd, 'source.txt'), 'current source\n');
      const developSha = commit(fixture.cwd, 'current source');
      git(fixture.cwd, ['checkout', '-b', releaseBranch]);
      await writeFile(
        path.join(fixture.cwd, 'version.txt'),
        'calculated version\n',
      );
      const headSha = commit(fixture.cwd, 'prepared result');
      assertReleasePrSource({
        cwd: fixture.cwd,
        headSha,
        developSha,
        mainSha: fixture.base,
      });
      assert.throws(
        /** 현재 기준과 다른 parent를 거부한다. */ () =>
          assertReleasePrSource({
            cwd: fixture.cwd,
            headSha,
            developSha: fixture.base,
            mainSha: fixture.base,
          }),
        /release PR no longer uses latest develop/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
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
        name: 'CI PR #35',
        path: '.github/workflows/test.yml',
        pull_requests: [{ number: 35 }],
        status: 'completed',
        conclusion: 'success',
      };
      assert.throws(
        () => latestReleaseRun([old, { ...old, id: 2, conclusion }], pr),
        /latest release CI unsuccessful/u,
      );
    });
  test('릴리스 최신 CI는 실제 표시 이름 대신 canonical·qualified 경로로 판정한다', /** 다른 workflow와 누락 경로는 후보에서 제외한다. */ () => {
    const pr = { number: 35, head: { sha: 'a'.repeat(40) } };
    const run = {
      id: 10,
      run_attempt: 1,
      name: 'CI PR #35',
      path: '.github/workflows/test.yml',
      event: 'pull_request',
      head_sha: pr.head.sha,
      pull_requests: [{ number: 35 }],
      status: 'completed',
      conclusion: 'success',
    };
    for (const path of [
      '.github/workflows/test.yml',
      '.github/workflows/test.yml@refs/heads/main',
    ])
      assert.equal(latestReleaseRun([{ ...run, path }], pr).id, 10);
    for (const path of [
      undefined,
      '.github/workflows/other.yml',
      '.github/workflows/test.yml.fake',
      '.github/workflows/test.yml@',
    ])
      assert.throws(
        /** 누락 경로를 성공 표시 이름으로 대체하지 않는다. */ () =>
          latestReleaseRun([{ ...run, path }], pr),
        /final release CI run required/u,
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
  test('실제 공유 보호 gate는 main·develop의 strict 필수 검사와 쓰기 권한이 모두 있어야 허용한다', /** 자체 판단의 입력과 고유 결과를 확인한다. */ async () => {
    const routes = [];
    /** 두 보호 브랜치의 API 응답만 준비한다. */
    async function api(method, route) {
      assert.equal(method, 'GET');
      routes.push(route);
      return route.endsWith('/protection')
        ? {
            enforce_admins: { enabled: true },
            required_pull_request_reviews: {
              bypass_pull_request_allowances: {},
            },
            required_status_checks: { strict: true, contexts: ['required-ci'] },
            allow_force_pushes: { enabled: false },
            allow_deletions: { enabled: false },
          }
        : { permissions: { pull: true, push: true } };
    }
    const input = {
      enabled: 'true',
      appToken: 'fixture',
      repository: 'Fixture/release',
      api,
    };
    await assertActivation(input);
    assert.deepEqual(routes.slice(0, 2), [
      '/repos/Fixture/release/branches/main/protection',
      '/repos/Fixture/release/branches/develop/protection',
    ]);
    await assert.rejects(
      assertActivation({
        ...input,
        /** 필수 검사의 최신 base 보호 누락은 거부한다. */
        api: async (method, route) => ({
          ...(await api(method, route)),
          required_status_checks: { strict: false, contexts: ['required-ci'] },
        }),
      }),
      /latest base required/u,
    );
  });
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
