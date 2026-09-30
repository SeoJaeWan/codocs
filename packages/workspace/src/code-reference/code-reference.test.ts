import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildCatalog,
  parseYaml,
  scanStatuses,
  codeReferenceStatuses,
} from '@codocs/core';
import { ioFailures } from '../test-support/file-system.js';
import {
  WorkspaceCodeReferenceIndex,
  codeCollectionStatuses,
  codeObservationKinds,
} from './index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '../query/index.js';
let project: string;
const indexes: WorkspaceCodeReferenceIndex[] = [];
const sessions: WorkspaceQuerySession[] = [];
const targetPath = '.codocs/target.yaml';
const targetText =
  'id: target\nname: 대상\ndomains: [업무]\ndefinition: 본문\n';
beforeEach(async () => {
  await mkdir('.workbench/fixtures', { recursive: true });
  project = await mkdtemp(path.resolve('.workbench/fixtures/code-index-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(project));
  await mkdir(path.join(project, '.codocs'));
  await writeFile(path.join(project, targetPath), targetText);
});
afterEach(async () => {
  ioFailures.clear();
  await Promise.all(indexes.splice(0).map((index) => index.close()));
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
});

/** 실제 catalog·disk·watch 연결을 검증하는 통합 fixture다. */
function createIndex(
  options: ConstructorParameters<typeof WorkspaceCodeReferenceIndex>[1] = {},
): WorkspaceCodeReferenceIndex {
  const index = new WorkspaceCodeReferenceIndex(project, options);
  indexes.push(index);
  index.setCatalog(
    buildCatalog({
      status: scanStatuses.complete,
      observations: [{ path: targetPath, parsed: parseYaml(targetText) }],
    }),
    1,
  );
  return index;
}
describe('WorkspaceCodeReferenceIndex: 저장 원문·IDE 편집과 역참조 통합', () => {
  it('저장 표기 하나가 있으면 확인한 출현과 실제 UTF-16 source 위치를 제공한다', async () => {
    await writeFile(path.join(project, 'source'), '🙂 @codocs [[대상]]#L2');
    const index = createIndex();
    const result = await index.snapshot();
    expect(result).toMatchObject({
      status: codeCollectionStatuses.complete,
      confirmedCount: 1,
      documentGeneration: 1,
      occurrences: [
        {
          sourcePath: 'source',
          observation: codeObservationKinds.disk,
          status: codeReferenceStatuses.resolved,
          marker: { offsetRange: { start: 3, end: 20 } },
        },
      ],
    });
  });
  it('적격 buffer를 편집하면 disk 출현을 대체하고 중복 집계하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    await index.snapshot();
    await index.updateBuffer({
      sourcePath: 'source',
      text: '@codocs [[대상]]#L3 @codocs [[대상]]',
      documentVersion: 1,
    });
    expect(
      (await index.snapshot()).occurrences.map((item) => item.observation),
    ).toEqual([codeObservationKinds.buffer, codeObservationKinds.buffer]);
  });
  it('buffer를 닫으면 저장 표기와 위치로 돌아간다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    await index.updateBuffer({
      sourcePath: 'source',
      text: '@codocs [[대상]]#L3',
      documentVersion: 1,
    });
    await index.closeBuffer('source');
    expect((await index.snapshot()).occurrences[0]).toMatchObject({
      observation: codeObservationKinds.disk,
      marker: { text: '@codocs [[대상]]#L2' },
    });
  });
  it('정책 제외 파일을 열면 buffer 출현도 수집하지 않는다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'excluded\n');
    await writeFile(path.join(project, 'excluded'), '@codocs [[대상]]');
    const index = createIndex();
    expect(
      await index.updateBuffer({
        sourcePath: 'excluded',
        text: '@codocs [[대상]]#L3',
        documentVersion: 1,
      }),
    ).toBe(false);
    expect((await index.snapshot()).occurrences).toEqual([]);
  });
  it('낡은 편집 버전이 뒤늦게 도착하면 최신 출현을 대체하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const index = createIndex();
    await index.updateBuffer({
      sourcePath: 'source',
      text: '@codocs [[대상]]#L3',
      documentVersion: 2,
    });
    expect(
      await index.updateBuffer({
        sourcePath: 'source',
        text: '@codocs [[대상]]#L2',
        documentVersion: 1,
      }),
    ).toBe(false);
    expect((await index.snapshot()).occurrences[0]?.documentVersion).toBe(2);
  });
  it('대상 YAML의 미저장 buffer만 수정하면 저장 이름 해석은 바뀌지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const session = createWorkspaceQuerySession({ project });
    sessions.push(session);
    await session.updateCodeBuffer({
      sourcePath: targetPath,
      text: targetText.replace('대상', '다른 이름'),
      documentVersion: 1,
    });
    expect(
      (await session.codeReferenceSnapshot()).occurrences.find(
        (item) => item.sourcePath === 'source',
      )?.status,
    ).toBe(codeReferenceStatuses.resolved);
  });
  it('대상 저장 이름을 수정하면 기존 코드 관측을 재사용하며 연결을 다시 해석한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const index = createIndex();
    const first = await index.snapshot();
    index.setCatalog(
      buildCatalog({
        status: scanStatuses.complete,
        observations: [
          {
            path: targetPath,
            parsed: parseYaml(targetText.replace('대상', '다른 이름')),
          },
        ],
      }),
      2,
    );
    const second = await index.snapshot();
    expect(second.codeGeneration).toBe(first.codeGeneration);
    expect(second.documentGeneration).toBe(2);
    expect(second.occurrences[0]?.status).toBe(codeReferenceStatuses.missing);
    expect(second.occurrences[0]?.sourceRevision).toBe(
      first.occurrences[0]?.sourceRevision,
    );
  });
  it('겹친 구간을 조회하면 정확한 출현 합집합이며 같은 행의 두 표기를 보존한다', async () => {
    await writeFile(
      path.join(project, 'source'),
      '@codocs [[대상]]#L2-L4 @codocs [[대상]]#L3 @codocs [[대상]]',
    );
    const index = createIndex();
    const result = await index.reverse(targetPath, {
      startLine: 2,
      endLine: 3,
    });
    expect(result.confirmedCount).toBe(2);
    expect(
      new Set(result.occurrences.map((item) => item.occurrenceId)).size,
    ).toBe(2);
    expect(result.unique).toBe(false);
    expect(
      result.occurrences.map((item) => item.marker.range.start.character),
    ).toEqual([0, 21]);
    expect((await index.reverse(targetPath)).confirmedCount).toBe(1);
  });
  it('개별 파일 읽기가 실패하면 확인한 다른 출현은 유지하고 유일성을 확정하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    await writeFile(path.join(project, 'unreadable'), '@codocs [[대상]]');
    const index = createIndex();
    ioFailures.set(path.join(project, 'unreadable'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const result = await index.reverse(targetPath);
    expect(result).toMatchObject({
      status: codeCollectionStatuses.incomplete,
      confirmedCount: 1,
      unique: false,
      absent: false,
      failures: [{ path: 'unreadable' }],
    });
    expect(result.occurrences[0]?.sourcePath).toBe('source');
  });
  it('파일 읽기 실패가 해제되면 명시 refresh로 complete 수집을 회복한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const index = createIndex();
    ioFailures.set(path.join(project, 'source'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    await index.snapshot();
    ioFailures.clear();
    const result = await index.refresh();
    expect(result).toMatchObject({
      status: codeCollectionStatuses.complete,
      confirmedCount: 1,
      failures: [],
    });
  });
  it('수집 중 확인한 출현 하나는 unique 이동으로 확정하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const gate: { wait?: Promise<void> } = {};
    const index = createIndex({
      beforeRead: async () => {
        await gate.wait;
      },
    });
    await index.snapshot();
    let resume!: () => void;
    gate.wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const operation = index.refresh();
    const result = await index.reverse(targetPath);
    expect(result).toMatchObject({
      status: codeCollectionStatuses.collecting,
      confirmedCount: 1,
      unique: false,
      absent: false,
    });
    resume();
    await operation;
  });
  it('불완전 수집에서 확인한 출현이 없으면 absence를 확정하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    ioFailures.set(path.join(project, 'source'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const result = await createIndex().reverse(targetPath);
    expect(result).toMatchObject({
      status: codeCollectionStatuses.incomplete,
      confirmedCount: 0,
      unique: false,
      absent: false,
    });
  });
  it('watch 등록 뒤 초기 reconciliation 동안 파일이 바뀌면 최신 원문으로 게시한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    let first = true;
    const index = createIndex({
      beforeRead: async () => {
        if (first) {
          first = false;
          await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L3');
        }
      },
    });
    const snapshot = await index.snapshot();
    expect(snapshot.occurrences[0]?.marker.text).toBe('@codocs [[대상]]#L3');
  });
  it('source와 owner 버전이 같으면 capture token으로 정확한 출현을 재확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    const snapshot = await index.snapshot();
    index.setOwner('source', 1);
    const token = await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    });
    expect(token).toBeDefined();
    expect(
      await index.confirm(token!, { sourcePath: 'source', documentVersion: 1 }),
    ).toMatchObject({
      sourcePath: 'source',
      marker: { text: '@codocs [[대상]]#L2' },
    });
  });
  it.each([
    'source',
    'target',
    'version',
    'close',
    'catalog',
    'restart',
  ] as const)(
    '%s 상태가 바뀌면 capture한 오래된 출현을 거부한다',
    async (change) => {
      await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
      const index = createIndex();
      const snapshot = await index.snapshot();
      index.setOwner('source', 1);
      const token = (await index.capture({
        occurrenceId: snapshot.occurrences[0]!.occurrenceId,
        ownerPath: 'source',
        ownerVersion: 1,
      }))!;
      if (change === 'source')
        await writeFile(path.join(project, 'source'), '표기 삭제');
      if (change === 'target')
        await writeFile(
          path.join(project, targetPath),
          targetText.replace('본문', '변경'),
        );
      if (change === 'version') index.setOwner('source', 2);
      if (change === 'close') await index.closeBuffer('source');
      if (change === 'catalog')
        index.setCatalog(
          buildCatalog({ status: scanStatuses.complete, observations: [] }),
          2,
        );
      if (change === 'restart') await index.close();
      expect(
        await index.confirm(token, {
          sourcePath: 'source',
          documentVersion: 1,
        }),
      ).toBeUndefined();
    },
  );
  it.each(['source', targetPath])(
    '동일 원문으로 %s 경로의 파일을 대체하면 정체가 달라져 거부한다',
    async (replaced) => {
      await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
      const index = createIndex();
      const snapshot = await index.snapshot();
      index.setOwner('source', 1);
      const token = (await index.capture({
        occurrenceId: snapshot.occurrences[0]!.occurrenceId,
        ownerPath: 'source',
        ownerVersion: 1,
      }))!;
      await writeFile(
        path.join(project, 'replacement'),
        replaced === 'source' ? '@codocs [[대상]]' : targetText,
      );
      await rename(
        path.join(project, 'replacement'),
        path.join(project, replaced),
      );
      expect(
        await index.confirm(token, {
          sourcePath: 'source',
          documentVersion: 1,
        }),
      ).toBeUndefined();
    },
  );
  it('다른 owner로 token을 확인하면 source 소유권이 달라 거부한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const index = createIndex();
    const snapshot = await index.snapshot();
    index.setOwner('source', 1);
    const token = (await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    }))!;
    expect(
      await index.confirm(token, {
        sourcePath: targetPath,
        documentVersion: 1,
      }),
    ).toBeUndefined();
  });
  it('완료 query를 반복해도 전체 프로젝트를 재수집하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const observed: string[] = [];
    const index = createIndex({ observe: (kind) => observed.push(kind) });
    await index.reverse(targetPath);
    await index.reverse(targetPath);
    await index.reverse(targetPath, { startLine: 2, endLine: 2 });
    expect(observed).toEqual(['code-index-published']);
  });
});

