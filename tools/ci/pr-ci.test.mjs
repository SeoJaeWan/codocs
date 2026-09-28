import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import {
  aggregate,
  assertReleaseProtection,
  eventPolicy,
  runBinding,
} from './pr-ci.mjs';
import { requiredJobs, sourceDigest } from '../build/release-contract.mjs';
const require = createRequire(
  new URL('../../packages/core/package.json', import.meta.url),
);
const YAML = require('yaml');
const workflow = YAML.parse(
  await readFile(
    new URL('../../.github/workflows/test.yml', import.meta.url),
    'utf8',
  ),
);
const reporter = YAML.parse(
  await readFile(
    new URL('../../.github/workflows/ci-report.yml', import.meta.url),
    'utf8',
  ),
);
const binding = {
  repository: 'SeoJaeWan/codocs',
  prNumber: 35,
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
  workflow: 'Tests',
  runId: '123',
  runAttempt: '2',
  eventName: 'pull_request',
  draft: false,
};
const sourceFiles = [
  { file: 'package.json', mode: '100644', gitBlob: 'c'.repeat(40) },
];
const candidate = {
  schemaVersion: 1,
  binding,
  artifactName: 'codocs-candidate-123-2',
  artifactId: '456',
  sourceCommit: binding.headSha,
  sourceTree: 'd'.repeat(40),
  sourceDiff: '',
  sourceFiles,
  sourceDigest: sourceDigest(sourceFiles),
  artifacts: [
    {
      product: 'npm',
      version: '0.0.1',
      basename: 'co-documentation-0.0.1.tgz',
      sha256: 'e'.repeat(64),
    },
    {
      product: 'vscode',
      version: '0.0.2',
      basename: 'codocs-0.0.2.vsix',
      sha256: 'f'.repeat(64),
    },
  ],
};
/** 독립적인 후보 계약 fixture로 OS 증거를 작성한다. */
function evidence(job, result = 'success') {
  return {
    schemaVersion: 1,
    job,
    binding,
    sourceCommit: candidate.sourceCommit,
    sourceTree: candidate.sourceTree,
    sourceDigest: candidate.sourceDigest,
    artifactId: '456',
    artifacts: candidate.artifacts,
    platform: job === 'macos' ? 'darwin' : 'win32',
    stable: '1.110.0',
    result,
  };
}
/** 실제 YAML의 조건을 제한된 GitHub context fixture에서 평가한다. */
function evaluate(
  expression,
  github,
  needs = { resolve: { outputs: { pr_number: '35' } } },
) {
  const source = expression.replace(/^\$\{\{\s*|\s*\}\}$/gu, '');
  return Function(
    'github',
    'needs',
    'always',
    'cancelled',
    'format',
    'startsWith',
    `return (${source});`,
  )(
    github,
    needs,
    () => true,
    () => github.cancelled === true,
    (format, ...values) =>
      format.replace(/\{(\d+)\}/gu, (_, i) => values[Number(i)]),
    (value, prefix) => value.startsWith(prefix),
  );
}

