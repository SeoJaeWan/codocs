import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUiEvidence, validateUiEvidence } from './ui-evidence.mjs';
import {
  bindUploadedCandidate,
  createReport,
  evidenceArtifactName,
  releaseFiles,
  requiredCheck,
  requiredJobs,
  validateBinding,
  validateEvidence,
  verifyCandidate,
} from '../build/release-contract.mjs';

/** 자동 PR만 같은 취소 그룹으로 묶고 Draft·종료 이벤트에는 러너를 배정하지 않는다. */
export function eventPolicy(eventName, event, workflow, runId) {
  const automatic = eventName === 'pull_request';
  return {
    run:
      !automatic ||
      (event.pull_request.state === 'open' &&
        event.pull_request.draft === false),
    group: automatic
      ? `${workflow}-pr-${event.pull_request.number}`
      : `${workflow}-${eventName}-${runId}`,
    cancel: automatic,
  };
}

/** 두 브랜치의 관리자 포함 strict 필수 CI·PR 의무가 실제 설정됐는지 확인하며 조회 실패를 전파한다. */
export async function assertReleaseProtection(api, repository) {
  assert.match(
    repository,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    'invalid repository',
  );
  for (const branch of ['main', 'develop']) {
    const protection = await api(
      'GET',
      `/repos/${repository}/branches/${branch}/protection`,
    );
    assert.equal(
      protection.enforce_admins?.enabled,
      true,
      `${branch}: admins must be protected`,
    );
    assert.ok(
      protection.required_pull_request_reviews,
      `${branch}: PR required`,
    );
    assert.equal(
      protection.required_status_checks?.strict,
      true,
      `${branch}: latest base required`,
    );
    const checks = [
      ...(protection.required_status_checks.contexts ?? []),
      ...(protection.required_status_checks.checks ?? []).map(
        (check) => check.context,
      ),
    ];
    assert.ok(
      checks.includes(requiredCheck),
      `${branch}: required-ci required`,
    );
    assert.equal(
      protection.allow_force_pushes?.enabled,
      false,
      `${branch}: force push forbidden`,
    );
    assert.equal(
      protection.allow_deletions?.enabled,
      false,
      `${branch}: deletion forbidden`,
    );
    const bypass =
      protection.required_pull_request_reviews.bypass_pull_request_allowances ??
      {};
    assert.ok(
      Object.values(bypass).every(
        (entries) => Array.isArray(entries) && entries.length === 0,
      ),
      `${branch}: PR bypass forbidden`,
    );
  }
  return true;
}

/** GitHub 이벤트와 환경을 ready PR 실행에만 결합한다. 수동·push는 필수 PR 증거가 아니다. */
export function runBinding(event, environment) {
  assert.equal(
    environment.GITHUB_EVENT_NAME,
    'pull_request',
    'automatic PR required',
  );
  assert.equal(event.pull_request.state, 'open', 'open PR required');
  return validateBinding({
    repository: environment.GITHUB_REPOSITORY,
    prNumber: event.pull_request.number,
    headSha: event.pull_request.head.sha,
    baseSha: event.pull_request.base.sha,
    workflow: environment.GITHUB_WORKFLOW,
    runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    eventName: environment.GITHUB_EVENT_NAME,
    draft: event.pull_request.draft,
  });
}

/** 각 OS가 같은 업로드 후보를 검증했으며 실제 필수 job도 모두 성공한 경우만 통과한다. */
export function aggregate(binding, candidate, jobs, evidence, stable) {
  const report = createReport(binding, candidate, jobs);
  if (candidate) {
    for (const job of ['macos', 'windows']) {
      validateEvidence(evidence[job], candidate);
      assert.equal(evidence[job].job, job, 'evidence job mismatch');
      assert.equal(evidence[job].stable, stable, 'fixed stable mismatch');
      assert.equal(
        evidence[job].result,
        jobs[job].result,
        'evidence outcome mismatch',
      );
      if (evidence[job].result === 'success')
        validateUiEvidence(
          evidence[job].ui,
          candidate,
          stable,
          evidence[job].platform,
        );
    }
  }
  return report;
}

