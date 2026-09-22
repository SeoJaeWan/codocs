import { describe, expect, it, vi } from 'vitest';
import { osContracts } from '../../../../tools/test-support/os-contracts.js';

const boundary = vi.hoisted(() => ({
  platform: 'win32',
  entries: new Map<
    string,
    { kind: 'file' | 'directory' | 'link'; real: string; target?: string }
  >(),
  denied: new Map<string, string>(),
  calls: [] as string[],
}));
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    default: new Proxy(actual.posix, {
      get(_target, key): unknown {
        return Reflect.get(
          boundary.platform === 'win32' ? actual.win32 : actual.posix,
          key,
        ) as unknown;
      },
    }),
  };
});
vi.mock('node:fs/promises', () => {
  const lookup = (input: string) => {
    boundary.calls.push(input);
    const code = boundary.denied.get(input);
    if (code) throw Object.assign(new Error(code), { code });
    const entry = boundary.entries.get(input);
    if (!entry)
      throw Object.assign(new Error('missing ' + input), { code: 'ENOENT' });
    return entry;
  };
  return {
    lstat: (input: string) =>
      Promise.resolve({
        isSymbolicLink: () => lookup(input).kind === 'link',
      }),
    stat: (input: string) => {
      const entry = lookup(input);
      const target = entry.kind === 'link' ? lookup(entry.real) : entry;
      return Promise.resolve({
        isDirectory: () => target.kind === 'directory',
        isFile: () => target.kind === 'file',
        dev: 1n,
        ino: 1n,
      });
    },
    realpath: (input: string) => {
      const entry = lookup(input);
      lookup(entry.real);
      return Promise.resolve(entry.real);
    },
    readlink: (input: string) => Promise.resolve(lookup(input).target),
    access: (input: string) => {
      lookup(input);
      return Promise.resolve();
    },
  };
});
import { resolveProjectRoot } from '../project-root/index.js';
import { resolveWorkspacePath } from './index.js';

describe.each(osContracts)(
  '$platform 경로·연결·권한 syscall 경계',
  (contract) => {
    /** 각 OS의 원래 절대 경로와 readlink 원문을 그대로 제공한다. */
    function prepare(): void {
      boundary.platform = contract.platform;
      boundary.entries.clear();
      boundary.denied.clear();
      boundary.calls.length = 0;
      for (const name of [contract.root, contract.codocs, contract.target])
        boundary.entries.set(name, { kind: 'directory', real: name });
      boundary.entries.set(contract.logical, {
        kind: 'link',
        real: contract.target,
        target: contract.readlink,
      });
      boundary.entries.set(contract.child, {
        kind: 'file',
        real: contract.child,
      });
      const logicalChild =
        contract.platform === 'win32'
          ? 'C:\\자료 공간\\.codocs\\연결\\한글.yaml'
          : '/자료 공간/.codocs/연결/한글.yaml';
      boundary.entries.set(logicalChild, {
        kind: 'file',
        real: contract.child,
      });
    }

    it('원래 OS 경로와 연결 원문을 전달하면 실제 경로 계산으로 발견 경로와 외부 범위를 반환한다', async () => {
      prepare();
      const selected = await resolveProjectRoot({ cwd: contract.root });
      expect(selected.success).toBe(true);
      if (!selected.success) throw new Error('root');
      const result = await resolveWorkspacePath(selected.root, contract.input);
      expect(result).toMatchObject({
        success: true,
        path: contract.discovered,
        realPath: contract.child,
        scope: { logicalPath: contract.logical, realPath: contract.target },
        links: [{ targetPath: contract.target, confirmed: true }],
      });
      expect(boundary.calls).toContain(contract.logical);
    });

    it('연결 뒤 상위 이동을 요청하면 OS 정규화로 경계를 지우지 않고 거부한다', async () => {
      prepare();
      const selected = await resolveProjectRoot({ cwd: contract.root });
      if (!selected.success) throw new Error('root');
      const result = await resolveWorkspacePath(
        selected.root,
        '.codocs/연결/../비밀.yaml',
      );
      expect(result).toMatchObject({ success: false, status: 'denied' });
      expect(boundary.calls.some((name) => name.includes('비밀'))).toBe(false);
    });

    it.each(contract.deniedCodes)(
      '%s 권한 오류가 발생하면 빈 성공 대신 원래 IO 원인을 보존한다',
      async (code) => {
        prepare();
        const selected = await resolveProjectRoot({ cwd: contract.root });
        if (!selected.success) throw new Error('root');
        boundary.denied.set(contract.logical, code);
        expect(
          await resolveWorkspacePath(selected.root, contract.input),
        ).toMatchObject({
          success: false,
          status: 'unavailable',
          diagnostics: [{ ioCode: code }],
        });
      },
    );

    it('끊어진 링크를 발견하면 ENOENT를 일반 파일 삭제로 바꾸지 않는다', async () => {
      prepare();
      const selected = await resolveProjectRoot({ cwd: contract.root });
      if (!selected.success) throw new Error('root');
      boundary.entries.delete(contract.target);
      expect(
        await resolveWorkspacePath(selected.root, contract.input),
      ).toMatchObject({
        success: false,
        status: 'unavailable',
        links: [{ targetPath: contract.target, confirmed: false }],
        diagnostics: [{ ioCode: 'ENOENT' }],
      });
    });
  },
);