describe('PR 이벤트와 실제 workflow 러너 조건', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  for (const [action, state, draft, count] of [
    ['opened', 'open', true, 0],
    ['synchronize', 'open', true, 0],
    ['reopened', 'open', true, 0],
    ['ready_for_review', 'open', false, 6],
    ['synchronize', 'open', false, 6],
    ['reopened', 'open', false, 6],
    ['converted_to_draft', 'open', true, 0],
    ['closed', 'closed', false, 0],
    ['closed', 'closed', true, 0],
  ])
    it(`${action}·Draft ${draft}·${state}이면 검사 job ${count}개만 실행한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
      const event = { action, pull_request: { number: 35, state, draft } };
      const github = {
        event_name: 'pull_request',
        event,
        workflow: 'Tests',
        run_id: '123',
      };
      assert.equal(workflow.on.pull_request.types.includes(action), true);
      assert.equal(
        Object.values(workflow.jobs).filter((job) => evaluate(job.if, github))
          .length,
        count,
      );
      assert.equal(evaluate(workflow.concurrency.group, github), 'Tests-pr-35');
      assert.equal(
        evaluate(workflow.concurrency['cancel-in-progress'], github),
        true,
      );
      assert.equal(
        eventPolicy('pull_request', event, 'Tests', '123').run,
        count > 0,
      );
      if (!count)
        assert.equal(evaluate(workflow['run-name'], github), 'Cancel PR #35');
    });
  for (const event_name of ['push', 'workflow_dispatch'])
    it(`${event_name}는 main 전체 검사와 별도 취소 그룹을 유지한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
      const github = {
        event_name,
        event: { pull_request: {} },
        workflow: 'Tests',
        run_id: '124',
      };
      assert.equal(
        Object.values(workflow.jobs).filter((job) => evaluate(job.if, github))
          .length,
        5,
      );
      assert.equal(
        evaluate(workflow.concurrency.group, github),
        `Tests-${event_name}-124`,
      );
      assert.equal(
        evaluate(workflow.concurrency['cancel-in-progress'], github),
        false,
      );
      assert.deepEqual(workflow.on.push.branches, ['main']);
    });
  it('필수 dependency 실패는 집계하되 실행 취소 후에는 집계 runner를 시작하지 않는다', /** 집계 job의 실패·취소 시작 조건을 확인한다. */ () => {
    const github = {
      event_name: 'pull_request',
      event: { pull_request: { number: 35, state: 'open', draft: false } },
      cancelled: false,
    };
    assert.equal(evaluate(workflow.jobs['required-ci'].if, github), true);
    assert.equal(workflow.jobs['required-ci'].if.includes('success()'), false);
    assert.equal(
      evaluate(workflow.jobs['required-ci'].if, { ...github, cancelled: true }),
      false,
    );
    assert.equal(
      evaluate(workflow.jobs['required-ci'].name, github),
      'required-ci',
    );
    assert.equal(
      evaluate(workflow.jobs['required-ci'].name, {
        ...github,
        event_name: 'workflow_dispatch',
      }),
      'PR checks omitted',
    );
    assert.equal(
      evaluate(workflow.jobs['required-ci'].name, {
        ...github,
        event_name: 'push',
      }),
      'PR checks omitted',
    );
    assert.equal(
      evaluate(workflow.jobs['required-ci'].name, {
        ...github,
        event: { pull_request: { state: 'open', draft: true } },
      }),
      'PR checks omitted',
    );
  });
  it('다른 PR와 관리 workflow는 취소 그룹을 공유하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.notEqual(
      eventPolicy(
        'pull_request',
        { pull_request: { number: 36 } },
        'Tests',
        '123',
      ).group,
      'Tests-pr-35',
    );
    assert.notEqual(
      eventPolicy(
        'pull_request',
        { pull_request: { number: 35 } },
        'Release publish',
        '123',
      ).group,
      'Tests-pr-35',
    );
  });
  it('문서 경로 분기 없이 정적 한 번과 양 OS·두 버전·네 lifecycle을 유지한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    assert.equal(workflow.on.pull_request.paths, undefined);
    assert.equal(workflow.on.pull_request['paths-ignore'], undefined);
    assert.deepEqual(Object.keys(workflow.jobs), [
      'static',
      'release-management',
      'prepare',
      'windows',
      'macos',
      'required-ci',
    ]);
    assert.deepEqual(workflow.jobs['required-ci'].needs, [
      'static',
      'prepare',
      'release-management',
      'macos',
      'windows',
    ]);
    assert.equal(
      workflow.jobs.static.steps.filter(
        (step) => step.run === 'pnpm check:static',
      ).length,
      1,
    );
    const administration = workflow.jobs['release-management'];
    assert.equal(administration['runs-on'], 'ubuntu-24.04');
    assert.equal(administration.name, 'Release management tests');
    assert.equal(administration.steps[0].with['fetch-depth'], 0);
    assert.ok(
      administration.steps.some(
        (step) => step.run === 'pnpm test:release-management',
      ),
    );
    for (const [id, job] of Object.entries(workflow.jobs))
      if (id !== 'release-management')
        assert.equal(
          job.steps.find(
            /** checkout history 확장은 관리 job 하나로 제한한다. */ (step) =>
              step.uses?.startsWith('actions/checkout@'),
          )?.with?.['fetch-depth'],
          undefined,
        );
    for (const [id, os] of [
      ['windows', 'windows-2025'],
      ['macos', 'macos-15'],
    ]) {
      const job = workflow.jobs[id];
      assert.equal(job['runs-on'], os);
      assert.equal(job.name, `Tests (${os})`);
      assert.equal(job.needs, 'prepare');
      assert.ok(job.steps.some((step) => step.run === 'pnpm check:runtime:os'));
      assert.equal(
        job.steps.filter((step) =>
          step.run?.includes('run.mjs --vscode-version'),
        ).length,
        2,
      );
      assert.equal(
        job.steps.filter((step) =>
          step.run?.includes('lifecycle.mjs --vscode-version'),
        ).length,
        2,
      );
      assert.ok(
        job.steps.some((step) =>
          step.run?.includes('--vscode-version 1.100.0'),
        ),
      );
      assert.ok(
        job.steps.some((step) =>
          step.run?.includes('needs.prepare.outputs.stable'),
        ),
      );
      assert.ok(
        job.steps.some(
          (step) =>
            step.run?.includes('pnpm release:verify') &&
            step.run.includes('needs.prepare.outputs.npm_file'),
        ),
      );
      assert.ok(job.steps.some((step) => step.if === 'failure()'));
      assert.equal(
        job.env.CODOCS_ARTIFACT_ID.includes(
          "github.event_name == 'pull_request'",
        ),
        true,
      );
    }
    const lifecycle = await readFile(
      new URL(
        '../../packages/vscode/test-runner/lifecycle.mjs',
        import.meta.url,
      ),
      'utf8',
    );
    assert.match(
      lifecycle,
      /\['startup-failure', 'failure', 'timeout', 'cancelled'\]/u,
    );
    const source = JSON.stringify(workflow);
    assert.equal(source.includes('pnpm check"'), false);
    assert.equal(source.includes('0.0.1.tgz'), false);
    assert.equal(source.includes('cache: true'), false);
    for (const job of Object.values(workflow.jobs))
      for (const step of job.steps)
        if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/u);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    const baseline = workflow.jobs.prepare.steps.find(
      (step) => step.run === 'node tools/ci/release-flow.mjs verify-pr',
    );
    assert.equal(baseline.env.GITHUB_TOKEN, '${{ github.token }}');
    assert.deepEqual(reporter.permissions, {
      contents: 'read',
      actions: 'read',
    });
    assert.deepEqual(reporter.jobs.report.permissions, {
      contents: 'read',
      actions: 'read',
      'pull-requests': 'write',
    });
    assert.equal(reporter.jobs.report.needs, 'resolve');
    assert.equal(reporter.jobs.report.concurrency['cancel-in-progress'], false);
    assert.equal(
      reporter.jobs.report.concurrency.group,
      'ci-report-${{ github.repository }}-${{ needs.resolve.outputs.pr_number }}',
    );
    assert.equal(
      reporter.jobs.report.steps[0].with.ref,
      '${{ github.event.repository.default_branch }}',
    );
    assert.equal(
      reporter.jobs.report.steps.some((step) => step.run?.includes('pnpm')),
      false,
    );
  });
  it('Draft 취소 workflow의 완료는 reporter runner를 시작하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    const github = {
      event: {
        workflow_run: {
          name: 'Tests',
          event: 'pull_request',
          conclusion: 'success',
          display_title: 'Cancel PR #35',
        },
      },
    };
    assert.equal(evaluate(reporter.jobs.report.if, github), false);
    assert.equal(evaluate(reporter.jobs.resolve.if, github), false);
  });
  it('게시 skipped는 두 reporter job을 막고 실제 성공·실패는 처리한다', /** 실제 YAML의 지원 조건만 검증한다. */ () => {
    for (const conclusion of ['skipped', 'success', 'failure']) {
      const github = {
        event: { workflow_run: { name: 'Release publish', conclusion } },
      };
      assert.equal(
        evaluate(reporter.jobs.resolve.if, github),
        conclusion !== 'skipped',
      );
      assert.equal(
        evaluate(reporter.jobs.report.if, github),
        conclusion !== 'skipped',
      );
    }
  });
  it('준비된 CI는 허용하되 PR 출력이 없으면 writer를 시작하지 않는다', /** resolver 생략 결과를 빈 댓글 그룹으로 실행하지 않는다. */ () => {
    for (const workflow_run of [
      {
        name: 'Tests',
        event: 'pull_request',
        conclusion: 'success',
        display_title: 'CI PR #35',
      },
      { name: 'Release publish', conclusion: 'success' },
    ]) {
      const github = { event: { workflow_run } };
      assert.equal(evaluate(reporter.jobs.resolve.if, github), true);
      assert.equal(evaluate(reporter.jobs.report.if, github), true);
      assert.equal(
        evaluate(reporter.jobs.report.if, github, {
          resolve: { outputs: { pr_number: '' } },
        }),
        false,
      );
    }
  });
});

