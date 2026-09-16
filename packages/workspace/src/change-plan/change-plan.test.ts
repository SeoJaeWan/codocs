/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- Vitest의 인라인 콜백은 선언 함수가 아니다. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changePlanStatuses, parseYaml } from '@codocs/core';
import { describe, expect, it } from 'vitest';
import { loadWorkspace } from '../loader/index.js';
import { calculateRevision } from '../revision/index.js';
import { planWorkspaceChange } from './index.js';

describe('작업 공간의 미저장 변경 계획', () => {
  it('한 번 읽은 바이트 revision을 확인하고 디스크를 수정하지 않는다', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codocs-change-plan-'));
    try {
      const folder = path.join(root, '.codocs');
      await mkdir(folder);
      const file = path.join(folder, 'zone.yaml');
      const bytes = Buffer.from(
        'id: zone\r\nname: 구역\r\ndomains: [운영]\r\ndefinition: 설명\r\n',
      );
      await writeFile(file, bytes);
      const scan = await loadWorkspace({ cwd: root });
      const original = scan.documents[0];
      expect(original?.revision).toBe(calculateRevision(bytes));
      const result = planWorkspaceChange(
        {
          mode: 'update',
          id: 'zone',
          revision: original?.revision,
          set: { id: 'next-zone' },
        },
        scan,
      );
      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate) {
        expect(result.baseRevision).toBe(original?.revision);
        expect(result.revision).toBe(
          calculateRevision(Buffer.from(result.raw)),
        );
      }
      expect(await readFile(file)).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('실제 파일의 원문과 revision으로 ID 후보를 재파싱하고 충돌을 진단하되 저장하지 않는다', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codocs-change-plan-flow-'));
    try {
      const folder = path.join(root, '.codocs');
      await mkdir(folder);
      const targetPath = path.join(folder, 'zone.yaml');
      const targetBytes = Buffer.from(
        '# 그대로 보존\r\nid: zone\r\nname: 구역\r\ndefinition: 설명\r\ndomains: [운영]\r\ndeprecatedAliases:\r\n  - id: return-zone\r\n    message: 기존 안내\r\n',
      );
      await writeFile(targetPath, targetBytes);
      await writeFile(
        path.join(folder, 'taken.yaml'),
        'id: taken\nname: 다른 문서\ndefinition: 설명\ndomains: [운영]\n',
      );
      await writeFile(
        path.join(folder, 'unrelated.yaml'),
        'id: unrelated\nname: 오류 문서\ndomains: [운영]\n',
      );
      const scan = await loadWorkspace({ cwd: root });
      const source = scan.documents.find(
        (item) => item.source.path === '.codocs/zone.yaml',
      );
      expect(source?.raw).toBe(targetBytes.toString('utf8'));
      expect(source?.revision).toBe(calculateRevision(targetBytes));
      expect(source?.utf8Lossless).toBe(true);

      const request = {
        mode: 'update',
        id: 'zone',
        revision: source?.revision,
        set: { id: 'next-zone' },
      };
      const result = planWorkspaceChange(request, scan);
      expect(result.status).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate) {
        expect(result.baseRevision).toBe(source?.revision);
        expect(result.revision).toBe(
          calculateRevision(Buffer.from(result.raw)),
        );
        expect(result.raw).toContain('# 그대로 보존\r\n');
        expect(result.raw).toContain('message: 기존 안내\r\n');
        const parsed = parseYaml(result.raw, '.codocs/zone.yaml');
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data).toEqual(result.data);
        expect(result.data.deprecatedAliases).toEqual([
          { id: 'return-zone', message: '기존 안내' },
          { id: 'zone' },
        ]);
        expect(
          result.diagnostics.some(
            (issue) => issue.path === '.codocs/unrelated.yaml',
          ),
        ).toBe(false);
        expect(Object.hasOwn(result, 'saved')).toBe(false);
      }
      expect(request.set.id).toBe('next-zone');
      expect(source?.raw).toBe(targetBytes.toString('utf8'));
      expect(await readFile(targetPath)).toEqual(targetBytes);

      const collision = planWorkspaceChange(
        { ...request, set: { id: 'taken' } },
        scan,
      );
      expect(collision.status).toBe(changePlanStatuses.failed);
      if (collision.status === changePlanStatuses.failed) {
        expect(
          collision.diagnostics.some((issue) => issue.code === 'duplicate_id'),
        ).toBe(true);
        expect(
          collision.diagnostics.some(
            (issue) => issue.path === '.codocs/unrelated.yaml',
          ),
        ).toBe(false);
      }
      const sameId = planWorkspaceChange(
        { ...request, set: { id: 'zone' } },
        scan,
      );
      expect(sameId.status).toBe(changePlanStatuses.unchanged);
      if (sameId.status === changePlanStatuses.unchanged)
        expect(sameId.revision).toBe(source?.revision);
      const protectedList = planWorkspaceChange(
        { ...request, set: { deprecatedAliases: [] } },
        scan,
      );
      expect(protectedList.status).toBe(changePlanStatuses.failed);
      expect(await readFile(targetPath)).toEqual(targetBytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('요청 접근자를 실행하지 않고 실패한다', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codocs-change-plan-'));
    try {
      const scan = await loadWorkspace({ cwd: root });
      let invoked = 0;
      const request = Object.defineProperty({}, 'mode', {
        get() {
          invoked++;
          return 'update';
        },
        enumerable: true,
      });
      expect(planWorkspaceChange(request, scan).status).toBe(
        changePlanStatuses.failed,
      );
      expect(invoked).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
