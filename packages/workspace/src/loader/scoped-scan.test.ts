import { parseYaml } from '@codocs/core';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadWorkspace,
  loadWorkspacePath,
  WorkspaceObservationCache,
  workspacePathsForLinkEvent,
} from './index.js';
import { resolveProjectRoot, type ProjectRoot } from '../project-root/index.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const native = await importOriginal<typeof import('node:fs/promises')>();
  const { createFileSystemBoundary } =
    await import('../test-support/file-system.js');
  const original = createFileSystemBoundary(native);
  return {
    ...original,
    readFile: vi.fn(original.readFile),
    readdir: vi.fn(original.readdir),
  };
});
vi.mock('@codocs/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@codocs/core')>();
  return { ...original, parseYaml: vi.fn(original.parseYaml) };
});
/** 시간에 의존하지 않고 실제 읽기·등록의 반환 경계를 제어한다. */
function barrier(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let fixture: string;
let root: ProjectRoot;
let codocs: string;
let outside: string;
const rawA = 'id: a\nname: A\ndefinition: A\n';
const rawB = 'id: b\nname: B\ndefinition: B\n';
beforeEach(async () => {
  await mkdir(path.join(process.cwd(), 'node_modules/.cache'), {
    recursive: true,
  });
  fixture = await mkdtemp(
    path.join(process.cwd(), 'node_modules/.cache/scoped-'),
  );
  codocs = path.join(fixture, '.codocs');
  outside = path.join(fixture, 'outside');
  await mkdir(codocs);
  await mkdir(outside);
  const selected = await resolveProjectRoot({ cwd: fixture });
  if (!selected.success) throw new Error('fixture root');
  root = selected.root;
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.mocked(readFile).mockReset();
  vi.mocked(readdir).mockReset();
  await rm(fixture, { recursive: true, force: true });
});

describe('loadWorkspacePath: 지정 경로의 관측과 재사용', () => {
  it('파일 하나를 확인하면 전체 상태 없이 해당 파일의 관측만 반환한다', async () => {
    const file = path.join('.codocs', 'a.yaml');
    await writeFile(path.join(fixture, file), rawA);
    await writeFile(path.join(codocs, 'b.yaml'), rawB);
    const result = await loadWorkspacePath(root, file);
    expect(result).not.toHaveProperty('status');
    expect(result.outcome).toBe('complete');
    expect(result.coverage).toEqual({
      path: file,
      logicalPath: path.join(fixture, file),
    });
    expect(result.documents.map((document) => document.source.path)).toEqual([
      file,
    ]);
    expect(vi.mocked(readFile).mock.calls.map(([file]) => file)).toEqual([
      path.join(fixture, file),
    ]);
    expect(readdir).not.toHaveBeenCalled();
    expect(parseYaml).toHaveBeenCalledExactlyOnceWith(rawA);
  });

  it('하위 폴더를 확인하면 형제 폴더를 열거하거나 읽지 않는다', async () => {
    const nested = path.join(codocs, 'nested');
    await mkdir(nested);
    await writeFile(path.join(nested, 'a.yaml'), rawA);
    await writeFile(path.join(codocs, 'b.yaml'), rawB);
    const result = await loadWorkspacePath(root, nested);
    expect(result.outcome).toBe('complete');
    expect(result.documents.map((document) => document.raw)).toEqual([rawA]);
    expect(vi.mocked(readdir).mock.calls.map(([file]) => file)).toEqual([
      nested,
    ]);
    expect(vi.mocked(readFile).mock.calls.map(([file]) => file)).toEqual([
      path.join(nested, 'a.yaml'),
    ]);
    expect(parseYaml).toHaveBeenCalledExactlyOnceWith(rawA);
  });

  it('A만 무효화하고 전체 순회를 이어가면 B 원문과 파싱 결과를 재사용한다', async () => {
    const a = path.join(codocs, 'a.yaml');
    const b = path.join(codocs, 'b.yaml');
    await writeFile(a, rawA);
    await writeFile(b, rawB);
    const cache = new WorkspaceObservationCache();
    const first = await loadWorkspace({ cwd: fixture }, { cache });
    const beforeB = first.documents.find(
      (document) => document.source.logicalPath === b,
    );
    cache.invalidate(a);
    await writeFile(a, rawA.replace('name: A', 'name: Changed'));
    vi.clearAllMocks();
    const scoped = await loadWorkspacePath(root, a, { cache });
    const next = await loadWorkspace({ cwd: fixture }, { cache });
    expect(scoped.documents[0]?.raw).toContain('name: Changed');
    expect(
      next.documents.find((document) => document.source.logicalPath === b),
    ).toBe(beforeB);
    expect(vi.mocked(readFile).mock.calls.map(([file]) => file)).toEqual([a]);
    expect(parseYaml).toHaveBeenCalledTimes(1);
    expect(
      next.documents.find((document) => document.source.logicalPath === a),
    ).toBe(scoped.documents[0]);
  });

  it('폴더를 교체하고 부모 범위를 무효화하면 하위 파일의 이전 관측을 재사용하지 않는다', async () => {
    const nested = path.join(codocs, 'nested');
    await mkdir(nested);
    await writeFile(path.join(nested, 'a.yaml'), rawA);
    const cache = new WorkspaceObservationCache();
    const first = await loadWorkspacePath(root, nested, { cache });
    await rename(nested, path.join(fixture, 'old'));
    await mkdir(nested);
    await writeFile(path.join(nested, 'a.yaml'), rawB);
    cache.invalidate(nested);
    const next = await loadWorkspacePath(root, nested, { cache });
    expect(next.documents[0]?.raw).toBe(rawB);
    expect(cache.isCurrent(first.observations[0]!)).toBe(false);
    expect(cache.isCurrent(next.observations[0]!)).toBe(true);
  });

  it('파일 읽기 중 무효화하면 늦게 완료한 이전 원문을 캐시에 채택하지 않는다', async () => {
    const a = path.join(codocs, 'a.yaml');
    await writeFile(a, rawA);
    const cache = new WorkspaceObservationCache();
    const started = barrier();
    const release = barrier();
    const original =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    vi.mocked(readFile).mockImplementationOnce(
      async (...args: Parameters<typeof readFile>) => {
        const bytes = await original.readFile(...args);
        started.resolve();
        await release.promise;
        return bytes;
      },
    );
    const oldRead = loadWorkspacePath(root, a, { cache });
    try {
      await started.promise;
      await writeFile(a, rawB);
      cache.invalidate(a);
      const latest = await loadWorkspacePath(root, a, { cache });
      release.resolve();
      const old = await oldRead;
      const reused = await loadWorkspacePath(root, a, { cache });
      expect(old.documents[0]?.raw).toBe(rawA);
      expect(cache.isCurrent(old.observations[0]!)).toBe(false);
      expect(cache.isScopeCurrent(codocs, old.generation)).toBe(false);
      expect(cache.isScopeCurrent(a, latest.generation)).toBe(true);
      expect(
        cache.isScopeCurrent(path.join(codocs, 'b.yaml'), old.generation),
      ).toBe(true);
      expect(latest.documents[0]?.raw).toBe(rawB);
      expect(reused.documents[0]).toBe(latest.documents[0]);
    } finally {
      release.resolve();
      await oldRead;
    }
  });
});

describe('loadWorkspace: 진행 중 전체 순회와 경로 보정', () => {
  it('전체 순회의 A 읽기를 보류하고 A를 보정하면 B 순회는 계속되고 이전 A만 만료한다', async () => {
    const a = path.join(codocs, 'a.yaml');
    const b = path.join(codocs, 'b.yaml');
    await writeFile(a, rawA);
    await writeFile(b, rawB);
    const cache = new WorkspaceObservationCache();
    const started = barrier();
    const release = barrier();
    const bRead = barrier();
    const original =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    let held = false;
    vi.mocked(readFile).mockImplementation(
      async (...args: Parameters<typeof readFile>) => {
        const bytes = await original.readFile(...args);
        if (args[0] === b) bRead.resolve();
        if (args[0] === a && !held) {
          held = true;
          started.resolve();
          await release.promise;
        }
        return bytes;
      },
    );
    const full = loadWorkspace({ cwd: fixture }, { cache });
    try {
      await started.promise;
      await writeFile(a, rawA.replace('name: A', 'name: Changed'));
      cache.invalidate(a);
      const corrected = await loadWorkspacePath(root, a, { cache });
      await bRead.promise;
      expect(corrected.documents[0]?.raw).toContain('name: Changed');
      release.resolve();
      const completed = await full;
      expect(
        completed.documents.map((document) => document.source.logicalPath),
      ).toEqual([a, b]);
      const accepted = completed.observations.filter((observation) =>
        cache.isCurrent(observation),
      );
      expect(
        accepted.map((observation) => observation.document.source.logicalPath),
      ).toEqual([b]);
      expect(
        vi.mocked(readFile).mock.calls.filter(([file]) => file === b),
      ).toHaveLength(1);
      expect(
        vi.mocked(parseYaml).mock.calls.filter(([raw]) => raw === rawB),
      ).toHaveLength(1);
    } finally {
      release.resolve();
      await full;
    }
  });

  it('같은 파일을 같은 세대에서 동시에 확인하면 하나의 읽기와 파싱을 공유한다', async () => {
    const a = path.join(codocs, 'a.yaml');
    await writeFile(a, rawA);
    const cache = new WorkspaceObservationCache();
    const results = await Promise.all([
      loadWorkspacePath(root, a, { cache }),
      loadWorkspacePath(root, a, { cache }),
    ]);
    expect(results[0]?.documents[0]).toBe(results[1]?.documents[0]);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(parseYaml).toHaveBeenCalledTimes(1);
  });
});

describe('loadWorkspacePath: 부재와 접근 실패', () => {
  it.each(['a.yaml', 'nested'])(
    '%s가 실제로 없으면 부재 범위만 반환한다',
    async (name) => {
      const target = path.join(codocs, name);
      const result = await loadWorkspacePath(root, target);
      expect(result.outcome).toBe('complete');
      expect(result.absent).toEqual([
        { path: path.join('.codocs', name), logicalPath: target },
      ]);
      expect(result.failures).toEqual([]);
      expect(result.documents).toEqual([]);
    },
  );

  it('캐시에 있는 파일이 삭제되면 무효화 없이도 경로 부재를 재확인한다', async () => {
    const a = path.join(codocs, 'a.yaml');
    await writeFile(a, rawA);
    const cache = new WorkspaceObservationCache();
    await loadWorkspacePath(root, a, { cache });
    await rm(a);
    const result = await loadWorkspacePath(root, a, { cache });
    expect(result.documents).toEqual([]);
    expect(result.absent).toEqual([
      { path: path.join('.codocs', 'a.yaml'), logicalPath: a },
    ]);
  });

  it('캐시에 있는 파일의 읽기 권한을 제거하면 이전 문서 대신 실패를 반환한다', async () => {
    const a = path.join(codocs, 'a.yaml');
    await writeFile(a, rawA);
    const cache = new WorkspaceObservationCache();
    await loadWorkspacePath(root, a, { cache });
    await chmod(a, 0);
    try {
      const result = await loadWorkspacePath(root, a, { cache });
      expect(result.outcome).toBe('failed');
      expect(result.documents).toEqual([]);
      expect(result.absent).toEqual([]);
      expect(result.failures).toMatchObject([
        { logicalPath: a, diagnostics: [{ ioCode: 'EACCES' }] },
      ]);
    } finally {
      await chmod(a, 0o600);
    }
  });

  it('경로 확인 후 파일 읽기에서 ENOENT가 나면 확정 부재 대신 실패를 반환한다', async () => {
    const a = path.join(codocs, 'a.yaml');
    await writeFile(a, rawA);
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error('read disappeared'), { code: 'ENOENT' }),
    );
    const result = await loadWorkspacePath(root, a);
    expect(result.outcome).toBe('failed');
    expect(result.absent).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(result.failures).toMatchObject([
      { logicalPath: a, diagnostics: [{ ioCode: 'ENOENT' }] },
    ]);
  });

  it('하위 폴더 하나의 열거가 실패하면 성공 관측과 partial 실패 범위를 따로 반환한다', async () => {
    const failed = path.join(codocs, 'failed');
    await mkdir(failed);
    await writeFile(path.join(codocs, 'a.yaml'), rawA);
    const original =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    vi.mocked(readdir).mockImplementation(
      async (...args: Parameters<typeof readdir>) => {
        if (args[0] === failed)
          throw Object.assign(new Error('fixture I/O'), { code: 'EIO' });
        return original.readdir(...args);
      },
    );
    const result = await loadWorkspacePath(root, codocs);
    expect(result.outcome).toBe('partial');
    expect(result.documents.map((document) => document.raw)).toEqual([rawA]);
    expect(result.failures).toMatchObject([
      { logicalPath: failed, diagnostics: [{ ioCode: 'EIO' }] },
    ]);
    expect(result.absent).toEqual([]);
  });

  it('폴더 열거가 IO 오류로 실패하면 부재로 바꾸지 않는다', async () => {
    const failure = Object.assign(new Error('fixture I/O'), { code: 'EIO' });
    vi.mocked(readdir).mockRejectedValueOnce(failure);
    const result = await loadWorkspacePath(root, codocs);
    expect(result.outcome).toBe('failed');
    expect(result.absent).toEqual([]);
    expect(result.failures).toMatchObject([
      { logicalPath: codocs, diagnostics: [{ ioCode: 'EIO' }] },
    ]);
  });
});

