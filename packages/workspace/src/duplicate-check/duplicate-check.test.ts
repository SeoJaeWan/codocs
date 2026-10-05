import { ioFailures } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { scanStatuses } from '@codocs/core';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from '../loader/index.js';
import { calculateRevision } from '../revision/index.js';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import {
  createWorkspaceQuerySession,
  workspaceIndexNotReady,
  workspaceQueryDiagnosticCodes,
  type WorkspaceQuerySession,
  type WorkspaceQuerySessionOptions,
} from '../query/index.js';
import {
  WorkspaceDuplicateChecker,
  workspaceDuplicateCheckDefaults,
  workspaceDuplicateDraftCoverages,
  workspaceDuplicateExpiryReasons,
  workspaceDuplicateIncompleteReasons,
  workspaceDuplicateLocationOrigins,
  workspaceDuplicateScopes,
  workspaceDuplicateStatuses,
  workspaceDuplicateStopReasons,
  workspaceDuplicateUncheckedReasons,
  type WorkspaceDuplicateResponse,
  type WorkspaceDuplicateSuccess,
} from './index.js';

const repeated =
  '고객이 주문을 취소하려면 결제 완료 후 24시간 이내에 고객센터로 요청해야 하며 처리는 영업일 기준 이틀이 걸린다.';
const shipping =
  '배송 지연이 발생하면 담당자가 재고 상태를 확인한 뒤 새로운 출고 일정을 안내하고 필요하면 대체 상품을 제안한다.';
const settlement =
  '정산은 매월 말일에 마감하며 마감 이후에 접수된 환불은 다음 달 정산에 반영하여 지급 금액을 다시 계산한다.';

let project: string;
const sessions: WorkspaceQuerySession[] = [];

/** 각 사례가 연 감시 세션을 종료할 수 있게 추적한다. */
function session(
  options: WorkspaceQuerySessionOptions = {},
): WorkspaceQuerySession {
  const created = createWorkspaceQuerySession(
    { cwd: project },
    undefined,
    options,
  );
  sessions.push(created);
  return created;
}

/** 실제 fixture의 발견 파일을 쓴다. */
async function file(name: string, raw: string): Promise<string> {
  const target = path.join(project, '.codocs', name);
  await writeFile(target, raw);
  return target;
}

/** definition 하나만 가진 유효한 문서 원문이다. */
function raw(id: string, definition: string): string {
  return `_codocs:\n  id: ${id}\n  name: 문서 ${id}\ndefinition: ${JSON.stringify(definition)}\n`;
}

/** success가 true인 응답만 통과시킨다. */
function succeeded(
  response: WorkspaceDuplicateResponse,
): WorkspaceDuplicateSuccess {
  if (!response.success)
    throw new Error(`검사 실패: ${JSON.stringify(response)}`);
  return response;
}

/** 여러 문서가 같은 문장을 가져 페이지 크기를 넘는 후보를 만든다. */
async function repeatedDocuments(count: number): Promise<void> {
  for (let index = 1; index <= count; index++)
    await file(`doc-${index}.yaml`, raw(`doc-${index}`, repeated));
}

/** 여덟 문서가 같은 문장을 가져 페이지 크기를 넘는 후보를 만든다. */
async function eightRepeatedDocuments(): Promise<void> {
  await repeatedDocuments(8);
}

/** 후보의 두 위치 중 초안 위치의 수를 센다. */
function draftLocationCount(
  candidate: WorkspaceDuplicateSuccess['candidates'][number],
): number {
  return [candidate.a, candidate.b].filter(
    (item) => item.origin === workspaceDuplicateLocationOrigins.draft,
  ).length;
}

/** 같은 문장을 가진 저장 문서와 무관한 문장을 가진 생성 초안 요청이다. */
function createDraft(definition: string): {
  mode: string;
  path: string;
  document: Record<string, unknown>;
} {
  return {
    mode: 'create',
    path: '.codocs/draft.yaml',
    document: { _codocs: { id: 'draft', name: '초안 문서' }, definition },
  };
}

beforeEach(async () => {
  const parent = path.resolve('.workbench/fixtures');
  await mkdir(parent, { recursive: true });
  project = await mkdtemp(path.join(parent, 'duplicates-'));
  await mkdir(path.join(project, '.codocs'));
});