describe('WorkspaceCodeReferenceIndex: 실제 감시 갱신', () => {
  it('저장 파일을 추가하면 감시가 새 출현을 게시한다', async () => {
    const index = createIndex();
    await index.snapshot();
    const published = new Promise<void>((resolve) => {
      const stop = index.onDidChange((snapshot) => {
        if (
          snapshot.status === codeCollectionStatuses.complete &&
          snapshot.occurrences.some((item) => item.sourcePath === 'new-source')
        ) {
          stop();
          resolve();
        }
      });
    });
    await writeFile(path.join(project, 'new-source'), '@codocs [[대상]]');
    await published;
    expect((await index.reverse(targetPath)).confirmedCount).toBe(1);
  });
  it('project gitignore를 저장하면 이전 코드 출현을 감시 갱신으로 제거한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    await writeFile(path.join(project, '.gitignore'), '');
    const index = createIndex();
    await index.snapshot();
    const published = new Promise<void>((resolve) => {
      const stop = index.onDidChange((snapshot) => {
        if (
          snapshot.status === codeCollectionStatuses.complete &&
          snapshot.occurrences.length === 0
        ) {
          stop();
          resolve();
        }
      });
    });
    await writeFile(path.join(project, '.gitignore'), 'source\n');
    await published;
    expect(await index.reverse(targetPath)).toMatchObject({
      confirmedCount: 0,
      absent: true,
      unique: false,
    });
  });
  it('Git 추적 상태를 해제하면 ignored source를 감시 갱신으로 제거한다', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execute = promisify(execFile);
    await execute('git', ['init', project]);
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    await execute('git', ['-C', project, 'add', 'source']);
    await writeFile(path.join(project, '.gitignore'), 'source\n');
    const index = createIndex();
    await index.snapshot();
    const published = new Promise<void>((resolve) => {
      const stop = index.onDidChange((snapshot) => {
        if (
          snapshot.status === codeCollectionStatuses.complete &&
          snapshot.occurrences.length === 0
        ) {
          stop();
          resolve();
        }
      });
    });
    await execute('git', ['-C', project, 'rm', '--cached', 'source']);
    await published;
    expect(await index.reverse(targetPath)).toMatchObject({
      confirmedCount: 0,
      absent: true,
    });
  });
  it('대상 이름을 저장하면 query session이 현재 코드 관측을 다시 해석한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const session = createWorkspaceQuerySession({ project });
    sessions.push(session);
    await session.codeReferenceSnapshot();
    const published = new Promise<void>((resolve) => {
      const stop = session.onDidChangeCodeReferences((snapshot) => {
        if (
          snapshot.occurrences.some(
            (item) =>
              item.sourcePath === 'source' &&
              item.status === codeReferenceStatuses.missing,
          )
        ) {
          stop();
          resolve();
        }
      });
    });
    await writeFile(
      path.join(project, targetPath),
      targetText.replace('대상', '저장된 새 이름'),
    );
    await published;
    expect(
      (await session.codeReferenceSnapshot()).occurrences.find(
        (item) => item.sourcePath === 'source',
      )?.status,
    ).toBe(codeReferenceStatuses.missing);
  });
  it('catalog 게시 전 대상 바이트가 바뀌면 capture를 거부한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const index = createIndex();
    const snapshot = await index.snapshot();
    index.setOwner('source', 1);
    await writeFile(
      path.join(project, targetPath),
      targetText.replace('대상', '다른 이름'),
    );
    expect(
      await index.capture({
        occurrenceId: snapshot.occurrences[0]!.occurrenceId,
        ownerPath: 'source',
        ownerVersion: 1,
      }),
    ).toBeUndefined();
  });
  it('source 파일이 삭제되면 buffer 출현과 과거 token을 계속 제공하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const index = createIndex();
    await index.updateBuffer({
      sourcePath: 'source',
      text: '@codocs [[대상]]#L2',
      documentVersion: 1,
    });
    await rm(path.join(project, 'source'));
    await index.refresh(['source']);
    expect((await index.snapshot()).occurrences).toEqual([]);
  });
});

