import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  buildCatalog,
  parseYaml,
  scanStatuses,
  codeReferenceStatuses,
} from '@codocs/core';
vi.mock('../paths/code-file-access.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../paths/code-file-access.js')>();
  const { countCodeAccess } = await import('../test-support/code-watch.js');
  return countCodeAccess(actual);
});
import { ioFailures } from '../test-support/file-system.js';
import { calculateRevision } from '../revision/index.js';
import {
  codeAccessCounts,
  createFakeCodeWatch,
  resetCodeAccessCounts,
} from '../test-support/code-watch.js';
import { discoverCodeFiles } from '../paths/code-file-access.js';
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
import {
  renameWithRetry,
  rmWithRetry,
} from '../../../../tools/test/support/retrying-fs.js';
const executeGit = promisify(execFile);
let project: string;
const indexes: WorkspaceCodeReferenceIndex[] = [];
const sessions: WorkspaceQuerySession[] = [];
const targetPath = '.codocs/target.yaml';
const targetText =
  '_codocs:\n  id: target\n  name: 대상\ndefinition: 본문\n업무: 값\n내용: 값\n';
beforeEach(async () => {
  resetCodeAccessCounts();
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
  await rmWithRetry(project, { recursive: true, force: true });
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
    await writeFile(path.join(project, 'source'), '🙂 @codocs [[대상:업무]]');
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
  it('적격 buffer를 편집하면 disk 출현을 대체하고 중복 집계하지 않는다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
    const index = createIndex();
    await index.ready();
    await index.updateBuffer({
      sourcePath: 'source',
      text: '@codocs [[대상:내용]] @codocs [[대상]]',
      documentVersion: 1,
    });
    expect(
      (await index.ready()).occurrences.map((item) => item.observation),
    ).toEqual([codeObservationKinds.buffer, codeObservationKinds.buffer]);
  });
  it('buffer를 닫으면 저장 표기와 위치로 돌아간다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
    const index = createIndex();
    await index.updateBuffer({
      sourcePath: 'source',
      text: '@codocs [[대상:내용]]',
      documentVersion: 1,
    });
    await index.closeBuffer('source');
    expect((await index.ready()).occurrences[0]).toMatchObject({
      observation: codeObservationKinds.disk,
      marker: { text: '@codocs [[대상:업무]]' },
    });
  });
  it('정책 제외 파일을 열면 buffer 출현도 수집하지 않는다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'excluded\n');
    await writeFile(path.join(project, 'excluded'), '@codocs [[대상]]');
    const index = createIndex();
    expect(
      await index.updateBuffer({
        sourcePath: 'excluded',
        text: '@codocs [[대상:내용]]',
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
      text: '@codocs [[대상:내용]]',
      documentVersion: 2,
    });
    expect(
      await index.updateBuffer({
        sourcePath: 'source',
        text: '@codocs [[대상:업무]]',
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
  it('섹션을 조회하면 그 섹션 표기의 출현만 제공하고 문서 전체 조회에서는 제외한다', async () => {
    await writeFile(
      path.join(project, 'source'),
      '@codocs [[대상:업무]] @codocs [[대상:내용]] @codocs [[대상:업무]] @codocs [[대상]]',
    );
    const index = createIndex();
    await index.ready();
    const result = await index.reverse(targetPath, '업무');
    expect(result.confirmedCount).toBe(2);
    expect(
      new Set(result.occurrences.map((item) => item.occurrenceId)).size,
    ).toBe(2);
    expect(result.unique).toBe(false);
    expect(
      result.occurrences.map((item) => item.marker.range.start.character),
    ).toEqual([0, 36]);
    expect((await index.reverse(targetPath, '내용')).unique).toBe(true);
    expect((await index.reverse(targetPath)).confirmedCount).toBe(1);
    expect((await index.reverse(targetPath, '없음')).absent).toBe(true);
  });
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
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
    let first = true;
    const index = createIndex({
      beforeRead: async () => {
        if (first) {
          first = false;
          await writeFile(
            path.join(project, 'source'),
            '@codocs [[대상:내용]]',
          );
        }
      },
    });
    const snapshot = await index.ready();
    expect(snapshot.occurrences[0]?.marker.text).toBe('@codocs [[대상:내용]]');
  });
  it('source와 owner 버전이 같으면 capture token으로 정확한 출현을 재확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
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
      marker: { text: '@codocs [[대상:업무]]' },
    });
  });
  it('섹션 표기를 확인하면 저장 문서의 섹션 키 위치를 목적지로 재확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
    const index = createIndex();
    const snapshot = await index.ready();
    expect(snapshot.occurrences[0]).toMatchObject({
      status: codeReferenceStatuses.resolved,
      section: '업무',
    });
    index.setOwner('source', 1);
    const token = await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    });
    expect(
      await index.confirm(token!, { sourcePath: 'source', documentVersion: 1 }),
    ).toMatchObject({
      destination: {
        kind: 'section',
        section: '업무',
        markerText: '업무',
        range: {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 2 },
        },
      },
    });
  });
  it('저장 문서에 없는 섹션 표기는 섹션 부재로 두고 조회와 capture에서 제외한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:없음]]');
    const index = createIndex();
    const snapshot = await index.ready();
    expect(snapshot.occurrences[0]?.status).toBe(
      codeReferenceStatuses.missingSection,
    );
    expect((await index.reverse(targetPath, '없음')).occurrences).toEqual([]);
    index.setOwner('source', 1);
    expect(
      await index.capture({
        occurrenceId: snapshot.occurrences[0]!.occurrenceId,
        ownerPath: 'source',
        ownerVersion: 1,
      }),
    ).toBeUndefined();
  });
  it('관련 없는 파일이 바뀌어 다시 수집되고 세대가 올라도 같은 token을 확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
    const index = createIndex();
    const snapshot = await index.ready();
    index.setOwner('source', 1);
    const token = (await index.capture({
      occurrenceId: snapshot.occurrences[0]!.occurrenceId,
      ownerPath: 'source',
      ownerVersion: 1,
    }))!;
    await writeFile(path.join(project, 'unrelated'), '@codocs [[대상:내용]]');
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
      marker: { text: '@codocs [[대상:업무]]' },
    });
  });
  it('수집이 진행 중일 때 클릭하면 기다리지 않고 직접 읽어 확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
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
        marker: { text: '@codocs [[대상:업무]]' },
      });
    } finally {
      resume();
      await operation;
    }
  });
  it('source의 표기와 무관한 뒷줄만 편집해도 클릭을 확인한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
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
      '@codocs [[대상:업무]]\n관련 없는 줄을 추가했다',
    );
    expect(
      await index.confirm(token, { sourcePath: 'source', documentVersion: 1 }),
    ).toMatchObject({ sourcePath: 'source' });
  });
  it('표기 위치가 실제로 이동하면 거부한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
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
      '앞줄 추가\n@codocs [[대상:업무]]',
    );
    expect(
      await index.confirm(token, { sourcePath: 'source', documentVersion: 1 }),
    ).toBeUndefined();
  });
  it('대상 문서가 실제로 바뀌어 새 catalog가 게시되어도 거부한다', async () => {
    await writeFile(path.join(project, 'source'), '@codocs [[대상:업무]]');
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
      await renameWithRetry(
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
    await index.reverse(targetPath, '업무');
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
      text: '@codocs [[대상:업무]]',
      documentVersion: 1,
    });
    await rmWithRetry(path.join(project, 'source'));
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
/**
 * 제외 경로의 변경이 수집 pass에 들어가지 않았는지 확인한다.
 * 고정 시간 대기는 느린 감시에서 늦은 신호를 놓치므로, 수집 대상 파일을 하나 더 써서 그 출현이 게시될 때까지를 경계로 삼는다.
 */
async function expectExcludedChangeIgnored(
  index: WorkspaceCodeReferenceIndex,
  passes: { affected: string[] }[],
  excluded: string,
): Promise<void> {
  const barrier = published(index, (snapshot) =>
    snapshot.occurrences.some((item) => item.sourcePath === 'barrier'),
  );
  await writeFile(path.join(project, 'barrier'), marker);
  await barrier;
  expect(passes.flatMap((pass) => pass.affected)).not.toContain(excluded);
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
/** 섹션을 적은 표기를 만든다. */
function markerSection(section: string): string {
  return `@codocs [[대상:${section}]]`;
}

describe('WorkspaceCodeReferenceIndex: 수집 범위만 감시', () => {
  it('제외한 dist 폴더를 삭제하고 다시 만들어도 감시 오류 없이 complete를 유지한다', async () => {
    await writeFile(path.join(project, '.gitignore'), 'dist/\n');
    await mkdir(path.join(project, 'dist'));
    await writeFile(path.join(project, 'dist', 'out.js'), 'text');
    const watchers = countingWatchers();
    const index = createIndex({ createWatcher: watchers.createWatcher });
    await index.ready();
    await rmWithRetry(path.join(project, 'dist'), { recursive: true });
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
    const passes: { affected: string[] }[] = [];
    const index = createIndex({
      observe: (_kind, detail) =>
        passes.push({ affected: (detail['affected'] as string[]) ?? [] }),
    });
    await index.ready();
    await writeFile(path.join(project, 'dist', 'junk'), marker + marker);
    await expectExcludedChangeIgnored(
      index,
      passes,
      path.join(project, 'dist', 'junk'),
    );
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
    await vi.waitFor(() => expect(observed.length).toBeGreaterThan(1), {
      timeout: 5_000,
    });
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
      await vi.waitFor(() => expect(fake.schedules).toHaveLength(attempt + 1), {
        timeout: 5_000,
      });
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
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(1), {
      timeout: 5_000,
    });
    fake.schedules[0]!.run();
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(2), {
      timeout: 5_000,
    });
    const recovered = published(
      index,
      (snapshot) => snapshot.status === codeCollectionStatuses.complete,
    );
    fake.schedules[1]!.run();
    await recovered;
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.behavior.failRegistrations = 1;
    fake.connections.at(-1)!.failed(new Error('EPERM: watch'));
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(3), {
      timeout: 5_000,
    });
    expect(fake.schedules.map((item) => item.delay)).toEqual([
      1_000, 2_000, 1_000,
    ]);
  });
  it('예약된 재시도 중 경로 없는 refresh를 호출하면 예약을 취소하고 즉시 복구한다', async () => {
    const { index, fake } = await startedIndex();
    fake.behavior.failRegistrations = 1;
    fake.connections[0]!.failed(new Error('EPERM: watch'));
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(1), {
      timeout: 5_000,
    });
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
    await vi.waitFor(() => expect(fake.schedules).toHaveLength(1), {
      timeout: 5_000,
    });
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
    await rmWithRetry(path.join(project, 'nested'), { recursive: true });
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
  /**
   * 최초 수집이 끝난 색인과 게시 목록을 만든다.
   * 이 그룹은 refresh 호출로만 재수집을 일으키므로 가짜 감시를 쓴다. 실제 감시는 테스트의 파일 쓰기를 늦게 보고
   * 별도 pass를 더해 게시 횟수와 순서를 OS 타이밍에 따라 바꾼다.
   */
  async function readyIndex(
    options: WorkspaceCodeReferenceIndexOptions = {},
    text = markerSection('업무'),
  ): Promise<{
    index: WorkspaceCodeReferenceIndex;
    seen: WorkspaceCodeReferenceSnapshot[];
  }> {
    await writeFile(path.join(project, 'source'), text);
    const fake = createFakeCodeWatch();
    const index = createIndex({
      createWatcher: fake.createWatcher,
      schedule: fake.schedule,
      ...options,
    });
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
      text: markerSection('업무'),
      documentVersion: 1,
    });
    await index.updateBuffer({
      sourcePath: 'source',
      text: markerSection('업무'),
      documentVersion: 2,
    });
    expect(seen).toEqual([]);
    expect((await index.snapshot()).codeGeneration).toBe(before);
    await index.updateBuffer({
      sourcePath: 'source',
      text: markerSection('내용'),
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
      text: markerSection('업무'),
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
      text: markerSection('내용'),
      documentVersion: 1,
    });
    seen.length = 0;
    observed.length = 0;
    await index.closeBuffer('source');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.occurrences[0]).toMatchObject({
      observation: codeObservationKinds.disk,
      marker: { text: markerSection('업무') },
    });
    expect(observed).toEqual([]);
  });
  it('임계 시간 안에 끝난 재확인은 collecting 없이 달라진 최종 결과만 한 번 게시한다', async () => {
    const { index, seen } = await readyIndex({ collectingThreshold: 60_000 });
    await writeFile(path.join(project, 'source'), markerSection('내용'));
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
    await writeFile(path.join(project, 'source'), markerSection('내용'));
    const operation = index.refresh(['source']);
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 5_000 });
      expect(seen[0]).toMatchObject({
        status: codeCollectionStatuses.collecting,
        hasCompletedCollection: true,
        occurrences: [{ marker: { text: markerSection('업무') } }],
      });
      expect(await index.reverse(targetPath, '업무')).toMatchObject({
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
    expect(seen[1]!.occurrences[0]!.marker.text).toBe(markerSection('내용'));
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
      await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 5_000 });
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

