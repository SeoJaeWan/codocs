import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readdir, readFile, open } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { calculateRevision } from '../revision/index.js';
import {
  codeCollectionStatuses,
  codeFileReasons,
  codeRepositoryKinds,
} from '../code-reference/domain-values.js';
const execute = promisify(execFile);
/** 확인한 코드 파일의 디스크 정체·원문 버전이다. */
export interface CodeFileObservation {
  path: string;
  text: string;
  revision: string;
  identity: string;
  stamp: string;
}
/** 정책 제외와 달리 완료 수집을 막는 실제 실패다. */
export interface CodeCollectionFailure {
  path?: string;
  reason: (typeof codeFileReasons)[keyof typeof codeFileReasons];
  message: string;
}
interface IgnoreLayer {
  directory: string;
  /** 감시 규칙 비교를 위해 규칙의 원문을 보존한다. */
  text: string;
  matcher: Ignore;
}
/** 프로젝트의 추적·ignore 집합을 한 번 확인한 읽기 전용 정책이다. */
export interface CodeFilePolicy {
  projectRoot: string;
  repositoryKind: (typeof codeRepositoryKinds)[keyof typeof codeRepositoryKinds];
  tracked: ReadonlySet<string>;
  /** 추적 파일을 하나 이상 가진 모든 상위 디렉터리다(프로젝트 root 제외). */
  trackedDirectories: ReadonlySet<string>;
  layers: readonly IgnoreLayer[];
  unknownIgnoreDirectories: ReadonlySet<string>;
}
/** 파일 원문을 읽지 않고 확인한 정책과 읽기 후보 파일이다. */
export interface CodeFilePolicyComputation {
  policy: CodeFilePolicy;
  /** 정책 계산 중 확인한 Git·ignore·탐색 실패다. */
  failures: readonly CodeCollectionFailure[];
  gitDirectory?: string;
  /** 수집 대상이 될 수 있는 일반 파일의 프로젝트 상대 경로다. */
  candidates: readonly string[];
}
/** 정책과 확인한 적격 파일만 함께 게시한다. */
export interface CodeFileDiscovery {
  status: (typeof codeCollectionStatuses)[keyof typeof codeCollectionStatuses];
  policy: CodeFilePolicy;
  files: readonly CodeFileObservation[];
  failures: readonly CodeCollectionFailure[];
  gitDirectory?: string;
  /** 증분 갱신이 이어받는 같은 시점의 상태 값이다. */
  state: CodeFileState;
}
/** inode·장치·생성 시점은 같은 경로의 파일 교체를 구분한다. */
function codeFileIdentity(stat: Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
}
/** 같은 파일의 바이트 관측을 재사용할 수 있는 메타데이터다. */
function stamp(stat: Stats): string {
  return `${codeFileIdentity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
/** 원문 성분을 보존한 프로젝트 상대 경로만 허용한다. */
export function codeFileRelativePath(
  projectRoot: string,
  input: string,
): string | undefined {
  if (input.split(path.sep === '\\' ? /[\\/]/u : /\//u).includes('..'))
    return undefined;
  const relative = path.isAbsolute(input)
    ? path.relative(projectRoot, input)
    : input;
  const parts = relative.split(path.sep === '\\' ? /[\\/]/u : /\//u);
  while (parts[0] === '.') parts.shift();
  if (
    !relative ||
    parts.some((part) => part === '..' || part === '.git' || part === '') ||
    path.isAbsolute(relative)
  )
    return undefined;
  return parts.join('/');
}
/** 저장·이름 변경이 같은 폴더에 잠시 만드는 임시 파일 이름이다. 코드로 수집하지 않는다. */
const writeTempFilePattern = /^\.codocs-write-[^.]+\.tmp$/u;
/**
 * 수집 대상이 될 수 없는 경로인지 판단한다. 부모 디렉터리의 ignore는 하위 규칙만으로 되살리지 않는다.
 * 쓰기 중 같은 폴더에 생기는 임시 파일(.codocs-write-*.tmp)은 새 원문을 담고 있어도 수집하지 않는다.
 */
export function isCodeFileIgnored(
  policy: CodeFilePolicy,
  relative: string,
): boolean {
  if (writeTempFilePattern.test(relative.slice(relative.lastIndexOf('/') + 1)))
    return true;
  if (policy.tracked.has(relative)) return false;
  const parts = relative.split('/');
  for (let end = 1; end <= parts.length; end++) {
    const candidate =
      parts.slice(0, end).join('/') + (end < parts.length ? '/' : '');
    let excluded = false;
    for (const layer of policy.layers) {
      if (layer.directory && !candidate.startsWith(layer.directory + '/'))
        continue;
      const local = layer.directory
        ? candidate.slice(layer.directory.length + 1)
        : candidate;
      if (!local) continue;
      const result = layer.matcher.test(local);
      if (result.ignored) excluded = true;
      else if (result.unignored) excluded = false;
    }
    if (excluded) return true;
  }
  return false;
}
/** 추적 파일이 하나라도 들어 있는 디렉터리인지 미리 계산한 집합에서 확인한다. */
export function hasTrackedDescendant(
  policy: CodeFilePolicy,
  relative: string,
): boolean {
  return policy.trackedDirectories.has(relative);
}
/** 추적 파일의 모든 상위 디렉터리를 한 번에 모은다. */
function trackedAncestors(tracked: ReadonlySet<string>): Set<string> {
  const directories = new Set<string>();
  for (const file of tracked) {
    let end = file.lastIndexOf('/');
    while (end > 0) {
      const directory = file.slice(0, end);
      if (directories.has(directory)) break;
      directories.add(directory);
      end = file.lastIndexOf('/', end - 1);
    }
  }
  return directories;
}
/**
 * 수집 대상이 될 수 없는 경로를 감시하지 않도록 수집과 같은 정책으로 판단한다.
 * 파일인지 디렉터리인지 정해지지 않은 첫 호출은 stats 없이 판단 가능한 경우에만 제외한다.
 */
export function isCodeWatchIgnored(
  policy: CodeFilePolicy,
  input: string,
  stats?: { isDirectory(): boolean },
): boolean {
  const relative = codeFileRelativePath(policy.projectRoot, input);
  if (!relative || path.posix.basename(relative) === '.gitignore') return false;
  const asFile = isCodeFileIgnored(policy, relative);
  const asDirectory =
    isCodeFileIgnored(policy, relative + '/') &&
    !hasTrackedDescendant(policy, relative);
  if (asFile === asDirectory) return asFile;
  if (!stats) return false;
  return stats.isDirectory() ? asDirectory : asFile;
}
/**
 * 감시 규칙은 .gitignore 계층의 원문과 추적 파일 때문에 감시하는 제외 폴더 집합이다.
 * 두 규칙이 같으면 감시 대상도 같다.
 */
export function codeWatchRuleKey(policy: CodeFilePolicy): string {
  return JSON.stringify([
    policy.layers.map((layer) => [layer.directory, layer.text]),
    [...policy.trackedDirectories]
      .filter((directory) => isCodeFileIgnored(policy, directory + '/'))
      .sort(),
  ]);
}
/** 프로젝트와 모든 경로 성분의 링크·특수 파일을 열기 전에 거부한다. */
async function regularFile(
  projectRoot: string,
  relative: string,
): Promise<Stats | undefined> {
  let current = projectRoot;
  let entry = await lstat(current);
  if (!entry.isDirectory() || entry.isSymbolicLink()) return undefined;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    entry = await lstat(current);
    if (
      entry.isSymbolicLink() ||
      (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())
    )
      return undefined;
  }
  return entry;
}
/** 같은 정책으로 IDE·MCP가 확인한 UTF-8 파일만 읽으며 링크를 따라가지 않는다. */
export async function readEligibleCodeFile(
  policy: CodeFilePolicy,
  input: string,
  cached?: CodeFileObservation,
): Promise<CodeFileObservation | CodeCollectionFailure | undefined> {
  const relative = codeFileRelativePath(policy.projectRoot, input);
  if (
    !relative ||
    isCodeFileIgnored(policy, relative) ||
    policy.repositoryKind === codeRepositoryKinds.unknown
  )
    return undefined;
  if (
    !policy.tracked.has(relative) &&
    [...policy.unknownIgnoreDirectories].some(
      (directory) => !directory || relative.startsWith(directory + '/'),
    )
  )
    return {
      path: relative,
      reason: codeFileReasons.read,
      message: '프로젝트 ignore 규칙을 확인하지 못했습니다.',
    };
  try {
    const before = await regularFile(policy.projectRoot, relative);
    if (!before) return undefined;
    if (cached && cached.stamp === stamp(before)) return cached;
    const handle = await open(
      path.join(policy.projectRoot, relative),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat();
      if (stamp(before) !== stamp(opened))
        return {
          path: relative,
          reason: codeFileReasons.changed,
          message: '파일 정체가 읽기 전에 변경되었습니다.',
        };
      const bytes = await handle.readFile();
      const after = await regularFile(policy.projectRoot, relative);
      if (
        !after ||
        stamp(after) !== stamp(before) ||
        stamp(await handle.stat()) !== stamp(before)
      )
        return {
          path: relative,
          reason: codeFileReasons.changed,
          message: '파일 정체 또는 원문이 읽기 도중 변경되었습니다.',
        };
      if (bytes.includes(0)) return undefined;
      let text: string;
      try {
        text = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        return undefined;
      }
      return {
        path: relative,
        text,
        revision: calculateRevision(bytes),
        identity: codeFileIdentity(before),
        stamp: stamp(before),
      };
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return undefined;
    return {
      path: relative,
      reason: codeFileReasons.read,
      message: String(error),
    };
  }
}

/** Git 추적 집합과 저장소 종류를 확인한 결과다. */
export interface CodeTrackedFiles {
  repositoryKind: CodeFilePolicy['repositoryKind'];
  tracked: ReadonlySet<string>;
  gitDirectory?: string;
  /** 명시적 비 Git이 아닌 Git 실패다. */
  failure?: CodeCollectionFailure;
}
/** 한 폴더의 .gitignore 규칙을 읽은 결과이며 failure가 있으면 그 폴더의 ignore 범위는 미확인이다. */
export interface CodeIgnoreLayerRead {
  layer?: IgnoreLayer;
  failure?: CodeCollectionFailure;
}
/** 증분 갱신이 이어받는 정책·관측·실패의 전체 상태이며 변경마다 새 값으로 교체한다. */
export interface CodeFileState {
  policy: CodeFilePolicy;
  gitDirectory?: string;
  /** Git·ignore·폴더 탐색 단계의 실패다. */
  policyFailures: readonly CodeCollectionFailure[];
  /** 파일 읽기 실패이며 경로당 하나다. */
  fileFailures: ReadonlyMap<string, CodeCollectionFailure>;
  /** 프로젝트 상대 경로 순서(전체 탐색 순서와 같음)로 정렬된 적격 파일이다. */
  files: ReadonlyMap<string, CodeFileObservation>;
}
/** 경로가 주어진 디렉터리 자신이거나 그 이하인지 확인한다. 빈 디렉터리는 프로젝트 전체다. */
function isWithinDirectory(relative: string, directory: string): boolean {
  return (
    directory === '' ||
    relative === directory ||
    relative.startsWith(directory + '/')
  );
}
/** 전체 탐색이 방문하는 순서와 같은 경로 순서다. */
function compareCodePaths(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = left[index]!.localeCompare(right[index]!);
    if (order) return order;
  }
  return left.length - right.length;
}
/** 문자열 코드 단위 순서로 비교한다. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** 상위 폴더 규칙이 항상 하위 폴더 규칙보다 앞서도록 폴더 경로 순으로 정렬한다. */
function sortedLayers(layers: readonly IgnoreLayer[]): IgnoreLayer[] {
  return [...layers].sort((a, b) => compareText(a.directory, b.directory));
}
/** 실패를 경로·사유·메시지 순으로 정렬해 탐색 방식과 무관한 순서를 만든다. */
function sortedFailures(
  failures: readonly CodeCollectionFailure[],
): CodeCollectionFailure[] {
  return [...failures].sort(
    (a, b) =>
      compareText(a.path ?? '', b.path ?? '') ||
      compareText(a.reason, b.reason) ||
      compareText(a.message, b.message),
  );
}
/** 상태의 모든 실패를 정렬해 하나로 모은다. */
export function codeFileFailures(
  state: CodeFileState,
): CodeCollectionFailure[] {
  return sortedFailures([
    ...state.policyFailures,
    ...state.fileFailures.values(),
  ]);
}
/** 실패가 하나라도 있으면 incomplete다. */
export function codeFileStatus(
  state: CodeFileState,
): (typeof codeCollectionStatuses)[keyof typeof codeCollectionStatuses] {
  return state.policyFailures.length || state.fileFailures.size
    ? codeCollectionStatuses.incomplete
    : codeCollectionStatuses.complete;
}
/** 파일 시스템 오류가 항목 없음이나 경로 성분이 디렉터리가 아님인지 확인한다. */
function isMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
/** 두 경로 집합이 같은 원소를 갖는지 확인한다. */
function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}
/** 집합에서 다른 원소의 하위가 아닌 최상위 폴더만 남긴다. */
function topmostDirectories(directories: Iterable<string>): string[] {
  const sorted = [...new Set(directories)].sort(
    (a, b) => a.split('/').length - b.split('/').length || compareText(a, b),
  );
  const result: string[] = [];
  for (const directory of sorted)
    if (!result.some((top) => isWithinDirectory(directory, top)))
      result.push(directory);
  return result;
}
/** Git 추적 집합과 저장소 종류만 확인하며 파일 시스템 탐색은 하지 않는다. */
export async function readTrackedCodeFiles(
  projectRoot: string,
): Promise<CodeTrackedFiles> {
  const tracked = new Set<string>();
  let repositoryKind: CodeFilePolicy['repositoryKind'] =
    codeRepositoryKinds.unknown;
  let gitDirectory: string | undefined;
  let failure: CodeCollectionFailure | undefined;
  try {
    const git = await execute(
      'git',
      ['-C', projectRoot, 'rev-parse', '--absolute-git-dir'],
      { encoding: 'utf8' },
    );
    gitDirectory = git.stdout.trim();
    const files = await execute(
      'git',
      ['-C', projectRoot, 'ls-files', '-z', '--cached', '--', '.'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    for (const file of files.stdout.split('\0'))
      if (file) tracked.add(file.replaceAll(path.sep, '/'));
    repositoryKind = codeRepositoryKinds.git;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr.includes('not a git repository')
    )
      repositoryKind = codeRepositoryKinds.nonGit;
    else failure = { reason: codeFileReasons.git, message: String(error) };
  }
  return {
    repositoryKind,
    tracked,
    ...(gitDirectory ? { gitDirectory } : {}),
    ...(failure ? { failure } : {}),
  };
}
/** 한 폴더의 .gitignore만 읽는다. 일반 파일이 아니거나 없으면 규칙이 없는 것으로 본다. */
export async function readCodeIgnoreLayer(
  projectRoot: string,
  directory: string,
): Promise<CodeIgnoreLayerRead> {
  const ignorePath = path.join(projectRoot, directory, '.gitignore');
  try {
    const ignoreStat = await lstat(ignorePath);
    if (ignoreStat.isFile() && !ignoreStat.isSymbolicLink()) {
      const text = await readFile(ignorePath, 'utf8');
      return { layer: { directory, text, matcher: ignore().add(text) } };
    }
    return {};
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return {};
    return {
      failure: {
        path: directory ? directory + '/.gitignore' : '.gitignore',
        reason: codeFileReasons.read,
        message: String(error),
      },
    };
  }
}
/** 탐색이 폴더 안으로 내려가는 조건이며 상위 폴더가 모두 같은 조건을 만족해야 한다. */
function isCodeDirectoryWalkable(
  policy: CodeFilePolicy,
  directory: string,
): boolean {
  if (!directory) return true;
  const parts = directory.split('/');
  for (let end = 1; end <= parts.length; end++) {
    const prefix = parts.slice(0, end).join('/');
    if (
      isCodeFileIgnored(policy, prefix + '/') &&
      !hasTrackedDescendant(policy, prefix)
    )
      return false;
  }
  return true;
}
/** 폴더 탐색이 누적하는 규칙·후보·실패다. layers와 unknown은 탐색 중 변경된다. */
interface CodeWalk {
  projectRoot: string;
  policy: CodeFilePolicy;
  layers: IgnoreLayer[];
  unknown: Set<string>;
  failures: CodeCollectionFailure[];
  candidates: string[];
}
/** 추적 파일이 있는 ignored 폴더만 내려가며 각 폴더 규칙을 순서대로 보존한다. */
async function walkCodeDirectory(
  walk: CodeWalk,
  directory: string,
): Promise<void> {
  const { projectRoot, policy } = walk;
  const absolute = path.join(projectRoot, directory);
  try {
    const entry = await lstat(absolute);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      if (!directory)
        walk.failures.push({
          reason: codeFileReasons.boundary,
          message: '프로젝트 root가 일반 디렉터리가 아닙니다.',
        });
      return;
    }
    if (!directory || !isCodeFileIgnored(policy, directory + '/')) {
      const read = await readCodeIgnoreLayer(projectRoot, directory);
      if (read.layer) walk.layers.push(read.layer);
      if (read.failure) {
        walk.unknown.add(directory);
        walk.failures.push(read.failure);
      }
    }
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of entries) {
      if (item.name === '.git' || item.isSymbolicLink()) continue;
      const relative = directory ? directory + '/' + item.name : item.name;
      if (item.isDirectory()) {
        if (
          !isCodeFileIgnored(policy, relative + '/') ||
          hasTrackedDescendant(policy, relative)
        )
          await walkCodeDirectory(walk, relative);
      } else if (
        item.isFile() &&
        policy.repositoryKind !== codeRepositoryKinds.unknown
      )
        walk.candidates.push(relative);
    }
  } catch (error: unknown) {
    walk.failures.push({
      ...(directory ? { path: directory } : {}),
      reason: codeFileReasons.read,
      message: String(error),
    });
  }
}
/**
 * 주어진 정책 위에서 한 폴더 이하만 탐색해 그 하위 ignore 규칙과 읽기 후보를 찾는다.
 * 정책에는 탐색할 하위 폴더의 규칙이 들어 있지 않아야 한다.
 */
export async function walkCodeSubtree(
  policy: CodeFilePolicy,
  directory: string,
): Promise<{
  policy: CodeFilePolicy;
  failures: CodeCollectionFailure[];
  candidates: string[];
}> {
  const layers = [...policy.layers];
  const unknown = new Set(policy.unknownIgnoreDirectories);
  const failures: CodeCollectionFailure[] = [];
  const candidates: string[] = [];
  const working: CodeFilePolicy = {
    ...policy,
    layers,
    unknownIgnoreDirectories: unknown,
  };
  await walkCodeDirectory(
    {
      projectRoot: policy.projectRoot,
      policy: working,
      layers,
      unknown,
      failures,
      candidates,
    },
    directory,
  );
  return {
    policy: { ...working, layers: sortedLayers(layers) },
    failures,
    candidates,
  };
}
/**
 * 파일 원문을 읽지 않고 Git 추적 집합과 프로젝트 .gitignore 계층만 확인한다.
 * 감시 등록과 수집이 같은 정책 계산을 공유한다.
 */
export async function computeCodeFilePolicy(
  projectRoot: string,
): Promise<CodeFilePolicyComputation> {
  projectRoot = path.resolve(projectRoot);
  const git = await readTrackedCodeFiles(projectRoot);
  const walked = await walkCodeSubtree(
    {
      projectRoot,
      repositoryKind: git.repositoryKind,
      tracked: git.tracked,
      trackedDirectories: trackedAncestors(git.tracked),
      layers: [],
      unknownIgnoreDirectories: new Set(),
    },
    '',
  );
  return {
    policy: walked.policy,
    failures: [...(git.failure ? [git.failure] : []), ...walked.failures],
    candidates: walked.candidates,
    ...(git.gitDirectory ? { gitDirectory: git.gitDirectory } : {}),
  };
}
/** 정렬된 기존 관측에 정렬된 추가 관측을 전체 탐색 순서를 유지하며 합친다. */
function mergeCodeFiles(
  base: ReadonlyMap<string, CodeFileObservation>,
  additions: readonly (readonly [string, CodeFileObservation])[],
): Map<string, CodeFileObservation> {
  if (!additions.length) return new Map(base);
  const sorted = [...additions].sort((a, b) => compareCodePaths(a[0], b[0]));
  const merged = new Map<string, CodeFileObservation>();
  let next = 0;
  for (const entry of base) {
    while (
      next < sorted.length &&
      compareCodePaths(sorted[next]![0], entry[0]) < 0
    )
      merged.set(...sorted[next++]!);
    merged.set(...entry);
  }
  while (next < sorted.length) merged.set(...sorted[next++]!);
  return merged;
}
/** 후보를 정책으로 읽어 관측과 읽기 실패로 나눈다. 같은 경로의 이전 관측은 메타데이터가 같으면 재사용한다. */
async function readCodeCandidates(
  policy: CodeFilePolicy,
  candidates: readonly string[],
  cached: (relative: string) => CodeFileObservation | undefined,
): Promise<{
  files: [string, CodeFileObservation][];
  failures: [string, CodeCollectionFailure][];
}> {
  const files: [string, CodeFileObservation][] = [];
  const failures: [string, CodeCollectionFailure][] = [];
  for (const relative of candidates) {
    const observed = await readEligibleCodeFile(
      policy,
      relative,
      cached(relative),
    );
    if (observed && 'text' in observed) files.push([relative, observed]);
    else if (observed) failures.push([relative, observed]);
  }
  return { files, failures };
}
/** Git 상태 실패와 명시적 비 Git을 구분하는 전체 탐색의 상태 값이다. */
export async function discoverCodeFileState(
  projectRoot: string,
  cache: ReadonlyMap<string, CodeFileObservation> = new Map(),
): Promise<CodeFileState> {
  const { policy, candidates, gitDirectory, failures } =
    await computeCodeFilePolicy(projectRoot);
  const read = await readCodeCandidates(policy, candidates, (relative) =>
    cache.get(relative),
  );
  return {
    policy,
    ...(gitDirectory ? { gitDirectory } : {}),
    policyFailures: failures,
    fileFailures: new Map(read.failures),
    files: new Map(read.files),
  };
}
/**
 * Git 상태 실패와 명시적 비 Git을 구분하고 프로젝트 .gitignore만 적용한다.
 */
export async function discoverCodeFiles(
  projectRoot: string,
  cache: ReadonlyMap<string, CodeFileObservation> = new Map(),
): Promise<CodeFileDiscovery> {
  const state = await discoverCodeFileState(projectRoot, cache);
  return {
    status: codeFileStatus(state),
    policy: state.policy,
    files: [...state.files.values()],
    failures: codeFileFailures(state),
    state,
    ...(state.gitDirectory ? { gitDirectory: state.gitDirectory } : {}),
  };
}
/** 한 폴더 이하의 관측·규칙·실패를 상태에서 제거한다. 빈 폴더는 프로젝트 전체이며 Git 실패는 남긴다. */
function withoutSubtree(
  state: CodeFileState,
  directory: string,
): CodeFileState {
  const files = new Map(state.files);
  for (const key of files.keys())
    if (isWithinDirectory(key, directory)) files.delete(key);
  const fileFailures = new Map(state.fileFailures);
  for (const key of fileFailures.keys())
    if (isWithinDirectory(key, directory)) fileFailures.delete(key);
  return {
    ...state,
    policy: {
      ...state.policy,
      layers: state.policy.layers.filter(
        (layer) => !isWithinDirectory(layer.directory, directory),
      ),
      unknownIgnoreDirectories: new Set(
        [...state.policy.unknownIgnoreDirectories].filter(
          (item) => !isWithinDirectory(item, directory),
        ),
      ),
    },
    policyFailures: state.policyFailures.filter(
      /** 제거할 폴더가 소유한 실패만 걸러낸다. */ (failure) =>
        failure.reason === codeFileReasons.git
          ? true
          : failure.path === undefined
            ? directory !== ''
            : !isWithinDirectory(failure.path, directory),
    ),
    fileFailures,
    files,
  };
}
/** 변경 경로 자신이나 상위 경로가 명시 변경이면 캐시를 쓰지 않는다. */
type FreshPaths = (relative: string) => boolean;
/** 한 폴더를 현재 정책으로 다시 탐색한다. 탐색 대상이 아니면 그 하위만 제거한다. */
async function rewalkCodeDirectory(
  state: CodeFileState,
  directory: string,
  fresh: FreshPaths,
): Promise<CodeFileState> {
  const base = withoutSubtree(state, directory);
  if (!isCodeDirectoryWalkable(base.policy, directory)) return base;
  if (directory)
    try {
      await lstat(path.join(base.policy.projectRoot, directory));
    } catch (error: unknown) {
      if (isMissingError(error)) return base;
    }
  const walked = await walkCodeSubtree(base.policy, directory);
  const read = await readCodeCandidates(
    walked.policy,
    walked.candidates,
    (relative) => (fresh(relative) ? undefined : state.files.get(relative)),
  );
  return {
    ...base,
    policy: walked.policy,
    policyFailures: [...base.policyFailures, ...walked.failures],
    fileFailures: new Map([...base.fileFailures, ...read.failures]),
    files: mergeCodeFiles(base.files, read.files),
  };
}
/** 파일 하나를 정책으로 다시 읽어 상태의 그 경로만 교체한다. */
async function rereadCodeFile(
  state: CodeFileState,
  relative: string,
  cached?: CodeFileObservation,
): Promise<CodeFileState> {
  const base = withoutSubtree(state, relative);
  const observed = await readEligibleCodeFile(base.policy, relative, cached);
  const failures = new Map(base.fileFailures);
  if (observed && 'text' in observed)
    return {
      ...base,
      files: mergeCodeFiles(base.files, [[relative, observed]]),
    };
  if (observed) failures.set(relative, observed);
  return { ...base, fileFailures: failures };
}
/** .gitignore 규칙이 실제로 달라졌을 때만 그 폴더 이하를 다시 확인한다. */
async function refreshCodeIgnoreLayer(
  state: CodeFileState,
  directory: string,
  fresh: FreshPaths,
): Promise<{ state: CodeFileState; rewalked: boolean }> {
  const { policy } = state;
  if (
    !isCodeDirectoryWalkable(policy, directory) ||
    (directory && isCodeFileIgnored(policy, directory + '/'))
  )
    return { state, rewalked: false };
  try {
    const entry = await lstat(path.join(policy.projectRoot, directory));
    if (!entry.isDirectory() || entry.isSymbolicLink())
      return { state, rewalked: false };
  } catch {
    return { state, rewalked: false };
  }
  const read = await readCodeIgnoreLayer(policy.projectRoot, directory);
  const previous = policy.layers.find((layer) => layer.directory === directory);
  const unknown = policy.unknownIgnoreDirectories.has(directory);
  if (
    previous?.text === read.layer?.text &&
    !previous === !read.layer &&
    unknown === !!read.failure
  )
    return { state, rewalked: false };
  return {
    state: await rewalkCodeDirectory(state, directory, fresh),
    rewalked: true,
  };
}
/** 추적 해제나 추가가 없는 index 갱신은 같은 상태를 돌려주고, 달라진 경로만 다시 확인한다. */
async function refreshCodeTrackedFiles(
  state: CodeFileState,
  fresh: FreshPaths,
): Promise<CodeFileState> {
  const next = await readTrackedCodeFiles(state.policy.projectRoot);
  const { policy } = state;
  const gitFailure = state.policyFailures.find(
    (failure) => failure.reason === codeFileReasons.git,
  );
  if (next.repositoryKind !== policy.repositoryKind) {
    const changed: CodeFileState = {
      ...state,
      policy: {
        ...policy,
        repositoryKind: next.repositoryKind,
        tracked: next.tracked,
        trackedDirectories: trackedAncestors(next.tracked),
      },
      policyFailures: [
        ...state.policyFailures.filter(
          (failure) => failure.reason !== codeFileReasons.git,
        ),
        ...(next.failure ? [next.failure] : []),
      ],
    };
    if (next.gitDirectory) changed.gitDirectory = next.gitDirectory;
    else delete changed.gitDirectory;
    return rewalkCodeDirectory(changed, '', fresh);
  }
  if (sameSet(next.tracked, policy.tracked)) {
    if (gitFailure?.message === next.failure?.message) return state;
    return {
      ...state,
      policyFailures: [
        ...state.policyFailures.filter(
          (failure) => failure.reason !== codeFileReasons.git,
        ),
        ...(next.failure ? [next.failure] : []),
      ],
    };
  }
  const changedPaths = [
    ...[...next.tracked].filter((item) => !policy.tracked.has(item)),
    ...[...policy.tracked].filter((item) => !next.tracked.has(item)),
  ];
  const trackedDirectories = trackedAncestors(next.tracked);
  const updated: CodeFileState = {
    ...state,
    policy: { ...policy, tracked: next.tracked, trackedDirectories },
  };
  const changedDirectories = [
    ...[...trackedDirectories].filter(
      (item) => !policy.trackedDirectories.has(item),
    ),
    ...[...policy.trackedDirectories].filter(
      (item) => !trackedDirectories.has(item),
    ),
  ].filter((item) => isCodeFileIgnored(updated.policy, item + '/'));
  const roots = topmostDirectories(changedDirectories);
  let current = updated;
  for (const root of roots)
    current = await rewalkCodeDirectory(current, root, fresh);
  const untracked: CodeFilePolicy = { ...updated.policy, tracked: new Set() };
  for (const changed of changedPaths) {
    if (roots.some((root) => isWithinDirectory(changed, root))) continue;
    const unknownScope = [...updated.policy.unknownIgnoreDirectories].some(
      (item) => !item || changed.startsWith(item + '/'),
    );
    if (!unknownScope && !isCodeFileIgnored(untracked, changed)) continue;
    current = await rereadCodeFile(
      current,
      changed,
      current.files.get(changed),
    );
  }
  return current;
}
/** 감시 신호 하나를 처리 시점에 분류한 결과다. */
type CodeSignal =
  | { kind: 'git' }
  | { kind: 'root' }
  | { kind: 'path'; relative: string }
  | { kind: 'ignore' };
/** Git 메타데이터 경로, 프로젝트 root, 일반 상대 경로를 구분한다. */
function classifyCodeSignal(
  projectRoot: string,
  gitDirectory: string | undefined,
  input: string,
): CodeSignal {
  const absolute = path.isAbsolute(input)
    ? path.normalize(input)
    : path.join(projectRoot, input);
  const relative = path.relative(projectRoot, absolute);
  if (!relative) return { kind: 'root' };
  const parts = relative.split(path.sep);
  if (parts.includes('.git')) return { kind: 'git' };
  if (gitDirectory) {
    const inside = path.relative(gitDirectory, absolute);
    if (inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside)))
      return { kind: 'git' };
  }
  if (parts.includes('..') || path.isAbsolute(relative))
    return { kind: 'ignore' };
  return { kind: 'path', relative: parts.join('/') };
}
/** 경로 하나의 현재 종류(파일·폴더·없음)를 lstat으로 확인해 해당 범위만 갱신한다. */
async function refreshCodePath(
  state: CodeFileState,
  relative: string,
  fresh: FreshPaths,
): Promise<{ state: CodeFileState; rewalked: boolean }> {
  const { policy } = state;
  let entry: Stats | undefined;
  let failure: CodeCollectionFailure | undefined;
  try {
    entry = await lstat(path.join(policy.projectRoot, relative));
  } catch (error: unknown) {
    if (!isMissingError(error))
      failure = {
        path: relative,
        reason: codeFileReasons.read,
        message: String(error),
      };
  }
  if (failure) {
    const removed = withoutSubtree(state, relative);
    const asFile = isCodeFileIgnored(policy, relative);
    const asDirectory =
      isCodeFileIgnored(policy, relative + '/') &&
      !hasTrackedDescendant(policy, relative);
    if (asFile && asDirectory) return { state: removed, rewalked: false };
    return {
      state: {
        ...removed,
        fileFailures: new Map([...removed.fileFailures, [relative, failure]]),
      },
      rewalked: false,
    };
  }
  if (entry?.isDirectory() && !entry.isSymbolicLink())
    return {
      state: await rewalkCodeDirectory(state, relative, fresh),
      rewalked: true,
    };
  if (!entry?.isFile() || entry.isSymbolicLink())
    return { state: withoutSubtree(state, relative), rewalked: false };
  const blocked = state.policyFailures.some(
    (item) =>
      item.reason === codeFileReasons.read &&
      item.path !== undefined &&
      relative.startsWith(item.path + '/'),
  );
  if (blocked)
    return { state: withoutSubtree(state, relative), rewalked: false };
  return { state: await rereadCodeFile(state, relative), rewalked: false };
}
/**
 * 변경 신호를 경로 범위 갱신으로 반영한다. Git index·HEAD는 추적 집합 차이만, .gitignore는 그 폴더 이하만,
 * 파일·폴더는 해당 경로만 다시 확인하며 전체 정책 계산과 전체 탐색은 하지 않는다.
 * 같은 상태에서 변경이 없으면 같은 상태 객체를 돌려준다.
 */
export async function applyCodeSignals(
  state: CodeFileState,
  inputs: readonly string[],
): Promise<CodeFileState> {
  const { projectRoot } = state.policy;
  let git = false;
  let root = false;
  const relatives = new Set<string>();
  for (const input of inputs) {
    const signal = classifyCodeSignal(projectRoot, state.gitDirectory, input);
    if (signal.kind === 'git') git = true;
    else if (signal.kind === 'root') root = true;
    else if (signal.kind === 'path') relatives.add(signal.relative);
  }
  /** 명시 변경 경로나 그 하위는 메타데이터가 같아도 원문을 다시 읽는다. */
  const fresh: FreshPaths = (relative) => {
    for (
      let end = relative.length;
      end > 0;
      end = relative.lastIndexOf('/', end - 1)
    )
      if (relatives.has(relative.slice(0, end))) return true;
    return false;
  };
  let current = state;
  if (git) current = await refreshCodeTrackedFiles(current, fresh);
  const rewalked: string[] = [];
  if (root) {
    current = await rewalkCodeDirectory(current, '', fresh);
    rewalked.push('');
  }
  const ordered = [...relatives].sort(
    (a, b) => a.split('/').length - b.split('/').length || compareText(a, b),
  );
  for (const relative of ordered) {
    if (rewalked.some((directory) => isWithinDirectory(relative, directory)))
      continue;
    if (path.posix.basename(relative) === '.gitignore') {
      const directory = path.posix.dirname(relative);
      const refreshed = await refreshCodeIgnoreLayer(
        current,
        directory === '.' ? '' : directory,
        fresh,
      );
      current = refreshed.state;
      if (refreshed.rewalked) {
        rewalked.push(directory === '.' ? '' : directory);
        if (isWithinDirectory(relative, rewalked.at(-1)!)) continue;
      }
    }
    const refreshed = await refreshCodePath(current, relative, fresh);
    current = refreshed.state;
    if (refreshed.rewalked) rewalked.push(relative);
  }
  return current;
}
/** 감시 규칙(.gitignore 원문과 추적 때문에 감시하는 제외 폴더)이 달라진 최상위 폴더들이다. */
export function diffCodeWatchRules(
  previous: CodeFilePolicy,
  next: CodeFilePolicy,
): string[] {
  const changed: string[] = [];
  const before = new Map(previous.layers.map((l) => [l.directory, l.text]));
  const after = new Map(next.layers.map((l) => [l.directory, l.text]));
  for (const [directory, text] of after)
    if (before.get(directory) !== text) changed.push(directory);
  for (const directory of before.keys())
    if (!after.has(directory)) changed.push(directory);
  /** 추적 파일 때문에 감시하는 제외 폴더다. */
  const watched = (policy: CodeFilePolicy): Set<string> =>
    new Set(
      [...policy.trackedDirectories].filter((directory) =>
        isCodeFileIgnored(policy, directory + '/'),
      ),
    );
  const oldWatched = watched(previous);
  const newWatched = watched(next);
  for (const directory of newWatched)
    if (!oldWatched.has(directory)) changed.push(directory);
  for (const directory of oldWatched)
    if (!newWatched.has(directory)) changed.push(directory);
  return topmostDirectories(changed);
}
/** 감시 규칙이 달라진 폴더들을 현재 정책으로 다시 확인한다. */
export async function recheckCodeDirectories(
  state: CodeFileState,
  directories: readonly string[],
): Promise<CodeFileState> {
  let current = state;
  for (const directory of topmostDirectories(directories))
    current = await rewalkCodeDirectory(current, directory, () => false);
  return current;
}
