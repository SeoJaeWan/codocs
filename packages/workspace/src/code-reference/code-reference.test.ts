import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  buildCatalog,
  parseYaml,
  scanStatuses,
  codeReferenceStatuses,
} from '@codocs/core';
import { ioFailures } from '../test-support/file-system.js';
import { createFakeCodeWatch } from '../test-support/code-watch.js';
import { CodeReferenceWatcher } from '../watcher/code-reference-watcher.js';
import {
  WorkspaceCodeReferenceIndex,
  codeCollectionStatuses,
  codeFileReasons,
  codeObservationKinds,
  type WorkspaceCodeReferenceIndexOptions,
  type WorkspaceCodeReferenceSnapshot,
} from './index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '../query/index.js';
const executeGit = promisify(execFile);
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
    const result = await index.ready();
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
  /** @codocs [[작업 공간:코드 참조 색인]]#L35-L37 */
  it('적격 buffer를 편집하면 disk 출현을 대체하고 중복 집계하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    await index.ready();
    await index.updateBuffer({
      sourcePath: 'source',
      text: '@codocs [[대상]]#L3 @codocs [[대상]]',
      documentVersion: 1,
    });
    expect(
      (await index.ready()).occurrences.map((item) => item.observation),
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
    expect((await index.ready()).occurrences[0]).toMatchObject({
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
    expect((await index.ready()).occurrences).toEqual([]);
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
    expect((await index.ready()).occurrences[0]?.documentVersion).toBe(2);
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
    const first = await index.ready();
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
    const second = await index.ready();
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
    await index.ready();
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
  /** @codocs [[작업 공간:코드 참조 색인]]#L54-L55 */
  it('개별 파일 읽기가 실패하면 확인한 다른 출현과 실패 사유를 유지하고 incomplete로 표시한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    await writeFile(path.join(project, 'unreadable'), '@codocs [[대상]]');
    const index = createIndex();
    ioFailures.set(path.join(project, 'unreadable'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    await index.ready();
    const result = await index.reverse(targetPath);
    expect(result).toMatchObject({
      status: codeCollectionStatuses.incomplete,
      hasCompletedCollection: true,
      confirmedCount: 1,
      unique: true,
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
    await index.ready();
    ioFailures.clear();
    const result = await index.refresh();
    expect(result).toMatchObject({
      status: codeCollectionStatuses.complete,
      confirmedCount: 1,
      failures: [],
    });
  });
  it('불완전 수집에서 확인한 출현이 없으면 수집된 범위의 부재와 실패를 함께 표시한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    ioFailures.set(path.join(project, 'source'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const index = createIndex();
    await index.ready();
    const result = await index.reverse(targetPath);
    expect(result).toMatchObject({
      status: codeCollectionStatuses.incomplete,
      confirmedCount: 0,
      unique: false,
      absent: true,
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
    const snapshot = await index.ready();
    expect(snapshot.occurrences[0]?.marker.text).toBe('@codocs [[대상]]#L3');
  });
  it('source와 owner 버전이 같으면 capture token으로 정확한 출현을 재확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    const snapshot = await index.ready();
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
  it('관련 없는 파일이 바뀌어 다시 수집되고 세대가 올라도 같은 token을 확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    const snapshot = await index.ready();
    index.setOwner('source', 1);
    const token = (await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    }))!;
    await writeFile(path.join(project, 'unrelated'), '@codocs [[대상]]#L3');
    await index.refresh(['unrelated']);
    index.setCatalog(
      buildCatalog({
        status: scanStatuses.complete,
        observations: [{ path: targetPath, parsed: parseYaml(targetText) }],
      }),
      2,
    );
    const after = await index.ready();
    expect(after.codeGeneration).toBeGreaterThan(snapshot.codeGeneration);
    expect(after.documentGeneration).toBe(2);
    expect(
      await index.confirm(token, { sourcePath: 'source', documentVersion: 1 }),
    ).toMatchObject({
      sourcePath: 'source',
      marker: { text: '@codocs [[대상]]#L2' },
    });
  });
  it('수집이 진행 중일 때 클릭하면 기다리지 않고 직접 읽어 확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const gate: { wait?: Promise<void> } = {};
    const index = createIndex({
      beforeRead: async () => {
        await gate.wait;
      },
    });
    const snapshot = await index.ready();
    index.setOwner('source', 1);
    const token = (await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    }))!;
    let resume!: () => void;
    gate.wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const operation = index.refresh();
    try {
      expect(
        await index.confirm(token, {
          sourcePath: 'source',
          documentVersion: 1,
        }),
      ).toMatchObject({
        sourcePath: 'source',
        marker: { text: '@codocs [[대상]]#L2' },
      });
    } finally {
      resume();
      await operation;
    }
  });
  it('source의 표기와 무관한 뒷줄만 편집해도 클릭을 확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    const snapshot = await index.ready();
    index.setOwner('source', 1);
    const token = (await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    }))!;
    await writeFile(
      path.join(project, 'source'),
      '@codocs [[대상]]#L2\n관련 없는 줄을 추가했다',
    );
    expect(
      await index.confirm(token, { sourcePath: 'source', documentVersion: 1 }),
    ).toMatchObject({ sourcePath: 'source' });
  });
  it('표기 위치가 실제로 이동하면 거부한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    const snapshot = await index.ready();
    index.setOwner('source', 1);
    const token = (await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    }))!;
    await writeFile(
      path.join(project, 'source'),
      '앞줄 추가\n@codocs [[대상]]#L2',
    );
    expect(
      await index.confirm(token, { sourcePath: 'source', documentVersion: 1 }),
    ).toBeUndefined();
  });
  it('대상 문서가 실제로 바뀌어 새 catalog가 게시되어도 거부한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]#L2');
    const index = createIndex();
    const snapshot = await index.ready();
    index.setOwner('source', 1);
    const token = (await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    }))!;
    const changed = targetText.replace('대상', '다른 이름');
    await writeFile(path.join(project, targetPath), changed);
    index.setCatalog(
      buildCatalog({
        status: scanStatuses.complete,
        observations: [{ path: targetPath, parsed: parseYaml(changed) }],
      }),
      2,
    );
    expect(
      await index.confirm(token, { sourcePath: 'source', documentVersion: 1 }),
    ).toBeUndefined();
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
      const snapshot = await index.ready();
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
      const snapshot = await index.ready();
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
    const snapshot = await index.ready();
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
    await index.ready();
    await index.reverse(targetPath);
    await index.reverse(targetPath);
    await index.reverse(targetPath, { startLine: 2, endLine: 2 });
    expect(observed).toEqual(['code-index-published']);
  });
});

