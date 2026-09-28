import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bindUploadedCandidate,
  candidateArtifactName,
  commentMarker,
  createReport,
  jobNames,
  products,
  publishArtifactName,
  releaseFiles,
  reportArtifactName,
  requiredCheck,
  requiredJobs,
  validateBinding,
  validatePublish,
  validateReport,
  workflowNames,
} from '../build/release-contract.mjs';
import { releaseBranch, workflowIdentity } from './release-flow.mjs';

/** API run ID와 재실행 attempt를 함께 비교한다. */
export function sameRun(a, b) {
  return (
    String(a.id) === String(b.id) &&
    Number(a.run_attempt) === Number(b.run_attempt)
  );
}

/** 신뢰한 jobs API의 필수 job 이름·결과·시간·실패 단계를 집계한다. */
export function summarizeJobs(jobs) {
  const result = {};
  for (const id of requiredJobs) {
    const matches = jobs.filter((job) => job.name === jobNames[id]);
    assert.ok(matches.length <= 1, 'duplicate required job');
    const job = matches[0];
    const duration =
      job?.started_at && job?.completed_at
        ? Math.max(
            0,
            Math.round(
              (Date.parse(job.completed_at) - Date.parse(job.started_at)) /
                1000,
            ),
          )
        : null;
    result[id] = {
      result: ['success', 'failure', 'cancelled', 'skipped'].includes(
        job?.conclusion,
      )
        ? job.conclusion
        : job?.conclusion
          ? 'failure'
          : 'skipped',
      seconds: duration,
      failedSteps: (job?.steps ?? [])
        .filter((step) => ['failure', 'cancelled'].includes(step.conclusion))
        .map((step) => step.name),
    };
  }
  return result;
}

/** 같은 PR head의 자동 실행만 선택하여 수동·다른 PR 결과를 제외한다. */
export function newestRun(runs, binding) {
  return runs
    .filter(
      /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (run) =>
        run.event === 'pull_request' &&
        workflowIdentity(run) === workflowNames.ci &&
        !run.display_title?.startsWith('Cancel PR #') &&
        run.head_sha === binding.headSha &&
        (run.pull_requests?.some((pr) => pr.number === binding.prNumber) ||
          run.display_title === `CI PR #${binding.prNumber}`),
    )
    .sort(
      (a, b) =>
        Number(b.id) - Number(a.id) ||
        Number(b.run_attempt) - Number(a.run_attempt),
    )[0];
}

/** 현재 PR·최신 실행·기존 댓글 순서를 모두 만족할 때만 갱신한다. */
export function shouldUpdate(
  pr,
  binding,
  run,
  latest,
  previous,
  publishRun = null,
) {
  validateBinding(binding);
  if (
    pr.number !== binding.prNumber ||
    pr.head.sha !== binding.headSha ||
    !latest ||
    !sameRun(run, latest)
  )
    return false;
  if (
    !publishRun &&
    (pr.state !== 'open' ||
      pr.draft ||
      pr.base.sha !== binding.baseSha ||
      run.conclusion === 'cancelled')
  )
    return false;
  if (publishRun && (pr.state !== 'closed' || !pr.merged)) return false;
  if (previous) {
    if (
      Number(previous.runId) > Number(binding.runId) ||
      (previous.runId === binding.runId &&
        Number(previous.runAttempt) > Number(binding.runAttempt))
    )
      return false;
    if (
      publishRun &&
      previous.publishRun &&
      (Number(previous.publishRun.runId) > Number(publishRun.runId) ||
        (previous.publishRun.runId === publishRun.runId &&
          Number(previous.publishRun.runAttempt) >
            Number(publishRun.runAttempt)))
    )
      return false;
  }
  return true;
}

/** 댓글의 고정 표식 뒤 메타데이터만 읽으며 손상된 기존 댓글은 덮어쓰지 않는다. */
export function commentMetadata(body) {
  const match = body.match(/<!-- codocs-run: (\{[^\n]*\}) -->/u);
  if (!match) return null;
  const value = JSON.parse(match[1]);
  assert.match(value.runId, /^[1-9]\d*$/u, 'invalid comment run ID');
  assert.match(value.runAttempt, /^[1-9]\d*$/u, 'invalid comment attempt');
  return value;
}

