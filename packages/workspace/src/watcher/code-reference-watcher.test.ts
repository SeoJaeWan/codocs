import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { CodeReferenceWatcher } from './code-reference-watcher.js';
import {
  computeCodeFilePolicy,
  isCodeWatchIgnored,
} from '../paths/code-file-access.js';
import {
  renameWithRetry,
  rmWithRetry,
} from '../../../../tools/test/support/retrying-fs.js';
const execute = promisify(execFile);
let project: string;
let watcher: CodeReferenceWatcher | undefined;
beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/fixtures/code-watch-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(project));
});
afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
  vi.unstubAllEnvs();
  await rmWithRetry(project, { recursive: true, force: true });
});
describe('CodeReferenceWatcher: Git 메타데이터 원자 교체', () => {
  it('Git index를 같은 바이트·mtime으로 교체하면 파일 정체 변화 신호를 전달한다', async () => {
    await execute('git', ['init', project]);
    await writeFile(path.join(project, 'source'), 'text');
    await execute('git', ['-C', project, 'add', 'source']);
    const indexPath = path.join(project, '.git', 'index');
    await utimes(indexPath, 1000, 1000);
    const original = await stat(indexPath);
    const bytes = await readFile(indexPath);
    let resolveChange!: () => void;
    const changed = new Promise<void>((resolve) => {
      resolveChange = resolve;
    });
    const failures: unknown[] = [];
    watcher = new CodeReferenceWatcher(
      project,
      (paths) => {
        if (paths.includes(indexPath)) resolveChange();
      },
      (error) => failures.push(error),
    );
    await watcher.start();
    const replacement = path.join(project, 'replacement');
    await writeFile(replacement, bytes);
    await utimes(replacement, 1000, 1000);
    await renameWithRetry(replacement, indexPath);
    const current = await stat(indexPath);
    expect(current.mtimeMs).toBe(original.mtimeMs);
    expect(current.ino).not.toBe(original.ino);
    await changed;
    expect(failures).toEqual([]);
  });
  it('감시를 준비하던 중 close하면 등록 대기를 종료하고 이후 source 신호를 보내지 않는다', async () => {
    const events: string[] = [];
    watcher = new CodeReferenceWatcher(
      project,
      (paths) => events.push(...paths),
      (error) => {
        throw error;
      },
    );
    const starting = watcher.start();
    await watcher.close();
    await starting;
    await writeFile(path.join(project, 'source'), 'text');
    expect(events).toEqual([]);
  });
});
describe('CodeReferenceWatcher: 수집 정책 감시 범위', () => {
  /** 제외한 폴더 안의 추적 파일 하나만 정책상 감시 대상인 프로젝트를 만든다. */
  async function prepareIgnoredDirectory(): Promise<
    (input: string, stats?: { isDirectory(): boolean }) => boolean
  > {
    await execute('git', ['init', project]);
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'keep'), 'a');
    await writeFile(path.join(project, 'dist', 'junk'), 'a');
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    await execute('git', ['-C', project, 'add', '.gitignore']);
    await execute('git', ['-C', project, 'add', '-f', 'dist/keep']);
    const { policy } = await computeCodeFilePolicy(project);
    return (input, stats) => isCodeWatchIgnored(policy, input, stats);
  }
  it('제외한 폴더의 미추적 파일을 바꾸면 신호를 보내지 않는다', async () => {
    const excluded = await prepareIgnoredDirectory();
    const events: string[] = [];
    watcher = new CodeReferenceWatcher(
      project,
      (paths) => events.push(...paths),
      (error) => {
        throw error;
      },
      excluded,
    );
    await watcher.start();
    await writeFile(path.join(project, 'dist', 'junk'), 'b');
    await writeFile(path.join(project, 'dist', 'keep'), 'b');
    await vi.waitFor(
      () => expect(events).toContain(path.join(project, 'dist', 'keep')),
      { timeout: 5_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events).not.toContain(path.join(project, 'dist', 'junk'));
  });
  it('제외한 폴더 안의 추적 파일을 바꾸면 신호를 보낸다', async () => {
    const excluded = await prepareIgnoredDirectory();
    const events: string[] = [];
    watcher = new CodeReferenceWatcher(
      project,
      (paths) => events.push(...paths),
      (error) => {
        throw error;
      },
      excluded,
    );
    await watcher.start();
    await writeFile(path.join(project, 'dist', 'keep'), 'b');
    await vi.waitFor(
      () => expect(events).toContain(path.join(project, 'dist', 'keep')),
      { timeout: 5_000 },
    );
  });
  it('.gitignore를 바꾸면 제외 규칙과 무관하게 신호를 보낸다', async () => {
    const events: string[] = [];
    await writeFile(path.join(project, '.gitignore'), '.gitignore\n');
    const { policy } = await computeCodeFilePolicy(project);
    watcher = new CodeReferenceWatcher(
      project,
      (paths) => events.push(...paths),
      (error) => {
        throw error;
      },
      (input, stats) => isCodeWatchIgnored(policy, input, stats),
    );
    await watcher.start();
    await writeFile(path.join(project, '.gitignore'), 'b\n');
    await vi.waitFor(
      () => expect(events).toContain(path.join(project, '.gitignore')),
      { timeout: 5_000 },
    );
  });
});
