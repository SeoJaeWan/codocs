import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  workflowNames,
  jobNames,
  reportArtifactName,
  publishArtifactName,
  validateReport,
  createReport,
  requiredJobs,
  sha256,
  validatePublish,
} from '../build/release-contract.mjs';

const binding = {
  repository: 'SeoJaeWan/codocs',
  prNumber: 35,
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
  workflow: 'CI',
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
  sourceDigest: sha256(JSON.stringify(sourceFiles)),
  artifacts: [
    {
      product: 'npm',
      version: '1.2.3',
      basename: 'co-documentation-1.2.3.tgz',
      sha256: sha256('npm bytes'),
    },
    {
      product: 'vscode',
      version: '2.3.4',
      basename: 'codocs-2.3.4.vsix',
      sha256: sha256('vscode bytes'),
    },
  ],
};

for (const result of ['success', 'failure', 'cancelled', 'skipped'])
  test(`필수 job이 ${result}이면 모든 job 성공 여부를 정확하게 집계한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    const jobs = {
      static: { result: 'success' },
      'release-management': { result: 'success' },
      prepare: { result: 'success' },
      macos: { result: 'success' },
      windows: { result },
    };
    const report = createReport(binding, candidate, jobs);
    assert.equal(report.result, result === 'success' ? 'success' : 'failure');
    assert.equal(report.publish.npm.status, 'pending');
    assert.deepEqual(report.artifacts, candidate.artifacts);
  });
test('필수 job이 누락되면 집계 성공 결과를 만들지 않는다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  assert.throws(
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () =>
      createReport(binding, candidate, { static: { result: 'success' } }),
    { message: /required job set mismatch/u },
  );
});
test('npm 게시 성공과 변경 없는 확장을 기록하면 제품별 상태를 구분한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  const record = {
    ...candidate,
    products: {
      npm: { version: '1.2.3', status: 'published' },
      vscode: { version: '2.3.4', status: 'unchanged' },
    },
  };
  assert.equal(validatePublish(record, candidate, ['npm']), record);
});
test('버전이 그대로인 확장을 게시 성공으로 기록하면 잘못된 상태를 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  const record = {
    ...candidate,
    products: {
      npm: { version: '1.2.3', status: 'published' },
      vscode: { version: '2.3.4', status: 'published' },
    },
  };
  assert.throws(
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () =>
      validatePublish(record, candidate, ['npm']),
    {
      message: /invalid publish status/u,
    },
  );
});
test('후보 준비 실패로 receipt가 없으면 게시 가능성이 없는 실패 집계를 만든다', /** 실패 댓글에 후보 없이 job 결과를 남긴다. */ () => {
  const jobs = {
    static: { result: 'success' },
    'release-management': { result: 'success' },
    prepare: { result: 'failure' },
    macos: { result: 'skipped' },
    windows: { result: 'skipped' },
  };
  const report = createReport(binding, null, jobs);
  assert.equal(report.result, 'failure');
  assert.equal(report.artifactId, null);
  assert.deepEqual(report.artifacts, []);
});
test('최종 성공 report가 필수 job과 후보에 결합되면 게시 입력으로 인정한다', /** 실패 집계를 성공으로 재기록하지 못하게 한다. */ () => {
  const jobs = {
    static: { result: 'success' },
    'release-management': { result: 'success' },
    prepare: { result: 'success' },
    macos: { result: 'success' },
    windows: { result: 'success' },
  };
  const report = createReport(binding, candidate, jobs);
  assert.equal(validateReport(report, candidate), report);
});
test('필수 job 실패를 성공 report로 바꾸면 게시 입력으로 거부한다', /** 집계 결과와 원래 job 결과를 대조한다. */ () => {
  const jobs = {
    static: { result: 'success' },
    'release-management': { result: 'success' },
    prepare: { result: 'success' },
    macos: { result: 'success' },
    windows: { result: 'failure' },
  };
  const report = {
    ...createReport(binding, candidate, jobs),
    result: 'success',
  };
  assert.throws(() => validateReport(report, candidate), {
    message: /report result mismatch/u,
  });
});

test('workflow 이름과 실제 job 이름을 고정하면 후속 workflow_run reporter가 동일 집계를 찾는다', /** 두 workflow의 실행 결과 artifact와 job ID를 고정한다. */ () => {
  assert.deepEqual(workflowNames, { ci: 'Tests', publish: 'Release publish' });
  assert.deepEqual(jobNames, {
    static: 'Static checks',
    prepare: 'Freeze release candidate',
    'release-management': 'Release management tests',
    macos: 'Tests (macos-15)',
    windows: 'Tests (windows-2025)',
  });
  assert.equal(reportArtifactName(binding), 'codocs-report-123-2');
  assert.equal(
    publishArtifactName({ runId: '789', runAttempt: '3' }),
    'codocs-publish-789-3',
  );
});

test('필수 job 집합은 단일 관리 검사와 기존 두 OS를 모두 포함한다', /** 새 관리 결과도 게시까지 같은 원본에서 소비한다. */ () => {
  assert.deepEqual(requiredJobs, [
    'static',
    'prepare',
    'release-management',
    'macos',
    'windows',
  ]);
});
