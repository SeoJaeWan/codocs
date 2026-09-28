import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredCheck, workflowNames } from '../build/release-contract.mjs';

/** 실제 version subaction과 fixture가 공유하는 공식 불변 참조다. */
export const actionRevision = 'ae32849d5ba541f9ae29e40e22a623bc13562f51';
/** 공식 Action이 main 대상 입력에서 도출하는 준비 브랜치다. */
export const releaseBranch = 'changeset-release/main';
/** 보호 브랜치에 직접 쓰지 않는 동기화 PR의 단일 브랜치다. */
export const syncBranch = 'codex/release-sync-main-to-develop';

/** 표시 이름과 분리하여 공식 bare·@ref workflow 경로만 canonical 계약 이름으로 변환한다. */
export function workflowIdentity(run) {
  if (typeof run?.path !== 'string') return null;
  const canonical = run.path.replace(/@[^@\s]+$/u, '');
  if (canonical === '.github/workflows/test.yml') return workflowNames.ci;
  if (canonical === '.github/workflows/release-publish.yml')
    return workflowNames.publish;
  return null;
}

/** 인자를 shell에 전달하지 않고 Git의 정확한 결과를 읽는다. */
export function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  }).trim();
}
/** 실제 Git tree의 전체 파일 목록을 후보와 비교할 수 있는 형태로 읽는다. */
export function treeFiles(cwd, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/u, 'invalid source commit');
  const rows = git(cwd, ['ls-tree', '-r', '-z', commit]);
  return rows
    .split('\0')
    .filter(Boolean)
    .map(
      /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
        row,
      ) => {
        const tab = row.indexOf('\t');
        const [mode, type, gitBlob] = row.slice(0, tab).split(' ');
        assert.equal(type, 'blob', 'submodules are not release source');
        return { file: row.slice(tab + 1), mode, gitBlob };
      },
    )
    .sort((a, b) => (a.file < b.file ? -1 : 1));
}
/** GitHub의 인증된 REST 요청만 만들며 오류를 통과 결과로 바꾸지 않는다. */
export function githubApi(token, baseUrl = 'https://api.github.com') {
  assert.ok(token, 'GitHub App token required');
  return /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ async function request(
    method,
    relative,
    body,
  ) {
    assert.ok(
      relative.startsWith('/') && !relative.startsWith('//'),
      'relative API path required',
    );
    const response = await fetch(`${baseUrl}${relative}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
    });
    assert.ok(
      response.ok,
      `GitHub API ${method} ${relative}: ${response.status}`,
    );
    return response.status === 204 ? null : response.json();
  };
}
/** API 목록을 끝까지 읽어 최신 실행·중복 PR 판단에서 페이지 누락을 피한다. */
export async function listAll(api, relative, key = null) {
  const results = [];
  for (let page = 1; ; page++) {
    const value = await api(
      'GET',
      `${relative}${relative.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    const rows = key === null ? value : value[key];
    assert.ok(Array.isArray(rows), 'API list required');
    results.push(...rows);
    if (rows.length < 100) return results;
  }
}
/** 보호와 App 권한이 확인된 후에만 릴리스 쓰기·게시를 활성화한다. */
export async function assertActivation({
  api,
  repository,
  enabled,
  appToken,
  publishing = false,
  credentials = {},
  requiredProducts = ['npm', 'vscode'],
  protection,
}) {
  assert.equal(enabled, 'true', 'manual release activation required');
  assert.ok(appToken, 'GitHub App token required');
  assert.match(
    repository,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    'invalid repository',
  );
  const verify =
    protection ?? (await import('./pr-ci.mjs')).assertReleaseProtection;
  await verify(api, repository);
  const repo = await api('GET', `/repos/${repository}`);
  if (!publishing)
    assert.equal(
      repo.permissions?.push,
      true,
      'App contents write permission required',
    );
  assert.equal(
    repo.permissions?.pull,
    true,
    'App contents read permission required',
  );
  if (publishing) {
    if (requiredProducts.includes('npm'))
      assert.ok(credentials.npm, 'npm publish authentication required');
    if (requiredProducts.includes('vscode'))
      assert.ok(
        credentials.vscode,
        'Marketplace publish authentication required',
      );
  }
}
/** main의 변경을 다시 merge해도 develop tree가 바뀌지 않아야 동기화 완료로 인정한다. */
export function assertSynchronized(cwd, mainSha, developSha) {
  try {
    const mergedTree = git(cwd, [
      '-c',
      'merge.renames=false',
      'merge-tree',
      '--write-tree',
      mainSha,
      developSha,
    ]).split('\n')[0];
    assert.equal(
      mergedTree,
      git(cwd, ['rev-parse', `${developSha}^{tree}`]),
      'main to develop synchronization required before version preparation',
    );
  } catch (error) {
    throw new Error(
      'main to develop synchronization required before version preparation',
      { cause: error },
    );
  }
}
/** 최신 develop만 준비하며 main 반영 전의 소비 기록을 다시 계산하지 않는다. */
export function assertPreparation({
  cwd,
  eventSha,
  developSha,
  mainSha,
  changesetStatus,
}) {
  assert.equal(eventSha, developSha, 'stale develop event');
  assert.equal(
    git(cwd, ['rev-parse', 'HEAD']),
    developSha,
    'checkout/develop mismatch',
  );
  assert.equal(
    git(cwd, ['status', '--porcelain']),
    '',
    'clean preparation checkout required',
  );
  assertSynchronized(cwd, mainSha, developSha);
  assert.ok(
    Array.isArray(changesetStatus.releases),
    'official Changesets status required',
  );
  return changesetStatus.releases.length > 0;
}
/** 최종 릴리스 PR을 정확한 저장소·main·공식 준비 브랜치에 한정한다. */
export function assertMergedRelease(pr, repository, currentMain) {
  assert.equal(pr.merged, true, 'merged release PR required');
  assert.equal(pr.base.ref, 'main', 'main release required');
  assert.equal(pr.head.ref, releaseBranch, 'official release branch required');
  assert.equal(
    pr.head.repo.full_name,
    repository,
    'same repository release required',
  );
  assert.equal(pr.base.repo.full_name, repository, 'base repository mismatch');
  assert.equal(pr.merge_commit_sha, currentMain, 'stale merged release');
}
/** 최신 head 실행이 실패·취소·진행 중이면 이전 성공 실행을 선택하지 않는다. */
export function latestReleaseRun(runs, pr) {
  const relevant = runs.filter(
    /** 이 단계의 입력과 원본 식별자를 확인한 뒤 다음 처리에 전달한다. */ (
      run,
    ) =>
      run.event === 'pull_request' &&
      run.head_sha === pr.head.sha &&
      workflowIdentity(run) === workflowNames.ci &&
      run.pull_requests.some((item) => item.number === pr.number),
  );
  relevant.sort(
    (a, b) =>
      Number(b.id) - Number(a.id) ||
      Number(b.run_attempt) - Number(a.run_attempt),
  );
  const latest = relevant[0];
  assert.ok(latest, 'final release CI run required');
  assert.equal(latest.status, 'completed', 'latest release CI incomplete');
  assert.equal(latest.conclusion, 'success', 'latest release CI unsuccessful');
  return latest;
}
/** required-ci가 실제 최종 head에서 통과했는지 확인한다. */
export function assertRequiredCheck(checks, headSha) {
  const rows = checks.filter(
    (check) => check.name === requiredCheck && check.head_sha === headSha,
  );
  rows.sort((a, b) => Number(b.id) - Number(a.id));
  assert.equal(
    rows[0]?.conclusion,
    'success',
    'latest required-ci success required',
  );
}
/** 현재 원격 branch SHA를 exact API 값으로 읽는다. */
export async function branchSha(api, repository, branch) {
  return (await api('GET', `/repos/${repository}/git/ref/heads/${branch}`))
    .object.sha;
}
/** 워크플로 입력을 정책 검사한 뒤 공식 status 결과만 준비 여부에 사용한다. */
async function prepare() {
  const repository = process.env.GITHUB_REPOSITORY;
  const api = githubApi(process.env.CODOCS_APP_TOKEN);
  await assertActivation({
    api,
    repository,
    enabled: process.env.CODOCS_RELEASE_ENABLED,
    appToken: process.env.CODOCS_APP_TOKEN,
  });
  await mkdir('.workbench', { recursive: true });
  execFileSync(
    process.execPath,
    [
      'node_modules/@changesets/cli/bin.js',
      'status',
      '--output',
      '.workbench/changeset-status.json',
    ],
    { stdio: 'inherit' },
  );
  const status = JSON.parse(
    await readFile('.workbench/changeset-status.json', 'utf8'),
  );
  const identity = {
    developSha: await branchSha(api, repository, 'develop'),
    mainSha: await branchSha(api, repository, 'main'),
  };
  const shouldPrepare = assertPreparation({
    cwd: process.cwd(),
    eventSha: process.env.GITHUB_SHA,
    ...identity,
    changesetStatus: status,
  });
  await writeFile(
    '.workbench/release-preparation.json',
    JSON.stringify(identity),
  );
  const existing = await listAll(
    api,
    `/repos/${repository}/pulls?state=open&base=main&head=${repository.split('/')[0]}:${releaseBranch}`,
  );
  assert.ok(existing.length <= 1, 'duplicate official release PRs');
  await appendFile(process.env.GITHUB_OUTPUT, `prepare=${shouldPrepare}\n`);
}
/** 공식 version 명령 전후와 Action 완료 후 원격 기준의 변경을 거부한다. */
async function auditPreparation() {
  const api = githubApi(process.env.CODOCS_APP_TOKEN);
  const captured = JSON.parse(
    await readFile('.workbench/release-preparation.json', 'utf8'),
  );
  assert.equal(
    await branchSha(api, process.env.GITHUB_REPOSITORY, 'main'),
    captured.mainSha,
    'main changed during preparation',
  );
  assert.equal(
    await branchSha(api, process.env.GITHUB_REPOSITORY, 'develop'),
    captured.developSha,
    'develop changed during preparation',
  );
  return captured;
}
/** Action script 입력에서 공식 CLI만 호출하며 이전 준비 버전을 재계산하지 않는다. */
async function version() {
  await auditPreparation();
  execFileSync(
    process.execPath,
    ['node_modules/@changesets/cli/bin.js', 'version'],
    { stdio: 'inherit' },
  );
  await auditPreparation();
}
/** 최종 PR CI가 오래된 Action의 결과를 승인하지 않도록 현재 기준과 parent를 검사한다. */
export function assertReleasePrSource({ cwd, headSha, developSha, mainSha }) {
  assert.equal(
    git(cwd, ['rev-parse', `${headSha}^`]),
    developSha,
    'release PR no longer uses latest develop',
  );
  assertSynchronized(cwd, mainSha, developSha);
}
/** CI checkout에서 최신 원격 기준과 최종 릴리스 head의 연결만 검사한다. */
async function verifyPr() {
  const api = githubApi(
    process.env.CODOCS_APP_TOKEN ??
      process.env.GH_TOKEN ??
      process.env.GITHUB_TOKEN,
  );
  assertReleasePrSource({
    cwd: process.cwd(),
    headSha: git(process.cwd(), ['rev-parse', 'HEAD']),
    developSha: await branchSha(api, process.env.GITHUB_REPOSITORY, 'develop'),
    mainSha: await branchSha(api, process.env.GITHUB_REPOSITORY, 'main'),
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const commands = {
      prepare,
      version,
      'audit-preparation': auditPreparation,
      'verify-pr': verifyPr,
    };
    assert.ok(
      Object.hasOwn(commands, process.argv[2]),
      'unknown release-flow command',
    );
    await commands[process.argv[2]]();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
