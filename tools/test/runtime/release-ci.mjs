import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRelease } from '../../build/release.mjs';
import {
  artifactName as productArtifactName,
  bindUploadedCandidate,
  candidateArtifactName,
  products,
  readProductVersions,
  releaseFiles,
  verifyCandidate,
} from '../../build/release-contract.mjs';
import { resolveStableVersion } from '../../../packages/vscode/test-runner/cli.mjs';
import { readUiEvidence } from '../../ci/ui-evidence.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const input = path.join(root, '.workbench/release-input');

/** 다른 OS의 로컬 receipt 경로에서 안전한 동적 제품 파일명만 추출한다. */
export function artifactName(filename) {
  assert.equal(typeof filename, 'string', 'artifact path required');
  const name = filename.split(/[/\\]/u).at(-1);
  for (const [product, definition] of Object.entries(products)) {
    const prefix = definition.name + '-';
    const suffix = '.' + definition.suffix;
    if (name.startsWith(prefix) && name.endsWith(suffix)) {
      const version = name.slice(prefix.length, -suffix.length);
      assert.equal(name, productArtifactName(product, version));
      return name;
    }
  }
  throw new Error('unknown artifact filename');
}

/** 전달 소스·제품·파일 바이트와 선택 버전을 검사한다. 기대 실행 바인딩도 받을 수 있다. */
export async function verifyInput(
  directory,
  expectedCommit,
  expectedStable,
  expected = {},
) {
  let receipt = JSON.parse(
    await readFile(path.join(directory, releaseFiles.candidate), 'utf8'),
  );
  const selection = JSON.parse(
    await readFile(path.join(directory, releaseFiles.selection), 'utf8'),
  );
  assert.equal(
    selection.sourceCommit,
    expectedCommit,
    'selection source mismatch',
  );
  assert.match(
    selection.stable,
    /^\d+\.\d+\.\d+$/u,
    'exact stable version required',
  );
  assert.equal(selection.stable, expectedStable, 'selection stable mismatch');
  if (Object.hasOwn(expected, 'binding'))
    assert.deepEqual(
      selection.binding,
      expected.binding,
      'selection run mismatch',
    );
  if (Object.hasOwn(expected, 'execution'))
    assert.deepEqual(
      selection.execution,
      expected.execution,
      'execution run mismatch',
    );
  if (expected.artifactId) {
    assert.match(expected.artifactId, /^[1-9]\d*$/u, 'invalid artifactId');
    assert.ok(
      receipt.artifactId === null || receipt.artifactId === expected.artifactId,
      'artifactId mismatch',
    );
    receipt = receipt.binding
      ? bindUploadedCandidate(
          receipt,
          expected.binding ?? receipt.binding,
          expected.artifactId,
        )
      : { ...receipt, artifactId: expected.artifactId };
  }
  await verifyCandidate(directory, receipt, {
    ...expected,
    sourceCommit: expectedCommit,
  });
  return { receipt, selection };
}

/** 수동·push 실행 식별자를 PR 필수 증거와 분리하여 고정한다. */
export function executionBinding(head, environment) {
  assert.match(head, /^[a-f0-9]{40}$/u, 'exact source required');
  assert.match(
    environment.GITHUB_REPOSITORY,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    'repository required',
  );
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'])
    assert.match(
      environment[key],
      /^[1-9]\d*$/u,
      'execution identity required',
    );
  assert.ok(
    ['pull_request', 'workflow_dispatch', 'push'].includes(
      environment.GITHUB_EVENT_NAME,
    ),
    'unsupported execution event',
  );
  return {
    repository: environment.GITHUB_REPOSITORY,
    sourceCommit: head,
    eventName: environment.GITHUB_EVENT_NAME,
    runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
  };
}

/** GitHub 환경에서 PR head/base와 실행 시도를 명시적으로 읽는다. */
async function githubBinding(head) {
  if (
    !process.env.GITHUB_EVENT_PATH ||
    process.env.GITHUB_EVENT_NAME !== 'pull_request'
  )
    return null;
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  assert.equal(head, event.pull_request.head.sha, 'checkout must use PR head');
  return {
    repository: process.env.GITHUB_REPOSITORY,
    prNumber: event.pull_request.number,
    headSha: event.pull_request.head.sha,
    baseSha: event.pull_request.base.sha,
    workflow: process.env.GITHUB_WORKFLOW,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    eventName: process.env.GITHUB_EVENT_NAME,
    draft: event.pull_request.draft,
  };
}

