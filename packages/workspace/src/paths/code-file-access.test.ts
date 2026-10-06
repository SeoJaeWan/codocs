import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ioFailures, simulatedFileLinks } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  codeCollectionStatuses,
  codeFileReasons,
  codeRepositoryKinds,
} from '../code-reference/domain-values.js';
import {
  applyCodeSignals,
  codeFileFailures,
  codeFileStatus,
  codeWatchRuleKey,
  computeCodeFilePolicy,
  discoverCodeFileState,
  diffCodeWatchRules,
  discoverCodeFiles,
  isCodeWatchIgnored,
  readEligibleCodeFile,
  type CodeFileState,
} from './code-file-access.js';
const execute = promisify(execFile);
let project: string;
beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/fixtures/code-access-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(project));
});
afterEach(async () => {
  ioFailures.clear();
  simulatedFileLinks.clear();
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
});

describe('discoverCodeFiles: 프로젝트 코드 읽기 적격성', () => {
  it('저장·이름 변경이 남기는 .codocs-write 임시 파일은 새 원문을 담고 있어도 수집하지 않는다', async () => {
    await mkdir(path.join(project, 'src'));
    await writeFile(path.join(project, 'src', 'a.ts'), '@codocs [[대상]]');
    await writeFile(
      path.join(project, 'src', '.codocs-write-1234-abcd.tmp'),
      '@codocs [[대상]]',
    );
    const result = await discoverCodeFiles(project);

    expect(result.files.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(
      await readEligibleCodeFile(
        result.policy,
        'src/.codocs-write-1234-abcd.tmp',
      ),
    ).toBeUndefined();
  });

  it('알 수 없는 확장자와 확장자 없는 UTF-8 파일이면 모두 수집한다', async () => {
    await writeFile(path.join(project, 'memo'), '@codocs [[대상]]');
    await writeFile(path.join(project, 'code.weird'), '@codocs [[대상]]');
    const result = await discoverCodeFiles(project);
    expect(result.status).toBe(codeCollectionStatuses.complete);
    expect(result.files.map((file) => file.path)).toEqual([
      'code.weird',
      'memo',
    ]);
  });
  it('Git 추적 파일이 ignore와 일치하면 수집한다', async () => {
    await execute('git', ['init', project]);
    await writeFile(path.join(project, 'tracked'), '@codocs [[대상]]');
    await execute('git', ['-C', project, 'add', 'tracked']);
    await writeFile(path.join(project, '.gitignore'), 'tracked\nuntracked\n');
    await writeFile(path.join(project, 'untracked'), '@codocs [[대상]]');
    const result = await discoverCodeFiles(project);
    expect(result.policy.repositoryKind).toBe(codeRepositoryKinds.git);
    expect(result.files.map((file) => file.path)).toContain('tracked');
    expect(result.files.map((file) => file.path)).not.toContain('untracked');
  });
  it('Git 추적을 해제하면 ignore 파일의 출현을 제거한다', async () => {
    await execute('git', ['init', project]);
    await writeFile(path.join(project, 'tracked'), '@codocs [[대상]]');
    await execute('git', ['-C', project, 'add', 'tracked']);
    await writeFile(path.join(project, '.gitignore'), 'tracked\n');
    await execute('git', ['-C', project, 'rm', '--cached', 'tracked']);
    expect(
      (await discoverCodeFiles(project)).files.map((file) => file.path),
    ).not.toContain('tracked');
  });
  it('하위 ignore와 재포함 규칙이 있으면 해당 프로젝트 규칙만 적용한다', async () => {
    await mkdir(path.join(project, 'child'));
    await writeFile(path.join(project, '.gitignore'), '*.hidden\n');
    await writeFile(
      path.join(project, 'child', '.gitignore'),
      '!keep.hidden\nremove.txt\n',
    );
    await writeFile(path.join(project, 'child', 'keep.hidden'), 'yes');
    await writeFile(path.join(project, 'child', 'drop.hidden'), 'no');
    await writeFile(path.join(project, 'child', 'remove.txt'), 'no');
    const result = await discoverCodeFiles(project);
    expect(result.files.map((file) => file.path)).toContain(
      'child/keep.hidden',
    );
    expect(result.files.map((file) => file.path)).not.toContain(
      'child/drop.hidden',
    );
    expect(result.files.map((file) => file.path)).not.toContain(
      'child/remove.txt',
    );
  });
  it('부모 폴더가 제외되면 하위 파일 재포함만으로 경계를 되살리지 않는다', async () => {
    await mkdir(path.join(project, 'ignored'));
    await writeFile(
      path.join(project, '.gitignore'),
      'ignored/\n!ignored/keep\n',
    );
    await writeFile(path.join(project, 'ignored', 'keep'), 'no');
    expect(
      (await discoverCodeFiles(project)).files.map((file) => file.path),
    ).not.toContain('ignored/keep');
  });
  it('부모 폴더도 재포함하면 하위 파일을 수집한다', async () => {
    await mkdir(path.join(project, 'ignored'));
    await writeFile(
      path.join(project, '.gitignore'),
      'ignored/\n!ignored/\nignored/*\n!ignored/keep\n',
    );
    await writeFile(path.join(project, 'ignored', 'keep'), 'yes');
    expect(
      (await discoverCodeFiles(project)).files.map((file) => file.path),
    ).toContain('ignored/keep');
  });
  it('비 Git 프로젝트이면 프로젝트 ignore를 적용한 미추적 파일로 처리한다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'excluded\n');
    await writeFile(path.join(project, 'excluded'), 'no');
    await mkdir(path.join(project, 'node_modules'));
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'node_modules', 'yes'), 'yes');
    await writeFile(path.join(project, 'dist', 'yes'), 'yes');
    const result = await discoverCodeFiles(project);
    // fixture는 상위 저장소 안에 있지만 명시 GIT_CEILING_DIRECTORIES로 독립 비 Git을 재현한다.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(project));
    const isolated = await discoverCodeFiles(project);
    expect(isolated.policy.repositoryKind).toBe(codeRepositoryKinds.nonGit);
    expect(result.files.map((file) => file.path)).not.toContain('excluded');
    expect(isolated.files.map((file) => file.path)).toContain(
      'node_modules/yes',
    );
    expect(isolated.files.map((file) => file.path)).toContain('dist/yes');
  });
  it('프로젝트 gitignore를 수정하면 적격 파일 집합이 바뀐다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'code\n');
    await writeFile(path.join(project, 'code'), 'yes');
    const before = await discoverCodeFiles(project);
    await writeFile(path.join(project, '.gitignore'), '');
    expect(before.files.map((file) => file.path)).not.toContain('code');
    expect(
      (await discoverCodeFiles(project)).files.map((file) => file.path),
    ).toContain('code');
  });
  it('글로벌 excludes와 Git info exclude만 일치하면 파일을 수집한다', async () => {
    await execute('git', ['init', project]);
    await writeFile(path.join(project, 'global-ignore'), 'hidden\n');
    await execute('git', [
      '-C',
      project,
      'config',
      'core.excludesFile',
      path.join(project, 'global-ignore'),
    ]);
    await writeFile(path.join(project, '.git', 'info', 'exclude'), 'hidden\n');
    await writeFile(path.join(project, 'hidden'), 'yes');
    expect(
      (await discoverCodeFiles(project)).files.map((file) => file.path),
    ).toContain('hidden');
  });
  it('NUL 및 UTF-16 디스크 바이트면 텍스트로 수집하지 않는다', async () => {
    await writeFile(path.join(project, 'binary'), Buffer.from([65, 0, 66]));
    await writeFile(
      path.join(project, 'utf16'),
      Buffer.from('@codocs [[대상]]', 'utf16le'),
    );
    await writeFile(
      path.join(project, 'invalid-utf8'),
      Buffer.from([0xff, 0xfe]),
    );
    const result = await discoverCodeFiles(project);
    expect(result.status).toBe(codeCollectionStatuses.complete);
    expect(result.files).toEqual([]);
  });
  it('파일·폴더 연결과 .git 내부 및 프로젝트 밖이면 읽지 않는다', async () => {
    await mkdir(path.join(project, '.git'));
    await writeFile(path.join(project, '.git', 'secret'), 'no');
    await writeFile(path.join(project, 'real'), 'yes');
    // 파일 링크 거부 계약은 링크 생성 권한 없이 lstat 연결 응답 주입으로 확인한다.
    await writeFile(
      path.join(project, 'link'),
      '파일 연결을 대신하는 열거 항목',
    );
    simulatedFileLinks.add(path.join(project, 'link'));
    await symlink(
      path.dirname(project),
      path.join(project, 'folder'),
      'junction',
    );
    const result = await discoverCodeFiles(project);
    expect(result.files.map((file) => file.path)).toEqual(['real']);
    expect(
      await readEligibleCodeFile(result.policy, '../outside'),
    ).toBeUndefined();
    expect(await readEligibleCodeFile(result.policy, 'link')).toBeUndefined();
    expect(
      await readEligibleCodeFile(result.policy, 'folder/other'),
    ).toBeUndefined();
  });
  it('Git 실행 전제를 확인하지 못하면 비 Git이나 complete-empty로 반환하지 않는다', async () => {
    await writeFile(path.join(project, 'code'), 'yes');
    vi.stubEnv('PATH', '');
    const result = await discoverCodeFiles(project);
    expect(result.status).toBe(codeCollectionStatuses.incomplete);
    expect(result.policy.repositoryKind).toBe(codeRepositoryKinds.unknown);
    expect(result.failures[0]?.reason).toBe(codeFileReasons.git);
  });
  it('동일 원문의 메타데이터가 그대로이면 cache 관측을 재사용한다', async () => {
    await writeFile(path.join(project, 'code'), 'yes');
    const first = await discoverCodeFiles(project);
    const second = await discoverCodeFiles(
      project,
      new Map(first.files.map((file) => [file.path, file])),
    );
    expect(second.files[0]).toBe(first.files[0]);
  });
});

