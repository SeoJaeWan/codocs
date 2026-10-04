import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changePlanStatuses } from '@codocs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from '../loader/index.js';
import { planWorkspaceChange } from './index.js';

const original =
  '# 그대로 보존\r\n_codocs:\r\n  id: zone\r\n  name: 구역\r\ndefinition: 설명\r\n';
let root: string;
let file: string;
const zonePath = path.join('.codocs', 'zone.yaml');
const unrelatedPath = path.join('.codocs', 'unrelated.yaml');

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-change-plan-'));
  const folder = path.join(root, '.codocs');
  await mkdir(folder);
  file = path.join(folder, 'zone.yaml');
  await writeFile(file, original);
  await writeFile(
    path.join(folder, 'taken.yaml'),
    '_codocs:\n  id: taken\n  name: 다른 문서\ndefinition: 설명\n',
  );
  await writeFile(
    path.join(folder, 'unrelated.yaml'),
    '_codocs:\n  id: unrelated\n  name: 오류 문서\n',
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('planWorkspaceChange: 읽은 파일을 바탕으로 변경 계획 작성', () => {
  describe('문서 변경 후보와 원본 보존', () => {
    it('문서 설명 변경을 계획하면 새 설명을 가진 후보를 반환한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const source = scan.documents.find(
        (item) => item.source.path === zonePath,
      );
      const request = {
        mode: 'update',
        id: 'zone',
        revision: source?.revision,
        set: { definition: '새 설명' },
      };

      const result = planWorkspaceChange(request, scan);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.path).toBe(source?.source.path);
      expect(result.data.definition).toBe(request.set.definition);
    });

    it('_codocs로 ID를 변경하면 주석·개행을 보존하고 후보를 반환한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const source = scan.documents.find(
        (item) => item.source.path === zonePath,
      );
      const request = {
        mode: 'update',
        id: 'zone',
        revision: source?.revision,
        set: { _codocs: { id: 'next-zone', name: '구역' } },
      };

      const result = planWorkspaceChange(request, scan);

      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status !== changePlanStatuses.candidate) return;
      expect(result.baseRevision).toBe(request.revision);
      expect(result.raw).toContain('# 그대로 보존\r\n');
      expect(result.data._codocs.id).toBe(request.set._codocs.id);
      expect(result.revision).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ path: unrelatedPath }),
      );
    });

    it('ID 변경 후보를 계획하면 파일과 요청 객체를 수정하지 않는다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const source = scan.documents.find(
        (item) => item.source.path === zonePath,
      );
      const request = {
        mode: 'update',
        id: 'zone',
        revision: source?.revision,
        set: { _codocs: { id: 'next-zone', name: '구역' } },
      };
      const before = structuredClone(request);

      const result = planWorkspaceChange(request, scan);

      expect(result.status).toBe(changePlanStatuses.candidate);
      expect(request).toEqual(before);
      expect(source?.raw).toBe(original);
      expect(await readFile(file, 'utf8')).toBe(original);
      expect(result).not.toHaveProperty('saved');
    });
  });

  describe('ID 충돌과 변경 없는 요청 처리', () => {
    it('다른 문서가 사용 중인 ID로 변경하면 중복 ID 오류를 반환한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const source = scan.documents.find(
        (item) => item.source.path === zonePath,
      );
      const request = {
        mode: 'update',
        id: 'zone',
        revision: source?.revision,
        set: { _codocs: { id: 'taken', name: '구역' } },
      };

      const result = planWorkspaceChange(request, scan);

      expect(result.status).toBe(changePlanStatuses.failed);
      if (result.status !== changePlanStatuses.failed) return;
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'duplicate_id' }),
      );
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ path: unrelatedPath }),
      );
      expect(await readFile(file, 'utf8')).toBe(original);
    });

    it('기존 ID로 변경을 요청하면 원래 revision과 함께 변경 없음을 반환한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      const source = scan.documents.find(
        (item) => item.source.path === zonePath,
      );
      const request = {
        mode: 'update',
        id: 'zone',
        revision: source?.revision,
        set: { _codocs: { id: 'zone', name: '구역' } },
      };

      const result = planWorkspaceChange(request, scan);

      expect(result.status).toBe(changePlanStatuses.unchanged);
      if (result.status === changePlanStatuses.unchanged)
        expect(result.revision).toBe(source?.revision);
    });
  });

  describe('요청 접근자 실행 방지', () => {
    it('요청 속성에 접근자가 있으면 실행하지 않고 실패한다', async () => {
      const scan = await loadWorkspace({ cwd: root });
      let invoked = 0;
      const request = Object.defineProperty({}, 'mode', {
        /** 접근자 실행 여부를 관찰한다. */
        get() {
          invoked++;
          return 'update';
        },
        enumerable: true,
      });

      const result = planWorkspaceChange(request, scan);

      expect(result.status).toBe(changePlanStatuses.failed);
      expect(invoked).toBe(0);
    });
  });
});
