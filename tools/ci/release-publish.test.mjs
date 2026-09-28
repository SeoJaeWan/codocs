import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  products,
  artifactName,
  candidateArtifactName,
  sha256,
  sourceDigest,
  createReport,
  requiredJobs,
} from '../build/release-contract.mjs';
import { git, treeFiles, releaseBranch } from './release-flow.mjs';
import {
  changedProducts,
  selectArtifact,
  validatePublication,
  publicationRecord,
  publishProducts,
  unpackArtifact,
  unpackCandidateArchive,
} from './release-publish.mjs';
import {
  root,
  repositoryFixture,
  changeset,
  commit,
  officialCli,
  fixtureEnv,
} from './release-fixture.mjs';

const require = createRequire(import.meta.url);
const yazl = require(
  require.resolve('yazl', {
    paths: [path.dirname(require.resolve('@vscode/vsce/package.json'))],
  }),
);
/** 실제 CLI가 만든 최종 소스와 독립 candidate 바이트를 Git 병합 방식에 연결한다. */
async function publicationFixture(mode = 'squash') {
  const fixture = await repositoryFixture();
  await changeset(fixture.cwd, 'a');
  commit(fixture.cwd, 'unreleased patch');
  git(fixture.cwd, ['checkout', '-b', releaseBranch]);
  officialCli(fixture.cwd);
  const headSha = commit(fixture.cwd, 'official version');
  if (mode === 'rebase') {
    git(fixture.cwd, ['checkout', '-b', 'rebased-copy']);
    git(
      fixture.cwd,
      ['rebase', '--force-rebase', '--onto', 'main', fixture.base],
      { env: { ...fixtureEnv, GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z' } },
    );
    git(fixture.cwd, ['checkout', 'main']);
    git(fixture.cwd, ['merge', '--ff-only', 'rebased-copy'], {
      env: fixtureEnv,
    });
  } else {
    git(fixture.cwd, ['checkout', 'main']);
    git(
      fixture.cwd,
      [
        'merge',
        mode === 'merge' ? '--no-ff' : '--squash',
        releaseBranch,
        '--no-edit',
      ],
      { env: fixtureEnv },
    );
    if (mode === 'squash') commit(fixture.cwd, 'squashed version');
  }
  const currentMain = git(fixture.cwd, ['rev-parse', 'HEAD']);
  const binding = {
    repository: 'Fixture/release',
    prNumber: 35,
    headSha,
    baseSha: fixture.base,
    workflow: 'Tests',
    runId: '10',
    runAttempt: '1',
    eventName: 'pull_request',
    draft: false,
  };
  const files = treeFiles(fixture.cwd, headSha);
  const directory = path.join(fixture.directory, 'candidate');
  await mkdir(directory);
  const artifacts = [];
  for (const [product, version] of Object.entries({
    npm: '1.2.4',
    vscode: '2.3.4',
  })) {
    const basename = artifactName(product, version);
    const bytes = Buffer.from(`검증한 ${product} ${version} 원본 바이트\n`);
    await writeFile(path.join(directory, basename), bytes);
    artifacts.push({ product, version, basename, sha256: sha256(bytes) });
  }
  const candidate = {
    schemaVersion: 1,
    sourceCommit: headSha,
    sourceTree: git(fixture.cwd, ['rev-parse', `${headSha}^{tree}`]),
    sourceDiff: '',
    sourceFiles: files,
    sourceDigest: sourceDigest(files),
    binding,
    artifactName: candidateArtifactName(binding),
    artifactId: '20',
    artifacts,
  };
  await writeFile(
    path.join(directory, 'selection.json'),
    JSON.stringify({ sourceCommit: headSha, binding, stable: '1.100.0' }),
  );
  const pr = {
    number: 35,
    merged: true,
    head: {
      ref: releaseBranch,
      sha: headSha,
      repo: { full_name: 'Fixture/release' },
    },
    base: {
      ref: 'main',
      sha: fixture.base,
      repo: { full_name: 'Fixture/release' },
    },
    merge_commit_sha: currentMain,
  };
  const run = {
    id: 10,
    run_attempt: 1,
    head_sha: headSha,
    name: 'CI PR #35',
    path: '.github/workflows/test.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{ number: 35 }],
  };
  const artifact = {
    id: 20,
    name: candidate.artifactName,
    expired: false,
    expires_at: '2050-01-01T00:00:00Z',
    digest: `sha256:${'a'.repeat(64)}`,
    workflow_run: { id: 10, head_sha: headSha },
  };
  const report = createReport(
    binding,
    candidate,
    Object.fromEntries(requiredJobs.map((job) => [job, { result: 'success' }])),
  );
  const checks = [
    { id: 1, name: 'required-ci', head_sha: headSha, conclusion: 'success' },
  ];
  return {
    ...fixture,
    directory: fixture.directory,
    candidate,
    candidateDirectory: directory,
    pr,
    run,
    artifact,
    report,
    checks,
    currentMain,
  };
}
/** 검증 후보를 소비하는 관측 입력을 인접 테스트에 명시적으로 전달한다. */
function validationInput(fixture) {
  return {
    cwd: fixture.cwd,
    directory: fixture.candidateDirectory,
    candidate: fixture.candidate,
    report: fixture.report,
    pr: fixture.pr,
    currentMain: fixture.currentMain,
    run: fixture.run,
    artifact: fixture.artifact,
    checks: fixture.checks,
  };
}
/** existing VSCE zip writer로 테스트 archive를 만들며 제품 게시를 흉내 내지 않는다. */
async function zipBytes(entries) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name);
  const chunks = [];
  zip.outputStream.on('data', (chunk) => chunks.push(chunk));
  const completed = new Promise(
    /** archive writer의 실제 오류와 완료를 기다린다. */ (resolve, reject) => {
      zip.outputStream.on('end', resolve);
      zip.outputStream.on('error', reject);
    },
  );
  zip.end();
  await completed;
  return Buffer.concat(chunks);
}

