import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { CodeReferenceWatcher } from './code-reference-watcher.js';
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
  await rm(project, { recursive: true, force: true });
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
    await rename(replacement, indexPath);
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