describe('필수 CI 후보와 OS 증거 집계', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  for (const result of ['failure', 'cancelled', 'skipped', 'missing'])
    it(`릴리스 관리가 ${result}이면 OS 성공에도 필수 CI가 통과하지 않는다`, /** 누락은 성공 job 집합으로 인정하지 않는다. */ () => {
      const jobs = Object.fromEntries(
        requiredJobs.map((job) => [job, { result: 'success' }]),
      );
      if (result === 'missing') {
        delete jobs['release-management'];
        assert.throws(
          /** 관리 job의 부재는 필수 집합 오류로 명시적 거부한다. */ () =>
            aggregate(
              binding,
              candidate,
              jobs,
              { macos: evidence('macos'), windows: evidence('windows') },
              '1.110.0',
            ),
          /required job set mismatch/u,
        );
      } else {
        jobs['release-management'].result = result;
        assert.equal(
          aggregate(
            binding,
            candidate,
            jobs,
            { macos: evidence('macos'), windows: evidence('windows') },
            '1.110.0',
          ).result,
          'failure',
        );
      }
    });
  it('전체 성공이면 동일 후보와 양 OS 증거로 통과한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    const jobs = Object.fromEntries(
      requiredJobs.map((job) => [job, { result: 'success' }]),
    );
    const before = structuredClone(candidate);
    assert.equal(
      aggregate(
        binding,
        candidate,
        jobs,
        {
          macos: evidence('macos'),
          windows: evidence('windows'),
        },
        '1.110.0',
      ).result,
      'success',
    );
    assert.deepEqual(candidate, before);
  });
  for (const result of ['failure', 'cancelled', 'skipped'])
    it(`static이 ${result}면 성공으로 집계하지 않는다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
      const jobs = {
        static: { result },
        'release-management': { result: 'success' },
        prepare: { result: 'success' },
        macos: { result: 'success' },
        windows: { result: 'success' },
      };
      assert.equal(
        aggregate(
          binding,
          candidate,
          jobs,
          {
            macos: evidence('macos'),
            windows: evidence('windows'),
          },
          '1.110.0',
        ).result,
        'failure',
      );
    });
  it('후보가 없으면 모든 job 성공이어도 실패한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.equal(
      aggregate(
        binding,
        null,
        Object.fromEntries(
          requiredJobs.map((job) => [job, { result: 'success' }]),
        ),
        {},
        '1.110.0',
      ).result,
      'failure',
    );
  });
  it('다른 업로드 ID의 OS 증거는 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.throws(
      /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () =>
        aggregate(
          binding,
          candidate,
          Object.fromEntries(
            requiredJobs.map((job) => [job, { result: 'success' }]),
          ),
          {
            macos: { ...evidence('macos'), artifactId: '999' },
            windows: evidence('windows'),
          },
          '1.110.0',
        ),
      /evidence artifactId mismatch/u,
    );
  });
  it('OS가 준비 job과 다른 stable을 검증했다고 주장하면 거부한다', /** 고정 stable 연결을 검사한다. */ () => {
    assert.throws(
      /** 고정 버전이 다른 증거를 거부하는지 확인한다. */ () =>
        aggregate(
          binding,
          candidate,
          {
            static: { result: 'success' },
            'release-management': { result: 'success' },
            prepare: { result: 'success' },
            macos: { result: 'success' },
            windows: { result: 'success' },
          },
          {
            macos: { ...evidence('macos'), stable: '1.111.0' },
            windows: evidence('windows'),
          },
          '1.110.0',
        ),
      /fixed stable mismatch/u,
    );
  });
  it('수동 실행을 ready PR 바인딩으로 사용하면 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.throws(
      () => runBinding({}, { GITHUB_EVENT_NAME: 'workflow_dispatch' }),
      /automatic PR required/u,
    );
  });
});

describe('실제 보호 적용 확인', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  /** PR와 strict CI를 강제하는 독립적인 GitHub 응답 fixture다. */
  function protection() {
    return {
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
      },
      required_status_checks: {
        strict: true,
        contexts: ['required-ci'],
        checks: [],
      },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    };
  }
  it('main·develop 모두 보호됐으면 조회한 두 브랜치를 인정한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const routes = [];
    assert.equal(
      await assertReleaseProtection(async (method, route) => {
        routes.push([method, route]);
        return protection();
      }, 'SeoJaeWan/codocs'),
      true,
    );
    assert.deepEqual(routes, [
      ['GET', '/repos/SeoJaeWan/codocs/branches/main/protection'],
      ['GET', '/repos/SeoJaeWan/codocs/branches/develop/protection'],
    ]);
  });
  it('보호 조회가 404로 실패하면 실패를 전파하고 postmerge를 생략하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    await assert.rejects(
      assertReleaseProtection(async () => {
        throw new Error('404 protection unavailable');
      }, 'SeoJaeWan/codocs'),
      /404 protection unavailable/u,
    );
    assert.deepEqual(workflow.on.push.branches, ['main']);
  });
  for (const [field, replacement, message] of [
    ['enforce_admins', { enabled: false }, 'admins must be protected'],
    ['required_status_checks', { strict: false }, 'latest base required'],
    [
      'required_status_checks',
      { strict: true, contexts: [], checks: [] },
      'required-ci required',
    ],
    ['required_pull_request_reviews', null, 'PR required'],
    [
      'required_pull_request_reviews',
      { bypass_pull_request_allowances: { apps: [{ id: 1 }] } },
      'PR bypass forbidden',
    ],
  ])
    it(`${field}가 강제 조건을 충족하지 않으면 게시 gate를 거부한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
      await assert.rejects(
        assertReleaseProtection(
          async () => ({ ...protection(), [field]: replacement }),
          'SeoJaeWan/codocs',
        ),
        new RegExp(message, 'u'),
      );
    });
});
