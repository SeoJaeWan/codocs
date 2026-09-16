/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- Vitest의 인라인 콜백은 선언 함수가 아니다. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changePlanStatuses } from '@codocs/core';
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
