import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  products,
  sha256,
  sourceDigest,
  validateCandidate,
  bindUploadedCandidate,
  verifyCandidate,
  validateReport,
  validatePublish,
  candidateArtifactName,
  reportArtifactName,
  publishArtifactName,
  releaseFiles,
  workflowNames,
} from '../build/release-contract.mjs';
import {
  git,
  treeFiles,
  githubApi,
  branchSha,
  listAll,
  assertActivation,
  assertMergedRelease,
  latestReleaseRun,
  assertRequiredCheck,
  releaseBranch,
} from './release-flow.mjs';

const require = createRequire(import.meta.url);
const yauzl = require(
  require.resolve('yauzl', {
    paths: [path.dirname(require.resolve('@vscode/vsce/package.json'))],
  }),
);
const semver = require(
  require.resolve('semver', {
    paths: [path.dirname(require.resolve('@changesets/cli/package.json'))],
  }),
);
/** 각 제품의 manifest 버전만 비교하며 계산은 공식 semver에 맡긴다. */
export function changedProducts(before, after) {
  return Object.keys(products).filter(
    /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
      product,
    ) => {
      assert.ok(
        semver.valid(before[product]) && semver.valid(after[product]),
        'valid product versions required',
      );
      assert.ok(
        semver.gte(after[product], before[product]),
        'product version decreased',
      );
      return semver.gt(after[product], before[product]);
    },
  );
}
/** 최종 성공 실행의 단일 미만료 artifact ID를 선택하며 이전 실행으로 되돌리지 않는다. */
export function selectArtifact(artifacts, name, run, now = Date.now()) {
  const rows = artifacts.filter((artifact) => artifact.name === name);
  assert.equal(rows.length, 1, 'one exact artifact required');
  const artifact = rows[0];
  assert.equal(artifact.expired, false, 'expired release artifact');
  assert.ok(Date.parse(artifact.expires_at) > now, 'expired release artifact');
  assert.equal(
    String(artifact.workflow_run.id),
    String(run.id),
    'artifact run mismatch',
  );
  assert.equal(
    artifact.workflow_run.head_sha,
    run.head_sha,
    'artifact source mismatch',
  );
  assert.match(String(artifact.id), /^[1-9]\d*$/u, 'invalid artifact ID');
  assert.match(
    artifact.digest,
    /^sha256:[a-f0-9]{64}$/u,
    'artifact archive digest required',
  );
  return artifact;
}
/** commit 번호가 바뀌어도 전체 tree·blob과 최종 실행·후보·집계가 같을 때만 게시한다. */
export async function validatePublication({
  cwd,
  directory,
  candidate,
  report,
  pr,
  currentMain,
  run,
  artifact,
  checks,
  now,
  expectedBaseSha = pr.base.sha,
}) {
  assertMergedRelease(pr, candidate.binding.repository, currentMain);
  assert.equal(String(run.id), candidate.binding.runId, 'stale candidate run');
  assert.equal(
    String(run.run_attempt),
    candidate.binding.runAttempt,
    'stale candidate attempt',
  );
  assert.equal(run.head_sha, pr.head.sha, 'CI head mismatch');
  assert.equal(run.name, workflowNames.ci, 'CI workflow mismatch');
  assert.equal(run.event, 'pull_request', 'release PR CI required');
  assert.equal(run.status, 'completed', 'release CI incomplete');
  assert.equal(run.conclusion, 'success', 'release CI unsuccessful');
  assert.equal(
    candidate.binding.workflow,
    workflowNames.ci,
    'candidate workflow mismatch',
  );
  assert.equal(candidate.binding.prNumber, pr.number, 'candidate PR mismatch');
  assert.equal(
    candidate.binding.headSha,
    pr.head.sha,
    'candidate final head mismatch',
  );
  assert.equal(
    candidate.binding.baseSha,
    expectedBaseSha,
    'candidate final base mismatch',
  );
  git(cwd, [
    'merge-base',
    '--is-ancestor',
    candidate.binding.baseSha,
    currentMain,
  ]);
  selectArtifact(
    [artifact],
    candidateArtifactName(candidate.binding),
    run,
    now,
  );
  const files = treeFiles(cwd, currentMain);
  validateCandidate(candidate, {
    binding: candidate.binding,
    artifactId: String(artifact.id),
    sourceTree: git(cwd, ['rev-parse', `${currentMain}^{tree}`]),
    sourceFiles: files,
    sourceDigest: sourceDigest(files),
  });
  assertRequiredCheck(checks, pr.head.sha);
  const selection = JSON.parse(
    await readFile(path.join(directory, releaseFiles.selection), 'utf8'),
  );
  assert.deepEqual(
    selection.binding,
    candidate.binding,
    'selection run mismatch',
  );
  assert.equal(
    selection.sourceCommit,
    candidate.sourceCommit,
    'selection source mismatch',
  );
  assert.match(
    selection.stable,
    /^\d+\.\d+\.\d+$/u,
    'exact stable version required',
  );
  validateReport(report, candidate);
  await verifyCandidate(directory, candidate, {
    artifactId: String(artifact.id),
  });
  const versions = {};
  const before = {};
  for (const [product, definition] of Object.entries(products)) {
    versions[product] = JSON.parse(
      git(cwd, ['show', `${currentMain}:${definition.manifest}`]),
    ).version;
    before[product] = JSON.parse(
      git(cwd, ['show', `${candidate.binding.baseSha}:${definition.manifest}`]),
    ).version;
  }
  validateCandidate(candidate, { versions, artifactId: String(artifact.id) });
  return changedProducts(before, versions);
}
/** 같은 후보의 기록을 결합하며 성공 상태를 늦게 온 실패·중단 기록으로 덮어쓰지 않는다. */
export function publicationRecord(
  candidate,
  changed,
  publishRun,
  history = [],
) {
  publishArtifactName(publishRun);
  const record = {
    schemaVersion: 1,
    binding: candidate.binding,
    sourceCommit: candidate.sourceCommit,
    sourceTree: candidate.sourceTree,
    sourceDigest: candidate.sourceDigest,
    artifactId: candidate.artifactId,
    artifacts: candidate.artifacts,
    changedProducts: [...changed],
    publishRun,
    products: Object.fromEntries(
      candidate.artifacts.map(
        /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
          artifact,
        ) => [
          artifact.product,
          {
            version: artifact.version,
            status: changed.includes(artifact.product)
              ? 'pending'
              : 'unchanged',
          },
        ],
      ),
    ),
  };
  for (const previous of history) {
    validatePublish(previous, candidate, changed);
    assert.deepEqual(
      previous.changedProducts,
      changed,
      'previous publish targets mismatch',
    );
    publishArtifactName(previous.publishRun);
    assert.ok(
      BigInt(previous.publishRun.runId) <= BigInt(publishRun.runId),
      'future publish state',
    );
    if (previous.publishRun.runId === publishRun.runId)
      assert.ok(
        BigInt(previous.publishRun.runAttempt) < BigInt(publishRun.runAttempt),
        'duplicate or stale publish attempt',
      );
    for (const product of changed)
      if (previous.products[product].status === 'published')
        record.products[product] = { ...previous.products[product] };
  }
  return validatePublish(record, candidate, changed);
}
/** 검증한 바이트만 전달하며 제품별 기록과 공개 바이트 확인으로 부분 재시도한다. */
export async function publishProducts({
  directory,
  candidate,
  changed,
  publishRun,
  history = [],
  adapters,
  checkpoint,
  assertFresh,
}) {
  await verifyCandidate(directory, candidate, {
    artifactId: candidate.artifactId,
  });
  const record = publicationRecord(candidate, changed, publishRun, history);
  await checkpoint(structuredClone(record));
  for (const product of changed) {
    const state = record.products[product];
    if (state.status === 'published') continue;
    const artifact = candidate.artifacts.find(
      (item) => item.product === product,
    );
    try {
      if (assertFresh) await assertFresh();
      const existing = await adapters[product].inspect(artifact);
      if (existing !== null) {
        assert.equal(
          existing.sha256,
          artifact.sha256,
          'published version conflicts with candidate bytes',
        );
      } else {
        state.status = 'pending';
        delete state.error;
        await checkpoint(structuredClone(record));
        if (assertFresh) await assertFresh();
        await verifyCandidate(directory, candidate, {
          artifactId: candidate.artifactId,
        });
        await adapters[product].publish(
          path.join(directory, artifact.basename),
          artifact,
        );
      }
      state.status = 'published';
      delete state.error;
    } catch (error) {
      state.status = 'failed';
      state.error = error.message;
    }
    await checkpoint(structuredClone(record));
  }
  return validatePublish(record, candidate, changed);
}
/** 외부 zip 경로·중복·비정상 크기를 거부하며 기존 VSCE의 zip reader를 사용한다. */
export async function archiveFiles(bytes) {
  return new Promise(
    /** 모든 entry를 읽은 뒤에만 파일 바이트를 반환한다. */ (
      resolve,
      reject,
    ) => {
      yauzl.fromBuffer(
        bytes,
        { lazyEntries: true, strictFileNames: true },
        /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
          error,
          zip,
        ) => {
          if (error) {
            reject(error);
            return;
          }
          const files = new Map();
          let total = 0;
          zip.on('error', reject);
          zip.on('end', () => resolve(files));
          zip.on(
            'entry',
            /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
              entry,
            ) => {
              try {
                assert.equal(
                  path.basename(entry.fileName),
                  entry.fileName,
                  'unsafe archive path',
                );
                assert.ok(
                  !files.has(entry.fileName),
                  'duplicate archive files',
                );
                assert.ok(
                  entry.uncompressedSize <= 100 * 1024 * 1024,
                  'oversized archive file',
                );
                total += entry.uncompressedSize;
                assert.ok(
                  total <= 200 * 1024 * 1024,
                  'oversized artifact archive',
                );
                assert.ok(
                  ((entry.externalFileAttributes >>> 16) & 0o170000) !==
                    0o120000,
                  'archive symlink rejected',
                );
              } catch (failure) {
                zip.close();
                reject(failure);
                return;
              }
              zip.openReadStream(
                entry,
                /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
                  failure,
                  stream,
                ) => {
                  if (failure) {
                    zip.close();
                    reject(failure);
                    return;
                  }
                  const chunks = [];
                  stream.on('error', reject);
                  stream.on('data', (chunk) => chunks.push(chunk));
                  stream.on('end', () => {
                    files.set(entry.fileName, Buffer.concat(chunks));
                    zip.readEntry();
                  });
                },
              );
            },
          );
          zip.readEntry();
        },
      );
    },
  );
}
/** archive 전체 해시와 명시된 파일 목록을 검사한 뒤 basename만 저장한다. */
export async function unpackArtifact(bytes, artifact, directory, allowedNames) {
  assert.equal(
    sha256(bytes),
    artifact.digest.slice('sha256:'.length),
    'artifact archive hash mismatch',
  );
  const files = await archiveFiles(bytes);
  assert.deepEqual(
    [...files.keys()].sort(),
    [...allowedNames].sort(),
    'unexpected artifact archive files',
  );
  await mkdir(directory, { recursive: true });
  for (const [name, content] of files)
    await writeFile(path.join(directory, name), content);
}
/** 실제 CI 후보의 네 파일 계약을 그대로 내려받고 제품 바이트를 즉시 대조한다. */
export async function unpackCandidateArchive(
  bytes,
  artifact,
  directory,
  candidate,
) {
  validateCandidate(candidate, { artifactId: String(artifact.id) });
  await unpackArtifact(bytes, artifact, directory, [
    releaseFiles.candidate,
    releaseFiles.selection,
    ...candidate.artifacts.map((item) => item.basename),
  ]);
  await verifyCandidate(directory, candidate, {
    artifactId: String(artifact.id),
  });
  return candidate;
}
/** 인증된 API 이후 배포 저장소에는 GitHub credential을 전달하지 않는다. */
async function downloadArtifact(repository, artifact, token) {
  const first = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
      },
      redirect: 'manual',
    },
  );
  assert.ok(
    [200, 302].includes(first.status),
    `artifact download failed: ${first.status}`,
  );
  if (first.status === 200) return Buffer.from(await first.arrayBuffer());
  const target = new URL(first.headers.get('location'));
  assert.equal(target.protocol, 'https:', 'secure artifact download required');
  const response = await fetch(target, { redirect: 'error' });
  assert.ok(
    response.ok,
    `artifact storage download failed: ${response.status}`,
  );
  return Buffer.from(await response.arrayBuffer());
}
/** 공개 바이트를 대조하여 중단 후 중복 게시를 막으며 404 이외의 오류를 미게시로 취급하지 않는다. */
async function inspectUrl(url) {
  const response = await fetch(url);
  if (response.status === 404) return null;
  assert.ok(
    response.ok,
    `published artifact inspection failed: ${response.status}`,
  );
  return { sha256: sha256(Buffer.from(await response.arrayBuffer())) };
}
/** 공개 대상 확인과 기존 CLI 게시만 담당하는 게시 어댑터를 만든다. */
function publisherAdapters() {
  return {
    npm: {
      /** registry의 정확한 버전이 가리키는 tarball을 확인한다. */
      async inspect(artifact) {
        const response = await fetch(
          `https://registry.npmjs.org/${products.npm.name}/${artifact.version}`,
        );
        if (response.status === 404) return null;
        assert.ok(response.ok, `npm inspection failed: ${response.status}`);
        const manifest = await response.json();
        const tarball = new URL(manifest.dist.tarball);
        assert.equal(tarball.protocol, 'https:', 'secure npm tarball required');
        assert.ok(
          tarball.hostname === 'registry.npmjs.org',
          'unexpected npm tarball host',
        );
        const published = await inspectUrl(tarball);
        assert.ok(published, 'published npm tarball missing');
        return published;
      },
      /** 재빌드하지 않은 정확한 tarball을 npm CLI에 전달한다. */
      async publish(filename) {
        execFileSync(
          'npm',
          ['publish', filename, '--access', 'public', '--ignore-scripts'],
          { stdio: 'pipe' },
        );
      },
    },
    vscode: {
      /** 정확한 Marketplace 버전의 공개 VSIX를 확인한다. */
      async inspect(artifact) {
        return inspectUrl(
          `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/seojaewan/vsextensions/${products.vscode.name}/${artifact.version}/vspackage`,
        );
      },
      /** 재패키징 없이 VSCE에 검증한 packagePath를 전달한다. */
      async publish(filename) {
        execFileSync(
          'pnpm',
          ['exec', 'vsce', 'publish', '--packagePath', filename],
          { stdio: 'pipe' },
        );
      },
    },
  };
}
/** 보호·최종 CI·tree·archive ID를 검사하고 결과 artifact를 reporter에 전달한다. */
async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.CODOCS_APP_TOKEN;
  const api = githubApi(token);
  await assertActivation({
    api,
    repository,
    enabled: process.env.CODOCS_RELEASE_ENABLED,
    appToken: token,
    publishing: true,
    requiredProducts: [],
    credentials: {
      npm: process.env.NODE_AUTH_TOKEN,
      vscode: process.env.VSCE_PAT,
    },
  });
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const currentMain = await branchSha(api, repository, 'main');
  assert.equal(
    process.env.GITHUB_REF,
    'refs/heads/main',
    'trusted main publication required',
  );
  assert.equal(process.env.GITHUB_SHA, currentMain, 'stale publish event');
  let number = Number(process.env.CODOCS_RELEASE_PR);
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    assert.equal(event.after, currentMain, 'push/main identity mismatch');
    const associated = await listAll(
      api,
      `/repos/${repository}/commits/${currentMain}/pulls`,
    );
    const releases = associated.filter(
      /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
        item,
      ) =>
        item.merged_at &&
        item.merge_commit_sha === currentMain &&
        item.base.ref === 'main' &&
        item.head.ref === releaseBranch,
    );
    if (releases.length === 0) return;
    assert.equal(releases.length, 1, 'one merged release PR required');
    number = releases[0].number;
  } else
    assert.equal(
      process.env.GITHUB_EVENT_NAME,
      'workflow_dispatch',
      'trusted publication event required',
    );
  assert.ok(
    Number.isSafeInteger(number) && number > 0,
    'release PR number required',
  );
  const pr = await api('GET', `/repos/${repository}/pulls/${number}`);
  assertMergedRelease(pr, repository, currentMain);
  const runs = await listAll(
    api,
    `/repos/${repository}/actions/workflows/test.yml/runs?event=pull_request&head_sha=${pr.head.sha}`,
    'workflow_runs',
  );
  const run = latestReleaseRun(runs, pr);
  const artifacts = await listAll(
    api,
    `/repos/${repository}/actions/runs/${run.id}/artifacts`,
    'artifacts',
  );
  let binding = {
    repository,
    prNumber: pr.number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    workflow: workflowNames.ci,
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
    eventName: 'pull_request',
    draft: false,
  };
  const metadata = selectArtifact(
    artifacts,
    candidateArtifactName(binding),
    run,
  );
  const directory = path.resolve('.workbench/publish/candidate');
  // 메타데이터가 가리키는 정확한 archive에서 후보 JSON과 전체 파일명을 연결한다.
  const archive = await downloadArtifact(repository, metadata, token);
  assert.equal(
    sha256(archive),
    metadata.digest.slice(7),
    'artifact archive hash mismatch',
  );
  const rawFiles = await archiveFiles(archive);
  assert.ok(rawFiles.has(releaseFiles.candidate), 'candidate JSON missing');
  const rawCandidate = JSON.parse(
    rawFiles.get(releaseFiles.candidate).toString('utf8'),
  );
  validateCandidate(rawCandidate);
  const expectedBaseSha =
    process.env.GITHUB_EVENT_NAME === 'push'
      ? event.before
      : rawCandidate.binding.baseSha;
  assert.match(expectedBaseSha, /^[a-f0-9]{40}$/u, 'original CI base required');
  binding = { ...binding, baseSha: expectedBaseSha };
  const candidate = bindUploadedCandidate(
    rawCandidate,
    binding,
    String(metadata.id),
  );
  await unpackCandidateArchive(archive, metadata, directory, candidate);
  const reportMetadata = selectArtifact(
    artifacts,
    reportArtifactName(binding),
    run,
  );
  const reportDirectory = path.resolve('.workbench/publish/report');
  await unpackArtifact(
    await downloadArtifact(repository, reportMetadata, token),
    reportMetadata,
    reportDirectory,
    [releaseFiles.report],
  );
  const report = JSON.parse(
    await readFile(path.join(reportDirectory, releaseFiles.report), 'utf8'),
  );
  const checks = await listAll(
    api,
    `/repos/${repository}/commits/${pr.head.sha}/check-runs`,
    'check_runs',
  );
  const changed = await validatePublication({
    cwd: process.cwd(),
    directory,
    candidate,
    report,
    pr,
    currentMain,
    run,
    artifact: metadata,
    checks,
    expectedBaseSha,
  });
  for (const product of changed)
    assert.ok(
      product === 'npm' ? process.env.NODE_AUTH_TOKEN : process.env.VSCE_PAT,
      `${product} publish authentication required`,
    );
  const history = [];
  const previousArtifacts = await listAll(
    api,
    `/repos/${repository}/actions/artifacts`,
    'artifacts',
  );
  for (const artifact of previousArtifacts.filter(
    (item) =>
      item.name.startsWith('codocs-publish-') &&
      item.workflow_run.head_sha === currentMain &&
      !item.expired,
  )) {
    const previousRun = await api(
      'GET',
      `/repos/${repository}/actions/runs/${artifact.workflow_run.id}`,
    );
    assert.equal(
      previousRun.name,
      workflowNames.publish,
      'publish state workflow mismatch',
    );
    assert.equal(
      previousRun.path,
      '.github/workflows/release-publish.yml',
      'publish state workflow path mismatch',
    );
    const publishRun = {
      runId: String(previousRun.id),
      runAttempt: String(previousRun.run_attempt),
    };
    // 같은 run의 이전 attempt는 artifact 이름으로 구별하며 현재 실행은 읽지 않는다.
    const match = /^codocs-publish-([1-9]\d*)-([1-9]\d*)$/u.exec(artifact.name);
    assert.ok(
      match && match[1] === publishRun.runId,
      'publish artifact name mismatch',
    );
    publishRun.runAttempt = match[2];
    if (
      publishRun.runId === process.env.GITHUB_RUN_ID &&
      publishRun.runAttempt === process.env.GITHUB_RUN_ATTEMPT
    )
      continue;
    const selected = selectArtifact(
      [artifact],
      publishArtifactName(publishRun),
      previousRun,
    );
    const previousDirectory = path.resolve(
      `.workbench/publish/history-${selected.id}`,
    );
    await unpackArtifact(
      await downloadArtifact(repository, selected, token),
      selected,
      previousDirectory,
      [releaseFiles.publish],
    );
    const previous = JSON.parse(
      await readFile(
        path.join(previousDirectory, releaseFiles.publish),
        'utf8',
      ),
    );
    assert.deepEqual(
      previous.publishRun,
      publishRun,
      'publish state run mismatch',
    );
    if (previous.artifactId === candidate.artifactId) history.push(previous);
  }
  /** 각 외부 게시 직전에도 소스와 최신 검증 실행을 다시 확인한다. */
  async function assertFresh() {
    assert.equal(
      await branchSha(api, repository, 'main'),
      currentMain,
      'main moved before publication',
    );
    const latest = latestReleaseRun(
      await listAll(
        api,
        `/repos/${repository}/actions/workflows/test.yml/runs?event=pull_request&head_sha=${pr.head.sha}`,
        'workflow_runs',
      ),
      pr,
    );
    assert.equal(
      String(latest.id),
      String(run.id),
      'CI changed before publication',
    );
    assert.equal(
      String(latest.run_attempt),
      String(run.run_attempt),
      'CI attempt changed before publication',
    );
  }
  await assertFresh();
  const record = await publishProducts({
    directory,
    candidate,
    changed,
    publishRun: {
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    },
    history,
    adapters: publisherAdapters(),
    assertFresh,
    /** 파일 교체로 제품별 완전한 JSON만 기록한다. */ checkpoint: async (
      state,
    ) => {
      const destination = path.resolve(
        '.workbench/publish',
        releaseFiles.publish,
      );
      await writeFile(
        `${destination}.tmp`,
        JSON.stringify(state, null, 2) + '\n',
      );
      await rename(`${destination}.tmp`, destination);
    },
  });
  if (Object.values(record.products).some((item) => item.status === 'failed'))
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
