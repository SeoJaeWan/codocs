import {
  mkdir,
  mkdtemp,
  open as openFile,
  readdir,
  readFile,
  rename as renameFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import { loadWorkspace } from '../loader/index.js';
import { prepareWorkspaceRename } from '../rename/index.js';
import { applyWorkspaceRename } from './index.js';

let root: string;
const orderPath = path.join('.codocs', 'order.yaml');
const sourcePath = path.join('.codocs', 'source.yaml');
const order =
  "id: order\nname: '주문'\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: 주문 설명\n";
const source =
  'id: source\nname: 출처\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: "참조 [[주문]]"\n';

/** 실패 연산에 실제 시스템 코드 형태를 부여한다. */
function ioError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** 프로젝트 .codocs에 테스트 문서를 쓴다. 키는 .codocs 아래 파일 이름이다. */
async function writeDocuments(files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files))
    await writeFile(path.join(root, '.codocs', name), content);
}

/** .codocs 파일의 현재 내용을 읽는다. */
async function read(name: string): Promise<string> {
  return readFile(path.join(root, '.codocs', name), 'utf8');
}

/** 현재 디스크를 스캔하고 미리보기에서 받은 revision과 함께 반영 입력을 만든다. */
async function previewed(
  selections: readonly {
    sourcePath: string;
    occurrenceIndex: number;
    targetPath: string;
  }[] = [],
  newName = '새주문',
) {
  const scan = await loadWorkspace({ cwd: root });
  const catalog = buildWorkspaceCatalog(scan);
  const request = { targetPath: orderPath, newName, selections };
  const { preview } = prepareWorkspaceRename(request, scan, catalog);
  return {
    scan,
    catalog,
    input: { ...request, revisions: preview.revisions },
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-rename-apply-'));
  await mkdir(path.join(root, '.codocs'));
  await writeDocuments({ 'order.yaml': order, 'source.yaml': source });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('applyWorkspaceRename: 이름 변경 반영', () => {
  describe('영향받는 모든 파일의 반영과 형식 보존', () => {
    it('이름과 참조를 새 이름으로 바꾸고 파일별 상태와 새 revision을 보고한다', async () => {
      const { scan, catalog, input } = await previewed();
      const result = await applyWorkspaceRename(input, scan, catalog);

      expect(result).toMatchObject({
        success: true,
        status: 'ready',
        saved: true,
        changed: true,
        files: [
          { path: orderPath, state: 'changed' },
          { path: sourcePath, state: 'changed' },
        ],
      });
      expect(await read('order.yaml')).toBe(
        "id: order\nname: '새주문'\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: 주문 설명\n",
      );
      expect(await read('source.yaml')).toBe(
        'id: source\nname: 출처\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: "참조 [[새주문]]"\n',
      );
    });

    it('반영 뒤 임시 파일을 남기지 않는다', async () => {
      const { scan, catalog, input } = await previewed();
      await applyWorkspaceRename(input, scan, catalog);

      expect(await readdir(path.join(root, '.codocs'))).toEqual([
        'order.yaml',
        'source.yaml',
      ]);
    });

    it('고를 참조가 남은 unresolved 상태도 반영하고 고르지 않은 참조는 원문 그대로 둔다', async () => {
      await writeDocuments({
        'purchase-order.yaml':
          'id: purchase-order\nname: 주문\ndomains: [구매]\ndeprecatedAliases: []\ndefinition: 구매\n',
      });
      const { scan, catalog, input } = await previewed();
      const result = await applyWorkspaceRename(input, scan, catalog);

      expect(result).toMatchObject({
        success: true,
        status: 'unresolved',
        files: [{ path: orderPath, state: 'changed' }],
      });
      expect(await read('source.yaml')).toBe(source);
      expect(await read('order.yaml')).toContain("name: '새주문'");
    });

    it('이름이 같고 고칠 참조도 없으면 파일을 바꾸지 않고 변경 없음으로 반환한다', async () => {
      const { scan, catalog, input } = await previewed([], '주문');
      const result = await applyWorkspaceRename(input, scan, catalog);

      expect(result).toMatchObject({
        success: true,
        saved: false,
        changed: false,
        files: [],
      });
      expect(await read('order.yaml')).toBe(order);
    });
  });

  describe('진행할 수 없는 이름 변경과 오래된 미리보기의 거절', () => {
    it('같은 도메인에 새 이름과 같은 문서가 있으면 blocked로 거절하고 파일을 바꾸지 않는다', async () => {
      await writeDocuments({
        'other.yaml':
          'id: other\nname: 새주문\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: 설명\n',
      });
      const { scan, catalog, input } = await previewed();
      const result = await applyWorkspaceRename(input, scan, catalog);

      expect(result).toMatchObject({
        success: false,
        saved: false,
        changed: false,
        files: [],
        diagnostics: [{ code: 'rename_blocked' }],
        preview: { status: 'blocked', blockingReason: 'name_conflict' },
      });
      expect(await read('order.yaml')).toBe(order);
      expect(await read('source.yaml')).toBe(source);
    });

    it('미리보기 뒤 영향 파일의 내용이 바뀌면 revision_conflict로 거절하고 파일을 바꾸지 않는다', async () => {
      const { input } = await previewed();
      const changed = source.replace('참조', '변경된 참조');
      await writeDocuments({ 'source.yaml': changed });
      const scan = await loadWorkspace({ cwd: root });
      const result = await applyWorkspaceRename(
        input,
        scan,
        buildWorkspaceCatalog(scan),
      );

      expect(result).toMatchObject({
        success: false,
        saved: false,
        changed: false,
        diagnostics: [{ code: 'revision_conflict', path: sourcePath }],
      });
      expect(await read('order.yaml')).toBe(order);
      expect(await read('source.yaml')).toBe(changed);
    });

    it('미리보기 뒤 새 파일이 영향 파일에 더해지면 영향 파일 집합 변경으로 거절하고 미리보기를 안내한다', async () => {
      const { input } = await previewed();
      await writeDocuments({
        'late.yaml':
          'id: late\nname: 늦은 문서\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: "[[주문]]"\n',
      });
      const scan = await loadWorkspace({ cwd: root });
      const result = await applyWorkspaceRename(
        input,
        scan,
        buildWorkspaceCatalog(scan),
      );

      expect(result).toMatchObject({
        success: false,
        saved: false,
        diagnostics: [
          {
            code: 'rename_affected_files_changed',
            path: path.join('.codocs', 'late.yaml'),
          },
        ],
      });
      expect(await read('order.yaml')).toBe(order);
    });

    it('스캔 이후 디스크 파일이 바뀌었으면 쓰기 전 확인에서 revision_conflict로 거절한다', async () => {
      const { scan, catalog, input } = await previewed();
      const changed = source.replace('참조', '외부 수정');
      await writeDocuments({ 'source.yaml': changed });
      const result = await applyWorkspaceRename(input, scan, catalog);

      expect(result).toMatchObject({
        success: false,
        saved: false,
        files: [],
        diagnostics: [{ code: 'revision_conflict', path: sourcePath }],
      });
      expect(await read('order.yaml')).toBe(order);
    });

    it('revisions 없이 요청하면 입력 오류로 거절한다', async () => {
      const { scan, catalog } = await previewed();
      const result = await applyWorkspaceRename(
        { targetPath: orderPath, newName: '새주문' },
        scan,
        catalog,
      );

      expect(result).toMatchObject({
        success: false,
        diagnostics: [{ code: 'invalid_input' }],
      });
    });
  });

  describe('쓰기 전 확인 실패 시 파일 변경 방지', () => {
    it('두 번째 파일에 임시 파일을 만들 수 없으면 아무 파일도 쓰지 않고 이유를 알린다', async () => {
      const { scan, catalog, input } = await previewed();
      let opens = 0;
      const result = await applyWorkspaceRename(input, scan, catalog, {
        operations: {
          open: async (target, flags, mode) => {
            opens++;
            if (opens === 2) throw ioError('EACCES');
            return openFile(target, flags, mode);
          },
        },
      });

      expect(result).toMatchObject({
        success: false,
        saved: false,
        changed: false,
        files: [],
        diagnostics: [
          { code: 'file_write_failed', path: sourcePath, ioCode: 'EACCES' },
        ],
      });
      expect(await read('order.yaml')).toBe(order);
      expect(await read('source.yaml')).toBe(source);
      expect(await readdir(path.join(root, '.codocs'))).toEqual([
        'order.yaml',
        'source.yaml',
      ]);
    });

    it('영향 파일 중 하나가 사라졌으면 아무 파일도 쓰지 않고 이유를 알린다', async () => {
      const { scan, catalog, input } = await previewed();
      await rm(path.join(root, '.codocs', 'source.yaml'));
      const result = await applyWorkspaceRename(input, scan, catalog);

      expect(result).toMatchObject({ success: false, saved: false, files: [] });
      expect(result.diagnostics[0]?.path).toContain('source');
      expect(await read('order.yaml')).toBe(order);
    });
  });

  describe('쓰기 중간 실패의 복구와 파일별 상태 보고', () => {
    /** 지정한 대상 파일 이름으로의 교체만 실패시키고 나머지는 실제 rename을 수행한다. */
    function failingRename(
      failures: (target: string, call: number) => boolean,
    ): (from: string, to: string) => Promise<void> {
      let calls = 0;
      return async (from, to) => {
        calls++;
        if (failures(to, calls)) throw ioError('EIO');
        await renameFile(from, to);
      };
    }

    it('두 번째 파일 교체가 실패하면 첫 파일을 원래 내용으로 복구하고 파일별 상태를 보고한다', async () => {
      const { scan, catalog, input } = await previewed();
      const result = await applyWorkspaceRename(input, scan, catalog, {
        operations: {
          rename: failingRename((target) => target.endsWith('source.yaml')),
        },
      });

      expect(result).toMatchObject({
        success: false,
        saved: false,
        changed: false,
        files: [
          { path: orderPath, state: 'restored' },
          { path: sourcePath, state: 'unchanged' },
        ],
        diagnostics: [
          { code: 'file_write_failed', path: sourcePath, ioCode: 'EIO' },
        ],
      });
      expect(await read('order.yaml')).toBe(order);
      expect(await read('source.yaml')).toBe(source);
    });

    it('복구까지 실패하면 그 파일을 복구 실패로 보고하고 새 내용이 남았음을 알린다', async () => {
      const { scan, catalog, input } = await previewed();
      const result = await applyWorkspaceRename(input, scan, catalog, {
        operations: {
          rename: failingRename(
            (target, call) => target.endsWith('source.yaml') || call >= 3,
          ),
        },
      });

      expect(result).toMatchObject({
        success: false,
        saved: true,
        changed: true,
        files: [
          { path: orderPath, state: 'restore_failed' },
          { path: sourcePath, state: 'unchanged' },
        ],
      });
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'rename_restore_failed',
          path: orderPath,
        }),
      );
      expect(await read('order.yaml')).toContain("name: '새주문'");
    });

    it('복구 시점에 다른 프로세스가 파일을 바꿨으면 덮어쓰지 않고 복구 실패로 보고한다', async () => {
      const { scan, catalog, input } = await previewed();
      let appliedCalls = 0;
      const external =
        "id: order\nname: '외부'\ndomains: [판매]\ndeprecatedAliases: []\ndefinition: 외부\n";
      const result = await applyWorkspaceRename(input, scan, catalog, {
        operations: {
          rename: async (from, to) => {
            appliedCalls++;
            if (to.endsWith('source.yaml')) {
              await writeFile(
                path.join(root, '.codocs', 'order.yaml'),
                external,
              );
              throw ioError('EIO');
            }
            await renameFile(from, to);
          },
        },
      });

      expect(result).toMatchObject({
        success: false,
        files: [
          { path: orderPath, state: 'restore_failed' },
          { path: sourcePath, state: 'unchanged' },
        ],
      });
      expect(appliedCalls).toBe(2);
      expect(await read('order.yaml')).toBe(external);
    });
  });
});
