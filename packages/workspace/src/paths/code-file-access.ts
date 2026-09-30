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
  matcher: Ignore;
}
/** 프로젝트의 추적·ignore 집합을 한 번 확인한 읽기 전용 정책이다. */
export interface CodeFilePolicy {
  projectRoot: string;
  repositoryKind: (typeof codeRepositoryKinds)[keyof typeof codeRepositoryKinds];
  tracked: ReadonlySet<string>;
  layers: readonly IgnoreLayer[];
  unknownIgnoreDirectories: ReadonlySet<string>;
}
/** 정책과 확인한 적격 파일만 함께 게시한다. */
export interface CodeFileDiscovery {
  status: (typeof codeCollectionStatuses)[keyof typeof codeCollectionStatuses];
  policy: CodeFilePolicy;
  files: readonly CodeFileObservation[];
  failures: readonly CodeCollectionFailure[];
  gitDirectory?: string;
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
/** 부모 디렉터리의 ignore는 하위 규칙만으로 되살리지 않는다. */
export function isCodeFileIgnored(
  policy: CodeFilePolicy,
  relative: string,
): boolean {
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
/**
 * Git 상태 실패와 명시적 비 Git을 구분하고 프로젝트 .gitignore만 적용한다.
 * @codocs [[작업 공간:코드 참조 색인]]#L14-L18
 */
export async function discoverCodeFiles(
  projectRoot: string,
  cache: ReadonlyMap<string, CodeFileObservation> = new Map(),
): Promise<CodeFileDiscovery> {
  projectRoot = path.resolve(projectRoot);
  const tracked = new Set<string>();
  const layers: IgnoreLayer[] = [];
  const unknownIgnoreDirectories = new Set<string>();
  const failures: CodeCollectionFailure[] = [];
  let repositoryKind: CodeFilePolicy['repositoryKind'] =
    codeRepositoryKinds.unknown;
  let gitDirectory: string | undefined;
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
    else failures.push({ reason: codeFileReasons.git, message: String(error) });
  }
  const policy: CodeFilePolicy = {
    projectRoot,
    repositoryKind,
    tracked,
    layers,
    unknownIgnoreDirectories,
  };
  const files: CodeFileObservation[] = [];
  /** 추적 파일이 있는 ignored 폴더만 내려가며 각 폴더 규칙을 순서대로 보존한다. */
  async function visit(directory: string): Promise<void> {
    const absolute = path.join(projectRoot, directory);
    try {
      const entry = await lstat(absolute);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        if (!directory)
          failures.push({
            reason: codeFileReasons.boundary,
            message: '프로젝트 root가 일반 디렉터리가 아닙니다.',
          });
        return;
      }
      const ignorePath = path.join(absolute, '.gitignore');
      if (!directory || !isCodeFileIgnored(policy, directory + '/')) {
        try {
          const ignoreStat = await lstat(ignorePath);
          if (ignoreStat.isFile() && !ignoreStat.isSymbolicLink())
            layers.push({
              directory,
              matcher: ignore().add(await readFile(ignorePath, 'utf8')),
            });
        } catch (error: unknown) {
          if (!(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )) {
            unknownIgnoreDirectories.add(directory);
            failures.push({
              path: directory ? directory + '/.gitignore' : '.gitignore',
              reason: codeFileReasons.read,
              message: String(error),
            });
          }
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
            [...tracked].some((file) => file.startsWith(relative + '/'))
          )
            await visit(relative);
        } else if (
          item.isFile() &&
          repositoryKind !== codeRepositoryKinds.unknown
        ) {
          const observed = await readEligibleCodeFile(
            policy,
            relative,
            cache.get(relative),
          );
          if (observed && 'text' in observed) files.push(observed);
          else if (observed) failures.push(observed);
        }
      }
    } catch (error: unknown) {
      failures.push({
        ...(directory ? { path: directory } : {}),
        reason: codeFileReasons.read,
        message: String(error),
      });
    }
  }
  await visit('');
  return {
    status: failures.length
      ? codeCollectionStatuses.incomplete
      : codeCollectionStatuses.complete,
    policy,
    files,
    failures,
    ...(gitDirectory ? { gitDirectory } : {}),
  };
}