afterEach(async () => {
  ioFailures.clear();
  await Promise.all(sessions.splice(0).map((item) => item.close()));
  await rm(project, { recursive: true, force: true });
});

describe('WorkspaceQuerySession.duplicates: 전체 검사', () => {
  it('두 문서가 같은 문장을 가지면 완전 일치 후보와 두 문서의 위치를 complete로 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    await file('gamma.yaml', raw('gamma', shipping));

    const result = succeeded(await session().duplicates());

    expect(result.status).toBe(workspaceDuplicateStatuses.complete);
    expect(result.scope).toBe(workspaceDuplicateScopes.all);
    expect(result.incompleteReasons).toEqual([]);
    expect(result.comparedDocumentCount).toBe(3);
    expect(result.totalCandidates).toBe(1);
    const [candidate] = result.candidates;
    expect(candidate?.kind).toBe('exact');
    expect(candidate?.a.path).toBe(path.join('.codocs', 'alpha.yaml'));
    expect(candidate?.b.path).toBe(path.join('.codocs', 'beta.yaml'));
    expect(candidate?.a.origin).toBe(workspaceDuplicateLocationOrigins.saved);
    expect(candidate?.a.fieldPath).toEqual(['definition']);
    expect(candidate?.a.range?.start.line).toBe(3);
    expect(result.exactGroups).toHaveLength(1);
    expect(result.exactGroups[0]?.occurrences).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('한 문서의 definition과 예시 section이 같은 문장을 가지면 문서 내부 반복 후보를 반환한다', async () => {
    await file(
      'alpha.yaml',
      `_codocs:\n  id: alpha\n  name: 문서 alpha\ndefinition: ${JSON.stringify(repeated)}\n예시: ${JSON.stringify(repeated)}\n`,
    );

    const result = succeeded(await session().duplicates());

    expect(result.totalCandidates).toBe(1);
    expect(result.candidates[0]?.a.path).toBe(result.candidates[0]?.b.path);
    expect(result.candidates[0]?.a.fieldPath).toEqual(['definition']);
    expect(result.candidates[0]?.b.fieldPath).toEqual(['예시']);
  });

  it('반복이 없는 문서만 있으면 완료 상태와 빈 후보 목록을 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('gamma.yaml', raw('gamma', shipping));

    const result = succeeded(await session().duplicates());

    expect(result.status).toBe(workspaceDuplicateStatuses.complete);
    expect(result.candidates).toEqual([]);
    expect(result.comparedDocumentCount).toBe(2);
  });

  it('파싱에 실패한 문서가 있으면 그 문서를 검사하지 못한 범위로 남기고 partial로 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    await file('broken.yaml', 'id: [broken\n');

    const result = succeeded(await session().duplicates());

    expect(result.status).toBe(workspaceDuplicateStatuses.partial);
    expect(result.incompleteReasons).toContain(
      workspaceDuplicateIncompleteReasons.uncheckedDocuments,
    );
    expect(result.unchecked).toEqual([
      expect.objectContaining({
        path: path.join('.codocs', 'broken.yaml'),
        reason: workspaceDuplicateUncheckedReasons.parseFailed,
      }),
    ]);
    expect(result.comparedDocumentCount).toBe(2);
    expect(result.totalCandidates).toBe(1);
  });

  it('일부 파일을 읽지 못한 partial 탐색이면 읽지 못한 파일을 남기고 partial로 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    const unreadable = await file('gamma.yaml', raw('gamma', shipping));
    ioFailures.set(unreadable, { operations: ['lstat'], code: 'EACCES' });

    const result = succeeded(await session().duplicates());

    expect(result.scanStatus).toBe(scanStatuses.partial);
    expect(result.status).toBe(workspaceDuplicateStatuses.partial);
    expect(result.incompleteReasons).toEqual([
      workspaceDuplicateIncompleteReasons.discoveryPartial,
      workspaceDuplicateIncompleteReasons.uncheckedDocuments,
    ]);
    expect(result.unchecked).toEqual([
      expect.objectContaining({
        path: path.join('.codocs', 'gamma.yaml'),
        reason: workspaceDuplicateUncheckedReasons.readFailed,
      }),
    ]);
  });

  it('탐색이 실패하면 빈 후보의 성공 대신 failed 응답을 반환한다', async () => {
    const result = await createWorkspaceQuerySession({
      cwd: path.join(project, 'missing'),
    }).duplicates();

    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.status).toBe(
      workspaceDuplicateStatuses.failed,
    );
  });

  it('지원하지 않는 입력 형태를 전달하면 invalid_input 진단의 failed 응답을 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));

    const result = await session().duplicates({ scope: 'all' });

    expect(result).toMatchObject({
      success: false,
      status: workspaceDuplicateStatuses.failed,
      error: { code: 'invalid_input' },
    });
  });

  it('명시 refresh가 진행 중이면 색인 준비 중 응답을 반환하고 검사하지 않는다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    const target = session();
    await target.list();

    const refreshing = target.refresh();
    const result = await target.duplicates();
    await refreshing;

    expect(result).toMatchObject({
      success: false,
      status: workspaceDuplicateStatuses.notReady,
      error: { code: workspaceIndexNotReady().error.code },
    });
  });
});