describe('readEligibleCodeFile: 경로 성분의 실제 경계', () => {
  it('절대 경로에 link 뒤 부모 이동이 있으면 정규화 전에 거부한다', async () => {
    await writeFile(path.join(project, 'real'), 'yes');
    await symlink(
      path.dirname(project),
      path.join(project, 'link'),
      'junction',
    );
    const discovery = await discoverCodeFiles(project);
    expect(
      await readEligibleCodeFile(discovery.policy, project + '/link/../real'),
    ).toBeUndefined();
  });
});

describe('discoverCodeFiles: 프로젝트 root 전제', () => {
  it('프로젝트 root가 디렉터리 링크이면 완료된 빈 집합으로 게시하지 않는다', async () => {
    const linked = path.join(project, 'linked-root');
    await symlink(project, linked, 'junction');
    const result = await discoverCodeFiles(linked);
    expect(result.status).toBe(codeCollectionStatuses.incomplete);
    expect(result.files).toEqual([]);
    expect(
      result.failures.some(
        (failure) => failure.reason === codeFileReasons.boundary,
      ),
    ).toBe(true);
  });
});

describe('computeCodeFilePolicy: 파일을 읽지 않는 정책 계산', () => {
  it('추적 파일이 있으면 모든 상위 디렉터리를 미리 계산한 집합에 담는다', async () => {
    await execute('git', ['init', project]);
    await mkdir(path.join(project, 'a', 'b'), { recursive: true });
    await writeFile(path.join(project, 'a', 'b', 'file'), 'text');
    await writeFile(path.join(project, 'top'), 'text');
    await execute('git', ['-C', project, 'add', '.']);
    const { policy } = await computeCodeFilePolicy(project);
    expect([...policy.trackedDirectories].sort()).toEqual(['a', 'a/b']);
  });
  it('정책만 계산하면 원문을 읽지 않고 읽기 후보 경로만 제공한다', async () => {
    await writeFile(path.join(project, 'source'), 'text');
    ioFailures.set(path.join(project, 'source'), {
      operations: ['readFile', 'lstat'],
      code: 'EACCES',
    });
    const result = await computeCodeFilePolicy(project);
    expect(result.candidates).toEqual(['source']);
    expect(result.failures).toEqual([]);
  });
});

