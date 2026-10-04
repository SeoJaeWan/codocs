import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspaceQuerySession,
  workspaceIndexNotReady,
} from './index.js';

let fixture: string;

beforeAll(async () => {
  await mkdir('.workbench', { recursive: true });
  fixture = await mkdtemp(path.resolve('.workbench/shared-results-'));
  await mkdir(path.join(fixture, '.codocs'));
  await writeFile(
    path.join(fixture, '.codocs', 'one.yaml'),
    '_codocs:\n  id: one\n  name: 하나\ndefinition: 본문\n',
  );
});

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe('workspace 공통 조회 결과', () => {
  it('준비 중 결과를 실제 읽기 실패와 다른 진단으로 만든다', () => {
    expect(workspaceIndexNotReady()).toEqual({
      success: false,
      scanStatus: 'failed',
      error: {
        code: 'index_not_ready',
        severity: 'error',
        message: '문서 색인을 구성하는 중입니다. 완료 후 다시 조회하세요.',
      },
    });
  });

  it('초기 동시 목록·상세는 같은 완료 관측을 기다리고 개별 부재를 요청 성공으로 보존한다', async () => {
    const session = createWorkspaceQuerySession({ project: fixture });
    try {
      const [list, get] = await Promise.all([
        session.list(),
        session.get(['one', 'missing']),
      ]);
      expect(list).toMatchObject({
        success: true,
        scanStatus: 'complete',
        totalCount: 1,
      });
      expect(get).toMatchObject({ success: true, scanStatus: 'complete' });
      if (get.success) {
        expect(get.results[0]).toMatchObject({ id: 'one', found: true });
        expect(get.results[1]).toMatchObject({
          id: 'missing',
          found: false,
          diagnostics: [{ code: 'not_found' }],
        });
      }
      const refresh = await session.refresh();
      expect(refresh).toMatchObject({
        success: true,
        fileCount: 1,
        itemCount: 1,
      });
    } finally {
      await session.close();
    }
  });

  it('진행 중 읽기와 동시에 닫아도 세션을 다시 준비하지 않는다', async () => {
    const session = createWorkspaceQuerySession({ project: fixture });
    const pending = session.list();
    await session.close();
    await pending;
    expect(session.readiness.state).toBe('closed');
    const late = await session.get(['one']);
    expect(late).toMatchObject({ success: false, scanStatus: 'failed' });
    expect(session.readiness.state).toBe('closed');
  });
});
