import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  artifactName,
  workflowNames,
  jobNames,
  reportArtifactName,
  publishArtifactName,
  bindUploadedCandidate,
  validateReport,
  candidateArtifactName,
  commentMarker,
  createReport,
  evidenceArtifactName,
  releaseFiles,
  requiredCheck,
  requiredJobs,
  sha256,
  sourceDigest,
  validateCandidate,
  validateEvidence,
  validatePublish,
  verifyCandidate,
} from './release-contract.mjs';

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

test('두 제품의 다른 버전을 전달하면 안전한 파일명과 공유 계약을 고정한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  assert.equal(artifactName('npm', '1.2.3'), 'co-documentation-1.2.3.tgz');
  assert.equal(artifactName('vscode', '2.3.4'), 'codocs-2.3.4.vsix');
  assert.equal(candidateArtifactName(binding), candidate.artifactName);
  assert.equal(
    evidenceArtifactName(binding, 'macos'),
    'codocs-evidence-macos-123-2',
  );
  assert.equal(requiredCheck, 'required-ci');
  assert.equal(commentMarker, '<!-- codocs-required-ci -->');
  assert.deepEqual(requiredJobs, ['static', 'prepare', 'macos', 'windows']);
  assert.deepEqual(releaseFiles, {
    candidate: 'release.json',
    selection: 'selection.json',
    evidence: 'evidence.json',
    report: 'ci-report.json',
    publish: 'publish.json',
  });
  assert.equal(
    validateCandidate(candidate, {
      binding,
      artifactId: '456',
      versions: { npm: '1.2.3', vscode: '2.3.4' },
    }),
    candidate,
  );
});
for (const [title, mutate, message] of [
  [
    'source commit',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.sourceCommit = 'f'.repeat(40);
    },
    'PR head/source mismatch',
  ],
  [
    'dirty source',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.sourceDiff = 'changed';
    },
    'dirty candidate source',
  ],
  [
    'source hash',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.sourceFiles[0].gitBlob = 'f'.repeat(40);
    },
    'source digest mismatch',
  ],
  [
    'source mode',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.sourceFiles[0].mode = '100755';
    },
    'source digest mismatch',
  ],
  [
    'duplicate source',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.sourceFiles.push(value.sourceFiles[0]);
    },
    'source files must be sorted and unique',
  ],
  [
    'source path escape',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.sourceFiles[0].file = '../secret';
    },
    'unsafe source path',
  ],
  [
    'duplicate product',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.artifacts[1] = value.artifacts[0];
    },
    'duplicate product',
  ],
  [
    'unknown product',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.artifacts[0].product = 'other';
    },
    'unknown product',
  ],
  [
    'filename path escape',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.artifacts[0].basename = '../co-documentation-1.2.3.tgz';
    },
    'artifact basename mismatch',
  ],
  [
    'filename product',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.artifacts[0].basename = 'codocs-1.2.3.vsix';
    },
    'artifact basename mismatch',
  ],
  [
    'version filename',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.artifacts[0].version = '1.2.4';
    },
    'artifact basename mismatch',
  ],
  [
    'invalid artifact hash',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.artifacts[0].sha256 = 'bad';
    },
    'invalid artifact hash',
  ],
  [
    'artifact attempt name',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.binding.runAttempt = '3';
    },
    'artifact name mismatch',
  ],
  [
    'Draft',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.binding.draft = true;
    },
    'ready PR evidence required',
  ],
  [
    'manual event',
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (value) => {
      value.binding.eventName = 'workflow_dispatch';
    },
    'PR evidence required',
  ],
])
  test(`${title}이 어긋나면 후보를 정확한 이유로 거부한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    const input = structuredClone(candidate);
    mutate(input);
    assert.throws(
      /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () =>
        validateCandidate(input),
      {
        message: new RegExp(message, 'u'),
      },
    );
  });
for (const [key, value] of [
  ['sourceCommit', 'f'.repeat(40)],
  ['sourceTree', 'f'.repeat(40)],
  ['sourceDigest', 'f'.repeat(64)],
  ['artifactId', '789'],
  ['binding', { ...binding, baseSha: 'f'.repeat(40) }],
  ['binding', { ...binding, headSha: 'f'.repeat(40) }],
  ['binding', { ...binding, runId: '789' }],
  ['binding', { ...binding, runAttempt: '3' }],
  ['binding', { ...binding, workflow: 'Other' }],
])
  test(`기대 ${key} ${JSON.stringify(value)}가 다르면 다른 소스나 실행 후보를 거부한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.throws(
      /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () =>
        validateCandidate(candidate, { [key]: value }),
      {
        message: new RegExp(`${key} mismatch`, 'u'),
      },
    );
  });