describe('isCodeWatchIgnored: 수집과 같은 감시 대상 판단', () => {
  const file = { isDirectory: () => false };
  const directory = { isDirectory: () => true };
  it('미추적 ignore 파일이면 감시하지 않는다', async () => {
    await writeFile(path.join(project, '.gitignore'), '*.log\n');
    const { policy } = await computeCodeFilePolicy(project);
    expect(isCodeWatchIgnored(policy, path.join(project, 'a.log'), file)).toBe(
      true,
    );
  });
  it('추적 파일이 없는 ignore 폴더이면 감시하지 않는다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    const { policy } = await computeCodeFilePolicy(project);
    expect(
      isCodeWatchIgnored(policy, path.join(project, 'dist'), directory),
    ).toBe(true);
  });
  it('추적 파일이 있는 ignore 폴더이면 감시한다', async () => {
    await execute('git', ['init', project]);
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'keep'), 'text');
    await execute('git', ['-C', project, 'add', '-f', 'dist/keep']);
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    const { policy } = await computeCodeFilePolicy(project);
    expect(
      isCodeWatchIgnored(policy, path.join(project, 'dist'), directory),
    ).toBe(false);
    expect(
      isCodeWatchIgnored(policy, path.join(project, 'dist', 'keep'), file),
    ).toBe(false);
  });
  it('제외한 폴더 안의 미추적 파일이면 감시하지 않는다', async () => {
    await execute('git', ['init', project]);
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'keep'), 'text');
    await execute('git', ['-C', project, 'add', '-f', 'dist/keep']);
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    const { policy } = await computeCodeFilePolicy(project);
    expect(
      isCodeWatchIgnored(policy, path.join(project, 'dist', 'junk'), file),
    ).toBe(true);
  });
  it('.gitignore 파일이면 항상 감시한다', async () => {
    await writeFile(path.join(project, '.gitignore'), '.gitignore\n');
    const { policy } = await computeCodeFilePolicy(project);
    expect(
      isCodeWatchIgnored(policy, path.join(project, '.gitignore'), file),
    ).toBe(false);
  });
  it('폴더인지 파일인지 정해지지 않은 첫 호출이면 제외하지 않고 stats가 오면 폴더로 판단한다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    const { policy } = await computeCodeFilePolicy(project);
    const undecided = isCodeWatchIgnored(policy, path.join(project, 'dist'));
    const decided = isCodeWatchIgnored(
      policy,
      path.join(project, 'dist'),
      directory,
    );
    expect([undecided, decided]).toEqual([false, true]);
  });
});