describe('loadWorkspacePath: 외부 연결의 발견 경로와 감시 대상', () => {
  it('빈 외부 폴더 링크를 발견하면 열거 전에 대상 등록 완료를 기다린다', async () => {
    const linked = path.join(codocs, 'linked');
    await symlink(outside, linked, 'dir');
    const started = barrier();
    const release = barrier();
    const operation = loadWorkspacePath(root, linked, {
      onLink: async () => {
        started.resolve();
        await release.promise;
      },
    });
    try {
      await started.promise;
      expect(readdir).not.toHaveBeenCalled();
      release.resolve();
      const result = await operation;
      expect(result.documents).toEqual([]);
      expect(result.links).toMatchObject([
        {
          logicalPath: linked,
          targetPath: outside,
          kind: 'directory',
          confirmed: true,
        },
      ]);
    } finally {
      release.resolve();
      await operation;
    }
  });

  it('깨진 외부 파일 링크를 확인하면 대상 위치를 등록하고 실패로 남긴다', async () => {
    const linked = path.join(codocs, 'broken.yaml');
    const target = path.join(outside, 'missing.yaml');
    await symlink(target, linked, 'file');
    const onLink = vi.fn();
    const result = await loadWorkspacePath(root, linked, { onLink });
    expect(result.outcome).toBe('failed');
    expect(result.absent).toEqual([]);
    expect(result.links).toEqual([
      {
        path: path.join('.codocs', 'broken.yaml'),
        logicalPath: linked,
        targetPath: target,
        confirmed: false,
      },
    ]);
    expect(onLink).toHaveBeenCalledWith(result.links[0]);
    expect(result.failures).toMatchObject([
      { logicalPath: linked, diagnostics: [{ ioCode: 'ENOENT' }] },
    ]);
    expect(result.failures[0]).not.toHaveProperty('realPath');
  });

  it('외부 폴더 열거가 실패해도 확인한 연결을 반환한다', async () => {
    const linked = path.join(codocs, 'linked');
    await symlink(outside, linked, 'dir');
    vi.mocked(readdir).mockRejectedValueOnce(
      Object.assign(new Error('fixture I/O'), { code: 'EIO' }),
    );
    const result = await loadWorkspacePath(root, linked);
    expect(result.outcome).toBe('failed');
    expect(result.links).toMatchObject([
      { logicalPath: linked, targetPath: outside, confirmed: true },
    ]);
    expect(result.failures).toMatchObject([
      { logicalPath: linked, realPath: outside },
    ]);
  });

  it('같은 외부 폴더의 두 별칭을 탐색하면 문서와 이벤트 대응을 발견 경로별로 보존한다', async () => {
    await writeFile(path.join(outside, 'a.yaml'), rawA);
    const left = path.join(codocs, 'left');
    const right = path.join(codocs, 'right');
    await symlink(outside, left, 'dir');
    await symlink(outside, right, 'dir');
    const result = await loadWorkspace({ cwd: fixture });
    expect(
      result.documents.map((document) => document.source.logicalPath),
    ).toEqual([path.join(left, 'a.yaml'), path.join(right, 'a.yaml')]);
    expect(
      workspacePathsForLinkEvent(
        result.links,
        path.join(outside, 'a.yaml'),
      ).sort(),
    ).toEqual([path.join(left, 'a.yaml'), path.join(right, 'a.yaml')]);
  });

  it('등록 대기 중 링크 대상이 바뀌면 새 실제 경로와 새 원문을 함께 반환한다', async () => {
    const oldTarget = path.join(outside, 'old.yaml');
    const newTarget = path.join(outside, 'new.yaml');
    const linked = path.join(codocs, 'a.yaml');
    await writeFile(oldTarget, rawA);
    await writeFile(newTarget, rawB);
    await symlink(oldTarget, linked, 'file');
    const result = await loadWorkspacePath(root, linked, {
      onLink: async (link) => {
        if (link.targetPath === oldTarget) {
          await rm(linked);
          await symlink(newTarget, linked, 'file');
        }
      },
    });
    expect(result.documents[0]?.source.realPath).toBe(newTarget);
    expect(result.documents[0]?.raw).toBe(rawB);
    expect(result.links.map((link) => link.targetPath)).toEqual([
      oldTarget,
      newTarget,
    ]);
  });

  it('파일 링크의 실대상이 바뀌면 같은 캐시에서도 새 원문을 읽는다', async () => {
    const oldTarget = path.join(outside, 'old.yaml');
    const newTarget = path.join(outside, 'new.yaml');
    const linked = path.join(codocs, 'a.yaml');
    await writeFile(oldTarget, rawA);
    await writeFile(newTarget, rawB);
    await symlink(oldTarget, linked, 'file');
    const cache = new WorkspaceObservationCache();
    const first = await loadWorkspacePath(root, linked, { cache });
    await rm(linked);
    await symlink(newTarget, linked, 'file');
    const next = await loadWorkspacePath(root, linked, { cache });
    expect(next.documents[0]?.source.realPath).toBe(newTarget);
    expect(next.documents[0]?.raw).toBe(rawB);
    expect(cache.isCurrent(first.observations[0]!)).toBe(false);
  });

  it('파일 링크의 형제 외부 신호를 받으면 읽기 범위를 확장하지 않는다', async () => {
    const target = path.join(outside, 'a.yaml');
    const linked = path.join(codocs, 'a.yaml');
    await writeFile(target, rawA);
    await symlink(target, linked, 'file');
    const initial = await loadWorkspace({ cwd: fixture });
    expect(
      workspacePathsForLinkEvent(initial.links, path.join(outside, 'b.yaml')),
    ).toEqual([]);
    expect(workspacePathsForLinkEvent(initial.links, outside)).toEqual([
      linked,
    ]);
    const denied = await loadWorkspacePath(root, target);
    expect(denied.outcome).toBe('failed');
    expect(denied.documents).toEqual([]);
    expect(denied.failures[0]?.diagnostics[0]?.code).toBe(
      'path_outside_workspace',
    );
  });

  it('범위의 조상으로 되돌아가는 링크를 직접 확인하면 순환을 건너뛴다', async () => {
    const back = path.join(codocs, 'back');
    await writeFile(path.join(codocs, 'a.yaml'), rawA);
    await symlink(codocs, back, 'dir');
    const result = await loadWorkspacePath(root, path.join(back, 'a.yaml'));
    expect(result.outcome).toBe('complete');
    expect(result.documents).toEqual([]);
    expect(result.skippedCycles).toMatchObject([{ logicalPath: back }]);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('열거 뒤 항목 부재의 직접 확인', () => {
  it('열거한 파일이 lstat 전에 삭제되면 확인 부재로 반환하고 IO 실패로 남기지 않는다', async () => {
    const target = path.join(codocs, 'a.yaml');
    await writeFile(target, rawA);
    const original =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    vi.mocked(readdir).mockImplementationOnce(
      async (...args: Parameters<typeof original.readdir>) => {
        const entries = await original.readdir(...args);
        await rm(target);
        return entries;
      },
    );
    const result = await loadWorkspacePath(root, codocs);
    expect(result.outcome).toBe('complete');
    expect(result.documents).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.absent).toEqual([
      { path: path.join('.codocs', 'a.yaml'), logicalPath: target },
    ]);
  });
});
