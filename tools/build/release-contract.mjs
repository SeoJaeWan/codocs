import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

/** 제품 식별과 manifest 및 공개 파일명의 단일 원본이다. */
export const products = Object.freeze({
  npm: Object.freeze({
    name: 'co-documentation',
    changeset: '@codocs/mcp',
    manifest: 'packages/mcp/package.json',
    suffix: 'tgz',
  }),
  vscode: Object.freeze({
    name: 'codocs',
    changeset: 'codocs',
    manifest: 'packages/vscode/package.json',
    suffix: 'vsix',
  }),
});
/** 준비·정적 검사와 양 OS 검사를 모두 통과해야 하는 필수 job ID다. */
export const requiredJobs = Object.freeze([
  'static',
  'prepare',
  'macos',
  'windows',
]);
/** workflow_run 댓글 작성자가 감시할 정확한 workflow 표시 이름이다. */
export const workflowNames = Object.freeze({
  ci: 'Tests',
  publish: 'Release publish',
});
/** GitHub jobs API의 name을 계약 job ID로 변환하기 위한 원본이다. */
export const jobNames = Object.freeze({
  static: 'Static checks',
  prepare: 'Freeze release candidate',
  macos: 'Tests (macos-15)',
  windows: 'Tests (windows-2025)',
});

/** 보호 규칙과 결과 댓글에서 사용할 계약 식별자다. */
export const requiredCheck = 'required-ci';
/** 결과 댓글을 같은 PR에서 갱신하기 위한 고정 표식이다. */
export const commentMarker = '<!-- codocs-required-ci -->';
/** 후보·환경 선택·검증·집계·게시 파일명이다. */
export const releaseFiles = Object.freeze({
  candidate: 'release.json',
  selection: 'selection.json',
  evidence: 'evidence.json',
  report: 'ci-report.json',
  publish: 'publish.json',
});
/** 정확한 버전과 안전한 파일명에 쓰는 semver 문자열을 검사한다. */
export function assertVersion(version) {
  assert.equal(typeof version, 'string', 'version must be a string');
  assert.match(
    version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u,
    'invalid product version',
  );
  return version;
}
/** 제품과 버전으로 경로가 없는 공개 산출물 이름을 만든다. */
export function artifactName(product, version) {
  assert.ok(Object.hasOwn(products, product), 'unknown product');
  assertVersion(version);
  return `${products[product].name}-${version}.${products[product].suffix}`;
}
/** 제품 manifest를 읽으며 제품 간 버전 일치를 요구하지 않는다. */
export async function readProductVersions(root) {
  const result = {};
  for (const [product, definition] of Object.entries(products)) {
    const manifest = JSON.parse(
      await readFile(path.join(root, definition.manifest), 'utf8'),
    );
    assert.equal(
      manifest.name,
      definition.changeset,
      'manifest product mismatch',
    );
    result[product] = assertVersion(manifest.version);
  }
  return result;
}
/** 바이트를 SHA-256으로 식별한다. */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
/** 전체 Git blob 목록의 순서·중복·상대 경로를 검사하고 식별자를 만든다. */
export function sourceDigest(sourceFiles) {
  assert.ok(
    Array.isArray(sourceFiles) && sourceFiles.length > 0,
    'sourceFiles required',
  );
  let previous = '';
  for (const entry of sourceFiles) {
    assert.equal(typeof entry.file, 'string', 'source path required');
    assert.ok(
      entry.file.length > 0 &&
        !entry.file.includes('\\') &&
        !/[\0\r\n\t]/u.test(entry.file) &&
        !/^[A-Za-z]:/u.test(entry.file) &&
        !entry.file.split('/').some((part) => ['', '.', '..'].includes(part)),
      'unsafe source path',
    );
    assert.ok(entry.file > previous, 'source files must be sorted and unique');
    assert.ok(
      ['100644', '100755', '120000'].includes(entry.mode),
      'invalid source mode',
    );
    assert.match(entry.gitBlob, /^[a-f0-9]{40}$/u, 'invalid Git blob');
    previous = entry.file;
  }
  return sha256(JSON.stringify(sourceFiles));
}
/** 실행 식별자의 숫자 문자열을 검사한다. */
function assertId(value, name) {
  assert.equal(typeof value, 'string', `${name} must be a string`);
  assert.match(value, /^[1-9]\d*$/u, `invalid ${name}`);
}
/** 최종 PR head/base와 workflow 실행·시도를 분리하여 결합한다. */
export function validateBinding(binding) {
  assert.ok(binding && typeof binding === 'object', 'run binding required');
  assert.match(
    binding.repository,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    'invalid repository',
  );
  assert.ok(
    Number.isSafeInteger(binding.prNumber) && binding.prNumber > 0,
    'invalid PR number',
  );
  for (const key of ['headSha', 'baseSha'])
    assert.match(binding[key], /^[a-f0-9]{40}$/u, `invalid ${key}`);
  assert.equal(typeof binding.workflow, 'string', 'workflow required');
  assert.ok(
    binding.workflow.length > 0 && !/[\r\n]/u.test(binding.workflow),
    'invalid workflow',
  );
  assertId(binding.runId, 'runId');
  assertId(binding.runAttempt, 'runAttempt');
  assert.equal(binding.eventName, 'pull_request', 'PR evidence required');
  assert.equal(binding.draft, false, 'ready PR evidence required');
  return binding;
}
/** 실행마다 후보 artifact 이름을 구분한다. */
export function candidateArtifactName(binding) {
  validateBinding(binding);
  return `codocs-candidate-${binding.runId}-${binding.runAttempt}`;
}
/** OS별 실행 증거의 artifact 이름을 고정한다. */
export function evidenceArtifactName(binding, job) {
  validateBinding(binding);
  assert.ok(['macos', 'windows'].includes(job), 'invalid evidence job');
  return `codocs-evidence-${job}-${binding.runId}-${binding.runAttempt}`;
}
/** CI 집계 JSON을 workflow_run 작성자에게 전달할 artifact 이름이다. */
export function reportArtifactName(binding) {
  validateBinding(binding);
  return `codocs-report-${binding.runId}-${binding.runAttempt}`;
}
/** 게시 실행 자체의 run ID와 attempt로 게시 결과 artifact를 구분한다. */
export function publishArtifactName(run) {
  assertId(run.runId, 'runId');
  assertId(run.runAttempt, 'runAttempt');
  return `codocs-publish-${run.runId}-${run.runAttempt}`;
}