/** 후보를 직접 재검증한 뒤 OS의 결과·실행 환경·실패 단계만 보관한다. */
export async function writeEvidence(
  directory,
  binding,
  artifactId,
  stable,
  job,
  steps,
) {
  const original = JSON.parse(
    await readFile(path.join(directory, releaseFiles.candidate), 'utf8'),
  );
  const candidate = bindUploadedCandidate(original, binding, artifactId);
  await verifyCandidate(directory, candidate, { binding, artifactId });
  const outcomes = Object.values(steps).map((step) => step.outcome);
  const result = outcomes.includes('cancelled')
    ? 'cancelled'
    : outcomes.includes('failure')
      ? 'failure'
      : ['runtime', 'installed', 'stable_ui'].every(
            (name) => steps[name]?.outcome === 'success',
          )
        ? 'success'
        : 'failure';
  const evidence = {
    schemaVersion: 1,
    job,
    binding,
    sourceCommit: candidate.sourceCommit,
    sourceTree: candidate.sourceTree,
    sourceDigest: candidate.sourceDigest,
    artifactId,
    artifacts: candidate.artifacts,
    platform: process.platform,
    stable,
    result,
    ui:
      result === 'success'
        ? await readUiEvidence(
            '.workbench/vscode-ui',
            candidate,
            stable,
            process.platform,
          )
        : null,
    failedSteps: Object.entries(steps)
      .filter(([, step]) => step.outcome === 'failure')
      .map(([name]) => name),
  };
  validateEvidence(evidence, candidate);
  const output = path.join('.workbench/pr-evidence', job);
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, releaseFiles.evidence),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  return evidenceArtifactName(binding, job);
}

/** CI 집계 파일은 실패해도 먼저 기록하고 실패 종료로 필수 check를 차단한다. */
async function main(mode) {
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const binding = runBinding(event, process.env);
  const directory = '.workbench/release-input';
  if (mode === 'evidence') {
    await writeEvidence(
      directory,
      binding,
      process.env.CODOCS_ARTIFACT_ID,
      process.env.CODOCS_EXPECTED_STABLE,
      process.env.CODOCS_JOB,
      JSON.parse(process.env.CODOCS_STEPS),
    );
    return;
  }
  assert.equal(mode, 'aggregate', 'Usage: pr-ci.mjs evidence|aggregate');
  const needs = JSON.parse(process.env.CODOCS_NEEDS);
  const jobs = Object.fromEntries(
    requiredJobs.map((job) => [
      job,
      { result: needs[job]?.result ?? 'skipped' },
    ]),
  );
  let report;
  try {
    const candidate = bindUploadedCandidate(
      JSON.parse(
        await readFile(path.join(directory, releaseFiles.candidate), 'utf8'),
      ),
      binding,
      process.env.CODOCS_ARTIFACT_ID,
    );
    await verifyCandidate(directory, candidate, {
      binding,
      artifactId: process.env.CODOCS_ARTIFACT_ID,
    });
    const evidence = {};
    for (const job of ['macos', 'windows'])
      evidence[job] = JSON.parse(
        await readFile(
          path.join(
            '.workbench/incoming-evidence',
            evidenceArtifactName(binding, job),
            releaseFiles.evidence,
          ),
          'utf8',
        ),
      );
    const selection = JSON.parse(
      await readFile(path.join(directory, releaseFiles.selection), 'utf8'),
    );
    assert.deepEqual(selection.binding, binding, 'selection run mismatch');
    assert.equal(
      selection.sourceCommit,
      candidate.sourceCommit,
      'selection source mismatch',
    );
    report = aggregate(binding, candidate, jobs, evidence, selection.stable);
  } catch (error) {
    report = createReport(binding, null, jobs);
    report.diagnostic = error.message;
  }
  await mkdir('.workbench/pr-report', { recursive: true });
  await writeFile(
    path.join('.workbench/pr-report', releaseFiles.report),
    JSON.stringify(report, null, 2) + '\n',
  );
  assert.equal(report.result, 'success', 'required CI failed');
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2]);
