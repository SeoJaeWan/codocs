import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogConfirmations,
  codeReferenceSyntaxes,
  changeImpactCertainties,
  changeImpactDiagnosticMessages,
  changeImpactReasons,
  changeImpactStatuses,
  codeReferenceDestinationKinds,
  codeReferenceStatuses,
} from '@codocs/core';
import {
  codeCollectionStatuses,
  codeFileReasons,
  codeObservationKinds,
} from '../code-reference/index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
  type WorkspaceQuerySessionOptions,
} from '../query/index.js';
import {
  createWorkspaceWriteImpactNotice,
  type WorkspaceWriteImpactCapture,
} from './index.js';
import { writeImpactBases } from './domain-values.js';

let root: string;
let target: string;
let sessions: WorkspaceQuerySession[];
const original =
  'id: target\nname: 계약\ndomains: [업무]\ndefinition: |\n  alpha\n  beta\n  gamma\n  omega\n';
const code =
  '// @codocs [[계약]]#L5 @codocs [[계약]]#L6-L7\n// @codocs [[계약]]#L8\n// @codocs [[계약]]\n// @codocs [[업무:계약]]#L6\n';
/** 파일과 모든 watcher는 사례별 사유 작업 트리에만 생성한다. */
beforeEach(async () => {
  await mkdir('.workbench', { recursive: true });
  root = await mkdtemp(path.resolve('.workbench/write-impact-'));
  await mkdir(path.join(root, '.codocs'));
  target = path.join(root, '.codocs/target.yaml');
  await writeFile(target, original);
  await writeFile(path.join(root, 'source.txt'), code);
  sessions = [];
});
/** 세션의 문서·코드 watcher를 닫은 뒤 fixture를 정리한다. */
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(sessions.map((session) => session.close()));
  await rm(root, { recursive: true, force: true });
});
/** 실제 실패 지점을 제외하면 디스크 수집과 저장을 그대로 실행한다. */
function session(
  options: WorkspaceQuerySessionOptions = {},
): WorkspaceQuerySession {
  const current = createWorkspaceQuerySession(
    { project: root, cwd: root },
    undefined,
    options,
  );
  sessions.push(current);
  return current;
}
/** 요청 버전은 비교 구현과 독립적으로 원본 바이트에서 계산한다. */
function revision(raw: string | Uint8Array): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe('WorkspaceWriteImpact 실제 저장과 기존 출현', () => {
  it('구간 내부를 변경하면 같은 파일의 서로 다른 출현과 전체 참조를 각각 보존한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { definition: 'alpha\nchanged\ngamma\nomega\n' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    if (!result.success) return;
    const bytes = await readFile(target);
    expect(result.revision).toBe(revision(bytes));
    expect(result.writeImpact).toMatchObject({
      basis: writeImpactBases.savedFiles,
      target: {
        path: '.codocs/target.yaml',
        revision: result.revision,
        beforeRevision: revision(original),
      },
      collection: {
        status: codeCollectionStatuses.complete,
        confirmedCount: 5,
      },
      calculation: { status: changeImpactStatuses.complete, failures: [] },
    });
    expect(
      result.writeImpact?.impacts.map((impact) => ({
        marker: impact.marker,
        reasons: impact.reasons,
      })),
    ).toEqual([
      {
        marker: '@codocs [[계약]]#L6-L7',
        reasons: [changeImpactReasons.regionChanged],
      },
      {
        marker: '@codocs [[계약]]',
        reasons: [changeImpactReasons.documentChanged],
      },
      {
        marker: '@codocs [[업무:계약]]#L6',
        reasons: [changeImpactReasons.regionChanged],
      },
    ]);
    expect(result.writeImpact?.impacts[0]).toMatchObject({
      sourcePath: 'source.txt',
      sourceRevision: revision(code),
      range: { start: { line: 0, character: 21 } },
      destination: {
        kind: codeReferenceDestinationKinds.rows,
        startLine: 6,
        endLine: 7,
      },
    });
    expect(JSON.stringify(result)).not.toContain('alpha');
    expect(result).not.toHaveProperty('raw');
    expect(result).not.toHaveProperty('document');
  });
  it('저장 코드에 출현이 없으면 완료 수집과 빈 영향 목록을 반환한다', async () => {
    await writeFile(path.join(root, 'source.txt'), '// no references');
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 계약' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
      writeImpact: {
        collection: {
          status: codeCollectionStatuses.complete,
          confirmedCount: 0,
        },
        calculation: { status: changeImpactStatuses.complete, failures: [] },
        impacts: [],
      },
    });
  });
  it('문서를 새로 생성하면 이전 연결 없이 실제 저장과 완료된 빈 영향을 반환한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'create',
      path: '.codocs/new.yaml',
      document: {
        id: 'new',
        name: '새 문서',
        domains: ['업무'],
        definition: '새 원문',
      },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
      writeImpact: {
        target: { path: '.codocs/new.yaml' },
        calculation: { status: changeImpactStatuses.complete, failures: [] },
        impacts: [],
      },
    });
    if (!result.success) return;
    expect(result.writeImpact?.target).not.toHaveProperty('beforeRevision');
    expect(result.revision).toBe(
      revision(await readFile(path.join(root, '.codocs/new.yaml'))),
    );
  });
  it('구간 뒤쪽만 변경하면 앞부분의 행 참조를 안내에서 제외한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { definition: 'alpha\nbeta\ngamma\nchanged\n' },
    });
    if (!result.success) return expect(result.success).toBe(true);
    expect(result.writeImpact?.impacts.map((impact) => impact.marker)).toEqual([
      '@codocs [[계약]]#L8',
      '@codocs [[계약]]',
    ]);
  });
  it('앞부분에 행을 삽입하면 기존 숫자를 보존하며 행 이동 사유를 안내한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { definition: 'inserted\nalpha\nbeta\ngamma\nomega\n' },
    });
    if (!result.success) return expect(result.success).toBe(true);
    expect(
      result.writeImpact?.impacts.find(
        (impact) => impact.marker === '@codocs [[계약]]#L6-L7',
      ),
    ).toMatchObject({
      destination: {
        kind: codeReferenceDestinationKinds.rows,
        startLine: 6,
        endLine: 7,
      },
      reasons: [changeImpactReasons.precedingLineShift],
    });
    expect(await readFile(path.join(root, 'source.txt'), 'utf8')).toBe(code);
  });
  it('끝 구간을 삭제하면 저장 뒤 범위가 무효여도 저장 전 출현을 안내한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { definition: 'alpha\n' },
    });
    if (!result.success) return expect(result.success).toBe(true);
    expect(
      result.writeImpact?.impacts.find(
        (impact) => impact.marker === '@codocs [[계약]]#L6-L7',
      )?.reasons,
    ).toContain(changeImpactReasons.regionChanged);
    expect(
      (await current.savedCodeReferenceSnapshot()).occurrences.find(
        (occurrence) => occurrence.marker.text === '@codocs [[계약]]#L6-L7',
      )?.status,
    ).toBe(codeReferenceStatuses.outOfBounds);
  });
  it('이름과 도메인을 바꾸면 저장 뒤 끊어진 기존 출현과 각 사유를 유지한다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 계약', domains: ['개발'] },
    });
    if (!result.success) return expect(result.success).toBe(true);
    expect(result.writeImpact?.impacts).toHaveLength(5);
    expect(
      result.writeImpact?.impacts.find(
        (impact) => impact.marker === '@codocs [[업무:계약]]#L6',
      )?.reasons,
    ).toEqual([
      changeImpactReasons.nameChanged,
      changeImpactReasons.domainChanged,
      changeImpactReasons.precedingLineShift,
    ]);
    expect(
      (await current.savedCodeReferenceSnapshot()).occurrences.every(
        (occurrence) => occurrence.status === codeReferenceStatuses.missing,
      ),
    ).toBe(true);
  });
  it('반복 구간 하나를 삭제하면 자동 재배치 없이 영향 가능성을 안내한다', async () => {
    const repeated = original.replace('  gamma\n', '  beta\n');
    await writeFile(target, repeated);
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(repeated),
      set: { definition: 'alpha\nbeta\nomega\n' },
    });
    if (!result.success) return expect(result.success).toBe(true);
    expect(
      result.writeImpact?.impacts.find(
        (impact) => impact.marker === '@codocs [[계약]]#L6-L7',
      ),
    ).toMatchObject({
      certainty: changeImpactCertainties.possible,
      reasons: [changeImpactReasons.ambiguousCorrespondence],
      destination: {
        kind: codeReferenceDestinationKinds.rows,
        startLine: 6,
        endLine: 7,
      },
    });
  });
  it('IDE buffer에 출현이 없어도 저장 안내에는 디스크 출현을 사용한다', async () => {
    const current = session();
    await current.codeReferenceSnapshot();
    expect(
      await current.updateCodeBuffer({
        sourcePath: 'source.txt',
        text: '// dirty buffer',
        documentVersion: 1,
      }),
    ).toBe(true);
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 계약' },
    });
    if (!result.success) return expect(result.success).toBe(true);
    expect(result.writeImpact?.collection.confirmedCount).toBe(5);
    expect(result.writeImpact?.impacts).toHaveLength(5);
  });
});

