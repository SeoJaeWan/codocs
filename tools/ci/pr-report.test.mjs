import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  commentMetadata,
  newestRun,
  renderComment,
  reportRun,
  resolveReportPr,
  shouldUpdate,
  summarizeJobs,
} from './pr-report.mjs';
import { createReport, sourceDigest } from '../build/release-contract.mjs';
import { releaseBranch } from './release-flow.mjs';
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
const files = [
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
  sourceFiles: files,
  sourceDigest: sourceDigest(files),
  artifacts: [
    {
      product: 'npm',
      version: '0.0.2',
      basename: 'co-documentation-0.0.2.tgz',
      sha256: 'e'.repeat(64),
    },
    {
      product: 'vscode',
      version: '0.0.1',
      basename: 'codocs-0.0.1.vsix',
      sha256: 'f'.repeat(64),
    },
  ],
};
const run = {
  id: 123,
  run_attempt: 2,
  name: 'Tests',
  event: 'pull_request',
  head_sha: binding.headSha,
  conclusion: 'success',
  display_title: 'CI PR #35',
  pull_requests: [
    {
      number: 35,
      head: { sha: binding.headSha },
      base: { sha: binding.baseSha },
    },
  ],
};
const pr = {
  number: 35,
  state: 'open',
  draft: false,
  merged: false,
  head: { sha: binding.headSha },
  base: { sha: binding.baseSha },
};
const jobRows = [
  { name: 'Static checks', conclusion: 'success' },
  { name: 'Freeze release candidate', conclusion: 'success' },
  {
    name: 'Tests (macos-15)',
    conclusion: 'success',
    started_at: '2026-09-28T01:00:00Z',
    completed_at: '2026-09-28T01:03:00Z',
  },
  {
    name: 'Tests (windows-2025)',
    conclusion: 'success',
    started_at: '2026-09-28T01:00:00Z',
    completed_at: '2026-09-28T01:04:00Z',
  },
  { name: 'Release management tests', conclusion: 'success' },
  { name: 'required-ci', conclusion: 'success' },
];

/** 실제 reporter API·artifact 경계를 모방하며 외부 쓰기는 독립 배열에만 남긴다. */
function fixture() {
  const current = structuredClone(pr);
  const trigger = structuredClone(run);
  const jobs = structuredClone(jobRows);
  const runs = [structuredClone(run)];
  const comments = [];
  const writes = [];
  const artifacts = [
    { id: 456, name: 'codocs-candidate-123-2', expired: false },
    { id: 457, name: 'codocs-report-123-2', expired: false },
  ];
  const uploaded = createReport(binding, candidate, {
    static: { result: 'success' },
    'release-management': { result: 'success' },
    prepare: { result: 'success' },
    macos: { result: 'success' },
    windows: { result: 'success' },
  });
  const records = {
    456: { ...structuredClone(candidate), artifactId: null },
    457: uploaded,
  };
  const calls = [];
  /** 테스트 fixture의 명시적 API 경로 외 조회·쓰기는 실패시킨다. */
  async function api(method, route, body) {
    calls.push([method, route]);
    if (method !== 'GET') {
      writes.push({ method, route, body });
      return {};
    }
    if (route === '/repos/SeoJaeWan/codocs/actions/runs/123') return trigger;
    if (route === '/repos/SeoJaeWan/codocs/actions/runs/987')
      return {
        id: 987,
        run_attempt: 1,
        path: '.github/workflows/release-publish.yml',
        head_branch: 'main',
        event: 'push',
        head_sha: '9'.repeat(40),
      };
    if (route === '/repos/SeoJaeWan/codocs/pulls/35') return current;
    if (route.startsWith('/repos/SeoJaeWan/codocs/commits/'))
      return [{ number: 35 }];
    if (route.includes('/attempts/2/jobs?')) return { jobs };
    if (route.includes('/workflows/test.yml/runs?'))
      return { workflow_runs: runs };
    if (route.includes('/issues/35/comments?')) return comments;
    if (route.includes('/runs/123/artifacts?')) return { artifacts };
    if (route.includes('/runs/987/artifacts?'))
      return {
        artifacts: [{ id: 988, name: 'codocs-publish-987-1', expired: false }],
      };
    throw new Error(`unexpected fixture API ${method} ${route}`);
  }
  return {
    current,
    trigger,
    jobs,
    runs,
    comments,
    writes,
    artifacts,
    uploaded,
    records,
    calls,
    api,
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ readArchive: async (id) =>
      structuredClone(records[id]),
  };
}

