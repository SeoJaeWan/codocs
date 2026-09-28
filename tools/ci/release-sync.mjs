import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { devNull } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  git,
  treeFiles,
  syncBranch,
  githubApi,
  branchSha,
  listAll,
  assertActivation,
  assertMergedRelease,
  assertSynchronized,
} from './release-flow.mjs';

/** main에서 삭제된 기록의 원래 blob을 추적해 수정된 기록을 충돌로 처리한다. */
export function consumedChangesets(cwd, releaseSha, developSha) {
  const source = git(cwd, ['rev-parse', `${releaseSha}^`]);
  const before = treeFiles(cwd, source);
  const main = new Map(
    treeFiles(cwd, releaseSha).map((entry) => [entry.file, entry]),
  );
  const develop = new Map(
    treeFiles(cwd, developSha).map((entry) => [entry.file, entry]),
  );
  const consumed = before.filter(
    (entry) =>
      /^\.changeset\/(?!README\.md$)[^/]+\.md$/u.test(entry.file) &&
      !main.has(entry.file),
  );
  for (const entry of consumed) {
    const current = develop.get(entry.file);
    assert.ok(
      !current ||
        (current.gitBlob === entry.gitBlob && current.mode === entry.mode),
      `modified consumed Changeset: ${entry.file}`,
    );
  }
  return consumed;
}
/** 최신 develop와 main을 merge하여 신규 코드·기록을 보존한 동기화 후보만 만든다. */
export function buildSync({
  cwd,
  mainSha,
  developSha,
  releaseSha,
  previousSyncSha = null,
}) {
  assert.equal(
    git(cwd, ['status', '--porcelain']),
    '',
    'clean sync checkout required',
  );
  assert.equal(
    git(cwd, ['rev-parse', `${mainSha}^{tree}`]),
    git(cwd, ['rev-parse', `${releaseSha}^{tree}`]),
    'release/main source mismatch',
  );
  const consumed = consumedChangesets(cwd, releaseSha, developSha);
  git(cwd, ['checkout', '-B', syncBranch, previousSyncSha ?? developSha]);
  try {
    git(cwd, [
      '-c',
      'merge.renames=false',
      '-c',
      `core.hooksPath=${devNull}`,
      'merge',
      '--no-edit',
      '--no-ff',
      developSha,
    ]);
    // squash/rebase가 원래 추가 기록의 조상을 잃어도 정확한 소비 목록만 지운다.
    const current = new Map(
      treeFiles(cwd, git(cwd, ['rev-parse', 'HEAD'])).map((entry) => [
        entry.file,
        entry,
      ]),
    );
    const remaining = consumed.filter((entry) => current.has(entry.file));
    for (const entry of remaining)
      assert.deepEqual(
        current.get(entry.file),
        entry,
        `modified consumed Changeset: ${entry.file}`,
      );
    if (remaining.length) {
      git(cwd, ['rm', '--', ...remaining.map((entry) => entry.file)]);
      git(cwd, [
        '-c',
        `core.hooksPath=${devNull}`,
        'commit',
        '-m',
        'Remove released Changesets',
      ]);
    }
    git(cwd, [
      '-c',
      'merge.renames=false',
      '-c',
      `core.hooksPath=${devNull}`,
      'merge',
      '--no-edit',
      '--no-ff',
      mainSha,
    ]);
  } catch (error) {
    throw new Error(
      'release synchronization conflict; preserve and resolve in the sync PR',
      { cause: error },
    );
  }
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const files = new Set(treeFiles(cwd, head).map((entry) => entry.file));
  for (const entry of consumed)
    assert.ok(!files.has(entry.file), 'consumed Changeset reappeared');
  git(cwd, ['merge-base', '--is-ancestor', developSha, head]);
  assertSynchronized(cwd, mainSha, head);
  return {
    head,
    mainSha,
    developSha,
    consumed,
    changed:
      git(cwd, ['rev-parse', `${head}^{tree}`]) !==
      git(cwd, ['rev-parse', `${developSha}^{tree}`]),
  };
}
/** 단일 unprotected branch를 fast-forward로만 갱신하고 단일 sync PR을 재사용한다. */
export async function publishSync({
  cwd,
  api,
  repository,
  candidate,
  expectedSyncSha,
  push,
}) {
  assert.equal(
    await branchSha(api, repository, 'main'),
    candidate.mainSha,
    'stale sync main',
  );
  assert.equal(
    await branchSha(api, repository, 'develop'),
    candidate.developSha,
    'stale sync develop',
  );
  const refs = await listAll(
    api,
    `/repos/${repository}/git/matching-refs/heads/${syncBranch}`,
  );
  assert.ok(refs.length <= 1, 'ambiguous sync ref');
  assert.equal(
    refs[0]?.object.sha ?? null,
    expectedSyncSha,
    'concurrent sync update',
  );
  if (!candidate.changed) return null;
  const pulls = await listAll(
    api,
    `/repos/${repository}/pulls?state=open&base=develop&head=${repository.split('/')[0]}:${syncBranch}`,
  );
  assert.ok(pulls.length <= 1, 'duplicate sync PRs');
  await push(cwd, candidate.head, syncBranch);
  const body = `main ${candidate.mainSha} → develop ${candidate.developSha}\n\n소비한 Changesets만 제거하고 다음 출시의 코드와 기록을 보존합니다.`;
  if (pulls.length)
    return api('PATCH', `/repos/${repository}/pulls/${pulls[0].number}`, {
      title: 'Synchronize main release into develop',
      body,
    });
  return api('POST', `/repos/${repository}/pulls`, {
    title: 'Synchronize main release into develop',
    body,
    head: syncBranch,
    base: 'develop',
  });
}
/** 보호 확인과 최신 PR 확인 후 sync PR만 쓰며 보호 브랜치에 직접 push하지 않는다. */
async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const api = githubApi(process.env.CODOCS_APP_TOKEN);
  await assertActivation({
    api,
    repository,
    enabled: process.env.CODOCS_RELEASE_ENABLED,
    appToken: process.env.CODOCS_APP_TOKEN,
  });
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const pr = await api(
    'GET',
    `/repos/${repository}/pulls/${event.pull_request.number}`,
  );
  const mainSha = await branchSha(api, repository, 'main');
  assertMergedRelease(pr, repository, mainSha);
  const developSha = await branchSha(api, repository, 'develop');
  const refs = await listAll(
    api,
    `/repos/${repository}/git/matching-refs/heads/${syncBranch}`,
  );
  assert.ok(refs.length <= 1, 'ambiguous sync ref');
  const previousSyncSha = refs[0]?.object.sha ?? null;
  git(process.cwd(), ['fetch', 'origin', pr.head.sha]);
  const candidate = buildSync({
    cwd: process.cwd(),
    mainSha,
    developSha,
    releaseSha: pr.head.sha,
    previousSyncSha,
  });
  await publishSync({
    cwd: process.cwd(),
    api,
    repository,
    candidate,
    expectedSyncSha: previousSyncSha,
    /** API 상태를 확인한 후보만 강제 갱신 없이 push한다. */ push: async (
      cwd,
      head,
      branch,
    ) => {
      git(cwd, ['push', 'origin', `${head}:refs/heads/${branch}`]);
    },
  });
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