/** 비교에 필요한 정책·관측·실패만 순서까지 포함해 값으로 만든다. */
function summarize(state: CodeFileState): unknown {
  return {
    kind: state.policy.repositoryKind,
    tracked: [...state.policy.tracked].sort(),
    trackedDirectories: [...state.policy.trackedDirectories].sort(),
    layers: state.policy.layers.map((layer) => [layer.directory, layer.text]),
    unknown: [...state.policy.unknownIgnoreDirectories].sort(),
    files: [...state.files].map(([key, file]) => [key, file.revision]),
    failures: codeFileFailures(state),
  };
}
/** 증분 결과가 같은 디스크 상태의 새 전체 탐색과 같은지 확인한다. */
async function expectSameAsFullDiscovery(
  state: CodeFileState,
  label: string,
): Promise<void> {
  expect(summarize(state), label).toEqual(
    summarize(await discoverCodeFileState(project)),
  );
}
const indexPath = (): string => path.join(project, '.git', 'index');
const gitIn = (...args: string[]): Promise<unknown> =>
  execute('git', ['-C', project, ...args]);

describe('applyCodeSignals: 경로 범위 증분 갱신은 전체 탐색과 같다', () => {
  it('.gitignore를 편집하면 그 폴더 이하의 적격성만 다시 확인해 전체 탐색과 같다', async () => {
    await mkdir(path.join(project, 'child', 'deep'), { recursive: true });
    await writeFile(path.join(project, 'child', 'a.txt'), 'a');
    await writeFile(path.join(project, 'child', 'deep', 'b.txt'), 'b');
    await writeFile(path.join(project, 'top.txt'), 't');
    const state = await discoverCodeFileState(project);
    await writeFile(
      path.join(project, 'child', '.gitignore'),
      'deep/\n*.txt\n',
    );
    const edited = await applyCodeSignals(state, [
      path.join(project, 'child', '.gitignore'),
    ]);
    expect([...edited.files.keys()]).toEqual(['child/.gitignore', 'top.txt']);
    await expectSameAsFullDiscovery(edited, '규칙 추가');
    await writeFile(path.join(project, 'child', '.gitignore'), '');
    const restored = await applyCodeSignals(edited, [
      path.join(project, 'child', '.gitignore'),
    ]);
    expect(restored.files.has('child/deep/b.txt')).toBe(true);
    await expectSameAsFullDiscovery(restored, '규칙 제거');
    await rm(path.join(project, 'child', '.gitignore'));
    await expectSameAsFullDiscovery(
      await applyCodeSignals(restored, [
        path.join(project, 'child', '.gitignore'),
      ]),
      '.gitignore 삭제',
    );
  });
  it('폴더를 만들면 그 하위만 탐색하고 삭제하면 그 경로 아래 관측을 제거한다', async () => {
    await writeFile(path.join(project, 'top.txt'), 't');
    const state = await discoverCodeFileState(project);
    await mkdir(path.join(project, 'made', 'inner'), { recursive: true });
    await writeFile(path.join(project, 'made', '.gitignore'), 'skip\n');
    await writeFile(path.join(project, 'made', 'skip'), 's');
    await writeFile(path.join(project, 'made', 'inner', 'c.txt'), 'c');
    const created = await applyCodeSignals(state, [path.join(project, 'made')]);
    expect([...created.files.keys()]).toEqual([
      'made/.gitignore',
      'made/inner/c.txt',
      'top.txt',
    ]);
    await expectSameAsFullDiscovery(created, '폴더 생성');
    await rm(path.join(project, 'made'), { recursive: true });
    const removed = await applyCodeSignals(created, [
      path.join(project, 'made'),
    ]);
    expect([...removed.files.keys()]).toEqual(['top.txt']);
    expect(removed.policy.layers).toEqual([]);
    await expectSameAsFullDiscovery(removed, '폴더 삭제');
  });
  it('git add와 git rm --cached 뒤 index 신호는 추적 차이만 반영해 전체 탐색과 같다', async () => {
    await execute('git', ['init', project]);
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, '.gitignore'), 'dist/\n*.log\n');
    await writeFile(path.join(project, 'dist', 'out.js'), 'o');
    await writeFile(path.join(project, 'dist', 'junk.js'), 'j');
    await writeFile(path.join(project, 'run.log'), 'l');
    let state = await discoverCodeFileState(project);
    expect([...state.files.keys()]).toEqual(['.gitignore']);
    await gitIn('add', '-f', 'dist/out.js', 'run.log');
    state = await applyCodeSignals(state, [indexPath()]);
    expect([...state.files.keys()]).toEqual([
      '.gitignore',
      'dist/out.js',
      'run.log',
    ]);
    await expectSameAsFullDiscovery(state, 'git add -f');
    await gitIn('rm', '--cached', '-q', 'dist/out.js');
    state = await applyCodeSignals(state, [indexPath()]);
    expect([...state.files.keys()]).toEqual(['.gitignore', 'run.log']);
    await expectSameAsFullDiscovery(state, 'git rm --cached');
  });
  it('추적 집합이 같은 index 신호는 같은 상태 객체를 돌려주고 이미 적격인 파일의 git add도 관측을 바꾸지 않는다', async () => {
    await execute('git', ['init', project]);
    await writeFile(path.join(project, 'plain'), 'p');
    const state = await discoverCodeFileState(project);
    expect(await applyCodeSignals(state, [indexPath()])).toBe(state);
    await gitIn('add', 'plain');
    const added = await applyCodeSignals(state, [indexPath()]);
    expect(added.files.get('plain')).toBe(state.files.get('plain'));
    expect(added.policy.tracked.has('plain')).toBe(true);
    await expectSameAsFullDiscovery(added, '적격 파일의 git add');
  });
  it('ignore 규칙을 읽지 못한 범위에 파일이 생겨도 미추적 출현을 수집하지 않고 실패로 남긴다', async () => {
    await mkdir(path.join(project, 'scope'));
    await writeFile(path.join(project, 'scope', '.gitignore'), 'x\n');
    ioFailures.set(path.join(project, 'scope', '.gitignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const state = await discoverCodeFileState(project);
    await writeFile(path.join(project, 'scope', 'late'), 'late');
    const next = await applyCodeSignals(state, [
      path.join(project, 'scope', 'late'),
    ]);
    expect(next.files.has('scope/late')).toBe(false);
    expect(codeFileFailures(next).map((failure) => failure.path)).toContain(
      'scope/late',
    );
    await expectSameAsFullDiscovery(next, '미확인 ignore 범위');
  });
  it('파일 변경·삭제·같은 내용 저장은 그 경로만 갱신하고 같은 내용이면 관측 결과가 같다', async () => {
    await writeFile(path.join(project, 'a'), 'one');
    await writeFile(path.join(project, 'b'), 'two');
    const state = await discoverCodeFileState(project);
    await writeFile(path.join(project, 'a'), 'one');
    const same = await applyCodeSignals(state, [path.join(project, 'a')]);
    expect(same.files.get('a')?.revision).toBe(state.files.get('a')?.revision);
    expect(same.files.get('b')).toBe(state.files.get('b'));
    await writeFile(path.join(project, 'a'), 'changed');
    await rm(path.join(project, 'b'));
    const changed = await applyCodeSignals(same, [
      path.join(project, 'a'),
      path.join(project, 'b'),
    ]);
    expect([...changed.files.keys()]).toEqual(['a']);
    await expectSameAsFullDiscovery(changed, '변경과 삭제');
  });
  it.each([20261001, 7, 1234567])(
    '무작위 변경 순서를 반복해도 매 단계의 증분 결과가 전체 탐색과 같다 (seed %i)',
    async (initialSeed) => {
      await execute('git', ['init', project]);
      /** 재현 가능한 의사 난수다. */
      let seed = initialSeed;
      const random = (limit: number): number => {
        seed = (seed + 0x6d2b79f5) | 0;
        let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return Math.floor(
          (((value ^ (value >>> 14)) >>> 0) / 4294967296) * limit,
        );
      };
      const pick = <T>(items: readonly T[]): T => items[random(items.length)]!;
      const directories = ['', 'a', 'b', 'a/c', 'b/c'];
      const names = ['f1', 'f2', 'x.log', 'keep.log', '.gitignore'];
      const contents = ['', 'y', '@codocs [[x]]', '@codocs [[x]]\nz'];
      const patterns = ['a/', '*.log', '!keep.log', 'b', 'f1', 'c/', ''];
      const exists = new Set<string>();
      let state = await discoverCodeFileState(project);
      const trail: string[] = [];
      let compared = 0;
      for (let step = 0; step < 40; step++) {
        const signals: string[] = [];
        const operation = random(7);
        const directory = pick(directories);
        const file = path.posix.join(directory, pick(names));
        const absolute = path.join(project, ...file.split('/'));
        if (operation <= 1) {
          await mkdir(path.dirname(absolute), { recursive: true });
          const text =
            path.posix.basename(file) === '.gitignore'
              ? pick(patterns) + '\n' + pick(patterns) + '\n'
              : pick(contents);
          await writeFile(absolute, text);
          exists.add(file);
          trail.push(`write ${file}`);
          signals.push(path.dirname(absolute), absolute);
        } else if (operation === 2 && exists.size) {
          const target = pick([...exists]);
          await rm(path.join(project, ...target.split('/')), { force: true });
          exists.delete(target);
          trail.push(`rm ${target}`);
          signals.push(path.join(project, ...target.split('/')));
        } else if (operation === 3 && directory) {
          await rm(path.join(project, ...directory.split('/')), {
            recursive: true,
            force: true,
          });
          for (const item of [...exists])
            if (item.startsWith(directory + '/')) exists.delete(item);
          trail.push(`rmdir ${directory}`);
          signals.push(path.join(project, ...directory.split('/')));
        } else if (operation === 4 && exists.size) {
          const target = pick([...exists]);
          await gitIn('add', '-f', '--', target).catch(() => undefined);
          trail.push(`add ${target}`);
          signals.push(indexPath());
        } else if (operation === 5) {
          const target = pick([...exists, 'none']);
          await gitIn('rm', '--cached', '-q', '--', target).catch(
            () => undefined,
          );
          trail.push(`rm-cached ${target}`);
          signals.push(indexPath());
        } else if (
          directory.includes('/') ||
          directory === 'a' ||
          directory === 'b'
        ) {
          const to = path.join(project, 'moved-' + step);
          const from = path.join(project, ...directory.split('/'));
          try {
            await rename(from, to);
            for (const item of [...exists])
              if (item.startsWith(directory + '/')) exists.delete(item);
            trail.push(`move ${directory}`);
            signals.push(from, to);
          } catch {
            // 존재하지 않는 폴더의 이동은 건너뛴다.
          }
        }
        if (!signals.length) continue;
        compared++;
        state = await applyCodeSignals(state, signals);
        await expectSameAsFullDiscovery(state, trail.join(' | '));
      }
      expect(compared).toBeGreaterThan(15);
    },
    120_000,
  );
});