describe('WorkspaceCodeReferenceIndex: 실제 감시 갱신', () => {
  it('저장 파일을 추가하면 감시가 새 출현을 게시한다', async () => {
    const index = createIndex();
    await index.ready();
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
    await index.ready();
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
    await index.ready();
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
    const snapshot = await index.ready();
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
    expect((await index.ready()).occurrences).toEqual([]);
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
    await index.ready();
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
    const index = createIndex();
    await index.ready();
    const result = await index.reverse(targetPath);
    expect(result.status).toBe(codeCollectionStatuses.incomplete);
    expect(result.occurrences).toEqual([]);
  });
  it('IO가 실패한 출현 하나가 있어도 별도로 확인한 출현의 개별 클릭은 가능하다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상]]');
    await writeFile(path.join(project, 'unreadable'), '@codocs [[대상]]');
    ioFailures.set(path.join(project, 'unreadable'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const index = createIndex();
    const snapshot = await index.ready();
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

/** 다음 게시 중 조건을 만족하는 snapshot을 기다린다. */
function published(
  index: WorkspaceCodeReferenceIndex,
  matches: (snapshot: WorkspaceCodeReferenceSnapshot) => boolean,
): Promise<WorkspaceCodeReferenceSnapshot> {
  return new Promise((resolve) => {
    const stop = index.onDidChange((snapshot) => {
      if (!matches(snapshot)) return;
      stop();
      resolve(snapshot);
    });
  });
}
/** 실제 감시를 만들면서 생성 횟수와 전달된 오류를 기록한다. */
function countingWatchers(): {
  created: CodeReferenceWatcher[];
  errors: unknown[];
  createWatcher: NonNullable<
    WorkspaceCodeReferenceIndexOptions['createWatcher']
  >;
} {
  const created: CodeReferenceWatcher[] = [];
  const errors: unknown[] = [];
  return {
    created,
    errors,
    /** 실제 감시를 만들어 오류를 기록한 뒤 수집 계층에 넘긴다. */
    createWatcher: (root, changed, failed, excluded) => {
      const watcher = new CodeReferenceWatcher(
        root,
        changed,
        (error) => {
          errors.push(error);
          failed(error);
        },
        excluded,
      );
      created.push(watcher);
      return watcher;
    },
  };
}
const marker = '@codocs [[대상]]';

describe('WorkspaceCodeReferenceIndex: 수집 범위만 감시', () => {
  /** @codocs [[작업 공간:작업 공간 파일 감시]]#L67 */
  it('제외한 dist 폴더를 삭제하고 다시 만들어도 감시 오류 없이 complete를 유지한다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'out.js'), 'text');
    const watchers = countingWatchers();
    const index = createIndex({ createWatcher: watchers.createWatcher });
    await index.ready();
    await rm(path.join(project, 'dist'), { recursive: true });
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'out.js'), 'text');
    const later = published(index, (snapshot) =>
      snapshot.occurrences.some((item) => item.sourcePath === 'later'),
    );
    await writeFile(path.join(project, 'later'), marker);
    expect(await later).toMatchObject({
      status: codeCollectionStatuses.complete,
      failures: [],
    });
    expect(watchers.errors).toEqual([]);
  });
  it('제외한 폴더 안의 추적 파일을 수정하면 새 출현을 게시한다', async () => {
    await executeGit('git', ['init', project]);
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'keep'), marker);
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    await executeGit('git', ['-C', project, 'add', '-f', 'dist/keep']);
    const index = createIndex();
    await index.ready();
    const changed = published(
      index,
      (snapshot) =>
        snapshot.status === codeCollectionStatuses.complete &&
        snapshot.occurrences.length === 2,
    );
    await writeFile(path.join(project, 'dist', 'keep'), marker + '\n' + marker);
    await changed;
    expect((await index.reverse(targetPath)).confirmedCount).toBe(2);
  });
  it('제외한 폴더 안의 미추적 파일을 수정하면 다시 수집하지 않는다', async () => {
    await executeGit('git', ['init', project]);
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'keep'), marker);
    await writeFile(path.join(project, 'dist', 'junk'), marker);
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    await executeGit('git', ['-C', project, 'add', '-f', 'dist/keep']);
    const observed: string[] = [];
    const index = createIndex({ observe: (kind) => observed.push(kind) });
    await index.ready();
    await writeFile(path.join(project, 'dist', 'junk'), marker + marker);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(observed).toEqual(['code-index-published']);
  });
});