describe('WorkspaceQuerySession.duplicates: 문서별 준비 캐시', () => {
  it('같은 색인을 다시 검사하면 모든 문서의 준비 자료를 재사용한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    await file('gamma.yaml', raw('gamma', shipping));
    const target = session();

    const first = succeeded(await target.duplicates());
    const second = succeeded(await target.duplicates());

    expect(first.preparation).toEqual({ preparedCount: 3, reusedCount: 0 });
    expect(second.preparation).toEqual({ preparedCount: 0, reusedCount: 3 });
  });

  it('한 문서를 수정한 뒤 다시 검사하면 그 문서만 다시 준비한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    const gamma = await file('gamma.yaml', raw('gamma', shipping));
    const prepared: string[] = [];
    const target = session({
      duplicateCheck: {
        onPrepare: (documentPath) => prepared.push(documentPath),
      },
    });
    await target.duplicates();
    prepared.length = 0;

    await writeFile(gamma, raw('gamma', settlement));
    await target.refresh();
    const result = succeeded(await target.duplicates());

    expect(prepared).toEqual([path.join('.codocs', 'gamma.yaml')]);
    expect(result.preparation).toEqual({ preparedCount: 1, reusedCount: 2 });
  });

  it('문서를 삭제한 뒤 다시 검사하면 삭제된 문서를 비교하지 않는다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    const beta = await file('beta.yaml', raw('beta', repeated));
    const target = session();
    const before = succeeded(await target.duplicates());

    await rm(beta);
    await target.refresh();
    const after = succeeded(await target.duplicates());

    expect(before.totalCandidates).toBe(1);
    expect(after.totalCandidates).toBe(0);
    expect(after.comparedDocumentCount).toBe(1);
  });

  it('초안을 검사한 뒤 전체를 검사하면 초안은 캐시에 들어가지 않아 모든 저장 문서를 재사용한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', shipping));
    const target = session();
    await target.duplicates();
    const request = {
      mode: 'create',
      path: '.codocs/draft.yaml',
      document: {
        _codocs: { id: 'draft', name: '초안 문서' },
        definition: settlement,
      },
    };

    await target.duplicates(request);
    const result = succeeded(await target.duplicates());

    expect(result.comparedDocumentCount).toBe(2);
    expect(result.preparation).toEqual({ preparedCount: 0, reusedCount: 2 });
  });
});