/** 외부 단계 이름의 Markdown·HTML을 텍스트로 표시한다. */
function escapeText(value) {
  return String(value)
    .replace(/[&<>|`@\[\]()*_#\\\r\n]/gu, (char) => `&#${char.codePointAt(0)};`)
    .slice(0, 300);
}

/** 결과·양 OS 시간·실패 단계·제품별 게시 상태를 댓글 하나로 표시한다. */
export function renderComment(report, publish = null, publishRun = null) {
  const binding = report.binding;
  const lines = [
    commentMarker,
    `<!-- codocs-run: ${JSON.stringify({ runId: binding.runId, runAttempt: binding.runAttempt, headSha: binding.headSha, baseSha: binding.baseSha, publishRun })} -->`,
    `${requiredCheck}: **${report.result}**`,
    `[Actions 실행](https://github.com/${binding.repository}/actions/runs/${binding.runId}/attempts/${binding.runAttempt})`,
    '',
    '| OS | 결과 | 시간 |',
    '| --- | --- | --- |',
  ];
  for (const job of ['windows', 'macos']) {
    const state = report.jobs[job];
    lines.push(
      `| ${job} | ${escapeText(state.result)} | ${state.seconds === null ? '—' : `${state.seconds}s`} |`,
    );
  }
  for (const job of requiredJobs) {
    const state = report.jobs[job];
    if (state.result !== 'success')
      lines.push(
        `\n실패 단계 (${job}): ${state.failedSteps.length ? state.failedSteps.map(escapeText).join(', ') : escapeText(state.result)}`,
      );
  }
  if (report.aggregateFailure)
    lines.push(
      `\n실패 단계 (${requiredCheck}): ${escapeText(report.aggregateFailure)}`,
    );
  lines.push('', '| 제품 | 버전 | 게시 |', '| --- | --- | --- |');
  for (const product of Object.keys(products)) {
    const artifact = report.artifacts.find((item) => item.product === product);
    const state = publish?.products[product];
    lines.push(
      `| ${product} | ${escapeText(state?.version ?? artifact?.version ?? '—')} | ${escapeText(state?.status ?? 'pending')} |`,
    );
  }
  if (publishRun)
    lines.push(
      `\n[게시 실행](https://github.com/${binding.repository}/actions/runs/${publishRun.runId}/attempts/${publishRun.runAttempt})`,
    );
  return lines.join('\n');
}

/** GitHub JSON 목록의 페이지를 전부 읽으며 첫 페이지 누락을 성공으로 오인하지 않는다. */
async function list(api, route, key = null) {
  const entries = [];
  for (let page = 1; ; page++) {
    const value = await api(
      'GET',
      `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    const batch = key ? value[key] : value;
    assert.ok(Array.isArray(batch), 'invalid API list');
    entries.push(...batch);
    if (batch.length < 100) return entries;
  }
}

/** 정확한 run의 살아 있는 이름 하나만 선택하고 archive에서 JSON 한 파일만 읽는다. */
async function record(
  api,
  readArchive,
  repository,
  runId,
  name,
  filename,
  optional = false,
) {
  const artifacts = await list(
    api,
    `/repos/${repository}/actions/runs/${runId}/artifacts`,
    'artifacts',
  );
  const matches = artifacts.filter(
    (item) => item.name === name && !item.expired,
  );
  if (!matches.length && optional) {
    if (typeof optional !== 'function') return null;
    // 만료된 동일 이름은 정상 부재가 아니므로 예외 판단 전에 실패시킨다.
    if (!artifacts.some((item) => item.name === name) && (await optional()))
      return null;
  }
  assert.equal(matches.length, 1, 'one exact live artifact required');
  const artifact = matches[0];
  assert.ok(
    Number.isSafeInteger(artifact.id) && artifact.id > 0,
    'invalid artifact ID',
  );
  return {
    value: await readArchive(artifact.id, filename),
    id: String(artifact.id),
  };
}

/** 게시 결과는 고정 main workflow의 push·명시 재시도에서만 받는다. */
function assertPublishRun(run) {
  assert.equal(
    workflowIdentity(run),
    workflowNames.publish,
    'trusted publish workflow required',
  );
  assert.equal(run.head_branch, 'main', 'main publish run required');
  assert.ok(
    ['push', 'workflow_dispatch'].includes(run.event),
    'trusted publish event required',
  );
}

/** 정상 생략과 비릴리스 main push만 제외하고 실제 게시에는 증거를 요구한다. */
async function publicationRecord(api, readArchive, repository, run) {
  if (run.conclusion === 'skipped') return null;
  const identity = {
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
  };
  return record(
    api,
    readArchive,
    repository,
    identity.runId,
    publishArtifactName(identity),
    releaseFiles.publish,
    /** 성공 push의 정확한 commit에 병합된 릴리스 PR이 없을 때만 부재를 허용한다. */
    async () => {
      if (run.event !== 'push' || run.conclusion !== 'success') return false;
      assert.match(run.head_sha, /^[0-9a-f]{40}$/u, 'invalid publish commit');
      const pulls = await list(
        api,
        `/repos/${repository}/commits/${run.head_sha}/pulls`,
      );
      return !pulls.some(
        /** 생산자가 게시하는 병합 릴리스 PR 조건을 그대로 대조한다. */
        (pr) =>
          pr.merged_at &&
          pr.merge_commit_sha === run.head_sha &&
          pr.base?.ref === 'main' &&
          pr.head?.ref === releaseBranch,
      );
    },
  );
}

/** 댓글 권한 없이 실행의 PR 번호만 확인해 PR별 작성 그룹을 분리한다. */
export async function resolveReportPr(api, readArchive, repository, run) {
  if (workflowIdentity(run) === workflowNames.ci) {
    assert.equal(run.event, 'pull_request', 'automatic PR required');
    const match = run.display_title?.match(/^CI PR #([1-9]\d*)$/u);
    assert.ok(match, 'ready CI title required');
    const number = Number(match[1]);
    assert.ok(Number.isSafeInteger(number), 'invalid PR number');
    return number;
  }
  assert.equal(
    workflowIdentity(run),
    workflowNames.publish,
    'unknown workflow',
  );
  const current = await api(
    'GET',
    `/repos/${repository}/actions/runs/${run.id}`,
  );
  assert.ok(sameRun(run, current), 'stale publish run');
  assertPublishRun(current);
  const identity = {
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
  };
  const uploaded = await publicationRecord(
    api,
    readArchive,
    repository,
    current,
  );
  if (!uploaded) return null;
  const binding = validateBinding(uploaded.value.binding);
  assert.equal(binding.repository, repository, 'repository mismatch');
  assert.deepEqual(uploaded.value.publishRun, identity, 'publish run mismatch');
  return binding.prNumber;
}

/** 댓글 권한으로 PR 코드를 실행하지 않고 API와 계약 JSON을 대조한 뒤 최신 댓글만 쓴다. */
export async function reportRun(
  api,
  readArchive,
  repository,
  run,
  expectedPrNumber = null,
) {
  assert.ok(
    Object.values(workflowNames).includes(workflowIdentity(run)),
    'unknown workflow',
  );
  const currentRun = await api(
    'GET',
    `/repos/${repository}/actions/runs/${run.id}`,
  );
  if (!sameRun(run, currentRun)) return 'stale';
  if (workflowIdentity(run) === workflowNames.publish)
    assertPublishRun(currentRun);
  else
    assert.equal(
      workflowIdentity(currentRun),
      workflowNames.ci,
      'CI workflow required',
    );
  let publish = null;
  let publishRun = null;
  let ciRun = run;
  let binding;
  if (workflowIdentity(run) === workflowNames.publish) {
    publishRun = { runId: String(run.id), runAttempt: String(run.run_attempt) };
    const published = await publicationRecord(
      api,
      readArchive,
      repository,
      currentRun,
    );
    if (!published) return 'ignored';
    publish = published.value;
    assert.deepEqual(publish.publishRun, publishRun, 'publish run mismatch');
    binding = validateBinding(publish.binding);
    ciRun = await api(
      'GET',
      `/repos/${repository}/actions/runs/${binding.runId}`,
    );
  } else {
    if (
      run.event !== 'pull_request' ||
      run.conclusion === 'cancelled' ||
      run.display_title?.startsWith('Cancel PR #')
    )
      return 'ignored';
    // fork 실행의 pull_requests가 비어 있으면 실제 commit 연결에서 PR을 확인한다.
    const linked = run.pull_requests?.length
      ? run.pull_requests
      : await list(api, `/repos/${repository}/commits/${run.head_sha}/pulls`);
    const candidates = [];
    for (const link of linked) {
      const pr = await api('GET', `/repos/${repository}/pulls/${link.number}`);
      if (pr.head.sha === run.head_sha && pr.state === 'open' && !pr.draft)
        candidates.push(pr);
    }
    if (candidates.length !== 1) return 'stale';
    const pr = candidates[0];
    binding = validateBinding({
      repository,
      prNumber: pr.number,
      headSha: run.head_sha,
      baseSha: pr.base.sha,
      workflow: workflowNames.ci,
      runId: String(run.id),
      runAttempt: String(run.run_attempt),
      eventName: run.event,
      draft: false,
    });
  }
  assert.equal(binding.repository, repository, 'repository mismatch');
  if (expectedPrNumber !== null)
    assert.equal(binding.prNumber, expectedPrNumber, 'resolved PR mismatch');
  assert.equal(binding.workflow, workflowNames.ci, 'CI binding required');
  assert.equal(
    workflowIdentity(ciRun),
    workflowNames.ci,
    'CI workflow required',
  );
  assert.equal(ciRun.event, 'pull_request', 'automatic PR required');
  assert.equal(ciRun.head_sha, binding.headSha, 'CI head mismatch');
  assert.equal(String(ciRun.id), binding.runId, 'CI run mismatch');
  assert.equal(
    String(ciRun.run_attempt),
    binding.runAttempt,
    'CI attempt mismatch',
  );
  const uploaded = await record(
    api,
    readArchive,
    repository,
    binding.runId,
    reportArtifactName(binding),
    releaseFiles.report,
    !publish,
  );
  if (uploaded)
    assert.deepEqual(
      uploaded.value.binding,
      binding,
      'report run/base mismatch',
    );
  if (
    !uploaded &&
    !ciRun.pull_requests?.some(
      (pr) =>
        pr.number === binding.prNumber &&
        pr.head?.sha === binding.headSha &&
        pr.base?.sha === binding.baseSha,
    )
  )
    return 'stale';
  // 집계 runner 자체가 실패한 경우에도 API의 실패 단계는 표시하되 후보 없이는 성공하지 않는다.
  const candidateRecord = await record(
    api,
    readArchive,
    repository,
    binding.runId,
    candidateArtifactName(binding),
    releaseFiles.candidate,
    !publish,
  );
  const candidate = candidateRecord
    ? bindUploadedCandidate(candidateRecord.value, binding, candidateRecord.id)
    : null;
  const apiJobs = await list(
    api,
    `/repos/${repository}/actions/runs/${binding.runId}/attempts/${binding.runAttempt}/jobs`,
    'jobs',
  );
  const jobs = summarizeJobs(apiJobs);
  const report = createReport(binding, candidate, jobs);
  const gate = apiJobs.find((job) => job.name === requiredCheck);
  if (
    !uploaded ||
    uploaded.value.result !== 'success' ||
    gate?.conclusion !== 'success' ||
    ciRun.conclusion !== 'success'
  )
    report.result = 'failure';
  if (report.result === 'failure' && gate?.conclusion !== 'success')
    report.aggregateFailure =
      (gate?.steps ?? [])
        .filter((step) => ['failure', 'cancelled'].includes(step.conclusion))
        .map((step) => step.name)
        .join(', ') ||
      gate?.conclusion ||
      'missing';
  if (report.result === 'success') validateReport(uploaded.value, candidate);
  if (publish) {
    validateReport(uploaded.value, candidate);
    assert.equal(
      report.result,
      'success',
      'published candidate needs successful CI',
    );
    validatePublish(publish, candidate, publish.changedProducts);
  }
  const comments = await list(
    api,
    `/repos/${repository}/issues/${binding.prNumber}/comments`,
  );
  const matches = comments.filter(
    (comment) =>
      comment.user?.login === 'github-actions[bot]' &&
      comment.body.startsWith(commentMarker),
  );
  assert.ok(matches.length <= 1, 'multiple result comments');
  const existing = matches[0];
  const latest = newestRun(
    await list(
      api,
      `/repos/${repository}/actions/workflows/test.yml/runs?event=pull_request&head_sha=${binding.headSha}`,
      'workflow_runs',
    ),
    binding,
  );
  const pr = await api('GET', `/repos/${repository}/pulls/${binding.prNumber}`);
  if (publishRun)
    assert.equal(
      pr.merge_commit_sha,
      currentRun.head_sha,
      'publish merge mismatch',
    );
  if (
    !shouldUpdate(
      pr,
      binding,
      ciRun,
      latest,
      existing ? commentMetadata(existing.body) : null,
      publishRun,
    )
  )
    return 'stale';
  const body = renderComment(report, publish, publishRun);
  if (existing)
    await api('PATCH', `/repos/${repository}/issues/comments/${existing.id}`, {
      body,
    });
  else
    await api(
      'POST',
      `/repos/${repository}/issues/${binding.prNumber}/comments`,
      { body },
    );
  return 'updated';
}

/** API 토큰은 GitHub API 요청에만 전달하고 외부 artifact redirect에는 전달하지 않는다. */
export function githubApi(token, base = 'https://api.github.com') {
  return /** 입력 조건과 관찰 결과를 계약에 대조한다. */ async function request(
    method,
    route,
    body,
  ) {
    const response = await fetch(base + route, {
      method,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (route.endsWith('/zip') && response.status === 302) {
      const url = new URL(response.headers.get('location'));
      assert.equal(url.protocol, 'https:', 'HTTPS artifact required');
      const archive = await fetch(url, { redirect: 'error' });
      assert.ok(archive.ok, 'artifact download failed');
      const bytes = Buffer.from(await archive.arrayBuffer());
      assert.ok(bytes.length <= 256 * 1024 * 1024, 'artifact too large');
      return bytes;
    }
    assert.ok(response.ok, `GitHub API ${method} ${route}: ${response.status}`);
    return response.json();
  };
}

/** archive를 풀지 않고 고정 basename의 JSON만 읽으며 PR 파일을 실행하지 않는다. */
export async function archiveJson(api, repository, id, filename) {
  assert.ok(
    Object.values(releaseFiles).includes(filename),
    'unknown record filename',
  );
  assert.ok(Number.isSafeInteger(id) && id > 0, 'invalid artifact ID');
  await mkdir('.workbench/reporter', { recursive: true });
  const temporary = await mkdtemp('.workbench/reporter/archive-');
  try {
    const archive = path.join(temporary, 'record.zip');
    await writeFile(
      archive,
      await api('GET', `/repos/${repository}/actions/artifacts/${id}/zip`),
    );
    const members = execFileSync('unzip', ['-Z1', archive], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
      .trim()
      .split('\n');
    assert.equal(
      members.filter((entry) => entry === filename).length,
      1,
      'one record basename required',
    );
    return JSON.parse(
      execFileSync('unzip', ['-p', archive, filename], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** 기본 브랜치 reporter 진입점이며 PR checkout·설치·빌드를 수행하지 않는다. */
async function main() {
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const api = githubApi(process.env.GITHUB_TOKEN, process.env.GITHUB_API_URL);
  const repository = process.env.GITHUB_REPOSITORY;
  if (process.argv[2] === 'resolve') {
    const number = await resolveReportPr(
      api,
      (id, filename) => archiveJson(api, repository, id, filename),
      repository,
      event.workflow_run,
    );
    if (number !== null)
      await appendFile(process.env.GITHUB_OUTPUT, `pr_number=${number}\n`);
    return;
  }
  console.log(
    await reportRun(
      api,
      (id, filename) => archiveJson(api, repository, id, filename),
      repository,
      event.workflow_run,
      process.env.CODOCS_REPORT_PR
        ? Number(process.env.CODOCS_REPORT_PR)
        : null,
    ),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
