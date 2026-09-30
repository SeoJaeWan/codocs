import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ioFailures, simulatedFileLinks } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  codeCollectionStatuses,
  codeFileReasons,
  codeRepositoryKinds,
} from '../code-reference/domain-values.js';
import {
  computeCodeFilePolicy,
  discoverCodeFiles,
  isCodeWatchIgnored,
  readEligibleCodeFile,
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
  /** @codocs [[작업 공간:코드 참조 색인]]#L15 */
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
  /** @codocs [[작업 공간:코드 참조 색인]]#L25 */
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