describe('WorkspaceCodeReferenceIndex: 변경 경로만 증분 수집', () => {
  /** 가짜 감시로 최초 수집을 마치고 전체 계산 횟수를 0으로 되돌린 색인이다. */
  async function incrementalIndex(
    files: Record<string, string> = { source: marker },
  ): Promise<{
    index: WorkspaceCodeReferenceIndex;
    fake: ReturnType<typeof createFakeCodeWatch>;
    observed: string[];
    seen: WorkspaceCodeReferenceSnapshot[];
    signal: (...relatives: string[]) => Promise<void>;
  }> {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(project, name)), { recursive: true });
      await writeFile(path.join(project, name), text);
    }
    const fake = createFakeCodeWatch();
    const observed: string[] = [];
    const index = createIndex({
      createWatcher: fake.createWatcher,
      schedule: fake.schedule,
      observe: (kind) => observed.push(kind),
    });
    await index.ready();
    const seen: WorkspaceCodeReferenceSnapshot[] = [];
    index.onDidChange((snapshot) => seen.push(snapshot));
    resetCodeAccessCounts();
    observed.length = 0;
    return {
      index,
      fake,
      observed,
      seen,
      /** 감시 신호를 보내고 그 신호를 처리한 pass가 끝나기를 기다린다. */
      signal: async (...relatives) => {
        const before = observed.length;
        fake.connections
          .at(-1)!
          .changed(relatives.map((item) => path.join(project, item)));
        await vi.waitFor(
          () => expect(observed.length).toBeGreaterThan(before),
          { timeout: 5_000 },
        );
      },
    };
  }
  /** 같은 디스크 상태의 새 전체 탐색이 확인한 파일과 실패가 색인과 같은지 확인한다. */
  async function expectSameAsFullDiscovery(
    index: WorkspaceCodeReferenceIndex,
  ): Promise<void> {
    const discoveries = codeAccessCounts.discovery;
    const fresh = await discoverCodeFiles(project);
    codeAccessCounts.discovery = discoveries;
    const snapshot = await index.snapshot();
    expect([
      ...new Set(snapshot.occurrences.map((item) => item.sourcePath)),
    ]).toEqual(
      fresh.files
        .filter((file) => file.text.includes('@codocs'))
        .map((file) => file.path),
    );
    expect(snapshot.failures).toEqual(fresh.failures);
  }
  it('파일 내용 변경과 같은 내용 저장과 mtime만 바뀐 변경은 정책 계산도 전체 탐색도 하지 않는다', async () => {
    const { index, signal, seen } = await incrementalIndex();
    await writeFile(path.join(project, 'source'), marker + '\n' + marker);
    await signal('source');
    expect(seen).toHaveLength(1);
    expect((await index.snapshot()).occurrences).toHaveLength(2);
    await writeFile(path.join(project, 'source'), marker + '\n' + marker);
    await signal('source');
    await utimes(
      path.join(project, 'source'),
      new Date(),
      new Date(2000, 1, 1),
    );
    await signal('source');
    expect(seen).toHaveLength(1);
    expect(codeAccessCounts).toEqual({ policy: 0, discovery: 0 });
  });
  it('파일을 새로 만들고 지우면 그 경로만 반영하며 전체 계산을 하지 않는다', async () => {
    const { index, signal } = await incrementalIndex();
    await writeFile(path.join(project, 'added'), marker);
    await signal('added');
    expect((await index.snapshot()).occurrences).toHaveLength(2);
    await rmWithRetry(path.join(project, 'source'));
    await signal('source');
    expect(
      (await index.snapshot()).occurrences.map((item) => item.sourcePath),
    ).toEqual(['added']);
    expect(codeAccessCounts).toEqual({ policy: 0, discovery: 0 });
  });
  it('.gitignore 편집과 폴더 생성·삭제와 git add·rm --cached 뒤 결과는 전체 탐색과 같다', async () => {
    await executeGit('git', ['init', project]);
    const { index, signal } = await incrementalIndex({
      source: marker,
      'ignored/a': marker,
    });
    await writeFile(path.join(project, '.gitignore'), 'ignored/\n');
    await signal('.gitignore');
    expect((await index.snapshot()).occurrences).toHaveLength(1);
    await expectSameAsFullDiscovery(index);
    await mkdir(path.join(project, 'made', 'deep'), { recursive: true });
    await writeFile(path.join(project, 'made', 'deep', 'b'), marker);
    await signal('made');
    expect((await index.snapshot()).occurrences).toHaveLength(2);
    await expectSameAsFullDiscovery(index);
    await rmWithRetry(path.join(project, 'made'), { recursive: true });
    await signal('made');
    await expectSameAsFullDiscovery(index);
    await executeGit('git', ['-C', project, 'add', '-f', 'ignored/a']);
    await signal('.git/index');
    expect((await index.snapshot()).occurrences).toHaveLength(2);
    await expectSameAsFullDiscovery(index);
    await executeGit('git', [
      '-C',
      project,
      'rm',
      '--cached',
      '-q',
      'ignored/a',
    ]);
    await signal('.git/index');
    expect((await index.snapshot()).occurrences).toHaveLength(1);
    await expectSameAsFullDiscovery(index);
    expect(codeAccessCounts.discovery).toBe(0);
  });
  it('git status가 index를 다시 써도 이미 적격인 파일의 git add도 아무것도 게시하지 않는다', async () => {
    await executeGit('git', ['init', project]);
    const { signal, seen } = await incrementalIndex({ source: marker });
    await executeGit('git', ['-C', project, 'add', 'source']);
    await utimes(
      path.join(project, 'source'),
      new Date(),
      new Date(2000, 1, 1),
    );
    await executeGit('git', ['-C', project, 'status']);
    await signal('.git/index');
    await executeGit('git', ['-C', project, 'status']);
    await signal('.git/index', '.git/HEAD');
    expect(seen).toEqual([]);
    expect(codeAccessCounts.discovery).toBe(0);
  });
  it('한 pass 동안 도착한 변경은 누적한 경로만 다음 pass로 처리하고 전체 탐색을 하지 않는다', async () => {
    const gate: { hold?: Promise<void>; entered?: (() => void) | undefined } =
      {};
    const fake = createFakeCodeWatch();
    const index = createIndex({
      createWatcher: fake.createWatcher,
      schedule: fake.schedule,
      beforeRead: async () => {
        gate.entered?.();
        await gate.hold;
      },
    });
    await writeFile(path.join(project, 'source'), marker);
    await mkdir(path.join(project, 'dir'));
    await index.ready();
    resetCodeAccessCounts();
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      gate.entered = resolve;
    });
    const settled = published(
      index,
      (snapshot) => snapshot.occurrences.length === 3,
    );
    await writeFile(path.join(project, 'first'), marker);
    fake.connections[0]!.changed([path.join(project, 'first')]);
    await entered;
    gate.entered = undefined;
    await writeFile(path.join(project, 'dir', 'second'), marker);
    fake.connections[0]!.changed([
      path.join(project, 'dir', 'second'),
      path.join(project, 'first'),
    ]);
    release();
    await settled;
    expect(codeAccessCounts).toEqual({ policy: 0, discovery: 0 });
  });
});