/** 업로드 ID는 양의 숫자 문자열이며 업로드 전 후보에는 null만 허용한다. */
function validateArtifactId(id, allowPending) {
  if (id === null && allowPending) return;
  assertId(id, 'artifactId');
}
/** 후보의 제품·버전·basename·해시와 소스·실행 바인딩을 검사한다.
 * expected에는 필요한 sourceCommit/sourceTree/sourceDigest/sourceFiles/binding/versions/artifactId를 전달한다.
 * 업로드 전에는 binding=null, artifactId=null을 허용하며 CI·게시 소비자는 기대 binding과 artifactId를 반드시 전달한다.
 */
export function validateCandidate(candidate, expected = {}) {
  assert.equal(candidate.schemaVersion, 1, 'unsupported candidate schema');
  assert.match(
    candidate.sourceCommit,
    /^[a-f0-9]{40}$/u,
    'invalid source commit',
  );
  assert.match(candidate.sourceTree, /^[a-f0-9]{40}$/u, 'invalid source tree');
  assert.equal(candidate.sourceDiff, '', 'dirty candidate source');
  assert.equal(
    sourceDigest(candidate.sourceFiles),
    candidate.sourceDigest,
    'source digest mismatch',
  );
  if (candidate.binding !== null) {
    validateBinding(candidate.binding);
    assert.equal(
      candidate.sourceCommit,
      candidate.binding.headSha,
      'PR head/source mismatch',
    );
    assert.equal(
      candidate.artifactName,
      candidateArtifactName(candidate.binding),
      'artifact name mismatch',
    );
  } else assert.equal(candidate.artifactName, null, 'unbound artifact name');
  validateArtifactId(
    candidate.artifactId,
    !Object.hasOwn(expected, 'artifactId'),
  );
  assert.ok(
    Array.isArray(candidate.artifacts) &&
      candidate.artifacts.length === Object.keys(products).length,
    'two products required',
  );
  const seen = new Set();
  for (const artifact of candidate.artifacts) {
    assert.ok(Object.hasOwn(products, artifact.product), 'unknown product');
    assert.ok(!seen.has(artifact.product), 'duplicate product');
    seen.add(artifact.product);
    assert.equal(
      artifact.basename,
      artifactName(artifact.product, artifact.version),
      'artifact basename mismatch',
    );
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/u, 'invalid artifact hash');
    if (expected.versions)
      assert.equal(
        artifact.version,
        expected.versions[artifact.product],
        'product version mismatch',
      );
  }
  for (const key of [
    'sourceCommit',
    'sourceTree',
    'sourceDigest',
    'sourceFiles',
    'binding',
    'artifactId',
  ])
    if (Object.hasOwn(expected, key))
      assert.deepEqual(candidate[key], expected[key], `${key} mismatch`);
  return candidate;
}
/** 업로드 API에서 확인한 artifact ID를 다운로드한 원본 후보에 결합한다. 원본 JSON에 자기 업로드 ID를 재작성할 필요가 없다. */
export function bindUploadedCandidate(candidate, binding, artifactId) {
  validateBinding(binding);
  validateArtifactId(artifactId, false);
  validateCandidate(candidate, { binding });
  assert.ok(
    candidate.artifactId === null || candidate.artifactId === artifactId,
    'artifactId mismatch',
  );
  return validateCandidate(
    { ...candidate, artifactId },
    { binding, artifactId },
  );
}

