import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

/**
 * 반영을 확인한 뒤 같은 저장의 늦은 중복 신호가 추가 스캔을 만드는지 지켜보는 시간(ms)이다.
 * 반영 자체는 이 시간으로 기다리지 않는다. 느린 CI에서 반영이 늦으면 고정 대기만으로는 0회로 잘못 실패한다.
 */
const settleMilliseconds = 1200;
/** 감시 반영을 기다리는 최대 시간(ms)이다. */
const reflectTimeout = 10_000;
let project: string;
let session: WorkspaceQuerySession | undefined;
beforeEach(async () => {
  const parent = path.resolve('.workbench/fixtures');
  await mkdir(parent, { recursive: true });
  project = await mkdtemp(path.join(parent, 'single-scan-'));
  await mkdir(path.join(project, '.codocs'));
});
afterEach(async () => {
  await session?.close();
  session = undefined;
  await rmWithRetry(project, { recursive: true, force: true });
});

describe('문서 저장 한 번의 색인 갱신', () => {
  it('YAML 파일을 한 번 저장하면 문서 스캔과 문서 게시가 각각 한 번만 일어난다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 이전\n',
    );
    const starts: Record<string, unknown>[] = [];
    const published: Record<string, unknown>[] = [];
    const changes: number[] = [];
    session = createWorkspaceQuerySession({ cwd: project }, (kind, detail) => {
      if (kind === 'index-start') starts.push(detail);
      if (kind === 'index-published') published.push(detail);
    });
    session.onDidChangeSnapshot((event) => changes.push(event.catalogVersion));
    await session.get(['alpha']);
    await new Promise((resolve) => setTimeout(resolve, settleMilliseconds));
    const baseline = {
      starts: starts.length,
      published: published.length,
      changes: changes.length,
      version: session.catalogVersion,
    };
    await writeFile(
      target,
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 최신 정의\n',
    );
    await vi.waitFor(
      () => expect(changes.length).toBeGreaterThan(baseline.changes),
      { timeout: reflectTimeout },
    );
    await new Promise((resolve) => setTimeout(resolve, settleMilliseconds));
    expect(starts.length - baseline.starts).toBe(1);
    expect(published.length - baseline.published).toBe(1);
    expect(changes.length - baseline.changes).toBe(1);
    expect(session.catalogVersion - baseline.version).toBe(1);
    expect(await session.get(['alpha'])).toMatchObject({
      results: [{ document: { definition: '최신 정의' } }],
    });
  });

  it('같은 파일을 연속으로 두 번 저장하면 각 저장이 한 번씩 스캔되어 최신 내용을 반영한다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 처음\n',
    );
    const starts: Record<string, unknown>[] = [];
    session = createWorkspaceQuerySession({ cwd: project }, (kind, detail) => {
      if (kind === 'index-start') starts.push(detail);
    });
    await session.get(['alpha']);
    await new Promise((resolve) => setTimeout(resolve, settleMilliseconds));
    const baseline = starts.length;
    for (const definition of ['둘째 정의', '셋째 정의']) {
      await writeFile(
        target,
        `_codocs:\n  id: alpha\n  name: alpha\ndefinition: ${definition}\n`,
      );
      await vi.waitFor(
        async () =>
          expect(await session!.get(['alpha'])).toMatchObject({
            results: [{ document: { definition } }],
          }),
        { timeout: reflectTimeout },
      );
      await new Promise((resolve) => setTimeout(resolve, settleMilliseconds));
    }
    expect(starts.length - baseline).toBe(2);
  });
});