describe('버전 증가 제품만 선택', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  for (const [name, after, expected] of [
    ['npm만', { npm: '1.2.4', vscode: '2.3.4' }, ['npm']],
    ['확장만', { npm: '1.2.3', vscode: '2.4.0' }, ['vscode']],
    ['둘 다', { npm: '1.3.0', vscode: '3.0.0' }, ['npm', 'vscode']],
    ['변경 없음', { npm: '1.2.3', vscode: '2.3.4' }, []],
  ])
    test(`${name} 증가하면 해당 제품만 게시 대상으로 선택한다`, /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
      assert.deepEqual(
        changedProducts({ npm: '1.2.3', vscode: '2.3.4' }, after),
        expected,
      );
    });
  test('제품 version이 감소하면 게시 대상을 조용히 생략하지 않고 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
    assert.throws(
      /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () =>
        changedProducts(
          { npm: '1.2.3', vscode: '2.3.4' },
          { npm: '1.2.2', vscode: '2.3.4' },
        ),
      /product version decreased/u,
    );
  });
});

describe('최종 CI 후보와 병합 소스 연결', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('게시 검증은 실제 run 표시 이름과 bare·qualified 경로를 사용한다', /** unrelated·missing 경로는 원본 후보로도 거부한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      for (const path of [
        '.github/workflows/test.yml',
        '.github/workflows/test.yml@main',
      ])
        assert.deepEqual(
          await validatePublication({
            ...validationInput(fixture),
            run: { ...fixture.run, path },
          }),
          ['npm'],
        );
      for (const path of [
        undefined,
        '.github/workflows/test.yml.fake',
        '.github/workflows/other.yml',
        '.github/workflows/test.yml@',
      ])
        await assert.rejects(
          validatePublication({
            ...validationInput(fixture),
            run: { ...fixture.run, path },
          }),
          /CI workflow mismatch/u,
        );
    } finally {
      await fixture.dispose();
    }
  });
  for (const mode of ['merge', 'squash', 'rebase'])
    test(`${mode}의 main commit 번호가 바뀌어도 전체 소스와 최종 검증 바이트가 같으면 게시를 허용한다`, /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
      const fixture = await publicationFixture(mode);
      try {
        assert.notEqual(fixture.currentMain, fixture.candidate.sourceCommit);
        assert.deepEqual(await validatePublication(validationInput(fixture)), [
          'npm',
        ]);
      } finally {
        await fixture.dispose();
      }
    });
  test('main이 다른 tree를 갖게 되면 commit 연결만으로 이전 후보를 허용하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await writeFile(
        path.join(fixture.cwd, 'different.mjs'),
        'export const different = true;\n',
      );
      const currentMain = commit(fixture.cwd, 'different source');
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          currentMain,
          pr: { ...fixture.pr, merge_commit_sha: currentMain },
        }),
        /sourceTree mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('새 CI run과 이전 후보가 섞이면 artifact를 게시하기 전에 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          run: { ...fixture.run, id: 11 },
        }),
        /stale candidate run/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('같은 run의 다음 attempt와 이전 후보가 섞이면 게시하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          run: { ...fixture.run, run_attempt: 2 },
        }),
        /stale candidate attempt/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('candidate artifact ID가 실제 다운로드 ID와 다르면 게시하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          artifact: { ...fixture.artifact, id: 21 },
        }),
        /artifactId mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('tgz 바이트가 변조됐으면 게시 어댑터를 호출하기 전에 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await appendFile(
        path.join(
          fixture.candidateDirectory,
          fixture.candidate.artifacts[0].basename,
        ),
        'tampered',
      );
      await assert.rejects(
        validatePublication(validationInput(fixture)),
        /artifact hash mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('최종 required-ci가 실패하면 성공 candidate JSON만으로 게시하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          checks: [{ ...fixture.checks[0], conclusion: 'failure' }],
        }),
        /latest required-ci success required/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('집계 source digest가 다른 실행을 가리키면 게시하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          report: { ...fixture.report, sourceDigest: 'b'.repeat(64) },
        }),
        /report sourceDigest mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('최종 PR base가 후보 base와 다르면 이전 검증을 게시 근거로 사용하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          pr: {
            ...fixture.pr,
            base: { ...fixture.pr.base, sha: 'b'.repeat(40) },
          },
        }),
        /candidate final base mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
});

describe('고정 stable 선택 파일과 후보 연결', /** 같은 후보의 환경 선택만 사용한다. */ () => {
  test('selection이 다른 실행을 가리키면 게시하지 않는다', /** 원래 검증 환경의 실행 바인딩을 검사한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await writeFile(
        path.join(fixture.candidateDirectory, 'selection.json'),
        JSON.stringify({
          sourceCommit: fixture.candidate.sourceCommit,
          binding: { ...fixture.candidate.binding, runId: '11' },
          stable: '1.100.0',
        }),
      );
      await assert.rejects(
        validatePublication(validationInput(fixture)),
        /selection run mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
});

describe('병합 후 원래 CI base 보존', /** 원래 base와 현재 PR base의 차이를 검사한다. */ () => {
  test('병합 후 PR API base가 main으로 이동해도 신뢰된 push before가 원래 CI base면 같은 후보를 허용한다', /** 이전 최종 검증의 base를 유지한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const input = validationInput(fixture);
      const changed = await validatePublication({
        ...input,
        pr: {
          ...fixture.pr,
          base: { ...fixture.pr.base, sha: fixture.currentMain },
        },
        expectedBaseSha: fixture.base,
      });
      assert.deepEqual(changed, ['npm']);
    } finally {
      await fixture.dispose();
    }
  });
  test('신뢰된 push before가 최종 CI base와 다르면 게시하지 않는다', /** 실행의 원래 base가 다른 후보를 차단한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      await assert.rejects(
        validatePublication({
          ...validationInput(fixture),
          expectedBaseSha: 'b'.repeat(40),
        }),
        /candidate final base mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
});

describe('artifact 만료와 archive 바이트 검사', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('artifact가 만료되면 이전 후보를 재빌드하지 않고 차단한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
    const run = { id: 10, head_sha: 'a'.repeat(40) };
    const artifact = {
      id: 20,
      name: 'candidate',
      expired: true,
      expires_at: '2050-01-01T00:00:00Z',
      digest: `sha256:${'a'.repeat(64)}`,
      workflow_run: { id: 10, head_sha: run.head_sha },
    };
    assert.throws(
      () => selectArtifact([artifact], 'candidate', run),
      /expired release artifact/u,
    );
  });
  test('expired 표식이 false여도 만료 시각이 지났으면 게시하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
    const run = { id: 10, head_sha: 'a'.repeat(40) };
    const artifact = {
      id: 20,
      name: 'candidate',
      expired: false,
      expires_at: '2020-01-01T00:00:00Z',
      digest: `sha256:${'a'.repeat(64)}`,
      workflow_run: { id: 10, head_sha: run.head_sha },
    };
    assert.throws(
      () => selectArtifact([artifact], 'candidate', run),
      /expired release artifact/u,
    );
  });
  test('release.json·selection.json·두 제품을 가진 실제 CI archive 구성을 소비하면 선택 파일과 검증 제품 바이트를 함께 보존한다', /** 실제 archive 파일 목록 계약을 synthetic 제품 바이트로 연결한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const entries = [
        ['release.json', Buffer.from(JSON.stringify(fixture.candidate))],
        [
          'selection.json',
          await readFile(
            path.join(fixture.candidateDirectory, 'selection.json'),
          ),
        ],
      ];
      for (const artifact of fixture.candidate.artifacts)
        entries.push([
          artifact.basename,
          await readFile(
            path.join(fixture.candidateDirectory, artifact.basename),
          ),
        ]);
      const bytes = await zipBytes(entries);
      const artifact = {
        ...fixture.artifact,
        digest: `sha256:${sha256(bytes)}`,
      };
      const directory = path.join(fixture.directory, 'downloaded-candidate');
      await unpackCandidateArchive(
        bytes,
        artifact,
        directory,
        fixture.candidate,
      );
      assert.equal(
        JSON.parse(await readFile(path.join(directory, 'selection.json')))
          .stable,
        '1.100.0',
      );
      assert.deepEqual(
        await validatePublication({
          ...validationInput(fixture),
          directory,
          artifact,
        }),
        ['npm'],
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('archive hash가 맞으면 명시한 JSON basename만 저장한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      const bytes = await zipBytes([
        ['publish.json', Buffer.from('{"schemaVersion":1}')],
      ]);
      const directory = path.join(fixture.directory, 'download');
      await unpackArtifact(
        bytes,
        { digest: `sha256:${sha256(bytes)}` },
        directory,
        ['publish.json'],
      );
      assert.equal(
        await readFile(path.join(directory, 'publish.json'), 'utf8'),
        '{"schemaVersion":1}',
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('archive hash가 변조됐으면 파일을 저장하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      const bytes = await zipBytes([['publish.json', Buffer.from('{}')]]);
      await assert.rejects(
        unpackArtifact(
          bytes,
          { digest: `sha256:${'a'.repeat(64)}` },
          path.join(fixture.directory, 'download'),
          ['publish.json'],
        ),
        /artifact archive hash mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('archive에 예상하지 않은 실행 파일이 있으면 전체 후보를 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await repositoryFixture();
    try {
      const bytes = await zipBytes([
        ['publish.json', Buffer.from('{}')],
        ['execute.mjs', Buffer.from('throw 1')],
      ]);
      await assert.rejects(
        unpackArtifact(
          bytes,
          { digest: `sha256:${sha256(bytes)}` },
          path.join(fixture.directory, 'download'),
          ['publish.json'],
        ),
        /unexpected artifact archive files/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
});

describe('제품별 기록 보존과 같은 후보의 부분 재시도', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('확장만 실패하면 다음 attempt에서 성공한 npm을 다시 게시하지 않고 확장만 재시도한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const calls = [];
      const snapshots = [];
      let failExtension = true;
      const adapters = Object.fromEntries(
        Object.keys(products).map(
          /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ (product) => [
            product,
            {
              /** fixture 게시 버전은 아직 없다. */ inspect: async () => null,
              /** 실패한 제품만 다음 실행에 다시 호출되는지 기록한다. */ publish:
                async (filename, artifact) => {
                  calls.push({
                    product,
                    filename,
                    hash: sha256(await readFile(filename)),
                  });
                  if (product === 'vscode' && failExtension)
                    throw new Error('fixture Marketplace failure');
                  assert.equal(
                    sha256(await readFile(filename)),
                    artifact.sha256,
                  );
                },
            },
          ],
        ),
      );
      const first = await publishProducts({
        directory: fixture.candidateDirectory,
        candidate: fixture.candidate,
        changed: ['npm', 'vscode'],
        publishRun: { runId: '100', runAttempt: '1' },
        adapters,
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ checkpoint: async (
          record,
        ) => {
          snapshots.push(record);
        },
      });
      assert.equal(first.products.npm.status, 'published');
      assert.equal(first.products.vscode.status, 'failed');
      failExtension = false;
      const second = await publishProducts({
        directory: fixture.candidateDirectory,
        candidate: fixture.candidate,
        changed: ['npm', 'vscode'],
        publishRun: { runId: '100', runAttempt: '2' },
        history: [first],
        adapters,
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ checkpoint: async (
          record,
        ) => {
          snapshots.push(record);
        },
      });
      assert.deepEqual(
        calls.map((call) => call.product),
        ['npm', 'vscode', 'vscode'],
      );
      assert.equal(second.products.npm.status, 'published');
      assert.equal(second.products.vscode.status, 'published');
      assert.equal(snapshots[0].products.npm.status, 'pending');
      assert.equal(snapshots[0].products.vscode.status, 'pending');
      assert.deepEqual(second.changedProducts, ['npm', 'vscode']);
    } finally {
      await fixture.dispose();
    }
  });
  test('npm 게시 뒤 main이 바뀌면 확장을 게시하지 않고 npm 성공 기록을 보존한다', /** 제품 사이 원격 소스가 바뀌면 나머지 게시를 중단한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const calls = [];
      let checks = 0;
      const adapters = Object.fromEntries(
        Object.keys(products).map(
          /** 제품마다 독립 게시 관측 어댑터를 만든다. */ (product) => [
            product,
            {
              /** 아직 게시하지 않은 버전만 반환한다. */ inspect: async () =>
                null,
              /** fixture 제품 게시 요청을 기록한다. */ publish: async () => {
                calls.push(product);
              },
            },
          ],
        ),
      );
      const record = await publishProducts({
        directory: fixture.candidateDirectory,
        candidate: fixture.candidate,
        changed: ['npm', 'vscode'],
        publishRun: { runId: '100', runAttempt: '1' },
        adapters,
        /** 내구 기록 저장 성공을 관측한다. */ checkpoint: async () => {},
        /** 첫 제품 완료 이후의 원격 이동을 재현한다. */ assertFresh:
          async () => {
            checks++;
            if (checks >= 3) throw new Error('main moved before publication');
          },
      });
      assert.deepEqual(calls, ['npm']);
      assert.equal(record.products.npm.status, 'published');
      assert.equal(record.products.vscode.status, 'failed');
      assert.match(
        record.products.vscode.error,
        /main moved before publication/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
  test('게시 직후 기록 저장이 중단되면 공개 바이트를 확인하여 같은 제품을 중복 게시하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      let existing = null;
      let count = 0;
      let saved;
      const adapters = {
        npm: {
          /** 중단 직전 공개된 실제 fixture hash를 반환한다. */ inspect:
            async () => existing,
          /** 게시 성공을 기록하되 checkpoint가 이후 중단된다. */ publish:
            async (filename, artifact) => {
              count++;
              existing = { sha256: artifact.sha256 };
            },
        },
      };
      await assert.rejects(
        publishProducts({
          directory: fixture.candidateDirectory,
          candidate: fixture.candidate,
          changed: ['npm'],
          publishRun: { runId: '100', runAttempt: '1' },
          adapters,
          /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ checkpoint:
            async (record) => {
              if (record.products.npm.status === 'published')
                throw new Error(
                  'fixture interrupted before durable checkpoint',
                );
              saved = record;
            },
        }),
        /fixture interrupted before durable checkpoint/u,
      );
      assert.equal(saved.products.npm.status, 'pending');
      const resumed = await publishProducts({
        directory: fixture.candidateDirectory,
        candidate: fixture.candidate,
        changed: ['npm'],
        publishRun: { runId: '101', runAttempt: '1' },
        history: [saved],
        adapters,
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ checkpoint:
          async () => {},
      });
      assert.equal(count, 1);
      assert.equal(resumed.products.npm.status, 'published');
      assert.equal(resumed.products.vscode.status, 'unchanged');
    } finally {
      await fixture.dispose();
    }
  });
  test('같은 버전에 다른 공개 바이트가 있으면 충돌을 기록하고 다시 게시하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      let called = false;
      const record = await publishProducts({
        directory: fixture.candidateDirectory,
        candidate: fixture.candidate,
        changed: ['npm'],
        publishRun: { runId: '100', runAttempt: '1' },
        adapters: {
          npm: {
            /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ inspect:
              async () => ({ sha256: 'b'.repeat(64) }),
            /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ publish:
              async () => {
                called = true;
              },
          },
        },
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ checkpoint:
          async () => {},
      });
      assert.equal(called, false);
      assert.equal(record.products.npm.status, 'failed');
      assert.match(record.products.npm.error, /published version conflicts/u);
    } finally {
      await fixture.dispose();
    }
  });
  test('게시할 제품이 없으면 두 대상 모두 unchanged로 기록하고 어댑터를 호출하지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const record = await publishProducts({
        directory: fixture.candidateDirectory,
        candidate: fixture.candidate,
        changed: [],
        publishRun: { runId: '100', runAttempt: '1' },
        adapters: {},
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ checkpoint:
          async () => {},
      });
      assert.equal(record.products.npm.status, 'unchanged');
      assert.equal(record.products.vscode.status, 'unchanged');
    } finally {
      await fixture.dispose();
    }
  });
  test('역순 실패 기록이 뒤에 도착해도 이전 published 제품 상태를 보존한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const published = publicationRecord(fixture.candidate, ['npm'], {
        runId: '100',
        runAttempt: '1',
      });
      published.products.npm.status = 'published';
      const failed = publicationRecord(fixture.candidate, ['npm'], {
        runId: '101',
        runAttempt: '1',
      });
      failed.products.npm.status = 'failed';
      const next = publicationRecord(
        fixture.candidate,
        ['npm'],
        { runId: '102', runAttempt: '1' },
        [failed, published],
      );
      assert.equal(next.products.npm.status, 'published');
      assert.equal(next.products.vscode.status, 'unchanged');
    } finally {
      await fixture.dispose();
    }
  });
  test('같은 attempt 결과를 다시 쓰려 하거나 미래 기록을 읽으면 stale 게시 실행을 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const history = publicationRecord(fixture.candidate, ['npm'], {
        runId: '100',
        runAttempt: '2',
      });
      assert.throws(
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () =>
          publicationRecord(
            fixture.candidate,
            ['npm'],
            { runId: '100', runAttempt: '2' },
            [history],
          ),
        /duplicate or stale publish attempt/u,
      );
      assert.throws(
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () =>
          publicationRecord(
            fixture.candidate,
            ['npm'],
            { runId: '99', runAttempt: '1' },
            [history],
          ),
        /future publish state/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
});

for (const outcome of ['failure', 'cancelled', 'skipped', 'missing'])
  test(`관리 job ${outcome}을 성공 report로 위조해도 게시 입력은 거부한다`, /** OS 통과만으로 게시 guard를 넘을 수 없다. */ async () => {
    const fixture = await publicationFixture();
    try {
      const input = validationInput(fixture);
      const report = structuredClone(input.report);
      if (outcome === 'missing') delete report.jobs['release-management'];
      else report.jobs['release-management'].result = outcome;
      await assert.rejects(
        validatePublication({ ...input, report }),
        /required job set mismatch|report result mismatch/u,
      );
    } finally {
      await fixture.dispose();
    }
  });