describe('.codocsignore: 프로젝트 root 제외 규칙', () => {
  const file = { isDirectory: () => false };
  const directory = { isDirectory: () => true };
  /** Git 저장소에 파일을 만들어 추적 상태로 둔다. */
  async function trackFile(relative: string, text: string): Promise<void> {
    await mkdir(path.dirname(path.join(project, relative)), {
      recursive: true,
    });
    await writeFile(path.join(project, relative), text);
    await gitIn('add', '-f', relative);
  }
  it('제외 폴더에 추적 파일이 있어도 하위 파일을 수집하지 않고 완료로 남긴다', async () => {
    await execute('git', ['init', project]);
    await trackFile('docs/a.md', '@codocs [[대상]]');
    await trackFile('src/b.ts', '@codocs [[대상]]');
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    const result = await discoverCodeFiles(project);
    expect(result.status).toBe(codeCollectionStatuses.complete);
    expect(result.files.map((item) => item.path)).toEqual([
      '.codocsignore',
      'src/b.ts',
    ]);
  });
  it('추적 파일이 .gitignore의 재포함 규칙과 일치해도 .codocsignore가 제외한다', async () => {
    await execute('git', ['init', project]);
    await trackFile('keep.ts', '@codocs [[대상]]');
    await writeFile(path.join(project, '.gitignore'), '*.ts\n!keep.ts\n');
    await writeFile(path.join(project, '.codocsignore'), 'keep.ts\n');
    const result = await discoverCodeFiles(project);
    expect(result.files.map((item) => item.path)).not.toContain('keep.ts');
  });
  it('.codocsignore의 재포함 규칙은 .gitignore가 제외한 미추적 파일을 되살리지 않는다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'hidden.ts\n');
    await writeFile(
      path.join(project, '.codocsignore'),
      'other.ts\n!hidden.ts\n',
    );
    await writeFile(path.join(project, 'hidden.ts'), '@codocs [[대상]]');
    const result = await discoverCodeFiles(project);
    expect(result.files.map((item) => item.path)).not.toContain('hidden.ts');
  });
  it('.codocsignore 안에서 앞선 규칙을 되돌리면 그 파일은 다시 수집한다', async () => {
    await writeFile(path.join(project, '.codocsignore'), '*.ts\n!keep.ts\n');
    await writeFile(path.join(project, 'keep.ts'), '@codocs [[대상]]');
    await writeFile(path.join(project, 'drop.ts'), '@codocs [[대상]]');
    const result = await discoverCodeFiles(project);
    expect(result.files.map((item) => item.path)).toContain('keep.ts');
    expect(result.files.map((item) => item.path)).not.toContain('drop.ts');
  });
  it('제외한 폴더는 하위의 재포함 규칙으로 되살리지 않는다', async () => {
    await mkdir(path.join(project, 'docs'));
    await writeFile(path.join(project, 'docs', 'a.md'), '@codocs [[대상]]');
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n!docs/a.md\n');
    const result = await discoverCodeFiles(project);
    expect(result.files.map((item) => item.path)).not.toContain('docs/a.md');
  });
  it('하위 폴더의 .codocsignore는 규칙 파일로 읽지 않는다', async () => {
    await mkdir(path.join(project, 'sub'));
    await writeFile(path.join(project, 'sub', '.codocsignore'), '*\n');
    await writeFile(path.join(project, 'sub', 'a.ts'), '@codocs [[대상]]');
    const result = await discoverCodeFiles(project);
    expect(result.files.map((item) => item.path)).toContain('sub/a.ts');
  });
  it('.codocsignore가 일반 파일이 아니면 규칙이 없는 것으로 본다', async () => {
    await mkdir(path.join(project, '.codocsignore'));
    await writeFile(path.join(project, 'a.ts'), '@codocs [[대상]]');
    const result = await discoverCodeFiles(project);
    expect(result.status).toBe(codeCollectionStatuses.complete);
    expect(result.files.map((item) => item.path)).toEqual(['a.ts']);
  });
  it('.codocsignore가 없으면 감시 규칙 키는 .gitignore 규칙만 담는다', async () => {
    const { policy } = await computeCodeFilePolicy(project);
    expect(codeWatchRuleKey(policy)).toBe(JSON.stringify([[], []]));
  });
  it('추적 파일이 있는 제외 폴더도 .codocsignore가 제외하면 감시하지 않는다', async () => {
    await execute('git', ['init', project]);
    await trackFile('docs/a.md', 'text');
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    const { policy } = await computeCodeFilePolicy(project);
    expect(
      isCodeWatchIgnored(policy, path.join(project, 'docs'), directory),
    ).toBe(true);
    expect(
      isCodeWatchIgnored(policy, path.join(project, 'docs', 'a.md'), file),
    ).toBe(true);
  });
  it('.codocsignore 자신은 모든 패턴에 일치해도 감시한다', async () => {
    await writeFile(path.join(project, '.codocsignore'), '*\n');
    const { policy } = await computeCodeFilePolicy(project);
    expect(
      isCodeWatchIgnored(policy, path.join(project, '.codocsignore'), file),
    ).toBe(false);
  });
  it('.codocsignore 규칙이 달라지면 감시 규칙 키와 달라진 감시 폴더가 바뀐다', async () => {
    const before = (await computeCodeFilePolicy(project)).policy;
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    const after = (await computeCodeFilePolicy(project)).policy;
    expect(codeWatchRuleKey(after)).not.toBe(codeWatchRuleKey(before));
    expect(diffCodeWatchRules(before, after)).toEqual(['']);
    expect(diffCodeWatchRules(after, after)).toEqual([]);
  });
  it('.codocsignore를 만들고 고치고 지우면 전체 탐색과 같은 결과로 갱신한다', async () => {
    await mkdir(path.join(project, 'docs'));
    await writeFile(path.join(project, 'docs', 'a.md'), 'a');
    await writeFile(path.join(project, 'top.txt'), 't');
    const state = await discoverCodeFileState(project);
    const signal = [path.join(project, '.codocsignore')];
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    const created = await applyCodeSignals(state, signal);
    expect(created.files.has('docs/a.md')).toBe(false);
    await expectSameAsFullDiscovery(created, '규칙 생성');
    await writeFile(path.join(project, '.codocsignore'), 'top.txt\n');
    const edited = await applyCodeSignals(created, signal);
    expect(edited.files.has('docs/a.md')).toBe(true);
    expect(edited.files.has('top.txt')).toBe(false);
    await expectSameAsFullDiscovery(edited, '규칙 수정');
    await rm(path.join(project, '.codocsignore'));
    const removed = await applyCodeSignals(edited, signal);
    expect(removed.files.has('top.txt')).toBe(true);
    await expectSameAsFullDiscovery(removed, '규칙 삭제');
  });
  it('내용이 같은 .codocsignore 신호는 관측을 바꾸지 않는다', async () => {
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    const state = await discoverCodeFileState(project);
    const next = await applyCodeSignals(state, [
      path.join(project, '.codocsignore'),
    ]);
    expect(summarize(next)).toEqual(summarize(state));
  });
  it('.codocsignore를 읽지 못하면 incomplete이고 추적 파일도 확정하지 않는다', async () => {
    await execute('git', ['init', project]);
    await trackFile('src/a.ts', '@codocs [[대상]]');
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    ioFailures.set(path.join(project, '.codocsignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const result = await discoverCodeFiles(project);
    expect(result.status).toBe(codeCollectionStatuses.incomplete);
    expect(result.failures.map((failure) => failure.path)).toContain(
      '.codocsignore',
    );
    expect(result.files).toEqual([]);
    expect(await readEligibleCodeFile(result.policy, 'src/a.ts')).toMatchObject(
      { path: 'src/a.ts', reason: codeFileReasons.read },
    );
  });
  it('.codocsignore 읽기 실패가 해소되면 증분 갱신이 완료 수집으로 돌아간다', async () => {
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    await writeFile(path.join(project, 'a.ts'), 'a');
    ioFailures.set(path.join(project, '.codocsignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const failed = await discoverCodeFileState(project);
    ioFailures.clear();
    const healed = await applyCodeSignals(failed, [
      path.join(project, '.codocsignore'),
    ]);
    expect(codeFileStatus(healed)).toBe(codeCollectionStatuses.complete);
    expect([...healed.files.keys()]).toContain('a.ts');
  });
});
