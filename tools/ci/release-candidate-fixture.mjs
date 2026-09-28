import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolvePnpm } from '../toolchain.mjs';
import {
  candidateArtifactName,
  evidenceArtifactName,
  releaseFiles,
  requiredJobs,
  sha256,
  readProductVersions,
} from '../build/release-contract.mjs';
import { verifyInput } from '../test/runtime/release-ci.mjs';
import { assertReleasePrSource, releaseBranch } from './release-flow.mjs';
import {
  publishProducts,
  validatePublication,
  unpackCandidateArchive,
} from './release-publish.mjs';
import { eventPolicy } from './pr-ci.mjs';
import { shouldUpdate, renderComment, commentMetadata } from './pr-report.mjs';
import {
  root,
  git,
  fixtureEnv,
  changeset,
  commit,
} from './release-fixture.mjs';
const pnpm = resolvePnpm();
const require = createRequire(import.meta.url);
const yazl = require(
  require.resolve('yazl', {
    paths: [path.dirname(require.resolve('@vscode/vsce/package.json'))],
  }),
);
/** 실제 명령의 종료·시간·원문 로그를 같은 실행의 증거에 남긴다. */
async function command(cwd, evidence, name, args, extra = {}) {
  const started = Date.now();
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...fixtureEnv, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  const code = await new Promise(
    /** 실행 완료와 준비 오류를 구분한다. */ (resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    },
  );
  await writeFile(path.join(evidence, `${name}.log`), log);
  await writeFile(
    path.join(evidence, `${name}.json`),
    JSON.stringify(
      {
        executable: process.execPath,
        args,
        cwd,
        code,
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ),
  );
  assert.equal(code, 0, `${name}: ${log.slice(-10000)}`);
  return log;
}

/** 실제 tgz·VSIX와 영수증을 upload archive의 네 파일 계약으로 인코딩한다. */
async function archive(directory, candidate) {
  const zip = new yazl.ZipFile();
  for (const name of [
    releaseFiles.candidate,
    releaseFiles.selection,
    ...candidate.artifacts.map((item) => item.basename),
  ])
    zip.addBuffer(await readFile(path.join(directory, name)), name);
  const chunks = [];
  zip.outputStream.on('data', (chunk) => chunks.push(chunk));
  const complete = new Promise(
    /** ZIP writer 완료 전에 부분 바이트를 전달하지 않는다. */ (
      resolve,
      reject,
    ) => {
      zip.outputStream.on('end', resolve);
      zip.outputStream.on('error', reject);
    },
  );
  zip.end();
  await complete;
  return Buffer.concat(chunks);
}

/** 실행 결과 경로를 실제 runner 출력에서 읽고 성공·정리 근거를 확인한다. */
async function guiEvidence(log, kind, expectedVersion, expectedHash) {
  const marker =
    kind === 'functional' ? 'VS Code run output: ' : 'VS Code lifecycle: ';
  const output = log
    .split(/\r?\n/u)
    .find((line) => line.startsWith(marker))
    ?.slice(marker.length);
  assert.ok(output, `runner evidence path missing: ${log}`);
  const result = JSON.parse(await readFile(path.join(output, 'result.json')));
  assert.equal(result.version, expectedVersion);
  if (kind === 'functional') {
    assert.equal(result.passed, true);
    assert.equal(result.cleaned, true);
    assert.equal(result.process.residualProcesses, 0);
    const installation = JSON.parse(
      await readFile(path.join(output, 'installation.json')),
    );
    assert.equal(installation.sha256, expectedHash);
    const functional = JSON.parse(
      await readFile(path.join(output, 'functional.json')),
    );
    const { scenarios } = require(
      path.join(root, 'packages/vscode/src/integration/extension.test.cjs'),
    );
    assert.deepEqual(
      functional.results.map((item) => item.id),
      scenarios.map((item) => item.id),
    );
    assert.ok(functional.results.every((item) => item.passed));
    assert.equal(functional.environment.extensionVersion, installation.version);
  } else {
    assert.equal(result.archiveSha256, expectedHash);
    assert.deepEqual(
      result.results.map((item) => item.mode),
      ['startup-failure', 'failure', 'timeout', 'cancelled'],
    );
    assert.ok(
      result.results.every(
        (item) => item.passed && item.residualProcesses === 0,
      ),
    );
  }
  return { kind, output, result };
}

/** 최종 버전 실물 후보의 관리 소비와 명시적 native GUI 소비를 분리한다. */
export async function verifyVersionedCandidate({ gui = false } = {}) {
  await mkdir(path.join(root, '.workbench'), { recursive: true });
  const evidence = await mkdtemp(path.join(root, '.workbench/candidate-'));
  const cwd = path.join(evidence, 'source');
  // staged snapshot에서도 현재 index의 제품 소스를 독립 Git fixture로 확정한다.
  const tree = git(root, ['write-tree']);
  git(
    root,
    ['clone', '--quiet', '--shared', '--no-checkout', '--', root, cwd],
    { env: fixtureEnv },
  );
  git(cwd, ['read-tree', tree], { env: fixtureEnv });
  git(cwd, ['config', '--local', 'core.longpaths', 'true']);
  git(cwd, ['config', '--local', 'core.autocrlf', 'false']);
  git(cwd, ['checkout-index', '--all', '--force'], { env: fixtureEnv });
  git(cwd, ['config', 'user.name', 'Fixture']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  git(cwd, ['checkout', '-B', 'develop'], { env: fixtureEnv });
  const before = await readProductVersions(cwd);
  await changeset(cwd, 'int001-final', {
    '@codocs/mcp': 'patch',
    codocs: 'patch',
  });
  const source = commit(cwd, 'integration source');
  git(cwd, ['branch', '-f', 'main', source], { env: fixtureEnv });
  // fixture install은 prepare hook을 등록하지 않으며 결과 commit의 실제 hook과 별개다.
  await command(
    cwd,
    evidence,
    'install',
    [
      pnpm,
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--store-dir',
      path.join(evidence, 'pnpm-store'),
    ],
    {
      npm_config_cache: path.join(evidence, 'npm-cache'),
      XDG_CACHE_HOME: path.join(evidence, 'cache'),
    },
  );
  git(cwd, ['checkout', '-b', releaseBranch], { env: fixtureEnv });
  await command(cwd, evidence, 'official-cli', [pnpm, 'release:version']);
  const headSha = commit(cwd, 'official final versions');
  const finalVersions = await readProductVersions(cwd);
  assert.notEqual(finalVersions.npm, before.npm);
  assert.notEqual(finalVersions.vscode, before.vscode);
  assertReleasePrSource({ cwd, headSha, developSha: source, mainSha: source });
  const binding = {
    repository: 'Fixture/release',
    prNumber: 35,
    headSha,
    baseSha: source,
    workflow: 'Tests',
    runId: '101',
    runAttempt: '2',
    eventName: 'pull_request',
    draft: false,
  };
  const event = {
    pull_request: {
      number: 35,
      state: 'open',
      draft: false,
      head: { sha: headSha },
      base: { sha: source },
    },
  };
  const eventFile = path.join(evidence, 'event.json');
  await writeFile(eventFile, JSON.stringify(event));
  const environment = {
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REPOSITORY: binding.repository,
    GITHUB_SHA: headSha,
    CODOCS_SOURCE_SHA: headSha,
    GITHUB_WORKFLOW: 'Tests',
    GITHUB_RUN_ID: binding.runId,
    GITHUB_RUN_ATTEMPT: binding.runAttempt,
  };
  // 실제 CI prepare가 stable을 이 실행에서 한 번만 결정하고 최종 버전 파일을 만든다.
  await command(
    cwd,
    evidence,
    'prepare',
    ['tools/test/runtime/release-ci.mjs', 'prepare'],
    environment,
  );
  const directory = path.join(cwd, '.workbench/release-input');
  const selection = JSON.parse(
    await readFile(path.join(directory, releaseFiles.selection)),
  );
  const stable = selection.stable;
  const verified = await verifyInput(directory, headSha, stable, {
    binding,
    artifactId: '201',
    versions: finalVersions,
  });
  const candidate = verified.receipt;
  await command(
    cwd,
    evidence,
    'actual-ci-input',
    ['tools/test/runtime/release-ci.mjs', 'verify'],
    {
      ...environment,
      CODOCS_EXPECTED_STABLE: stable,
      CODOCS_ARTIFACT_ID: '201',
    },
  );
  const files = Object.fromEntries(
    candidate.artifacts.map((item) => [
      item.product,
      path.join(directory, item.basename),
    ]),
  );
  const observations = [];
  if (gui) {
    assert.ok(
      ['darwin', 'win32'].includes(process.platform),
      'supported native GUI OS required',
    );

    await command(cwd, evidence, 'installed-package', [
      pnpm,
      'release:verify',
      files.npm,
      files.vscode,
    ]);

    const hash = candidate.artifacts.find(
      (item) => item.product === 'vscode',
    ).sha256;
    for (const version of ['1.100.0', stable]) {
      const functional = await command(cwd, evidence, `functional-${version}`, [
        'packages/vscode/test-runner/run.mjs',
        '--vscode-version',
        version,
        '--vsix',
        files.vscode,
        '--mcp-tgz',
        files.npm,
      ]);
      observations.push(
        await guiEvidence(functional, 'functional', version, hash),
      );
      const lifecycle = await command(cwd, evidence, `lifecycle-${version}`, [
        'packages/vscode/test-runner/lifecycle.mjs',
        '--vscode-version',
        version,
        '--vsix',
        files.vscode,
      ]);
      observations.push(
        await guiEvidence(lifecycle, 'lifecycle', version, hash),
      );
    }
  }
  // 관리 검사는 실제 호스트가 Linux여도 macOS로 표시하지 않는다.
  const hostJob = gui
    ? process.platform === 'win32'
      ? 'windows'
      : 'macos'
    : null;
  let hostEvidence;
  if (hostJob) {
    await command(
      cwd,
      evidence,
      'actual-host-evidence',
      ['tools/ci/pr-ci.mjs', 'evidence'],
      {
        ...environment,
        CODOCS_EXPECTED_STABLE: stable,
        CODOCS_ARTIFACT_ID: '201',
        CODOCS_JOB: hostJob,
        CODOCS_STEPS: JSON.stringify({
          identity: { outcome: 'success' },
          installed: { outcome: 'success' },
        }),
      },
    );
    hostEvidence = JSON.parse(
      await readFile(
        path.join(cwd, '.workbench/pr-evidence', hostJob, 'evidence.json'),
      ),
    );
    assert.equal(hostEvidence.platform, process.platform);
  }
  // 각 OS는 실제 GUI 관측이 있을 때만 native 증거이며 나머지는 명시적인 관리 fixture다.
  for (const job of ['macos', 'windows']) {
    const incoming = path.join(
      cwd,
      '.workbench/incoming-evidence',
      evidenceArtifactName(binding, job),
    );
    await mkdir(incoming, { recursive: true });
    await writeFile(
      path.join(incoming, releaseFiles.evidence),
      JSON.stringify(
        job === hostJob
          ? hostEvidence
          : {
              schemaVersion: 1,
              binding,
              sourceCommit: candidate.sourceCommit,
              sourceTree: candidate.sourceTree,
              sourceDigest: candidate.sourceDigest,
              artifactId: '201',
              artifacts: candidate.artifacts,
              stable,
              result: 'success',
              failedSteps: [],
              job,
              platform: job === 'windows' ? 'win32' : 'darwin',
              fixtureOnly: true,
              fixtureSourcePlatform: process.platform,
              fixturePurpose:
                'administration aggregate contract; no native OS observation',
            },
      ),
    );
  }
  await command(
    cwd,
    evidence,
    'actual-aggregate',
    ['tools/ci/pr-ci.mjs', 'aggregate'],
    {
      ...environment,
      CODOCS_ARTIFACT_ID: '201',
      CODOCS_NEEDS: JSON.stringify(
        Object.fromEntries(
          requiredJobs.map((job) => [job, { result: 'success' }]),
        ),
      ),
    },
  );
  const report = JSON.parse(
    await readFile(path.join(cwd, '.workbench/pr-report/ci-report.json')),
  );
  assert.equal(report.result, 'success');
  const run = {
    id: 101,
    run_attempt: 2,
    head_sha: headSha,
    name: 'CI PR #35',
    display_title: 'CI PR #35',
    path: '.github/workflows/test.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{ number: 35 }],
  };
  const openPr = { ...event.pull_request, merged: false };
  assert.equal(shouldUpdate(openPr, binding, run, run, null), true);
  const comment = renderComment(report);
  assert.equal(commentMetadata(comment).runAttempt, '2');
  assert.equal(
    shouldUpdate({ ...openPr, head: { sha: source } }, binding, run, run, null),
    false,
  );
  assert.equal(
    shouldUpdate(openPr, binding, run, { ...run, id: 102 }, null),
    false,
  );
  assert.equal(eventPolicy('pull_request', event, 'Tests', '101').run, true);
  assert.equal(
    eventPolicy(
      'pull_request',
      { pull_request: { ...openPr, draft: true } },
      'Tests',
      '102',
    ).run,
    false,
  );
  git(cwd, ['checkout', 'main'], { env: fixtureEnv });
  git(cwd, ['merge', '--squash', releaseBranch], { env: fixtureEnv });
  const currentMain = commit(cwd, 'fixture release merge');
  const pr = {
    number: 35,
    merged: true,
    merge_commit_sha: currentMain,
    head: {
      ref: releaseBranch,
      sha: headSha,
      repo: { full_name: binding.repository },
    },
    base: { ref: 'main', sha: source, repo: { full_name: binding.repository } },
  };
  const bytes = await archive(directory, candidate);
  const artifact = {
    id: 201,
    name: candidateArtifactName(binding),
    expired: false,
    expires_at: '2050-01-01T00:00:00Z',
    digest: `sha256:${sha256(bytes)}`,
    workflow_run: { id: 101, head_sha: headSha },
  };
  const publication = path.join(evidence, 'publication');
  await unpackCandidateArchive(bytes, artifact, publication, candidate);
  const changed = await validatePublication({
    cwd,
    directory: publication,
    candidate,
    report,
    pr,
    currentMain,
    run,
    artifact,
    checks: [
      { id: 1, name: 'required-ci', head_sha: headSha, conclusion: 'success' },
    ],
  });
  assert.deepEqual(changed, ['npm', 'vscode']);
  const published = [];
  const checkpoints = [];
  const adapters = Object.fromEntries(
    changed.map(
      /** 대상별 adapter가 동일 바이트를 관찰하도록 한다. */ (product) => [
        product,
        {
          /** 공개 조회를 로컬 바이트 관측으로만 대체한다. */ inspect:
            async () => null,
          /** adapter가 받은 실제 파일이 CI 검증 바이트와 같은지 확인한다. */ publish:
            async (filename, item) => {
              assert.equal(sha256(await readFile(filename)), item.sha256);
              assert.deepEqual(
                await readFile(filename),
                await readFile(files[product]),
              );
              published.push(product);
              if (
                product === 'vscode' &&
                published.filter((value) => value === product).length === 1
              )
                throw new Error('fixture Marketplace failure');
            },
        },
      ],
    ),
  );
  /** 제품별 완전한 상태만 메모리 및 실행 증거에 보존한다. */
  async function checkpoint(state) {
    checkpoints.push(state);
  }
  const first = await publishProducts({
    directory: publication,
    candidate,
    changed,
    publishRun: { runId: '301', runAttempt: '1' },
    adapters,
    checkpoint,
  });
  assert.equal(first.products.npm.status, 'published');
  assert.equal(first.products.vscode.status, 'failed');
  const retry = await publishProducts({
    directory: publication,
    candidate,
    changed,
    publishRun: { runId: '301', runAttempt: '2' },
    history: [first],
    adapters,
    checkpoint,
  });
  assert.deepEqual(published, ['npm', 'vscode', 'vscode']);
  assert.equal(retry.products.vscode.status, 'published');
  assert.match(renderComment(report, retry, retry.publishRun), /published/u);
  const npmArtifact = candidate.artifacts.find(
    (item) => item.product === 'npm',
  );
  await writeFile(path.join(publication, npmArtifact.basename), 'tampered');
  await assert.rejects(
    publishProducts({
      directory: publication,
      candidate,
      changed,
      publishRun: { runId: '302', runAttempt: '1' },
      adapters,
      checkpoint,
    }),
    /artifact hash mismatch/u,
  );
  await assert.rejects(
    verifyInput(publication, headSha, stable, { binding, artifactId: '201' }),
    /artifact hash mismatch/u,
  );
  await copyFile(files.npm, path.join(publication, npmArtifact.basename));
  const corruptArchive = Buffer.from(bytes);
  corruptArchive[0] ^= 1;
  await assert.rejects(
    unpackCandidateArchive(
      corruptArchive,
      artifact,
      path.join(evidence, 'tampered'),
      candidate,
    ),
    /artifact archive hash mismatch/u,
  );
  await writeFile(
    path.join(evidence, 'summary.json'),
    JSON.stringify(
      {
        tree,
        source,
        headSha,
        currentMain,
        finalVersions,
        stable,
        candidate,
        artifact,
        report,
        retry,
        checkpoints,
        observations,
        gui,
        otherOS: gui
          ? 'opposite OS fixture only; not executed'
          : 'both OS receipts are administration fixtures; not executed',
        hostPlatform: process.platform,
        nativeOS: hostJob,
        publication: 'local adapters only',
      },
      null,
      2,
    ),
  );
  console.log(`Release candidate evidence: ${evidence}`);
  return {
    evidence,
    summary: JSON.parse(await readFile(path.join(evidence, 'summary.json'))),
  };
}