describe('WorkspaceQuerySession.duplicates: 초안 검사', () => {
  it('수정 초안이 다른 문서와 같은 문장을 가지면 초안 원문 기준의 후보를 반환한다', async () => {
    const alpha = await file('alpha.yaml', raw('alpha', settlement));
    await file('beta.yaml', raw('beta', repeated));
    const target = session();
    const request = {
      mode: 'update',
      id: 'alpha',
      revision: calculateRevision(await readFile(alpha)),
      set: { definition: repeated },
    };

    const result = succeeded(await target.duplicates(request));

    expect(result.scope).toBe(workspaceDuplicateScopes.draft);
    expect(result.draft).toMatchObject({
      path: path.join('.codocs', 'alpha.yaml'),
      id: 'alpha',
      coverage: workspaceDuplicateDraftCoverages.candidateFullText,
    });
    expect(result.totalCandidates).toBe(1);
    const locations = [result.candidates[0]?.a, result.candidates[0]?.b];
    const draftLocation = locations.find(
      (item) => item?.origin === workspaceDuplicateLocationOrigins.draft,
    );
    const savedLocation = locations.find(
      (item) => item?.origin === workspaceDuplicateLocationOrigins.saved,
    );
    expect(draftLocation?.path).toBe(path.join('.codocs', 'alpha.yaml'));
    expect(savedLocation?.path).toBe(path.join('.codocs', 'beta.yaml'));
  });

  it('저장 문서 두 개만 같은 문장을 가지고 초안이 무관하면 초안 검사는 complete와 빈 후보를 반환하고 전체 검사는 그 후보를 유지한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    const target = session();

    const draft = succeeded(await target.duplicates(createDraft(shipping)));
    const full = succeeded(await target.duplicates());

    expect(draft.status).toBe(workspaceDuplicateStatuses.complete);
    expect(draft.scope).toBe(workspaceDuplicateScopes.draft);
    expect(draft.totalCandidates).toBe(0);
    expect(draft.candidates).toEqual([]);
    expect(draft.exactGroups).toEqual([]);
    expect(draft.returnedCount).toBe(0);
    expect(draft.remainingCount).toBe(0);
    expect(draft.nextCursor).toBeNull();
    expect(full.scope).toBe(workspaceDuplicateScopes.all);
    expect(full.totalCandidates).toBe(1);
    expect(full.candidates[0]?.a.path).toBe(path.join('.codocs', 'alpha.yaml'));
    expect(full.candidates[0]?.b.path).toBe(path.join('.codocs', 'beta.yaml'));
    expect(full.exactGroups).toHaveLength(1);
  });

  it('변경 없는 수정 초안을 검사하면 저장 문서끼리의 후보를 반환하지 않는다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    const gamma = await file('gamma.yaml', raw('gamma', shipping));

    const result = succeeded(
      await session().duplicates({
        mode: 'update',
        id: 'gamma',
        revision: calculateRevision(await readFile(gamma)),
        set: { name: '문서 gamma' },
      }),
    );

    expect(result.status).toBe(workspaceDuplicateStatuses.complete);
    expect(result.totalCandidates).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('초안이 저장 문서의 문장을 반복하면 저장 문서끼리의 후보는 빼고 초안이 포함된 후보만 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', shipping));
    await file('gamma.yaml', raw('gamma', shipping));

    const result = succeeded(await session().duplicates(createDraft(repeated)));

    expect(result.totalCandidates).toBe(1);
    expect(result.candidates).toHaveLength(1);
    for (const candidate of result.candidates)
      expect(draftLocationCount(candidate)).toBeGreaterThanOrEqual(1);
    // 생성 초안의 경로는 요청한 '/' 구분 경로 그대로이고 저장 문서의 경로는 OS 구분자를 따른다.
    expect(result.candidates[0]?.b.path).toBe('.codocs/draft.yaml');
    expect(result.candidates[0]?.a.path).toBe(
      path.join('.codocs', 'alpha.yaml'),
    );
  });

  it('초안 내부 반복 후보는 두 위치 모두 초안 출처로 유지한다', async () => {
    await file('alpha.yaml', raw('alpha', shipping));
    await file('beta.yaml', raw('beta', shipping));
    const request = createDraft(settlement);
    request.document.예시 = settlement;

    const result = succeeded(await session().duplicates(request));

    expect(result.totalCandidates).toBe(1);
    expect(draftLocationCount(result.candidates[0]!)).toBe(2);
  });

  it('같은 구절이 저장 문서 두 곳과 초안에 있으면 초안 쌍만 반환하고 묶음에는 세 발생 위치를 모두 남긴다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));

    const result = succeeded(await session().duplicates(createDraft(repeated)));

    expect(result.totalCandidates).toBe(2);
    for (const candidate of result.candidates)
      expect(draftLocationCount(candidate)).toBe(1);
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.a.path === path.join('.codocs', 'alpha.yaml') &&
          candidate.b.path === path.join('.codocs', 'beta.yaml'),
      ),
    ).toBe(false);
    expect(result.exactGroups).toHaveLength(1);
    const occurrences = result.exactGroups[0]?.occurrences ?? [];
    expect(occurrences).toHaveLength(3);
    expect(
      occurrences.filter(
        (item) => item.origin === workspaceDuplicateLocationOrigins.draft,
      ),
    ).toHaveLength(1);
    expect(
      occurrences
        .filter(
          (item) => item.origin === workspaceDuplicateLocationOrigins.saved,
        )
        .map((item) => item.path),
    ).toEqual([
      path.join('.codocs', 'alpha.yaml'),
      path.join('.codocs', 'beta.yaml'),
    ]);
  });

  it('초안과 무관한 저장 문서끼리의 묶음은 초안 검사의 exactGroups에 포함하지 않는다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    await file('gamma.yaml', raw('gamma', shipping));
    await file('delta.yaml', raw('delta', shipping));

    const result = succeeded(await session().duplicates(createDraft(shipping)));

    expect(result.totalCandidates).toBe(2);
    expect(result.exactGroups).toHaveLength(1);
    expect(
      result.exactGroups[0]?.occurrences.every(
        (item) => item.path !== path.join('.codocs', 'alpha.yaml'),
      ),
    ).toBe(true);
  });

  it('초안 관련 후보가 페이지 크기보다 많으면 커서로 넘긴 후보 수가 totalCandidates와 같고 저장 문서끼리의 후보가 섞이지 않는다', async () => {
    await repeatedDocuments(24);
    const target = session();

    const first = succeeded(await target.duplicates(createDraft(repeated)));
    const second = succeeded(
      await target.duplicates({ cursor: first.nextCursor ?? '' }),
    );

    expect(first.totalCandidates).toBe(24);
    expect(first.returnedCount).toBe(workspaceDuplicateCheckDefaults.pageSize);
    expect(first.remainingCount).toBe(4);
    expect(second.returnedCount).toBe(4);
    expect(second.remainingCount).toBe(0);
    expect(second.nextCursor).toBeNull();
    expect(first.returnedCount + second.returnedCount).toBe(
      first.totalCandidates,
    );
    for (const candidate of [...first.candidates, ...second.candidates])
      expect(draftLocationCount(candidate)).toBeGreaterThanOrEqual(1);
  });

  it('시간 제한으로 partial이 된 초안 검사는 걸러진 후보가 0개여도 partial과 중단 이유를 유지한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));

    const result = succeeded(
      await session({ duplicateCheck: { timeLimitMs: 0 } }).duplicates(
        createDraft(shipping),
      ),
    );

    expect(result.status).toBe(workspaceDuplicateStatuses.partial);
    expect(result.stopReason).toBe(workspaceDuplicateStopReasons.timeLimit);
    expect(result.totalCandidates).toBe(0);
  });

  it('검사하지 못한 문서가 있는 초안 검사는 걸러진 후보가 0개여도 partial을 유지한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    await file('broken.yaml', 'id: [broken\n');

    const result = succeeded(await session().duplicates(createDraft(shipping)));

    expect(result.status).toBe(workspaceDuplicateStatuses.partial);
    expect(result.incompleteReasons).toContain(
      workspaceDuplicateIncompleteReasons.uncheckedDocuments,
    );
    expect(result.totalCandidates).toBe(0);
  });

  it('수정 초안이 원래 본문을 바꾸면 수정 전 원래 파일은 비교에서 빠진다', async () => {
    const alpha = await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    const target = session();
    const request = {
      mode: 'update',
      id: 'alpha',
      revision: calculateRevision(await readFile(alpha)),
      set: { definition: shipping },
    };

    const result = succeeded(await target.duplicates(request));

    expect(result.comparedDocumentCount).toBe(2);
    expect(result.candidates).toEqual([]);
  });

  it('생성 초안이 같은 문장을 두 번 가지면 초안 내부 반복 후보를 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', shipping));
    const request = {
      mode: 'create',
      path: '.codocs/draft.yaml',
      document: {
        _codocs: { id: 'draft', name: '초안 문서' },
        definition: settlement,
        예시: settlement,
      },
    };

    const result = succeeded(await session().duplicates(request));

    expect(result.totalCandidates).toBe(1);
    expect(result.candidates[0]?.a.origin).toBe(
      workspaceDuplicateLocationOrigins.draft,
    );
    expect(result.candidates[0]?.b.origin).toBe(
      workspaceDuplicateLocationOrigins.draft,
    );
    expect(result.candidates[0]?.b.fieldPath).toEqual(['예시']);
  });

  it('초안을 검사해도 파일 바이트·디렉터리 목록·색인 조회 결과가 바뀌지 않는다', async () => {
    const alpha = await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    const target = session();
    const before = {
      bytes: await readFile(alpha),
      names: await readdir(path.join(project, '.codocs')),
      got: await target.get(['alpha']),
      version: target.catalogVersion,
    };
    const request = {
      mode: 'create',
      path: '.codocs/draft.yaml',
      document: {
        _codocs: { id: 'draft', name: '초안 문서' },
        definition: repeated,
      },
    };

    const result = succeeded(await target.duplicates(request));

    expect(result.totalCandidates).toBeGreaterThan(0);
    expect(await readFile(alpha)).toEqual(before.bytes);
    expect(await readdir(path.join(project, '.codocs'))).toEqual(before.names);
    expect(await target.get(['alpha'])).toEqual(before.got);
    expect(target.catalogVersion).toBe(before.version);
  });

  it('변경 계획이 실패하는 초안이면 계획의 진단을 담은 failed 응답을 반환하고 후보를 만들지 않는다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    const request = { mode: 'update', id: 'missing', revision: 'x', set: {} };

    const result = await session().duplicates(request);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.status).toBe(workspaceDuplicateStatuses.failed);
    expect(result.diagnostics?.length).toBeGreaterThan(0);
    expect(result.error).toBe(result.diagnostics?.[0]);
  });

  it('같은 ID의 다른 경로 문서는 수정 대상의 원래 경로만 제외하므로 비교에 남는다', async () => {
    await file('alpha.yaml', raw('shared', repeated));
    await file('beta.yaml', raw('shared', repeated));
    const scan = await loadWorkspace({ cwd: project });
    const catalog = buildWorkspaceCatalog(scan);
    const revisions = new Map(
      scan.documents.map((item) => [item.source.path, item.revision]),
    );
    const checker = new WorkspaceDuplicateChecker();
    const alphaPath = path.join('.codocs', 'alpha.yaml');
    const alpha = scan.documents.find((item) => item.source.path === alphaPath);

    const outcome = await checker.check(
      {
        scanStatus: scanStatuses.complete,
        catalog,
        revisions,
        catalogVersion: 1,
      },
      {
        excludedPath: alphaPath,
        document: {
          path: alphaPath,
          id: 'shared',
          revision: 'draft-revision',
          parsed:
            alpha && 'parsed' in alpha ? alpha.parsed : (undefined as never),
        },
      },
      undefined,
      () => ({ catalogVersion: 1, closed: false }),
    );

    expect(outcome.kind).toBe('page');
    if (outcome.kind !== 'page') return;
    expect(outcome.page.totalCandidates).toBe(1);
    const locations = [
      outcome.page.candidates[0]?.a,
      outcome.page.candidates[0]?.b,
    ];
    expect(
      locations.find(
        (item) => item?.origin === workspaceDuplicateLocationOrigins.saved,
      )?.path,
    ).toBe(path.join('.codocs', 'beta.yaml'));
    expect(
      locations.filter(
        (item) => item?.origin === workspaceDuplicateLocationOrigins.draft,
      ),
    ).toHaveLength(1);
  });
});