describe('WorkspaceCodeReferenceIndex: 감시 규칙이 바뀔 때만 재구성', () => {
  it('제외 규칙을 제거하면 감시를 다시 구성하고 새로 포함한 폴더의 변경을 관측한다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'included/\n');
    await mkdir(path.join(project, 'included'));
    await writeFile(path.join(project, 'included', 'source'), marker);
    const watchers = countingWatchers();
    const index = createIndex({ createWatcher: watchers.createWatcher });
    await index.ready();
    const included = published(
      index,
      (snapshot) => snapshot.occurrences.length === 1,
    );
    await writeFile(path.join(project, '.gitignore'), '');
    await included;
    const edited = published(
      index,
      (snapshot) => snapshot.occurrences.length === 2,
    );
    await writeFile(
      path.join(project, 'included', 'source'),
      marker + '\n' + marker,
    );
    await edited;
    expect(watchers.created).toHaveLength(2);
  });
  it('제외 규칙을 추가하면 감시를 다시 구성하고 이전 출현을 제거한다', async () => {
    await mkdir(path.join(project, 'later'));
    await writeFile(path.join(project, 'later', 'source'), marker);
    const watchers = countingWatchers();
    const index = createIndex({ createWatcher: watchers.createWatcher });
    await index.ready();
    const removed = published(
      index,
      (snapshot) => snapshot.occurrences.length === 0,
    );
    await writeFile(path.join(project, '.gitignore'), 'later/\n');
    await removed;
    expect(watchers.created).toHaveLength(2);
  });
  it('새 폴더를 만들어도 규칙이 같으면 감시를 다시 구성하지 않는다', async () => {
    const watchers = countingWatchers();
    const index = createIndex({ createWatcher: watchers.createWatcher });
    await index.ready();
    const added = published(
      index,
      (snapshot) => snapshot.occurrences.length === 1,
    );
    await mkdir(path.join(project, 'created'));
    await writeFile(path.join(project, 'created', 'source'), marker);
    await added;
    expect(watchers.created).toHaveLength(1);
  });
  it('Git index가 갱신되어도 규칙이 같으면 감시를 다시 구성하지 않는다', async () => {
    await executeGit('git', ['init', project]);
    await writeFile(path.join(project, 'source'), marker);
    const observed: string[] = [];
    const watchers = countingWatchers();
    const index = createIndex({
      createWatcher: watchers.createWatcher,
      observe: (kind) => observed.push(kind),
    });
    await index.ready();
    await executeGit('git', ['-C', project, 'add', 'source']);
    await vi.waitFor(() => expect(observed.length).toBeGreaterThan(1));
    expect(watchers.created).toHaveLength(1);
  });
});