test('제품 manifest 버전과 후보 버전이 다르면 제품 버전 불일치를 반환한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  assert.throws(
    /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () =>
      validateCandidate(candidate, {
        versions: { npm: '1.2.4', vscode: '2.3.4' },
      }),
    { message: /product version mismatch/u },
  );
});
test('후보 파일을 전달하면 실제 두 파일의 바이트 해시를 검사한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-contract-'));
  try {
    await writeFile(
      path.join(directory, candidate.artifacts[0].basename),
      'npm bytes',
    );
    await writeFile(
      path.join(directory, candidate.artifacts[1].basename),
      'vscode bytes',
    );
    assert.equal(
      await verifyCandidate(directory, candidate, { artifactId: '456' }),
      candidate,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('전송 뒤 파일이 바뀌면 동일 버전과 실행이어도 바이트 불일치를 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-contract-'));
  try {
    await writeFile(
      path.join(directory, candidate.artifacts[0].basename),
      'modified',
    );
    await assert.rejects(verifyCandidate(directory, candidate), {
      message: /artifact hash mismatch/u,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('후보 파일명에 디렉터리가 있으면 일반 파일이 아니라 거부한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-contract-'));
  try {
    await mkdir(path.join(directory, 'input'));
    await mkdir(path.join(directory, 'input', candidate.artifacts[0].basename));
    await assert.rejects(
      verifyCandidate(path.join(directory, 'input'), candidate),
      { message: /artifact must be a regular file/u },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
const evidence = {
  ...candidate,
  job: 'macos',
  platform: 'darwin',
  stable: '1.139.1',
  result: 'success',
};
test('OS 증거에 후보의 소스·실행·제품·해시가 같으면 같은 후보 검증으로 인정한다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  assert.equal(validateEvidence(evidence, candidate), evidence);
});
for (const [key, value] of [
  ['artifactId', '789'],
  ['sourceTree', 'f'.repeat(40)],
  ['sourceDigest', 'f'.repeat(64)],
  ['binding', { ...binding, runAttempt: '3' }],
  ['artifacts', candidate.artifacts.slice(0, 1)],
])
  test(`OS 증거의 ${key}가 다르면 다른 후보로 거부한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    assert.throws(
      /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () =>
        validateEvidence({ ...evidence, [key]: value }, candidate),
      { message: new RegExp(`evidence ${key} mismatch`, 'u') },
    );
  });
for (const result of ['success', 'failure', 'cancelled', 'skipped'])
  test(`필수 job이 ${result}이면 모든 job 성공 여부를 정확하게 집계한다`, /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
    const jobs = {
      static: { result: 'success' },
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
test('전체 blob 목록에서 파일 mode가 다르면 소스 식별자도 다르다', /** 입력 조건과 관찰 결과를 계약에 대조한다. */ () => {
  assert.notEqual(
    sourceDigest(sourceFiles),
    sourceDigest([{ ...sourceFiles[0], mode: '100755' }]),
  );
});

test('업로드 원본 receipt의 ID가 null이면 확인된 API ID를 결합하고 입력을 보존한다', /** 업로드 뒤 외부 ID를 원본 바이트와 결합한다. */ () => {
  const input = { ...candidate, artifactId: null };
  const result = bindUploadedCandidate(input, binding, '456');
  assert.equal(result.artifactId, '456');
  assert.equal(input.artifactId, null);
});
test('이미 결합된 artifact ID가 다른 경우 업로드 ID를 바꾸지 않는다', /** 다른 업로드 후보로 갈아끼우는 것을 거부한다. */ () => {
  assert.throws(() => bindUploadedCandidate(candidate, binding, '789'), {
    message: /artifactId mismatch/u,
  });
});
test('후보 준비 실패로 receipt가 없으면 게시 가능성이 없는 실패 집계를 만든다', /** 실패 댓글에 후보 없이 job 결과를 남긴다. */ () => {
  const jobs = {
    static: { result: 'success' },
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
    macos: 'Tests (macos-15)',
    windows: 'Tests (windows-2025)',
  });
  assert.equal(reportArtifactName(binding), 'codocs-report-123-2');
  assert.equal(
    publishArtifactName({ runId: '789', runAttempt: '3' }),
    'codocs-publish-789-3',
  );
});