describe('WorkspaceWriteImpact 실패와 저장 결과 보존', () => {
  it('검증된 무변경은 영향 안내와 색인 결과를 추가하지 않는다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '계약' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: false,
      changed: false,
      revision: revision(original),
    });
    expect(result).not.toHaveProperty('writeImpact');
    expect(result).not.toHaveProperty('indexUpdated');
    expect(await readFile(target, 'utf8')).toBe(original);
  });
  it('원문 버전이 충돌하면 저장하지 않고 실제 변경 안내를 만들지 않는다', async () => {
    const current = session();
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: 'stale',
      set: { name: '새 이름' },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
    });
    expect(result).not.toHaveProperty('writeImpact');
    expect(await readFile(target, 'utf8')).toBe(original);
  });
  it('파일 교체가 실패하면 원본과 저장 오류를 보존하며 영향 안내를 생략한다', async () => {
    const current = session({
      storage: {
        operations: {
          rename: () =>
            Promise.reject(
              Object.assign(new Error('write denied'), { code: 'EACCES' }),
            ),
        },
      },
    });
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 이름' },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      error: { code: 'file_write_failed', ioCode: 'EACCES' },
    });
    expect(result).not.toHaveProperty('writeImpact');
    expect(await readFile(target, 'utf8')).toBe(original);
  });
  it('코드 수집이 예외로 실패해도 실제 저장과 새 revision을 보존한다', async () => {
    const current = session();
    vi.spyOn(current, 'savedCodeReferenceSnapshot').mockRejectedValue(
      new Error('collection denied'),
    );
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 이름' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: true,
    });
    if (!result.success) return;
    expect(result.revision).toBe(revision(await readFile(target)));
    expect(result.writeImpact).toMatchObject({
      collection: { status: codeCollectionStatuses.incomplete },
      calculation: {
        status: changeImpactStatuses.incomplete,
        failures: [changeImpactDiagnosticMessages.captureFailed],
      },
      impacts: [],
    });
    expect(result.writeImpact?.collection.failures[0]?.message).toContain(
      'collection denied',
    );
  });
  it('영향 계산이 실패해도 저장 결과와 색인 실패·복구 안내를 함께 보존한다', async () => {
    const current = session({
      beforeWriteImpactCalculation: () => {
        throw new Error('calculation unavailable');
      },
      beforeIndexUpdate: () => Promise.reject(new Error('index unavailable')),
    });
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 이름' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      changed: true,
      indexUpdated: false,
    });
    if (!result.success) return;
    expect(result.revision).toBe(revision(await readFile(target)));
    expect(
      result.diagnostics.find((item) => item.code === 'index_update_failed')
        ?.suggestion,
    ).toContain('codocs_refresh');
    expect(result.writeImpact?.calculation).toMatchObject({
      status: changeImpactStatuses.incomplete,
      failures: [expect.stringContaining('calculation unavailable')],
    });
    expect(result.writeImpact?.impacts).toEqual([]);
    await current.refresh();
    expect(await current.get(['target'])).toMatchObject({
      success: true,
      results: [{ found: true, revision: result.revision }],
    });
  });
  it('저장 뒤 외부 원문이 다시 바뀌어도 영향은 실제 반영한 원문으로 계산한다', async () => {
    const later = original
      .replace('  alpha', '  external')
      .replace('  beta', '  later');
    const current = session({
      beforeIndexUpdate: async () => {
        await writeFile(target, later);
      },
    });
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { definition: 'alpha\nbeta\ngamma\nchanged\n' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: false,
    });
    if (!result.success) return;
    expect(result.revision).not.toBe(revision(later));
    expect(result.writeImpact?.target.revision).toBe(result.revision);
    expect(result.writeImpact?.impacts.map((impact) => impact.marker)).toEqual([
      '@codocs [[계약]]#L8',
      '@codocs [[계약]]',
    ]);
    expect(await readFile(target, 'utf8')).toBe(later);
  });
  it('수집 도중 문서 세대가 바뀌면 저장은 유지하고 다른 세대의 출현 안내를 확정하지 않는다', async () => {
    const current = session();
    const savedSnapshot = current.savedCodeReferenceSnapshot.bind(current);
    await savedSnapshot();
    vi.spyOn(current, 'savedCodeReferenceSnapshot').mockImplementation(
      async () => {
        await writeFile(
          path.join(root, '.codocs/other.yaml'),
          'id: other\nname: 다른 문서\ndomains: [업무]\ndefinition: 본문\n',
        );
        await current.refresh();
        return savedSnapshot();
      },
    );
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 계약' },
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    if (!result.success) return;
    expect(result.writeImpact?.calculation.status).toBe(
      changeImpactStatuses.incomplete,
    );
    expect(result.writeImpact?.calculation.failures).toContain(
      changeImpactDiagnosticMessages.revisionMismatch,
    );
    expect(result.writeImpact?.impacts).toEqual([]);
  });
  it('불완전한 코드 수집에서도 확인한 항목과 실패 사유를 함께 전달한다', async () => {
    const current = session();
    const snapshot = await current.savedCodeReferenceSnapshot();
    vi.spyOn(current, 'savedCodeReferenceSnapshot').mockResolvedValue({
      ...snapshot,
      status: codeCollectionStatuses.incomplete,
      failures: [
        {
          reason: codeFileReasons.read,
          path: 'unreadable.txt',
          message: '읽기 실패',
        },
      ],
    });
    const result = await current.write({
      mode: 'update',
      id: 'target',
      revision: revision(original),
      set: { name: '새 계약' },
    });
    if (!result.success) return expect(result.success).toBe(true);
    expect(result.writeImpact?.collection).toMatchObject({
      status: codeCollectionStatuses.incomplete,
      confirmedCount: 5,
      failures: [{ path: 'unreadable.txt' }],
    });
    expect(result.writeImpact?.calculation.status).toBe(
      changeImpactStatuses.complete,
    );
    expect(result.writeImpact?.impacts).toHaveLength(5);
  });
  it('다른 revision의 비교 자료는 안내 계산을 불완전으로 남긴다', () => {
    const capture: WorkspaceWriteImpactCapture = {
      snapshot: {
        status: codeCollectionStatuses.complete,
        codeGeneration: 1,
        documentGeneration: 1,
        confirmedCount: 1,
        failures: [],
        occurrences: [
          {
            occurrenceId: 'saved:1',
            sourcePath: 'source.txt',
            sourceUri: 'file:///source.txt',
            sourceIdentity: 'file',
            sourceRevision: 'code',
            observation: codeObservationKinds.disk,
            marker: {
              text: '@codocs [[계약]]',
              syntax: codeReferenceSyntaxes.valid,
              name: '계약',
              offsetRange: { start: 0, end: 14 },
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 14 },
              },
              destination: { kind: codeReferenceDestinationKinds.document },
            },
            status: codeReferenceStatuses.resolved,
            candidates: [],
            target: {
              path: '.codocs/target.yaml',
              name: '계약',
              domains: ['업무'],
              confirmation: catalogConfirmations.confirmed,
              errors: [],
            },
            destination: { kind: codeReferenceDestinationKinds.document },
          },
        ],
      },
      revisions: new Map([['.codocs/target.yaml', 'different']]),
      failures: [],
    };
    const notice = createWorkspaceWriteImpactNotice(
      capture,
      {
        path: '.codocs/target.yaml',
        baseRevision: 'before',
        before: {
          raw: original,
          revision: 'before',
          name: '계약',
          domains: ['업무'],
        },
        after: { raw: 'changed', name: '계약', domains: ['업무'] },
      },
      { path: '.codocs/target.yaml', revision: 'saved' },
    );
    expect(notice.calculation).toEqual({
      status: changeImpactStatuses.incomplete,
      failures: [changeImpactDiagnosticMessages.revisionMismatch],
    });
    expect(notice.impacts).toEqual([]);
  });
});