describe('WorkspaceCodeReferenceIndex: 감시 오류 자동 복구', () => {
  /** 오류를 주입할 수 있는 가짜 감시로 색인을 만들고 최초 수집을 마친다. */
  async function startedIndex(): Promise<{
    index: WorkspaceCodeReferenceIndex;
    fake: ReturnType<typeof createFakeCodeWatch>;
  }> {
    await writeFile(path.join(project, 'source'), marker);
    const fake = createFakeCodeWatch();
    const index = createIndex({
      createWatcher: fake.createWatcher,
      schedule: fake.schedule,
    });
    await index.ready();
    return { index, fake };
  }
  it('감시 오류가 도착하면 확인한 출현을 보존한 채 watch 실패와 incomplete로 게시한다', async () => {
    const { index, fake } = await startedIndex();
    const seen: WorkspaceCodeReferenceSnapshot[] = [];
    index.onDidChange((snapshot) => seen.push(snapshot));
    fake.connections[0]!.failed(new Error('EPERM: watch'));
    expect(seen[0]).toMatchObject({
      status: codeCollectionStatuses.incomplete,
      confirmedCount: 1,
      failures: [{ reason: codeFileReasons.watch }],
    });
  });
  it('감시 오류 뒤에는 즉시 다시 등록하고 전체 재확인으로 complete를 회복한다', async () => {
    const { index, fake } = await startedIndex();
    const recovered = published(
      index,
      (snapshot) => snapshot.status === codeCollectionStatuses.complete,
    );
    fake.connections[0]!.failed(new Error('EPERM: watch'));
    expect(await recovered).toMatchObject({ confirmedCount: 1, failures: [] });
    expect(fake.connections.map((item) => item.closed)).toEqual([true, false]);
    expect(fake.schedules).toEqual([]);
  });
  it('연달아 도착한 감시 오류는 한 번의 재등록으로 합친다', async () => {
    const { index, fake } = await startedIndex();
    const recovered = published(
      index,
      (snapshot) => snapshot.status === codeCollectionStatuses.complete,
    );
    for (const message of ['first', 'second', 'third'])
      fake.connections[0]!.failed(new Error(message));
    await recovered;
    expect(fake.connections).toHaveLength(2);
  });
  it('재등록이 연달아 실패하면 1초부터 두 배씩 늘려 30초를 넘지 않게 계속 재시도한다', async () => {
    const { fake } = await startedIndex();
    fake.behavior.failRegistrations = 7;
    fake.connections[0]!.failed(new Error('EPERM: watch'));
    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      await vi.waitFor(() => expect(fake.schedules).toHaveLength(attempt + 1));
      delays.push(fake.schedules[attempt]!.delay);
      fake.schedules[attempt]!.run();
    }
    expect(delays).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });
  it('재등록에 성공하면 다음 실패의 재시도 간격을 1초로 되돌린다', async () => {
    const { index, fake } = await startedIndex();
    fake.behavior.failRegistrations = 2;
    fake.connections[0]!.failed(new Error('EPERM: watch'));
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(1));
    fake.schedules[0]!.run();
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(2));
    const recovered = published(
      index,
      (snapshot) => snapshot.status === codeCollectionStatuses.complete,
    );
    fake.schedules[1]!.run();
    await recovered;
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.behavior.failRegistrations = 1;
    fake.connections.at(-1)!.failed(new Error('EPERM: watch'));
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(3));
    expect(fake.schedules.map((item) => item.delay)).toEqual([
      1_000, 2_000, 1_000,
    ]);
  });
  it('예약된 재시도 중 경로 없는 refresh를 호출하면 예약을 취소하고 즉시 복구한다', async () => {
    const { index, fake } = await startedIndex();
    fake.behavior.failRegistrations = 1;
    fake.connections[0]!.failed(new Error('EPERM: watch'));
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(1));
    const result = await index.refresh();
    expect(result).toMatchObject({
      status: codeCollectionStatuses.complete,
      failures: [],
    });
    expect(fake.schedules[0]!.cancelled).toBe(true);
    expect(fake.connections).toHaveLength(3);
  });
  it('예약된 재시도 중 close하면 예약을 취소하고 이후 재등록하지 않는다', async () => {
    const { index, fake } = await startedIndex();
    fake.behavior.failRegistrations = 1;
    fake.connections[0]!.failed(new Error('EPERM: watch'));
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(1));
    await index.close();
    fake.schedules[0]!.run();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.schedules[0]!.cancelled).toBe(true);
    expect(fake.connections).toHaveLength(2);
  });
  it('폴더를 삭제하고 곧바로 다시 만든 뒤 기존 파일을 수정해도 다시 관측해 complete로 돌아간다', async () => {
    await mkdir(path.join(project, 'nested'));
    await writeFile(path.join(project, 'nested', 'source'), marker);
    const index = createIndex();
    await index.ready();
    await rm(path.join(project, 'nested'), { recursive: true });
    await mkdir(path.join(project, 'nested'));
    await writeFile(path.join(project, 'nested', 'source'), marker);
    const edited = published(
      index,
      (snapshot) =>
        snapshot.status === codeCollectionStatuses.complete &&
        snapshot.occurrences.length === 2,
    );
    await writeFile(
      path.join(project, 'nested', 'source'),
      marker + '\n' + marker,
    );
    expect(await edited).toMatchObject({ failures: [] });
  });
});