describe('WorkspaceQuerySession.duplicates: 시간 제한·취소·양보', () => {
  it('시간 제한을 0으로 설정하면 partial과 time_limit 중단 이유를 반환하고 완료로 표시하지 않는다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));

    const result = succeeded(
      await session({ duplicateCheck: { timeLimitMs: 0 } }).duplicates(),
    );

    expect(result.status).toBe(workspaceDuplicateStatuses.partial);
    expect(result.stopReason).toBe(workspaceDuplicateStopReasons.timeLimit);
    expect(result.incompleteReasons).toContain(
      workspaceDuplicateIncompleteReasons.timeLimit,
    );
    expect(result.status).not.toBe(workspaceDuplicateStatuses.complete);
    expect(result.progress.totalUnits).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it('주입한 시계가 시간 제한을 넘기면 비교를 멈추고 확인한 범위를 partial로 반환한다', async () => {
    await eightRepeatedDocuments();
    let now = 0;
    const result = succeeded(
      await session({
        duplicateCheck: {
          timeLimitMs: 100,
          sliceMs: 0,
          now: () => now,
          onSlice: () => {
            now += 60;
          },
        },
      }).duplicates(),
    );

    expect(result.status).toBe(workspaceDuplicateStatuses.partial);
    expect(result.stopReason).toBe(workspaceDuplicateStopReasons.timeLimit);
    expect(result.progress.totalUnits).toBeGreaterThan(
      result.progress.completedUnits,
    );
    expect(result.progress.completedUnits).toBeGreaterThan(0);
  });

  it('준비 중 취소하면 이후 문서를 준비하지 않고 cancelled를 반환하며 결과를 보관하지 않는다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    await file('gamma.yaml', raw('gamma', shipping));
    const controller = new AbortController();
    const prepared: string[] = [];
    const target = session({
      duplicateCheck: {
        onPrepare: (documentPath) => {
          prepared.push(documentPath);
          controller.abort();
        },
        sliceMs: 0,
      },
    });

    const result = await target.duplicates(undefined, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      success: false,
      status: workspaceDuplicateStatuses.cancelled,
      error: { code: workspaceQueryDiagnosticCodes.requestSuperseded },
    });
    expect(prepared).toHaveLength(1);
  });

  it('비교 중 취소하면 다음 조각을 실행하지 않고 cancelled를 반환한다', async () => {
    await eightRepeatedDocuments();
    const controller = new AbortController();
    const slices: number[] = [];
    const target = session({
      duplicateCheck: {
        sliceMs: 0,
        onSlice: (progress) => {
          slices.push(progress.completedUnits);
          controller.abort();
        },
      },
    });

    const result = await target.duplicates(undefined, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      success: false,
      status: workspaceDuplicateStatuses.cancelled,
    });
    expect(slices).toEqual([1]);
  });

  it('이미 취소된 신호로 호출하면 준비 없이 cancelled를 반환한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    const controller = new AbortController();
    controller.abort();

    const result = await session().duplicates(undefined, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      success: false,
      status: workspaceDuplicateStatuses.cancelled,
    });
  });

  it('검사가 진행 중일 때 같은 세션의 get은 검사 완료 전에 응답한다', async () => {
    await eightRepeatedDocuments();
    const target = session({ duplicateCheck: { sliceMs: 0 } });
    await target.list();
    let finished = false;

    const checking = target.duplicates().then((result) => {
      finished = true;
      return result;
    });
    const got = await target.get(['doc-1']);
    const finishedWhenGetResponded = finished;
    const result = succeeded(await checking);

    expect(got.success).toBe(true);
    expect(finishedWhenGetResponded).toBe(false);
    expect(result.status).toBe(workspaceDuplicateStatuses.complete);
  });

  it('검사 중 색인이 다시 게시되면 시작 시점 관측의 결과에 indexChangedDuringCheck를 표시한다', async () => {
    await file('alpha.yaml', raw('alpha', repeated));
    await file('beta.yaml', raw('beta', repeated));
    let changed = false;
    const target = session({
      duplicateCheck: {
        onSlice: async () => {
          if (changed) return;
          changed = true;
          await file('beta.yaml', raw('beta', shipping));
          await target.refresh();
        },
      },
    });

    const result = succeeded(await target.duplicates());

    expect(result.totalCandidates).toBe(1);
    expect(result.indexChangedDuringCheck).toBe(true);
  });
});