describe('PR별 댓글 작성 그룹 결정', /** 작성 전 PR 연결을 확인한다. */ () => {
  it('fork의 빈 연결 목록도 고정 CI 제목으로 같은 PR 그룹을 얻는다', /** fork 실행 제목을 확인한다. */ async () => {
    const f = fixture();
    assert.equal(
      await resolveReportPr(f.api, f.readArchive, binding.repository, {
        ...run,
        pull_requests: [],
      }),
      35,
    );
    assert.equal(f.writes.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(
      await resolveReportPr(f.api, f.readArchive, binding.repository, {
        ...run,
        display_title: 'CI PR #36',
      }),
      36,
    );
  });
  it('Draft 취소 제목은 댓글 그룹의 준비 완료 실행으로 인정하지 않는다', /** 생략 실행의 관리 러너 사용을 방지한다. */ async () => {
    const f = fixture();
    await assert.rejects(
      resolveReportPr(f.api, f.readArchive, binding.repository, {
        ...run,
        display_title: 'Cancel PR #35',
      }),
      /ready CI title required/u,
    );
    assert.equal(f.writes.length, 0);
  });
});

describe('최신 실행과 댓글 순서 확인', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  it('현재 head·base·최신 실행이면 댓글 갱신을 허용한다', () => {
    assert.equal(shouldUpdate(pr, binding, run, run, null), true);
  });
  for (const [name, change] of [
    ['새 head', { head: { sha: 'f'.repeat(40) } }],
    ['새 base', { base: { sha: 'f'.repeat(40) } }],
    ['Draft 복귀', { draft: true }],
    ['닫기', { state: 'closed' }],
  ])
    it(`${name} 뒤에는 이전 결과가 댓글을 덮어쓰지 않는다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
      assert.equal(
        shouldUpdate({ ...pr, ...change }, binding, run, run, null),
        false,
      );
    });
  it('최신 실행과 같은 head의 오래된 attempt도 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.equal(
      shouldUpdate(pr, binding, run, { ...run, run_attempt: 3 }, null),
      false,
    );
    assert.equal(
      shouldUpdate(pr, binding, run, run, { runId: '123', runAttempt: '3' }),
      false,
    );
  });
  it('수동·다른 PR·닫기 취소 실행을 최신 제품 CI로 선택하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    const rows = [
      run,
      { ...run, id: 130, event: 'workflow_dispatch' },
      {
        ...run,
        id: 131,
        display_title: 'CI PR #36',
        pull_requests: [{ number: 36 }],
      },
      { ...run, id: 132, display_title: 'Cancel PR #35' },
    ];
    assert.equal(newestRun(rows, binding).id, 123);
  });
  it('부분 게시의 더 오래된 게시 attempt는 최신 제품 결과를 덮어쓰지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.equal(
      shouldUpdate(
        { ...pr, state: 'closed', merged: true },
        binding,
        run,
        run,
        {
          runId: '123',
          runAttempt: '2',
          publishRun: { runId: '987', runAttempt: '2' },
        },
        { runId: '987', runAttempt: '1' },
      ),
      false,
    );
  });
});

describe('신뢰한 API 결과와 단일 댓글 게시', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  it('성공한 최신 PR의 OS 시간과 실행 링크를 댓글 하나에 쓴다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    assert.equal(
      await reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      'updated',
    );
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].method, 'POST');
    assert.match(f.writes[0].body.body, /required-ci: \*\*success\*\*/u);
    assert.match(f.writes[0].body.body, /windows \| success \| 240s/u);
    assert.match(f.writes[0].body.body, /macos \| success \| 180s/u);
    assert.match(f.writes[0].body.body, /actions\/runs\/123\/attempts\/2/u);
  });
  it('fork의 빈 pull_requests는 실제 commit 연결을 확인하고 댓글 권한만 사용한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.trigger.pull_requests = [];
    assert.equal(
      await reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      'updated',
    );
    assert.ok(f.calls.some(([, route]) => route.includes('/commits/')));
    assert.equal(f.writes.length, 1);
  });
  it('기존 봇 표식 댓글은 새 댓글 없이 PATCH한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.comments.push({
      id: 55,
      user: { login: 'github-actions[bot]' },
      body: renderComment(
        createReport(binding, candidate, summarizeJobs(jobRows)),
      ),
    });
    assert.equal(
      await reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      'updated',
    );
    assert.equal(f.writes[0].method, 'PATCH');
    assert.equal(
      f.writes[0].route,
      '/repos/SeoJaeWan/codocs/issues/comments/55',
    );
  });
  it('사용자가 복제한 표식 댓글을 수정하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.comments.push({
      id: 55,
      user: { login: 'contributor' },
      body: '<!-- codocs-required-ci -->',
    });
    await reportRun(f.api, f.readArchive, binding.repository, f.trigger);
    assert.equal(f.writes[0].method, 'POST');
  });
  it('API job 실패는 위조 성공 report를 통과 댓글로 만들지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.jobs[2].conclusion = 'failure';
    f.jobs[2].steps = [
      { name: 'VS Code minimum <script>', conclusion: 'failure' },
    ];
    await reportRun(f.api, f.readArchive, binding.repository, f.trigger);
    assert.match(f.writes[0].body.body, /required-ci: \*\*failure\*\*/u);
    assert.match(f.writes[0].body.body, /VS Code minimum &#60;script&#62;/u);
  });
  for (const conclusion of ['cancelled', 'skipped', 'timed_out'])
    it(`필수 API job이 ${conclusion}이면 성공 댓글을 쓰지 않는다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
      const f = fixture();
      f.jobs[2].conclusion = conclusion;
      await reportRun(f.api, f.readArchive, binding.repository, f.trigger);
      assert.match(f.writes[0].body.body, /required-ci: \*\*failure\*\*/u);
    });
  it('required-ci 집계 job 실패도 성공 댓글을 쓰지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.jobs.find((job) => job.name === 'required-ci').conclusion = 'failure';
    f.jobs.find((job) => job.name === 'required-ci').steps = [
      { name: 'Aggregate candidate', conclusion: 'failure' },
    ];
    await reportRun(f.api, f.readArchive, binding.repository, f.trigger);
    assert.match(f.writes[0].body.body, /required-ci: \*\*failure\*\*/u);
  });
  it('후보 생성 실패에도 API에 연결된 최신 base의 실패 단계를 기록한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.artifacts.splice(0);
    f.jobs[1].conclusion = 'failure';
    f.jobs[1].steps = [{ name: 'Freeze candidate', conclusion: 'failure' }];
    await reportRun(f.api, f.readArchive, binding.repository, f.trigger);
    assert.match(f.writes[0].body.body, /Freeze candidate/u);
    assert.match(f.writes[0].body.body, /required-ci: \*\*failure\*\*/u);
  });
  it('base 연결 증거가 없는 fork 준비 실패는 댓글을 덮어쓰지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.trigger.pull_requests = [];
    f.artifacts.splice(0);
    assert.equal(
      await reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      'stale',
    );
    assert.equal(f.writes.length, 0);
  });
  it('최신 base와 artifact 바인딩이 다르면 권한 쓰기 전에 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.current.base.sha = 'e'.repeat(40);
    await assert.rejects(
      reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      /report run\/base mismatch/u,
    );
    assert.equal(f.writes.length, 0);
  });
  it('오래된 실행 완료는 최신 head의 실행 댓글을 수정하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.runs.push({ ...run, id: 124 });
    assert.equal(
      await reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      'stale',
    );
    assert.equal(f.writes.length, 0);
  });
  for (const [name, changes] of [
    ['취소', { conclusion: 'cancelled' }],
    ['수동', { event: 'workflow_dispatch' }],
    ['Draft 생략', { display_title: 'Cancel PR #35' }],
  ])
    it(`${name} workflow 완료는 댓글을 수정하지 않는다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
      const f = fixture();
      Object.assign(f.trigger, changes);
      assert.equal(
        await reportRun(f.api, f.readArchive, binding.repository, f.trigger),
        'ignored',
      );
      assert.equal(f.writes.length, 0);
    });
  it('작성 그룹의 PR 번호와 실제 바인딩이 다르면 댓글을 쓰지 않는다', /** 해결한 PR 그룹과 작성 대상을 연결한다. */ async () => {
    const f = fixture();
    await assert.rejects(
      reportRun(f.api, f.readArchive, binding.repository, f.trigger, 36),
      /resolved PR mismatch/u,
    );
    assert.equal(f.writes.length, 0);
  });
  it('다른 artifact 업로드 ID가 report에 들어 있으면 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.records[457].artifactId = '999';
    await assert.rejects(
      reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      /report artifactId mismatch/u,
    );
    assert.equal(f.writes.length, 0);
  });
  it('같은 artifact 이름이 둘이면 임의의 후보를 선택하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.artifacts.push({
      id: 999,
      name: 'codocs-candidate-123-2',
      expired: false,
    });
    await assert.rejects(
      reportRun(f.api, f.readArchive, binding.repository, f.trigger),
      /one exact live artifact required/u,
    );
    assert.equal(f.writes.length, 0);
  });
  it('부분 게시의 대상별 결과를 같은 CI 댓글에 갱신한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
    const f = fixture();
    f.current.state = 'closed';
    f.current.merged = true;
    f.current.merge_commit_sha = '9'.repeat(40);
    const publishRun = {
      id: 987,
      run_attempt: 1,
      name: 'Release publish',
      event: 'push',
      conclusion: 'failure',
    };
    f.records[988] = {
      schemaVersion: 1,
      binding,
      sourceCommit: candidate.sourceCommit,
      sourceTree: candidate.sourceTree,
      sourceDigest: candidate.sourceDigest,
      artifactId: '456',
      artifacts: candidate.artifacts,
      changedProducts: ['npm'],
      publishRun: { runId: '987', runAttempt: '1' },
      products: {
        npm: { version: '0.0.2', status: 'failed' },
        vscode: { version: '0.0.1', status: 'unchanged' },
      },
    };
    assert.equal(
      await resolveReportPr(
        f.api,
        f.readArchive,
        binding.repository,
        publishRun,
      ),
      35,
    );
    assert.equal(
      await reportRun(f.api, f.readArchive, binding.repository, publishRun),
      'updated',
    );
    assert.match(f.writes[0].body.body, /npm \| 0.0.2 \| failed/u);
    assert.match(f.writes[0].body.body, /vscode \| 0.0.1 \| unchanged/u);
    assert.match(f.writes[0].body.body, /actions\/runs\/987/u);
  });
  for (const [field, value, message] of [
    ['path', '.github/workflows/fake.yml', 'trusted publish workflow required'],
    ['head_branch', 'feature', 'main publish run required'],
    ['event', 'pull_request', 'trusted publish event required'],
  ])
    it(`${field}가 신뢰한 main 게시 실행과 다르면 댓글을 거부한다`, /** 게시 실행의 신뢰 경계를 검증한다. */ async () => {
      const f = fixture();
      /** 신뢰 조회 응답에서 한 가지 조건만 변경한다. */
      async function api(method, route, body) {
        const result = await f.api(method, route, body);
        return route === '/repos/SeoJaeWan/codocs/actions/runs/987'
          ? { ...result, [field]: value }
          : result;
      }
      await assert.rejects(
        reportRun(api, f.readArchive, binding.repository, {
          id: 987,
          run_attempt: 1,
          name: 'Release publish',
        }),
        new RegExp(message, 'u'),
      );
      assert.equal(f.writes.length, 0);
    });
  it('손상된 기존 댓글 메타데이터는 조용히 최신 것으로 취급하지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.throws(
      () =>
        commentMetadata(
          '<!-- codocs-run: {"runId":"bad","runAttempt":"1"} -->',
        ),
      /invalid comment run ID/u,
    );
  });
});

/** 게시 없는 실행의 신뢰 조회·artifact·archive·댓글 경계를 관찰한다. */
function noPublicationFixture(conclusion, event = 'push') {
  const f = fixture();
  const current = {
    id: 987,
    run_attempt: 1,
    name: 'Release publish',
    path: '.github/workflows/release-publish.yml',
    head_branch: 'main',
    head_sha: '9'.repeat(40),
    event,
    conclusion,
  };
  const artifacts = [];
  const pulls = [];
  const archiveReads = [];
  /** 실제 게시 실행과 정확한 commit 연결만 대체한다. */
  async function api(method, route, body) {
    if (route === '/repos/SeoJaeWan/codocs/actions/runs/987') {
      f.calls.push([method, route]);
      return current;
    }
    if (route.includes('/runs/987/artifacts?')) {
      f.calls.push([method, route]);
      return { artifacts };
    }
    if (
      route.startsWith(
        `/repos/SeoJaeWan/codocs/commits/${current.head_sha}/pulls?`,
      )
    ) {
      f.calls.push([method, route]);
      return pulls;
    }
    return f.api(method, route, body);
  }
  return {
    ...f,
    current,
    artifacts,
    pulls,
    archiveReads,
    api,
    /** archive 소비가 생략되었는지도 별도로 기록한다. */
    readArchive: async (id, filename) => {
      archiveReads.push([id, filename]);
      return f.readArchive(id, filename);
    },
  };
}

describe('게시 없는 실행의 reporter 생략', /** 실제 누락과 정상 생략을 구별한다. */ () => {
  for (const [name, operation, ignored] of [
    ['resolver', resolveReportPr, null],
    ['writer', reportRun, 'ignored'],
  ]) {
    it(`${name}: 신뢰한 skipped 실행은 artifact 조회조차 하지 않는다`, /** 러너 없는 게시의 댓글 소비를 생략한다. */ async () => {
      const f = noPublicationFixture('skipped');
      assert.equal(
        await operation(f.api, f.readArchive, binding.repository, f.current),
        ignored,
      );
      assert.equal(f.calls.length, 1);
      assert.equal(f.archiveReads.length, 0);
      assert.equal(f.writes.length, 0);
    });
    it(`${name}: 성공한 비릴리스 main push는 증거 없이 생략한다`, /** 정확한 commit의 일반 PR 연결만 허용한다. */ async () => {
      const f = noPublicationFixture('success');
      f.pulls.push({
        merged_at: '2026-09-28',
        merge_commit_sha: f.current.head_sha,
        base: { ref: 'main' },
        head: { ref: 'feature' },
      });
      assert.equal(
        await operation(f.api, f.readArchive, binding.repository, f.current),
        ignored,
      );
      assert.ok(
        f.calls.some(([, route]) =>
          route.includes(`/commits/${f.current.head_sha}/pulls?`),
        ),
      );
      assert.equal(f.archiveReads.length, 0);
      assert.equal(f.writes.length, 0);
    });
    it(`${name}: 실제 릴리스 commit의 게시 증거 누락은 실패한다`, /** 생략 예외가 릴리스 오류를 가리지 않는다. */ async () => {
      const f = noPublicationFixture('success');
      f.pulls.push({
        merged_at: '2026-09-28',
        merge_commit_sha: f.current.head_sha,
        base: { ref: 'main' },
        head: { ref: releaseBranch },
      });
      await assert.rejects(
        operation(f.api, f.readArchive, binding.repository, f.current),
        /one exact live artifact required/u,
      );
      assert.equal(f.writes.length, 0);
    });
    for (const [conclusion, event] of [
      ['failure', 'push'],
      ['cancelled', 'push'],
      ['success', 'workflow_dispatch'],
    ])
      it(`${name}: ${event}/${conclusion}의 누락은 생략하지 않는다`, /** 실패·취소·재시도에는 게시 증거를 요구한다. */ async () => {
        const f = noPublicationFixture(conclusion, event);
        await assert.rejects(
          operation(f.api, f.readArchive, binding.repository, f.current),
          /one exact live artifact required/u,
        );
        assert.equal(f.writes.length, 0);
      });
    for (const expired of [true, false])
      it(`${name}: ${expired ? '만료된' : '중복된'} 게시 증거는 비릴리스 예외로 무시하지 않는다`, /** 잘못된 artifact를 정상 부재와 구별한다. */ async () => {
        const f = noPublicationFixture('success');
        f.artifacts.push({ id: 988, name: 'codocs-publish-987-1', expired });
        if (!expired)
          f.artifacts.push({
            id: 989,
            name: 'codocs-publish-987-1',
            expired: false,
          });
        await assert.rejects(
          operation(f.api, f.readArchive, binding.repository, f.current),
          /one exact live artifact required/u,
        );
        assert.equal(f.archiveReads.length, 0);
        assert.equal(f.writes.length, 0);
      });
    it(`${name}: webhook의 skipped 주장만으로 현재 실패 실행을 생략하지 않는다`, /** 실제 조회한 결론만 신뢰한다. */ async () => {
      const f = noPublicationFixture('failure');
      await assert.rejects(
        operation(f.api, f.readArchive, binding.repository, {
          ...f.current,
          conclusion: 'skipped',
        }),
        /one exact live artifact required/u,
      );
    });
    it(`${name}: 손상된 게시 archive는 비릴리스 예외로 무시하지 않는다`, /** archive 소비 실패가 정상 부재로 바뀌지 않는다. */ async () => {
      const f = noPublicationFixture('success');
      f.artifacts.push({
        id: 988,
        name: 'codocs-publish-987-1',
        expired: false,
      });
      await assert.rejects(
        operation(
          f.api,
          /** 실제 archive 파싱 실패를 전달한다. */ async () => {
            throw new Error('corrupt publish archive');
          },
          binding.repository,
          f.current,
        ),
        /corrupt publish archive/u,
      );
      assert.equal(f.writes.length, 0);
    });
    it(`${name}: skipped라도 다른 workflow는 거부한다`, /** 생략 전에 고정 workflow를 확인한다. */ async () => {
      const f = noPublicationFixture('skipped');
      f.current.path = '.github/workflows/fake.yml';
      await assert.rejects(
        operation(f.api, f.readArchive, binding.repository, f.current),
        /trusted publish workflow required/u,
      );
    });
  }
  it('실제 resolver CLI는 생략한 실행에 pr_number 출력을 쓰지 않는다', /** 실행 출력 부재로 후속 writer를 막는다. */ async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'codocs-report-skip-'));
    const f = noPublicationFixture('skipped');
    const requests = [];
    const server = createServer(
      /** 독립 로컬 API는 현재 게시 실행 한 건만 제공한다. */ (
        request,
        response,
      ) => {
        requests.push(request.url);
        response.setHeader('content-type', 'application/json');
        if (request.url === '/repos/SeoJaeWan/codocs/actions/runs/987')
          response.end(JSON.stringify(f.current));
        else {
          response.statusCode = 404;
          response.end('{}');
        }
      },
    );
    try {
      await new Promise(
        /** 서버 준비 후 실제 CLI를 시작한다. */ (resolve) =>
          server.listen(0, '127.0.0.1', resolve),
      );
      const event = path.join(directory, 'event.json');
      const output = path.join(directory, 'output');
      await writeFile(event, JSON.stringify({ workflow_run: f.current }));
      await writeFile(output, '');
      const child = spawn(
        process.execPath,
        [new URL('./pr-report.mjs', import.meta.url).pathname, 'resolve'],
        {
          env: {
            ...process.env,
            GITHUB_EVENT_PATH: event,
            GITHUB_OUTPUT: output,
            GITHUB_REPOSITORY: binding.repository,
            GITHUB_TOKEN: 'fixture-only',
            GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stderr = '';
      child.stderr.on(
        'data',
        /** 실패 로그를 테스트 진단에만 남긴다. */ (value) => {
          stderr += value;
        },
      );
      const code = await new Promise(
        /** CLI 종료 상태를 기다린다. */ (resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        },
      );
      assert.equal(code, 0, stderr);
      assert.equal(await readFile(output, 'utf8'), '');
      assert.deepEqual(requests, ['/repos/SeoJaeWan/codocs/actions/runs/987']);
    } finally {
      await new Promise(
        /** fixture 서버를 종료한다. */ (resolve) => server.close(resolve),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });
});

for (const outcome of ['failure', 'cancelled', 'skipped', 'missing'])
  it(`관리 job ${outcome}이면 reporter도 성공 댓글을 표시하지 않는다`, /** 신뢰한 jobs API의 관리 결과를 필수 집계에 연결한다. */ async () => {
    const f = fixture();
    const management = f.jobs.find(
      (job) => job.name === 'Release management tests',
    );
    if (outcome === 'missing') f.jobs.splice(f.jobs.indexOf(management), 1);
    else management.conclusion = outcome;
    await reportRun(f.api, f.readArchive, binding.repository, f.trigger);
    assert.match(f.writes[0].body.body, /required-ci: \*\*failure\*\*/u);
  });