describe('WorkspaceCodeReferenceIndex: 확인 전제 보존', () => {
  it('문서 탐색이 partial이면 코드 수집 complete도 역참조 부재를 확정하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    const index = createIndex();
    index.setCatalog(
      buildCatalog({
        status: scanStatuses.partial,
        observations: [{ path: targetPath, parsed: parseYaml(targetText) }],
      }),
      2,
    );
    const result = await index.reverse(targetPath);
    expect(result).toMatchObject({
      status: codeCollectionStatuses.complete,
      confirmedCount: 0,
      absent: false,
      unique: false,
    });
  });
  it('ignore 규칙 읽기가 실패하면 범위가 미확인인 미추적 출현을 확정하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    await writeFile(path.join(project, '.gitignore'), 'source\n');
    ioFailures.set(path.join(project, '.gitignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const result = await createIndex().reverse(targetPath);
    expect(result.status).toBe(codeCollectionStatuses.incomplete);
    expect(result.occurrences).toEqual([]);
    expect(result.absent).toBe(false);
  });
  it('IO가 실패한 출현 하나가 있어도 별도로 확인한 출현의 개별 클릭은 가능하다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    await writeFile(path.join(project, 'unreadable'), '@codocs [[대상]]');
    ioFailures.set(path.join(project, 'unreadable'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const index = createIndex();
    const snapshot = await index.snapshot();
    index.setOwner('source', 1);
    const token = await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    });
    expect(snapshot.status).toBe(codeCollectionStatuses.incomplete);
    expect(
      await index.confirm(token!, { sourcePath: 'source', documentVersion: 1 }),
    ).toMatchObject({ sourcePath: 'source' });
  });
});