describe('WorkspaceCodeReferenceIndex: 겹치는 감시 재구성', () => {
  /** 제외 규칙이 있는 폴더로 최초 수집을 마친 가짜 감시 색인이다. */
  async function rebuildIndex(): Promise<{
    index: WorkspaceCodeReferenceIndex;
    fake: ReturnType<typeof createFakeCodeWatch>;
  }> {
    await writeFile(path.join(project, '.gitignore'), 'included/\n');
    await mkdir(path.join(project, 'included'));
    await writeFile(path.join(project, 'included', 'source'), marker);
    const fake = createFakeCodeWatch();
    const index = createIndex({
      createWatcher: fake.createWatcher,
      schedule: fake.schedule,
    });
    await index.ready();
    resetCodeAccessCounts();
    fake.events.length = 0;
    return { index, fake };
  }
  it('규칙이 바뀌면 새 감시 시작과 ready 뒤에 이전 감시를 닫고 그 사이의 변경도 관측하며 전체 탐색을 하지 않는다', async () => {
    const { index, fake } = await rebuildIndex();
    fake.behavior.holdStart = true;
    await writeFile(path.join(project, '.gitignore'), '');
    fake.connections[0]!.changed([path.join(project, '.gitignore')]);
    await vi.waitFor(() => expect(fake.events).toEqual(['start:1']), {
      timeout: 5_000,
    });
    // 겹치는 동안 두 감시가 같은 경로를 보내도 한 경로로 합쳐진다.
    await writeFile(path.join(project, 'included', 'during'), marker);
    const during = path.join(project, 'included', 'during');
    fake.connections[0]!.changed([during]);
    fake.connections[1]!.changed([during]);
    expect(fake.events).toEqual(['start:1']);
    const settled = published(
      index,
      (snapshot) => snapshot.occurrences.length === 2,
    );
    fake.release(1);
    expect(
      (await settled).occurrences.map((item) => item.sourcePath).sort(),
    ).toEqual(['included/during', 'included/source']);
    expect(fake.events).toEqual(['start:1', 'ready:1', 'close:0']);
    expect(fake.connections.map((item) => item.closed)).toEqual([true, false]);
    expect(codeAccessCounts).toEqual({ policy: 0, discovery: 0 });
  });
  it('새 감시가 ready가 된 뒤 새로 포함한 폴더에서 생긴 변경은 새 감시가 전달해 관측한다', async () => {
    const { index, fake } = await rebuildIndex();
    await writeFile(path.join(project, '.gitignore'), '');
    fake.connections[0]!.changed([path.join(project, '.gitignore')]);
    await vi.waitFor(() => expect(fake.connections).toHaveLength(2), {
      timeout: 5_000,
    });
    await vi.waitFor(() => expect(fake.connections[0]!.closed).toBe(true), {
      timeout: 5_000,
    });
    const edited = published(
      index,
      (snapshot) => snapshot.occurrences.length === 2,
    );
    await writeFile(
      path.join(project, 'included', 'source'),
      marker + '\n' + marker,
    );
    fake.connections[1]!.changed([path.join(project, 'included', 'source')]);
    await edited;
    expect(codeAccessCounts.discovery).toBe(0);
  });
  it('새 감시 등록이 실패하면 이전 감시를 닫고 감시 오류 복구의 전체 재확인으로 complete를 회복한다', async () => {
    const { index, fake } = await rebuildIndex();
    fake.behavior.failRegistrations = 1;
    const incomplete = published(
      index,
      (snapshot) =>
        snapshot.status === codeCollectionStatuses.incomplete &&
        snapshot.failures.some((item) => item.reason === codeFileReasons.watch),
    );
    const recovered = published(
      index,
      (snapshot) => snapshot.status === codeCollectionStatuses.complete,
    );
    await writeFile(path.join(project, '.gitignore'), '');
    fake.connections[0]!.changed([path.join(project, '.gitignore')]);
    await incomplete;
    await recovered;
    expect(fake.events.slice(0, 4)).toEqual([
      'start:1',
      'ready:1',
      'close:1',
      'close:0',
    ]);
    expect(fake.connections[0]!.closed).toBe(true);
    expect(fake.connections.at(-1)!.closed).toBe(false);
    expect(codeAccessCounts.discovery).toBeGreaterThan(0);
  });
});
/** .codocs 문서를 제외한 코드 파일만 남긴다. 수집은 .codocs 안의 YAML도 일반 파일로 읽는다. */
function codeOnly(
  sources: ReturnType<WorkspaceCodeReferenceIndex['renameSources']>,
) {
  return sources.files.filter((file) => !file.path.startsWith('.codocs/'));
}
describe('WorkspaceCodeReferenceIndex.renameSources: 이름 변경 계산용 저장 관측', () => {
  it('최초 수집이 끝나기 전에는 collecting이고 끝나면 경로 순서의 저장 원문·revision·표기를 제공한다', async () => {
    await writeFile(path.join(project, 'b.ts'), '// @codocs [[대상]]');
    await writeFile(path.join(project, 'a.ts'), '// @codocs [[대상:업무]]');
    const index = createIndex();

    expect(index.renameSources().status).toBe(
      codeCollectionStatuses.collecting,
    );

    await index.ready();
    const sources = index.renameSources();

    expect(sources.status).toBe(codeCollectionStatuses.complete);
    expect(codeOnly(sources).map((file) => file.path)).toEqual([
      'a.ts',
      'b.ts',
    ]);
    expect(codeOnly(sources)[0]).toMatchObject({
      text: '// @codocs [[대상:업무]]',
      markers: [{ name: '대상', section: '업무' }],
    });
    expect(codeOnly(sources)[0]?.revision).toBe(
      calculateRevision(Buffer.from('// @codocs [[대상:업무]]', 'utf8')),
    );
  });

  it('IDE buffer는 무시하고 저장된 디스크 원문과 revision만 제공한다', async () => {
    await writeFile(path.join(project, 'source.ts'), '@codocs [[대상:업무]]');
    const index = createIndex();
    await index.ready();
    const before = codeOnly(index.renameSources())[0]!;
    await index.updateBuffer({
      sourcePath: 'source.ts',
      text: '@codocs [[대상:내용]] 편집 중',
      documentVersion: 1,
    });

    expect(codeOnly(index.renameSources())[0]).toEqual(before);
    expect(before.text).toBe('@codocs [[대상:업무]]');
  });

  it('읽지 못한 파일은 failures로 보고하고 읽은 파일은 계속 제공한다', async () => {
    await writeFile(path.join(project, 'source.ts'), '@codocs [[대상]]');
    await writeFile(path.join(project, 'legacy.ts'), '@codocs [[대상]]');
    ioFailures.set(path.join(project, 'legacy.ts'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const index = createIndex();
    await index.ready();
    const sources = index.renameSources();

    expect(sources.status).toBe(codeCollectionStatuses.incomplete);
    expect(codeOnly(sources).map((file) => file.path)).toEqual(['source.ts']);
    expect(sources.failures).toMatchObject([{ path: 'legacy.ts' }]);
  });
});

describe('WorkspaceCodeReferenceIndex: .codocsignore 제외', () => {
  it('추적된 파일이 제외 폴더에 있으면 출현과 진단 없이 완료로 게시한다', async () => {
    await executeGit('git', ['init', project]);
    await mkdir(path.join(project, 'docs'));
    await writeFile(path.join(project, 'docs', 'a.md'), marker);
    await writeFile(path.join(project, 'src'), marker);
    await executeGit('git', ['-C', project, 'add', 'docs/a.md', 'src']);
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    const index = createIndex();
    const result = await index.ready();
    expect(result.status).toBe(codeCollectionStatuses.complete);
    expect(result.occurrences.map((item) => item.sourcePath)).toEqual(['src']);
    expect(result.failures).toEqual([]);
  });
  it('제외한 파일을 편집기에서 열면 buffer로 받지 않고 이전 진단도 지운다', async () => {
    await writeFile(path.join(project, 'source'), marker);
    const index = createIndex();
    await index.ready();
    expect(
      await index.updateBuffer({
        sourcePath: 'source',
        text: markerSection('내용'),
        documentVersion: 1,
      }),
    ).toBe(true);
    const cleared = published(
      index,
      (snapshot) => snapshot.occurrences.length === 0,
    );
    await writeFile(path.join(project, '.codocsignore'), 'source\n');
    await cleared;
    expect(
      await index.updateBuffer({
        sourcePath: 'source',
        text: markerSection('내용'),
        documentVersion: 2,
      }),
    ).toBe(false);
    expect((await index.ready()).occurrences).toEqual([]);
  });
  it('감시 중 .codocsignore에 경로를 더하고 빼면 출현이 사라지고 다시 수집되며 감시를 다시 등록한다', async () => {
    await mkdir(path.join(project, 'docs'));
    await writeFile(path.join(project, 'docs', 'source'), marker);
    const watchers = countingWatchers();
    const index = createIndex({ createWatcher: watchers.createWatcher });
    await index.ready();
    const removed = published(
      index,
      (snapshot) => snapshot.occurrences.length === 0,
    );
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    await removed;
    const restored = published(
      index,
      (snapshot) => snapshot.occurrences.length === 1,
    );
    await rmWithRetry(path.join(project, '.codocsignore'));
    await restored;
    expect(watchers.created).toHaveLength(3);
    expect(watchers.errors).toEqual([]);
  });
  it('제외한 폴더의 추적 파일을 수정해도 다시 읽거나 게시하지 않는다', async () => {
    await executeGit('git', ['init', project]);
    await mkdir(path.join(project, 'docs'));
    await writeFile(path.join(project, 'docs', 'keep'), marker);
    await executeGit('git', ['-C', project, 'add', 'docs/keep']);
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    const passes: { affected: string[] }[] = [];
    const index = createIndex({
      observe: (_kind, detail) =>
        passes.push({ affected: (detail['affected'] as string[]) ?? [] }),
    });
    await index.ready();
    await writeFile(path.join(project, 'docs', 'keep'), marker + marker);
    await expectExcludedChangeIgnored(
      index,
      passes,
      path.join(project, 'docs', 'keep'),
    );
  });
  it('.codocsignore를 읽지 못하면 incomplete로 게시하고 .codocsignore 실패 경로를 남긴다', async () => {
    await writeFile(path.join(project, 'source'), marker);
    await writeFile(path.join(project, '.codocsignore'), 'docs/\n');
    ioFailures.set(path.join(project, '.codocsignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const index = createIndex();
    const result = await index.ready();
    expect(result.status).toBe(codeCollectionStatuses.incomplete);
    expect(result.failures.map((failure) => failure.path)).toContain(
      '.codocsignore',
    );
    expect(result.occurrences).toEqual([]);
  });
});