describe('WorkspaceQuerySession.duplicates: 결과 페이지와 커서 만료', () => {
  it('후보가 한 페이지를 넘으면 정렬된 첫 페이지와 커서를 주고 커서로 나머지를 반환한다', async () => {
    await eightRepeatedDocuments();
    const target = session();

    const first = succeeded(await target.duplicates());
    const second = succeeded(
      await target.duplicates({ cursor: first.nextCursor ?? '' }),
    );

    expect(first.totalCandidates).toBe(28);
    expect(first.returnedCount).toBe(workspaceDuplicateCheckDefaults.pageSize);
    expect(first.remainingCount).toBe(8);
    expect(first.status).toBe(workspaceDuplicateStatuses.complete);
    expect(first.candidates[0]?.a.path).toBe(
      path.join('.codocs', 'doc-1.yaml'),
    );
    expect(first.candidates[0]?.b.path).toBe(
      path.join('.codocs', 'doc-2.yaml'),
    );
    expect(second.returnedCount).toBe(8);
    expect(second.nextCursor).toBeNull();
    expect(second.candidates.at(-1)?.a.path).toBe(
      path.join('.codocs', 'doc-7.yaml'),
    );
    expect(second.candidates.at(-1)?.b.path).toBe(
      path.join('.codocs', 'doc-8.yaml'),
    );
  });

  it('partial 결과도 보관해 커서로 다음 페이지를 제공한다', async () => {
    await eightRepeatedDocuments();
    await file('broken.yaml', 'id: [broken\n');
    const target = session();

    const first = succeeded(await target.duplicates());
    const second = succeeded(
      await target.duplicates({ cursor: first.nextCursor ?? '' }),
    );

    expect(first.status).toBe(workspaceDuplicateStatuses.partial);
    expect(second.status).toBe(workspaceDuplicateStatuses.partial);
    expect(second.returnedCount).toBe(8);
  });

  it('페이지 사이에 비교한 문서의 원문이 바뀌면 source_changed 이유로 커서가 만료된다', async () => {
    await eightRepeatedDocuments();
    const target = session();
    const first = succeeded(await target.duplicates());

    await file('doc-3.yaml', raw('doc-3', shipping));
    await target.refresh();
    const result = await target.duplicates({ cursor: first.nextCursor ?? '' });

    expect(result).toMatchObject({
      success: false,
      status: workspaceDuplicateStatuses.expired,
      expiryReason: workspaceDuplicateExpiryReasons.sourceChanged,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });
  });

  it('다른 검사가 보관 결과를 대체하면 원문이 같아도 result_replaced 이유로 이전 커서가 만료된다', async () => {
    await eightRepeatedDocuments();
    const target = session();
    const first = succeeded(await target.duplicates());
    succeeded(await target.duplicates());

    const result = await target.duplicates({ cursor: first.nextCursor ?? '' });

    expect(result).toMatchObject({
      success: false,
      status: workspaceDuplicateStatuses.expired,
      expiryReason: workspaceDuplicateExpiryReasons.resultReplaced,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });
  });

  it('두 만료 이유는 서로 다른 안내 문구를 가진다', async () => {
    await eightRepeatedDocuments();
    const target = session();
    const replacedCursor =
      succeeded(await target.duplicates()).nextCursor ?? '';
    const changedCursor = succeeded(await target.duplicates()).nextCursor ?? '';
    const replaced = await target.duplicates({ cursor: replacedCursor });
    await file('doc-3.yaml', raw('doc-3', shipping));
    await target.refresh();
    const changed = await target.duplicates({ cursor: changedCursor });

    expect(replaced.success || changed.success).toBe(false);
    if (replaced.success || changed.success) return;
    expect(replaced.error.message).not.toBe(changed.error.message);
    expect(replaced.expiryReason).not.toBe(changed.expiryReason);
  });

  it('취소되거나 실패한 검사는 보관된 결과를 대체하지 않는다', async () => {
    await eightRepeatedDocuments();
    const target = session();
    const first = succeeded(await target.duplicates());
    const controller = new AbortController();
    controller.abort();
    await target.duplicates(undefined, { signal: controller.signal });
    await target.duplicates({
      mode: 'update',
      id: 'missing',
      revision: 'x',
      set: {},
    });

    const result = await target.duplicates({ cursor: first.nextCursor ?? '' });

    expect(result.success).toBe(true);
  });

  it('서명이 없는 문자열이나 서명 형식만 흉내 낸 토큰을 전달하면 unrecognized 이유로 만료된다', async () => {
    await eightRepeatedDocuments();
    const target = session();
    await target.duplicates();

    const garbage = await target.duplicates({ cursor: 'not-a-cursor' });
    const forged = await target.duplicates({ cursor: 'x.y' });

    for (const result of [garbage, forged])
      expect(result).toMatchObject({
        success: false,
        status: workspaceDuplicateStatuses.expired,
        expiryReason: workspaceDuplicateExpiryReasons.unrecognized,
      });
  });

  it('초안 검사 결과의 커서도 초안 원문 버전 기준으로 보관되어 다음 페이지를 제공한다', async () => {
    await repeatedDocuments(24);
    const target = session();
    const request = {
      mode: 'create',
      path: '.codocs/draft.yaml',
      document: {
        _codocs: { id: 'draft', name: '초안 문서' },
        definition: repeated,
      },
    };

    const first = succeeded(await target.duplicates(request));
    const second = succeeded(
      await target.duplicates({ cursor: first.nextCursor ?? '' }),
    );

    expect(first.totalCandidates).toBe(24);
    expect(second.returnedCount).toBe(4);
  });
});