describe('WorkspaceCodeReferenceIndex: 변경이 있을 때만 게시', () => {
  /** 게시된 snapshot을 모두 모은다. */
  function collect(
    index: WorkspaceCodeReferenceIndex,
  ): WorkspaceCodeReferenceSnapshot[] {
    const seen: WorkspaceCodeReferenceSnapshot[] = [];
    index.onDidChange((snapshot) => seen.push(snapshot));
    return seen;
  }
  /** 최초 수집이 끝난 색인과 게시 목록을 만든다. */
  async function readyIndex(
    options: WorkspaceCodeReferenceIndexOptions = {},
    text = marker + '#L2',
  ): Promise<{
    index: WorkspaceCodeReferenceIndex;
    seen: WorkspaceCodeReferenceSnapshot[];
  }> {
    await writeFile(path.join(project, 'source'), text);
    const index = createIndex(options);
    await index.ready();
    return { index, seen: collect(index) };
  }
  it('최초 수집이 끝나기 전에 조회하면 기다리지 않고 미완료 상태와 빈 결과를 돌려준다', async () => {
    await writeFile(path.join(project, 'source'), marker);
    const gate: { wait?: Promise<void> } = {};
    let resume!: () => void;
    gate.wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const index = createIndex({
      beforeRead: async () => {
        await gate.wait;
      },
    });
    try {
      const query = await index.reverse(targetPath);
      expect(query).toMatchObject({
        status: codeCollectionStatuses.collecting,
        hasCompletedCollection: false,
        occurrences: [],
        unique: false,
        absent: false,
      });
      expect(await index.snapshot()).toMatchObject({
        hasCompletedCollection: false,
      });
    } finally {
      resume();
    }
    expect(await index.ready()).toMatchObject({
      status: codeCollectionStatuses.complete,
      hasCompletedCollection: true,
      confirmedCount: 1,
    });
  });
  it('저장 표기와 같은 buffer를 반복 등록하면 게시하지 않고 다른 표기를 등록하면 한 번 게시한다', async () => {
    const { index, seen } = await readyIndex();
    const before = (await index.snapshot()).codeGeneration;
    await index.updateBuffer({
      sourcePath: 'source',
      text: marker + '#L2',
      documentVersion: 1,
    });
    await index.updateBuffer({
      sourcePath: 'source',
      text: marker + '#L2',
      documentVersion: 2,
    });
    expect(seen).toEqual([]);
    expect((await index.snapshot()).codeGeneration).toBe(before);
    await index.updateBuffer({
      sourcePath: 'source',
      text: marker + '#L3',
      documentVersion: 3,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.codeGeneration).toBe(before + 1);
  });
  it('결과가 같은 수집을 다시 하면 게시하지 않는다', async () => {
    const { index, seen } = await readyIndex();
    await index.refresh();
    await index.refresh(['source']);
    expect(seen).toEqual([]);
  });
  it('편집하지 않은 buffer를 닫으면 게시도 수집도 하지 않는다', async () => {
    const observed: string[] = [];
    const { index, seen } = await readyIndex({
      observe: (kind) => observed.push(kind),
    });
    await index.updateBuffer({
      sourcePath: 'source',
      text: marker + '#L2',
      documentVersion: 1,
    });
    observed.length = 0;
    await index.closeBuffer('source');
    expect(seen).toEqual([]);
    expect(observed).toEqual([]);
  });
  it('저장하지 않은 편집을 버리고 닫으면 저장 표기로 돌아가며 한 번만 게시한다', async () => {
    const observed: string[] = [];
    const { index, seen } = await readyIndex({
      observe: (kind) => observed.push(kind),
    });
    await index.updateBuffer({
      sourcePath: 'source',
      text: marker + '#L3',
      documentVersion: 1,
    });
    seen.length = 0;
    observed.length = 0;
    await index.closeBuffer('source');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.occurrences[0]).toMatchObject({
      observation: codeObservationKinds.disk,
      marker: { text: marker + '#L2' },
    });
    expect(observed).toEqual([]);
  });
  it('임계 시간 안에 끝난 재확인은 collecting 없이 달라진 최종 결과만 한 번 게시한다', async () => {
    const { index, seen } = await readyIndex({ collectingThreshold: 60_000 });
    await writeFile(path.join(project, 'source'), marker + '#L3');
    await index.refresh(['source']);
    expect(seen.map((item) => item.status)).toEqual([
      codeCollectionStatuses.complete,
    ]);
  });
  it('임계 시간을 넘긴 재확인은 이전 결과를 유지한 채 collecting을 한 번, 최종 결과를 한 번 게시한다', async () => {
    const gate: { wait?: Promise<void> } = {};
    const { index, seen } = await readyIndex({
      collectingThreshold: 10,
      beforeRead: async () => {
        await gate.wait;
      },
    });
    let resume!: () => void;
    gate.wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    await writeFile(path.join(project, 'source'), marker + '#L3');
    const operation = index.refresh(['source']);
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({
        status: codeCollectionStatuses.collecting,
        hasCompletedCollection: true,
        occurrences: [{ marker: { text: marker + '#L2' } }],
      });
      expect(
        await index.reverse(targetPath, { startLine: 2, endLine: 2 }),
      ).toMatchObject({
        status: codeCollectionStatuses.collecting,
        unique: true,
        absent: false,
      });
    } finally {
      resume();
    }
    await operation;
    expect(seen.map((item) => item.status)).toEqual([
      codeCollectionStatuses.collecting,
      codeCollectionStatuses.complete,
    ]);
    expect(seen[1]!.occurrences[0]!.marker.text).toBe(marker + '#L3');
  });
  it('임계 시간을 넘겼어도 결과가 같으면 collecting 한 번과 complete 한 번만 게시한다', async () => {
    const gate: { wait?: Promise<void> } = {};
    const { index, seen } = await readyIndex({
      collectingThreshold: 10,
      beforeRead: async () => {
        await gate.wait;
      },
    });
    let resume!: () => void;
    gate.wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const operation = index.refresh();
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1));
    } finally {
      resume();
    }
    await operation;
    expect(seen.map((item) => item.status)).toEqual([
      codeCollectionStatuses.collecting,
      codeCollectionStatuses.complete,
    ]);
  });
});
