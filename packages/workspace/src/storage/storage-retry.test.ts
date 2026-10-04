import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from '../loader/index.js';
import { createLink } from '../test-support/links.js';
import { holdWindowsFile } from '../test-support/windows-file-handle.js';
import { saveWorkspaceChange } from './index.js';

let root: string;
let folder: string;
let target: string;
const original = '_codocs:\n  id: first\n  name: First\ndefinition: Original\n';
const input = {
  mode: 'update',
  id: 'first',
  revision: createHash('sha256').update(original).digest('hex'),
  set: { definition: 'Updated' },
};

describe.skipIf(process.platform !== 'win32')(
  'Windows rename EPERM의 제한 재시도',
  () => {
    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), 'codocs-storage-retry-'));
      folder = path.join(root, '.codocs');
      target = path.join(folder, 'first.yaml');
      await mkdir(folder);
      await writeFile(target, original);
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('실제 삭제 공유 거부 핸들이 풀리면 같은 revision으로 저장한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const release = await holdWindowsFile(target);
      const failures: NodeJS.ErrnoException[] = [];
      let attempts = 0;
      try {
        const result = await saveWorkspaceChange(input, scan, {
          operations: {
            rename: async (source, destination) => {
              attempts++;
              try {
                await rename(source, destination);
              } catch (error) {
                failures.push(error as NodeJS.ErrnoException);
                expect(await readFile(target, 'utf8')).toBe(original);
                await release();
                throw error;
              }
            },
          },
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          code: 'EPERM',
          syscall: 'rename',
          dest: target,
        });
        expect(attempts).toBe(2);
        expect(result).toMatchObject({
          success: true,
          saved: true,
          changed: true,
        });
        expect(await readFile(target, 'utf8')).toBe(
          original.replace('Original', 'Updated'),
        );
        expect(await readdir(folder)).toEqual(['first.yaml']);
      } finally {
        await release();
      }
    });

    it('실제 공유 거부가 계속되면 네 번 안에 실패하고 원본과 오류를 보존한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const release = await holdWindowsFile(target);
      let attempts = 0;
      try {
        const result = await saveWorkspaceChange(input, scan, {
          operations: {
            rename: async (source, destination) => {
              attempts++;
              await rename(source, destination);
            },
          },
        });
        expect(attempts).toBe(4);
        expect(result).toMatchObject({
          success: false,
          saved: false,
          changed: false,
        });
        expect(result.diagnostics[0]).toMatchObject({
          code: 'file_write_failed',
          ioCode: 'EPERM',
        });
        expect(await readFile(target, 'utf8')).toBe(original);
        expect(await readdir(folder)).toEqual(['first.yaml']);
      } finally {
        await release();
      }
    });

    it('재시도 전에 외부 원문이 바뀌면 새 revision을 자동 적용하지 않는다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const changed = original.replace('Original', 'External');
      let attempts = 0;
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          rename: async () => {
            attempts++;
            await writeFile(target, changed);
            throw Object.assign(new Error('sharing violation'), {
              code: 'EPERM',
            });
          },
        },
      });
      expect(attempts).toBe(1);
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'revision_conflict',
      });
      expect(await readFile(target, 'utf8')).toBe(changed);
      expect(await readdir(folder)).toEqual(['first.yaml']);
    });

    it('재시도 전에 부모가 정션으로 바뀌면 외부 원문과 기존 임시 파일을 보존한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const external = path.join(root, 'outside');
      const moved = path.join(root, 'original');
      await mkdir(external);
      await writeFile(path.join(external, 'first.yaml'), original);
      const preparedLink = path.join(root, 'junction');
      await createLink(external, preparedLink, 'junction');
      let attempts = 0;
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          rename: async () => {
            attempts++;
            await rename(folder, moved);
            await rename(preparedLink, folder);
            throw Object.assign(new Error('sharing violation'), {
              code: 'EPERM',
            });
          },
        },
      });
      expect(attempts).toBe(1);
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'unsupported_workspace_link',
      });
      expect(await readFile(path.join(external, 'first.yaml'), 'utf8')).toBe(
        original,
      );
      expect(await readFile(path.join(moved, 'first.yaml'), 'utf8')).toBe(
        original,
      );
      expect(
        (await readdir(moved)).some((name) =>
          name.startsWith('.codocs-write-'),
        ),
      ).toBe(true);
    });

    it('재시도 전에 대상이 같은 바이트의 다른 파일로 교체되면 덮어쓰지 않는다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      let attempts = 0;
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          rename: async () => {
            attempts++;
            await rename(target, path.join(root, 'original.yaml'));
            await writeFile(target, original);
            throw Object.assign(new Error('sharing violation'), {
              code: 'EPERM',
            });
          },
        },
      });
      expect(attempts).toBe(1);
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'file_access_failed',
      });
      expect(await readFile(target, 'utf8')).toBe(original);
      expect(await readdir(folder)).toEqual(['first.yaml']);
    });

    it('재시도 전에 임시 파일의 바이트가 바뀌면 후보를 반영하지 않는다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      let attempts = 0;
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          rename: async (source) => {
            attempts++;
            await writeFile(source, 'changed candidate');
            throw Object.assign(new Error('sharing violation'), {
              code: 'EPERM',
            });
          },
        },
      });
      expect(attempts).toBe(1);
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'file_write_failed',
      });
      expect(await readFile(target, 'utf8')).toBe(original);
      expect(await readdir(folder)).toEqual(['first.yaml']);
    });

    it('재시도 전에 동일 ID 문서가 생기면 충돌을 다시 검사한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      let attempts = 0;
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          rename: async () => {
            attempts++;
            await writeFile(path.join(folder, 'other.yaml'), original);
            throw Object.assign(new Error('sharing violation'), {
              code: 'EPERM',
            });
          },
        },
      });
      expect(attempts).toBe(1);
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({ code: 'duplicate_id' });
      expect(await readFile(target, 'utf8')).toBe(original);
    });

    it.each(['EACCES', 'EIO'])(
      'rename이 %s로 실패하면 재시도하지 않는다',
      async (code) => {
        const scan = await loadWorkspace({ cwd: root });
        let attempts = 0;
        const result = await saveWorkspaceChange(input, scan, {
          operations: {
            rename: () => {
              attempts++;
              return Promise.reject(Object.assign(new Error(code), { code }));
            },
          },
        });
        expect(attempts).toBe(1);
        expect(result).toMatchObject({ success: false, saved: false });
        expect(result.diagnostics[0]).toMatchObject({
          code: 'file_write_failed',
          ioCode: code,
        });
        expect(await readFile(target, 'utf8')).toBe(original);
      },
    );

    it('임시 파일 읽기가 EPERM이면 rename 재시도로 바꾸지 않는다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      let attempts = 0;
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          readFile: async (source) => {
            if (source.endsWith('.tmp'))
              throw Object.assign(new Error('read denied'), { code: 'EPERM' });
            return readFile(source);
          },
          rename: () => {
            attempts++;
            return Promise.resolve();
          },
        },
      });
      expect(attempts).toBe(0);
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'file_write_failed',
        ioCode: 'EPERM',
      });
      expect(await readFile(target, 'utf8')).toBe(original);
      expect(await readdir(folder)).toEqual(['first.yaml']);
    });

    it('재시도 전에 임시 파일이 교체되면 다른 파일을 반영하거나 정리하지 않는다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      let replacedTemp = '';
      let attempts = 0;
      const result = await saveWorkspaceChange(input, scan, {
        operations: {
          rename: async (source) => {
            attempts++;
            replacedTemp = source;
            await rename(source, path.join(root, 'owned.tmp'));
            await writeFile(source, 'foreign');
            throw Object.assign(new Error('sharing violation'), {
              code: 'EPERM',
            });
          },
        },
      });
      expect(attempts).toBe(1);
      expect(result).toMatchObject({ success: false, saved: false });
      expect(result.diagnostics[0]).toMatchObject({
        code: 'file_write_failed',
      });
      expect(await readFile(target, 'utf8')).toBe(original);
      expect(await readFile(replacedTemp, 'utf8')).toBe('foreign');
      expect(await readFile(path.join(root, 'owned.tmp'), 'utf8')).toContain(
        'Updated',
      );
      expect(result.diagnostics).toHaveLength(2);
    });
  },
);
