import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from './index.js';

/** 감시 신호가 모두 가라앉을 때까지 기다리는 시간(ms)이다. */
const settleMilliseconds = 1200;
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
  await rm(project, { recursive: true, force: true });
});

describe('문서 저장 한 번의 색인 갱신', () => {
  it('YAML 파일을 한 번 저장하면 문서 스캔과 문서 게시가 각각 한 번만 일어난다', async () => {
    const target = path.join(project, '.codocs', 'alpha.yaml');
    await writeFile(
      target,
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 이전\n',
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
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 최신 정의\n',
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
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 처음\n',
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
        `id: alpha\nname: alpha\ndomains: [업무]\ndefinition: ${definition}\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, settleMilliseconds));
      expect(await session.get(['alpha'])).toMatchObject({
        results: [{ document: { definition } }],
      });
    }
    expect(starts.length - baseline).toBe(2);
  });
});
