import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createGitFixtureEnvironment } from '../test/git-config.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, describe } from 'node:test';
import {
  treeFiles,
  syncBranch,
  releaseBranch,
  assertPreparation,
} from './release-flow.mjs';
import { consumedChangesets, buildSync, publishSync } from './release-sync.mjs';
import {
  repositoryFixture,
  git,
  changeset,
  commit,
  versionedFixture,
  fixtureEnv,
} from './release-fixture.mjs';

/** 계산된 버전과 실제 Git 병합 방식별로 이미 게시할 main 및 동시 추가 develop을 만든다. */
async function releasedFixture(mode) {
  const fixture = await repositoryFixture();
  await changeset(fixture.cwd, 'a');
  await changeset(fixture.cwd, 'b');
  const source = commit(fixture.cwd, 'unreleased records');
  git(fixture.cwd, ['checkout', '-b', releaseBranch]);
  await versionedFixture(fixture.cwd);
  let releaseSha = commit(fixture.cwd, 'official versions');
  if (mode === 'rebase') {
    git(
      fixture.cwd,
      ['rebase', '--force-rebase', '--onto', 'main', fixture.base],
      { env: { ...fixtureEnv, GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z' } },
    );
    releaseSha = git(fixture.cwd, ['rev-parse', 'HEAD']);
    git(fixture.cwd, ['checkout', 'main']);
    git(fixture.cwd, ['merge', '--ff-only', releaseBranch], {
      env: fixtureEnv,
    });
  } else {
    git(fixture.cwd, ['checkout', 'main']);
    git(
      fixture.cwd,
      [
        'merge',
        mode === 'squash' ? '--squash' : '--no-ff',
        releaseBranch,
        '--no-edit',
      ],
      { env: fixtureEnv },
    );
    if (mode === 'squash') commit(fixture.cwd, 'squashed release');
  }
  const mainSha = git(fixture.cwd, ['rev-parse', 'main']);
  git(fixture.cwd, ['checkout', 'develop']);
  await changeset(fixture.cwd, 'f');
  await writeFile(
    path.join(fixture.cwd, 'next-release.mjs'),
    'export const next = true;\n',
  );
  const developSha = commit(fixture.cwd, 'new f arrives before sync');
  git(fixture.cwd, ['push', 'origin', 'main', 'develop'], { env: fixtureEnv });
  return { ...fixture, source, releaseSha, mainSha, developSha };
}

describe('정확한 기록 소비와 main 동기화', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('호출자의 Git identity 없이도 자체 sync는 fixture identity로 commit하고 동시 입력을 보존한다', /** 자체 판단의 입력과 고유 결과를 확인한다. */ async () => {
    const fixture = await releasedFixture('squash');
    try {
      const env = createGitFixtureEnvironment();
      for (const key of Object.keys(env))
        if (
          /^GIT_(AUTHOR|COMMITTER)_/u.test(key) ||
          /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/u.test(key) ||
          key === 'EMAIL'
        )
          delete env[key];
      Object.assign(env, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'user.useConfigOnly',
        GIT_CONFIG_VALUE_0: 'true',
      });
      const candidate = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            `import {readFileSync} from 'node:fs'; import {buildSync} from ${JSON.stringify(new URL('./release-sync.mjs', import.meta.url).href)}; process.stdout.write(JSON.stringify(buildSync(JSON.parse(readFileSync(0, 'utf8')))));`,
          ],
          {
            cwd: fixture.cwd,
            env,
            encoding: 'utf8',
            input: JSON.stringify({
              cwd: fixture.cwd,
              mainSha: fixture.mainSha,
              releaseSha: fixture.releaseSha,
              developSha: fixture.developSha,
            }),
          },
        ),
      );
      assert.equal(
        git(fixture.cwd, [
          'show',
          '-s',
          '--format=%an <%ae>|%cn <%ce>',
          candidate.head,
        ]),
        'Fixture <fixture@example.invalid>|Fixture <fixture@example.invalid>',
      );
      assert.match(
        git(fixture.cwd, ['show', `${candidate.head}:.changeset/f.md`]),
        /변경 f/u,
      );
      assert.equal(
        git(fixture.cwd, ['show', `${candidate.head}:next-release.mjs`]),
        'export const next = true;',
      );
    } finally {
      await fixture.dispose();
    }
  });
  for (const mode of ['merge', 'squash', 'rebase'])
    test(`${mode} 릴리스 후 동시 추가 f를 동기화하면 f·새 코드가 보존되고 소비한 a·b는 다시 나타나지 않는다`, /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
      const fixture = await releasedFixture(mode);
      try {
        const before = treeFiles(fixture.cwd, fixture.developSha);
        const candidate = buildSync({ ...fixture });
        const after = treeFiles(fixture.cwd, candidate.head);
        assert.deepEqual(
          candidate.consumed.map((entry) => entry.file),
          ['.changeset/a.md', '.changeset/b.md'],
        );
        assert.ok(
          !after.some((entry) =>
            ['.changeset/a.md', '.changeset/b.md'].includes(entry.file),
          ),
        );
        for (const file of ['.changeset/f.md', 'next-release.mjs'])
          assert.deepEqual(
            after.find((entry) => entry.file === file),
            before.find((entry) => entry.file === file),
          );
        assert.equal(
          JSON.parse(
            git(fixture.cwd, [
              'show',
              `${candidate.head}:packages/mcp/package.json`,
            ]),
          ).version,
          '1.2.4',
        );
        assert.equal(git(fixture.cwd, ['rev-parse', 'main']), fixture.mainSha);
        assert.equal(
          git(fixture.cwd, ['rev-parse', 'develop']),
          fixture.developSha,
        );
      } finally {
        await fixture.dispose();
      }
    });
  test('소비 기록 a가 develop에서 수정됐으면 삭제하지 않고 명시적 충돌로 거부한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await releasedFixture('squash');
    try {
      await writeFile(
        path.join(fixture.cwd, '.changeset/a.md'),
        'edited consumed record\n',
      );
      const developSha = commit(fixture.cwd, 'edited a');
      assert.throws(
        () => consumedChangesets(fixture.cwd, fixture.releaseSha, developSha),
        /modified consumed Changeset: \.changeset\/a.md/u,
      );
      assert.equal(git(fixture.cwd, ['rev-parse', 'HEAD']), developSha);
      assert.equal(
        git(fixture.cwd, ['show', `${developSha}:.changeset/a.md`]),
        'edited consumed record',
      );
      assert.equal(git(fixture.cwd, ['status', '--porcelain']), '');
    } finally {
      await fixture.dispose();
    }
  });
  test('sync PR도 squash로 병합하면 소스가 동기화된 develop에서 다음 준비를 허용한다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await releasedFixture('squash');
    try {
      const candidate = buildSync({ ...fixture });
      git(fixture.cwd, ['checkout', 'develop']);
      git(fixture.cwd, ['merge', '--squash', candidate.head], {
        env: fixtureEnv,
      });
      const developSha = commit(fixture.cwd, 'squashed sync PR');
      assert.equal(
        assertPreparation({
          cwd: fixture.cwd,
          eventSha: developSha,
          developSha,
          mainSha: fixture.mainSha,
          changesetStatus: { releases: [{ name: '@codocs/mcp' }] },
        }),
        true,
      );
      const next = buildSync({
        cwd: fixture.cwd,
        mainSha: fixture.mainSha,
        releaseSha: fixture.releaseSha,
        developSha,
        previousSyncSha: candidate.head,
      });
      assert.equal(next.changed, false);
    } finally {
      await fixture.dispose();
    }
  });
});