/** 한 번 패키징한 바이트를 양 OS에 전달하며 기존 prepare|verify 명령을 유지한다. */
async function main(mode) {
  const head = execFileSync(
    'git',
    ['-c', 'core.longpaths=true', 'rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  assert.equal(head, process.env.CODOCS_SOURCE_SHA ?? process.env.GITHUB_SHA);
  const execution = executionBinding(head, process.env);
  if (mode === 'prepare') {
    const stable = await resolveStableVersion();
    const resolvedAt = new Date().toISOString();
    const receipt = await packageRelease(root);
    assert.equal(receipt.sourceCommit, head);
    assert.equal(receipt.sourceDiff, '');
    receipt.binding = await githubBinding(head);
    receipt.artifactName = receipt.binding
      ? candidateArtifactName(receipt.binding)
      : null;
    await mkdir(input, { recursive: true });
    for (const artifact of receipt.artifacts)
      await copyFile(artifact.file, path.join(input, artifact.basename));
    await verifyCandidate(input, receipt, {
      sourceCommit: head,
      versions: await readProductVersions(root),
    });
    await writeFile(
      path.join(input, releaseFiles.candidate),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    await writeFile(
      path.join(input, releaseFiles.selection),
      JSON.stringify(
        {
          sourceCommit: head,
          binding: receipt.binding,
          execution,
          stable,
          resolvedAt,
        },
        null,
        2,
      ) + '\n',
    );
    if (process.env.GITHUB_OUTPUT) {
      const filenames = Object.fromEntries(
        receipt.artifacts.map(
          /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (artifact) => [
            artifact.product,
            artifact.basename,
          ],
        ),
      );
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `stable=${stable}\nnpm_file=${filenames.npm}\nvsix_file=${filenames.vscode}\ncandidate_directory=${input}\ncandidate_artifact=${receipt.artifactName ?? ''}\n`,
      );
    }
  } else if (mode === 'verify' || mode === 'evidence') {
    const entries = execFileSync(
      'git',
      ['-c', 'core.longpaths=true', 'ls-tree', '-r', '-z', head],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    const sourceFiles = entries
      .map(
        /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (entry) => {
          const [metadata, file] = entry.split('\t');
          return {
            file,
            mode: metadata.split(' ')[0],
            gitBlob: metadata.split(' ')[2],
          };
        },
      )
      .sort(
        /** 입력 조건과 관찰 결과를 계약에 대조한다. */ (a, b) =>
          a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
      );
    const sourceTree = execFileSync('git', ['rev-parse', `${head}^{tree}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const binding = await githubBinding(head);
    const expected = {
      sourceFiles,
      sourceTree,
      versions: await readProductVersions(root),
      execution,
      binding,
    };
    if (process.env.CODOCS_ARTIFACT_ID)
      expected.artifactId = process.env.CODOCS_ARTIFACT_ID;
    const { receipt, selection } = await verifyInput(
      input,
      head,
      process.env.CODOCS_EXPECTED_STABLE,
      expected,
    );
    if (mode === 'evidence') {
      const job = process.env.CODOCS_JOB;
      assert.equal(
        job,
        process.platform === 'win32' ? 'windows' : 'macos',
        'OS job mismatch',
      );
      const ui = await readUiEvidence(
        path.join(root, '.workbench/vscode-ui'),
        receipt,
        selection.stable,
        process.platform,
      );
      const output = path.join(root, '.workbench/os-evidence', job);
      await mkdir(output, { recursive: true });
      await writeFile(
        path.join(output, 'evidence.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            execution,
            job,
            stable: selection.stable,
            sourceCommit: receipt.sourceCommit,
            sourceTree: receipt.sourceTree,
            sourceDigest: receipt.sourceDigest,
            artifactId: receipt.artifactId,
            artifacts: receipt.artifacts,
            ui,
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    await writeFile(
      path.join(input, 'test-environment.json'),
      JSON.stringify(
        {
          sourceCommit: head,
          platform: process.platform,
          arch: process.arch,
          release: os.release(),
          cpu: os.cpus()[0]?.model,
          node: process.version,
          artifacts: receipt.artifacts,
          execution,
          artifactId: receipt.artifactId,
        },
        null,
        2,
      ) + '\n',
    );
  } else throw new Error('Usage: release-ci.mjs prepare|verify|evidence');
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2]);