/** 지정한 디렉터리 안의 일반 파일만 읽어 후보 해시와 비교한다. */
export async function verifyCandidate(directory, candidate, expected = {}) {
  validateCandidate(candidate, expected);
  const resolved = await realpath(directory);
  for (const artifact of candidate.artifacts) {
    const filename = path.join(directory, artifact.basename);
    assert.ok(
      (await lstat(filename)).isFile(),
      'artifact must be a regular file',
    );
    assert.equal(
      path.dirname(await realpath(filename)),
      resolved,
      'artifact escapes directory',
    );
    assert.equal(
      sha256(await readFile(filename)),
      artifact.sha256,
      'artifact hash mismatch',
    );
  }
  return candidate;
}
/** OS별 증거는 후보의 전체 제품 해시와 소스·실행·업로드 ID를 그대로 결합한다. */
export function validateEvidence(evidence, candidate) {
  validateCandidate(candidate, { artifactId: candidate.artifactId });
  assert.equal(evidence.schemaVersion, 1, 'unsupported evidence schema');
  assert.ok(
    ['macos', 'windows'].includes(evidence.job),
    'invalid evidence job',
  );
  for (const key of [
    'binding',
    'sourceCommit',
    'sourceTree',
    'sourceDigest',
    'artifactId',
    'artifacts',
  ])
    assert.deepEqual(evidence[key], candidate[key], `evidence ${key} mismatch`);
  assert.equal(
    evidence.platform,
    evidence.job === 'macos' ? 'darwin' : 'win32',
    'evidence platform mismatch',
  );
  assert.equal(typeof evidence.stable, 'string');
  assert.match(
    evidence.stable,
    /^\d+\.\d+\.\d+$/u,
    'exact stable version required',
  );
  assert.ok(
    ['success', 'failure', 'cancelled'].includes(evidence.result),
    'invalid evidence result',
  );
  return evidence;
}
/** 필수 job의 누락·실패·취소·예상 밖 생략을 통과로 집계하지 않는다. */
export function createReport(binding, candidate, jobs) {
  validateBinding(binding);
  if (candidate !== null)
    validateCandidate(candidate, { binding, artifactId: candidate.artifactId });
  assert.deepEqual(
    Object.keys(jobs).sort(),
    [...requiredJobs].sort(),
    'required job set mismatch',
  );
  for (const job of requiredJobs)
    assert.ok(
      ['success', 'failure', 'cancelled', 'skipped'].includes(jobs[job].result),
      'invalid job result',
    );
  return {
    schemaVersion: 1,
    binding,
    sourceCommit: candidate?.sourceCommit ?? binding.headSha,
    sourceTree: candidate?.sourceTree ?? null,
    sourceDigest: candidate?.sourceDigest ?? null,
    artifactId: candidate?.artifactId ?? null,
    artifacts: candidate?.artifacts ?? [],
    requiredJobs: [...requiredJobs],
    jobs,
    result:
      candidate !== null &&
      requiredJobs.every((job) => jobs[job].result === 'success')
        ? 'success'
        : 'failure',
    publish: Object.fromEntries(
      (candidate?.artifacts ?? []).map((artifact) => [
        artifact.product,
        { version: artifact.version, status: 'pending' },
      ]),
    ),
  };
}
/** 최종 성공 집계가 검증 후보·실행·필수 job 전체와 일치하는지 게시 전에 검사한다. */
export function validateReport(report, candidate) {
  const expected = createReport(candidate.binding, candidate, report.jobs);
  for (const key of [
    'schemaVersion',
    'binding',
    'sourceCommit',
    'sourceTree',
    'sourceDigest',
    'artifactId',
    'artifacts',
    'requiredJobs',
    'result',
  ])
    assert.deepEqual(report[key], expected[key], `report ${key} mismatch`);
  assert.equal(
    report.result,
    'success',
    'successful required CI report required',
  );
  return report;
}

/** 게시 상태를 제품별로 검사하며 변경 없는 제품을 성공 게시로 기록하지 않는다. */
export function validatePublish(record, candidate, changedProducts) {
  validateCandidate(candidate, { artifactId: candidate.artifactId });
  assert.equal(record.schemaVersion, 1, 'unsupported publish schema');
  for (const key of [
    'binding',
    'sourceCommit',
    'sourceTree',
    'sourceDigest',
    'artifactId',
    'artifacts',
  ])
    assert.deepEqual(record[key], candidate[key], `publish ${key} mismatch`);
  assert.deepEqual(
    Object.keys(record.products).sort(),
    Object.keys(products).sort(),
    'publish product set mismatch',
  );
  assert.ok(
    Array.isArray(changedProducts) &&
      new Set(changedProducts).size === changedProducts.length &&
      changedProducts.every((product) => Object.hasOwn(products, product)),
    'invalid changed products',
  );
  for (const artifact of candidate.artifacts) {
    const state = record.products[artifact.product];
    assert.equal(state.version, artifact.version, 'publish version mismatch');
    assert.ok(
      (changedProducts.includes(artifact.product)
        ? ['pending', 'published', 'failed']
        : ['unchanged']
      ).includes(state.status),
      'invalid publish status',
    );
  }
  return record;
}