describe('동기화 쓰기의 중복·경합·오래된 실행 차단', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ () => {
  test('같은 main 동기화를 반복하면 기존 sync PR 하나만 갱신하고 보호 브랜치를 쓰지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const fixture = await releasedFixture('merge');
    try {
      const candidate = buildSync({ ...fixture });
      let syncSha = null;
      let pull = null;
      const calls = [];
      /** fixture API에서 현재 ref와 단일 PR을 읽고 요청을 기록한다. */
      async function api(method, endpoint, body) {
        calls.push({ method, endpoint, body });
        if (endpoint.includes('/git/ref/heads/main'))
          return { object: { sha: fixture.mainSha } };
        if (endpoint.includes('/git/ref/heads/develop'))
          return { object: { sha: fixture.developSha } };
        if (endpoint.includes('/git/matching-refs/'))
          return syncSha ? [{ object: { sha: syncSha } }] : [];
        if (method === 'GET' && endpoint.includes('/pulls?'))
          return pull ? [pull] : [];
        if (method === 'POST') {
          pull = { number: 36, ...body };
          return pull;
        }
        return { ...pull, ...body };
      }
      /** 실제 bare 원격에는 sync ref 하나만 fast-forward한다. */
      async function push(cwd, head, branch) {
        assert.equal(branch, syncBranch);
        git(cwd, ['push', 'origin', `${head}:refs/heads/${branch}`], {
          env: fixtureEnv,
        });
        syncSha = head;
      }
      await publishSync({
        cwd: fixture.cwd,
        api,
        repository: 'Fixture/release',
        candidate,
        expectedSyncSha: null,
        push,
      });
      const second = await publishSync({
        cwd: fixture.cwd,
        api,
        repository: 'Fixture/release',
        candidate,
        expectedSyncSha: candidate.head,
        push,
      });
      assert.equal(second.number, 36);
      assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
      assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
      assert.equal(git(fixture.remote, ['rev-parse', 'main']), fixture.mainSha);
      assert.equal(
        git(fixture.remote, ['rev-parse', 'develop']),
        fixture.developSha,
      );
    } finally {
      await fixture.dispose();
    }
  });
  for (const branch of ['main', 'develop'])
    test(`${branch}가 후보 이후 바뀌면 원격 push 전에 오래된 sync 실행을 거부한다`, /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
      const candidate = {
        mainSha: 'a'.repeat(40),
        developSha: 'b'.repeat(40),
        head: 'c'.repeat(40),
        changed: true,
      };
      let pushed = false;
      await assert.rejects(
        publishSync({
          cwd: '.',
          repository: 'Fixture/release',
          candidate,
          expectedSyncSha: null,
          /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ api: async (
            method,
            endpoint,
          ) => ({
            object: {
              sha: endpoint.endsWith(`/${branch}`)
                ? 'd'.repeat(40)
                : endpoint.endsWith('/main')
                  ? candidate.mainSha
                  : candidate.developSha,
            },
          }),
          /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ push: async () => {
            pushed = true;
          },
        }),
        new RegExp(`stale sync ${branch}`, 'u'),
      );
      assert.equal(pushed, false);
    });
  test('다른 실행이 sync ref를 갱신했으면 이전 예상 SHA로 새 결과를 덮어쓰지 않는다', /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ async () => {
    const candidate = {
      mainSha: 'a'.repeat(40),
      developSha: 'b'.repeat(40),
      head: 'c'.repeat(40),
      changed: true,
    };
    let pushed = false;
    await assert.rejects(
      publishSync({
        cwd: '.',
        repository: 'Fixture/release',
        candidate,
        expectedSyncSha: null,
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ api: async (
          method,
          endpoint,
        ) =>
          endpoint.includes('/matching-refs/')
            ? [{ object: { sha: 'd'.repeat(40) } }]
            : {
                object: {
                  sha: endpoint.includes('/main')
                    ? candidate.mainSha
                    : candidate.developSha,
                },
              },
        /** 입력 조건과 관찰 결과를 인접 계약에 대조한다. */ push: async () => {
          pushed = true;
        },
      }),
      /concurrent sync update/u,
    );
    assert.equal(pushed, false);
  });
});
