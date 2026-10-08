import { ioFailures } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceQuerySession } from './index.js';
import type { WorkspaceQuerySession } from './index.js';
import { calculateRevision } from '../revision/index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

let project: string;
const sessions: WorkspaceQuerySession[] = [];

/** 사례가 연 세션을 정리 대상으로 추적한다. */
function openSession(): WorkspaceQuerySession {
  const session = createWorkspaceQuerySession({ cwd: project });
  sessions.push(session);
  return session;
}

beforeEach(
  /** 사례마다 독립된 실제 프로젝트에서 시작한다. */ async () => {
    const parent = path.resolve('.workbench/fixtures');
    await mkdir(parent, { recursive: true });
    project = await mkdtemp(path.join(parent, 'search-'));
    await mkdir(path.join(project, '.codocs'));
  },
);

afterEach(
  /** 사례가 만든 fixture만 정리한다. */ async () => {
    ioFailures.clear();
    await Promise.all(sessions.splice(0).map((session) => session.close()));
    await rmWithRetry(project, { recursive: true, force: true });
  },
);

/** 실제 문서 파일을 쓰고 경로를 돌려준다. */
async function file(name: string, raw: string): Promise<string> {
  const target = path.join(project, '.codocs', name);
  await writeFile(target, raw);
  return target;
}

describe('workspace 세션 search', () => {
  it('검색 결과 주소를 get에 넘기면 모두 found이고 이름이 충돌한 문서는 conflict다', async () => {
    await file(
      'cache.yaml',
      '_codocs:\n  id: cache\n  name: 캐시 정책\n만료: 캐시 만료 시간을 정한다\n',
    );
    await file(
      'a.yaml',
      '_codocs:\n  id: a\n  name: 같은이름\n개요: 결제 승인\n',
    );
    await file(
      'b.yaml',
      '_codocs:\n  id: b\n  name: 같은이름\n개요: 결제 승인\n',
    );
    const session = openSession();

    const result = await session.search(['캐시 만료', '결제', '없는주제zzz']);

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      emptyQueries: ['없는주제zzz'],
    });
    if (!result.success) throw new Error('search 실패');
    expect(result.items.length).toBeGreaterThan(1);
    // 이름 충돌 문서는 같은 주소가 두 번 나오며 get은 중복 주소를 한 번만 조회한다.
    const addresses = [...new Set(result.items.map((item) => item.address))];
    expect(addresses.some((address) => address.startsWith('캐시 정책'))).toBe(
      true,
    );
    const got = await session.get(addresses);
    if (!got.success) throw new Error('get 실패');
    expect(got.results.map((entry) => entry.address)).toEqual(addresses);
    for (const entry of got.results) {
      expect(entry.found).toBe(true);
      if (entry.address.startsWith('같은이름'))
        expect(entry).toMatchObject({ conflict: true });
      else expect(entry).not.toMatchObject({ conflict: true });
    }
  });

  it('걸린 것이 없으면 빈 items와 emptyQueries를 요청 성공으로 돌려준다', async () => {
    await file('a.yaml', '_codocs:\n  id: a\n  name: 하나\n개요: 본문\n');
    const result = await openSession().search(['zzzqqq']);
    expect(result).toEqual({
      success: true,
      scanStatus: 'complete',
      items: [],
      emptyQueries: ['zzzqqq'],
    });
  });

  it('write로 저장한 문서가 다음 search에 반영된다', async () => {
    const raw = '_codocs:\n  id: a\n  name: 하나\n개요: 본문\n';
    await file('a.yaml', raw);
    const session = openSession();
    expect(await session.search(['유니콘'])).toMatchObject({
      emptyQueries: ['유니콘'],
    });

    const saved = await session.write({
      mode: 'update',
      id: 'a',
      revision: calculateRevision(Buffer.from(raw)),
      set: { 개요: '유니콘 전략' },
    });
    expect(saved).toMatchObject({ success: true, indexUpdated: true });

    const after = await session.search(['유니콘']);
    expect(after).toMatchObject({ success: true, emptyQueries: [] });
    if (!after.success) throw new Error('search 실패');
    expect(after.items.map((item) => item.address)).toEqual(['하나:개요']);
    // 같은 카탈로그에서는 같은 결과를 다시 돌려준다.
    expect(await session.search(['유니콘'])).toEqual(after);
  });

  it('partial에서는 결과에 미확인 진단을 붙여 결과 없음을 문서 없음으로 단정하지 않는다', async () => {
    const target = await file(
      'a.yaml',
      '_codocs:\n  id: a\n  name: 하나\n개요: 본문\n',
    );
    const session = openSession();
    await session.list();
    ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
    await session.refresh();

    const result = await session.search(['본문']);

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'partial',
      diagnostics: [{ code: 'unconfirmed_reference', severity: 'warning' }],
    });
  });

  it('명시 refresh가 진행 중이면 index_not_ready로 거절한다', async () => {
    await file('a.yaml', '_codocs:\n  id: a\n  name: 하나\n개요: 본문\n');
    const session = openSession();
    await session.list();
    const refreshing = session.refresh();
    const result = await session.search(['본문']);
    await refreshing;
    expect(result).toMatchObject({
      success: false,
      error: { code: 'index_not_ready' },
    });
  });
});
