import { createLink as symlink } from '../test-support/links.js';
import { ioFailures } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import {
  catalogDiagnosticCodes,
  diagnosticSeverities,
  documentKinds,
  documentStatuses,
  queryDiagnosticCodes,
  scanStatuses,
  yamlDiagnosticCodes,
} from '@codocs/core';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceQuerySession as createSession,
  workspaceQueryDiagnosticCodes,
  workspaceQueryDiagnosticMessages,
} from './index.js';
import type { WorkspaceQuerySession } from './index.js';
import { WorkspaceWatcher, watcherRecoveryGuidance } from '../watcher/index.js';

let project: string;
const sessions: WorkspaceQuerySession[] = [];
const execFileAsync = promisify(execFile);

/** 각 사례가 연 감시 세션을 종료할 수 있게 추적한다. */
function createWorkspaceQuerySession(input: unknown): WorkspaceQuerySession {
  const session = createSession(input);
  sessions.push(session);
  return session;
}

beforeEach(
  /** 각 사례가 독립적인 실제 프로젝트에서 시작한다. */ async () => {
    const fixtureParent = path.resolve('.workbench/fixtures');
    await mkdir(fixtureParent, { recursive: true });
    project = await mkdtemp(path.join(fixtureParent, 'query-'));
    await mkdir(path.join(project, '.codocs'));
  },
);

afterEach(
  /** 해당 사례가 만든 fixture만 정리한다. */ async () => {
    ioFailures.clear();
    await Promise.all(sessions.splice(0).map((session) => session.close()));
    await rm(project, { recursive: true, force: true });
  },
);

/** 실제 fixture의 발견 파일을 쓴다. */
async function file(name: string, raw: string): Promise<string> {
  const target = path.join(project, '.codocs', name);
  await writeFile(target, raw);
  return target;
}

describe('workspace 조회 세션', /** scan과 조회 응답의 연결을 검증한다. */ () => {
  describe('문서 검증', () => {
    it('초기 요청은 실제 complete 색인을 기다린 뒤 진단 성공을 반환한다', async () => {
      await file(
        'alpha.yaml',
        'id: alpha\nname: Alpha\ndomains: [업무]\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.validate();
      expect(result).toMatchObject({
        success: true,
        scanStatus: scanStatuses.complete,
        diagnostics: [],
      });
    });

    it('partial 탐색에서 validate는 확인한 파일의 성공 진단을 반환하지 않는다', async () => {
      const target = await file(
        'alpha.yaml',
        'id: alpha\nname: Alpha\ndomains: [업무]\ndefinition: 본문\n',
      );
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
      const session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.validate();
      expect(result).toMatchObject({
        success: false,
        scanStatus: scanStatuses.partial,
        error: { path: path.join('.codocs', 'alpha.yaml'), ioCode: 'EACCES' },
      });
    });

    it('감시 실패 중 validate는 복구 안내가 있는 공통 실패를 반환한다', async () => {
      await file(
        'alpha.yaml',
        'id: alpha\nname: Alpha\ndomains: [업무]\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.validate();
      const spy = vi
        .spyOn(WorkspaceWatcher.prototype, 'readiness', 'get')
        .mockReturnValue({
          state: 'failed',
          ready: false,
          cause: 'watcher error',
          guidance: watcherRecoveryGuidance,
        });
      try {
        const result = await session.validate();
        expect(result).toMatchObject({
          success: false,
          scanStatus: scanStatuses.failed,
          error: { severity: diagnosticSeverities.error },
        });
        if (result.success) throw new Error('감시 실패를 성공으로 반환함');
        expect(result.error.message).toContain('codocs_refresh');
      } finally {
        spy.mockRestore();
      }
    });

    it('명시 refresh가 진행 중이면 validate는 이전 색인의 성공을 반환하지 않는다', async () => {
      await file(
        'alpha.yaml',
        'id: alpha\nname: Alpha\ndomains: [업무]\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.validate();
      const refresh = session.refresh();
      const result = await session.validate();
      expect(result).toMatchObject({
        success: false,
        error: { code: 'index_not_ready' },
      });
      await refresh;
    });
    it('전체 검증은 중복 ID와 별도 YAML 오류를 모두 보고하고 파일 검증은 대상과 관련 경로만 보고한다', async () => {
      await file(
        'a.yaml',
        'id: shared\nname: A\ndomains: [업무]\ndefinition: 본문\n',
      );
      await file(
        'b.yaml',
        'id: shared\nname: B\ndomains: [업무]\ndefinition: 본문\n',
      );
      await file('c.yaml', 'id: [\n');
      const session = createWorkspaceQuerySession({ cwd: project });

      const all = await session.validate();
      const selected = await session.validate('.codocs/a.yaml');

      expect(all).toMatchObject({
        success: true,
        scanStatus: scanStatuses.complete,
      });
      expect(selected).toMatchObject({
        success: true,
        scanStatus: scanStatuses.complete,
        path: path.join('.codocs', 'a.yaml'),
      });
      if (!all.success || !selected.success) throw new Error('검증 실패');
      expect(
        all.diagnostics.some(
          (item) =>
            item.path === path.join('.codocs', 'c.yaml') &&
            item.code === yamlDiagnosticCodes.invalidYaml,
        ),
      ).toBe(true);
      expect(selected.diagnostics).toContainEqual(
        expect.objectContaining({
          code: catalogDiagnosticCodes.duplicateId,
          path: path.join('.codocs', 'a.yaml'),
          relatedPaths: [
            path.join('.codocs', 'a.yaml'),
            path.join('.codocs', 'b.yaml'),
          ],
        }),
      );
      expect(
        selected.diagnostics.every(
          (item) => item.path !== path.join('.codocs', 'c.yaml'),
        ),
      ).toBe(true);
    });

    it('ID가 없는 문서와 파싱 실패 문서도 발견 경로로 검증한다', async () => {
      await file(
        'no-id.yaml',
        'name: No ID\ndomains: [업무]\ndefinition: 본문\n',
      );
      await file('broken.yaml', 'id: [\n');
      const session = createWorkspaceQuerySession({ cwd: project });

      const missingId = await session.validate('.codocs/no-id.yaml');
      const broken = await session.validate('.codocs/broken.yaml');

      expect(missingId).toMatchObject({
        success: true,
        diagnostics: [
          expect.objectContaining({
            code: 'missing_required_field',
            path: path.join('.codocs', 'no-id.yaml'),
          }),
        ],
      });
      expect(broken).toMatchObject({
        success: true,
        diagnostics: [
          expect.objectContaining({
            code: 'invalid_yaml',
            path: path.join('.codocs', 'broken.yaml'),
          }),
        ],
      });
    });

    it.each([
      '../outside.yaml',
      '.codocs',
      '.codocs/*.yaml',
      '.codocs/a.txt',
      '.codocs/a.yaml/',
    ])(
      '허용되지 않는 경로 %s를 지정하면 invalid_path를 반환한다',
      async (requested) => {
        const session = createWorkspaceQuerySession({ cwd: project });
        const result = await session.validate(requested);
        expect(result).toMatchObject({
          success: false,
          error: { code: queryDiagnosticCodes.invalidPath },
        });
      },
    );

    it('없는 파일의 경로와 ENOENT 원인을 보존한다', async () => {
      const session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.validate('.codocs/missing.yaml');
      expect(result).toMatchObject({
        success: false,
        error: {
          code: queryDiagnosticCodes.notFound,
          path: path.join('.codocs', 'missing.yaml'),
          ioCode: 'ENOENT',
        },
      });
    });

    it('실제 파일의 접근 확인 실패는 경로와 EACCES를 반환한다', async () => {
      const target = await file(
        'locked.yaml',
        'id: locked\nname: Locked\ndomains: [업무]\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.validate();
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
      const result = await session.validate('.codocs/locked.yaml');
      expect(result).toMatchObject({
        success: false,
        error: {
          code: queryDiagnosticCodes.fileAccessFailed,
          path: path.join('.codocs', 'locked.yaml'),
          ioCode: 'EACCES',
        },
      });
    });

    it('프로젝트 안의 절대 YAML 파일을 지정해도 invalid_path와 상대 경로 안내를 반환한다', async () => {
      const target = await file(
        'absolute.yaml',
        'id: absolute\nname: Absolute\ndomains: [업무]\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.validate(target);
      expect(result).toMatchObject({
        success: false,
        error: { code: queryDiagnosticCodes.invalidPath },
      });
      if (result.success) throw new Error('절대 경로를 허용함');
      expect(result.error.message).toContain('상대');
    });

    it('Windows 정션 경로를 지정하면 연결 대상을 읽지 않고 거부한다', async () => {
      const target = path.join(project, '.codocs', 'ordinary');
      await mkdir(target);
      await writeFile(
        path.join(target, 'item.yaml'),
        'id: item\nname: Item\ndomains: [업무]\ndefinition: 본문\n',
      );
      await symlink(
        target,
        path.join(project, '.codocs', 'linked'),
        'junction',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      const result = await session.validate('.codocs/linked/item.yaml');
      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'unsupported_workspace_link',
          path: path.join('.codocs', 'linked'),
        },
      });
    });

    it('색인에 아직 없는 새 파일을 성공 검증으로 보고하지 않는다', async () => {
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.validate();
      await file(
        'new.yaml',
        'id: new\nname: New\ndomains: [업무]\ndefinition: 본문\n',
      );
      const result = await session.validate('.codocs/new.yaml');
      expect(result).toMatchObject({
        success: false,
        error: { code: 'index_not_ready' },
      });
    });
  });
  describe('전체 텍스트 매칭', () => {
    it('저장하지 않은 주석·문자열·불완전 원문을 요청마다 새 UTF-16 범위로 매칭한다', async () => {
      await file(
        'user-name.yaml',
        'id: user-name\nname: user name\ndomains: [업무]\ndefinition: 본문\n',
      );
      await file(
        'return-zone.yaml',
        'id: return-zone\nname: return zone\ndomains: [업무]\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      const text = '😀// userName\r\nconst broken = "returnZone';
      const first = await session.match(text);
      if (!first.success) throw new Error('초기 매칭 실패');

      expect(first).toMatchObject({
        scanStatus: scanStatuses.complete,
        partial: false,
        candidates: [{ id: 'user-name' }, { id: 'return-zone' }],
      });
      expect(first.evidence.map((item) => item.range)).toEqual([
        {
          start: text.indexOf('userName'),
          end: text.indexOf('userName') + 'userName'.length,
        },
        {
          start: text.indexOf('returnZone'),
          end: text.indexOf('returnZone') + 'returnZone'.length,
        },
      ]);

      const edited = await session.match('// returnZone');
      expect(edited).toMatchObject({
        success: true,
        catalogVersion: first.catalogVersion,
        candidates: [{ id: 'return-zone' }],
      });
      if (edited.success)
        expect(
          edited.candidates.map((candidate) => candidate.id),
        ).not.toContain('user-name');
    });

    it('문서 ID 목록이 같아도 .codocs 변경을 새 catalog 버전의 다음 매칭에 반영한다', async () => {
      await file(
        'stable.yaml',
        'id: stable\nname: stable\ndomains: [업무]\ndefinition: 본문\ndeprecatedAliases: [{ id: alpha }]\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.match('alpha');
      if (!first.success) throw new Error('초기 매칭 실패');
      const listGeneration = session.generation;
      await file(
        'stable.yaml',
        'id: stable\nname: stable\ndomains: [업무]\ndefinition: 본문\ndeprecatedAliases: [{ id: beta }]\n',
      );

      await vi.waitFor(
        async () => {
          const synchronized = await session.match('beta');
          expect(synchronized).toMatchObject({
            success: true,
            candidates: [{ id: 'stable' }],
          });
          if (!synchronized.success) throw new Error('매칭 동기화 실패');
          expect(synchronized.catalogVersion).toBeGreaterThan(
            first.catalogVersion,
          );
        },
        { timeout: 5_000, interval: 25 },
      );
      expect(session.generation).toBe(listGeneration);
    });
  });

  it('refresh 집계는 같은 탐색의 파일·비필터 목록·진단을 반영한다', async () => {
    await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 본문\n',
    );
    await file(
      'duplicate.yaml',
      'id: alpha\nname: duplicate\ndomains: [업무]\ndefinition: 본문\n',
    );
    await file('broken.yaml', 'id: [\n');
    await file('unidentified.yaml', 'name: missing id\n');
    const session = createWorkspaceQuerySession({ cwd: project });
    const result = await session.refresh();
    const list = await session.list();

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      fileCount: 4,
      itemCount: 1,
      countsComplete: true,
    });
    if (!result.success || !list.success) throw new Error('refresh 실패');
    expect(result.itemCount).toBe(list.totalCount);
    expect(result.errorCount).toBe(
      result.diagnostics.filter(
        (d) => d.severity === diagnosticSeverities.error,
      ).length,
    );
    expect(result.warningCount).toBe(
      result.diagnostics.filter(
        (d) => d.severity === diagnosticSeverities.warning,
      ).length,
    );
    expect(result.errorCount).toBeGreaterThan(0);
    await session.close();
  });

  it('partial refresh는 집계가 불완전함을 명시한다', async () => {
    const target = await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });

    const result = await session.refresh();

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'partial',
      countsComplete: false,
      itemCount: 1,
    });
    if (!result.success) throw new Error('partial refresh 실패');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    await session.close();
  });

  it('감시 실패는 마지막 완료 snapshot만 미확인 조회로 제공한다', async () => {
    await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    const spy = vi
      .spyOn(WorkspaceWatcher.prototype, 'readiness', 'get')
      .mockReturnValue({
        state: 'failed',
        ready: false,
        cause: 'watcher error',
        guidance: watcherRecoveryGuidance,
      });
    try {
      expect(session.limitedReadAvailable).toBe(true);
      const list = await session.list();
      const get = await session.get(['alpha', 'outside']);
      const match = await session.match('outside');
      expect(list).toMatchObject({
        success: true,
        scanStatus: 'partial',
        items: [{ id: 'alpha', confirmation: 'unconfirmed' }],
      });
      if (list.success)
        expect(list.diagnostics?.[0]?.message).toContain('codocs_refresh');
      expect(get).toMatchObject({
        success: true,
        scanStatus: 'partial',
        results: [
          { id: 'alpha', found: true, confirmation: 'unconfirmed' },
          { id: 'outside', found: false, confirmation: 'unconfirmed' },
        ],
      });
      if (get.success)
        expect(get.results[1]?.diagnostics).not.toContainEqual(
          expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
        );
      expect(match).toMatchObject({
        success: true,
        scanStatus: 'partial',
        partial: true,
        candidates: [],
      });
      if (match.success)
        expect(match.diagnostics[0]?.message).toContain('codocs_refresh');
    } finally {
      spy.mockRestore();
      await session.close();
    }
  });

  it('완료 snapshot 없이 감시가 실패하면 조회 실패를 반환한다', async () => {
    const target = await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 본문\n',
    );
    ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
    const session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.list()).toMatchObject({
      success: true,
      scanStatus: 'partial',
    });
    const spy = vi
      .spyOn(WorkspaceWatcher.prototype, 'readiness', 'get')
      .mockReturnValue({
        state: 'failed',
        ready: false,
        cause: 'watcher error',
        guidance: watcherRecoveryGuidance,
      });
    try {
      expect(session.limitedReadAvailable).toBe(false);
      expect(await session.list()).toMatchObject({
        success: false,
        scanStatus: 'failed',
        error: { severity: diagnosticSeverities.error },
      });
      expect(await session.get(['alpha'])).toMatchObject({ success: false });
    } finally {
      spy.mockRestore();
      await session.close();
    }
  });
  it('동시 refresh가 같은 결과와 한 세대를 공유하고 조회가 보유한 결과를 재사용한다', async () => {
    await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    const before = session.generation;
    expect(await session.get(['alpha'])).toMatchObject({ success: true });
    expect(session.generation).toBe(before);
    const first = session.refresh();
    const second = session.refresh();
    expect(first).toBe(second);
    expect(await first).toMatchObject({
      success: true,
      scanStatus: 'complete',
    });
    expect(session.generation).toBe(before + 1);
    await session.close();
  });
  describe('문서 목록과 상세 조회', () => {
    it('문서 하나가 있는 프로젝트를 목록 조회하면 한 항목과 완료 상태를 반환한다', async () => {
      const raw =
        "id: alpha\r\nname: 알파\r\ndomains: [업무]\r\ndefinition: '본문'\r\n";
      await file('alpha.yaml', raw);
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        totalCount: 1,
        returnedCount: 1,
        nextCursor: null,
      });
      if (result.success)
        expect(result.items[0]).toMatchObject({ id: 'alpha' });
    });

    it('CRLF 문서를 상세 조회하면 원본 UTF-8 바이트의 revision을 반환한다', async () => {
      const raw =
        "id: alpha\r\nname: 알파\r\ndomains: [업무]\r\ndefinition: '본문'\r\n";
      await file('alpha.yaml', raw);
      const session = createWorkspaceQuerySession({ cwd: project });
      const ids = ['alpha'];

      const result = await session.get(ids);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        results: [
          {
            id: ids[0],
            found: true,
            revision: createHash('sha256').update(raw, 'utf8').digest('hex'),
          },
        ],
      });
    });

    it.each([1, 10, 20])(
      '%i개 ID를 상세 조회하면 실제 파일의 모든 결과를 요청 순서로 반환한다',
      async (size) => {
        const ids = Array.from(
          { length: size },
          (_, index) => `doc-${String(index).padStart(2, '0')}`,
        );
        await Promise.all(
          ids.map((id) =>
            file(
              `${id}.yaml`,
              `id: ${id}\nname: ${id}\ndomains: [업무]\ndefinition: ${id} 본문\n`,
            ),
          ),
        );
        const session = createWorkspaceQuerySession({ cwd: project });

        const requestedIds = ids.slice().reverse();
        const result = await session.get(requestedIds);

        expect(result).toMatchObject({
          success: true,
          scanStatus: scanStatuses.complete,
        });
        if (result.success)
          expect(result.results.map((item) => item.id)).toEqual(requestedIds);
      },
    );

    it('21개 고유 ID를 상세 조회하면 일부 결과 없이 전체 요청 입력 오류를 반환한다', async () => {
      const ids = Array.from(
        { length: 21 },
        (_, index) => `doc-${String(index).padStart(2, '0')}`,
      );
      await Promise.all(
        ids.map((id) =>
          file(
            `${id}.yaml`,
            `id: ${id}\nname: ${id}\ndomains: [업무]\ndefinition: ${id} 본문\n`,
          ),
        ),
      );
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.get(ids);

      expect(result).toMatchObject({
        success: false,
        error: { code: queryDiagnosticCodes.invalidInput },
      });
      expect(result).not.toHaveProperty('results');
    });

    it('실제 파일의 이름 참조를 상세 조회하면 직접 참조와 역참조 ID를 반환한다', async () => {
      await file(
        'source.yaml',
        "id: source\nname: 출발\ndomains: [업무]\ndefinition: '[[대상]]'\n",
      );
      await file(
        'target.yaml',
        'id: target\nname: 대상\ndomains: [업무]\ndefinition: 대상 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.get(['source', 'target']);

      expect(result).toMatchObject({
        success: true,
        results: [
          { id: 'source', found: true, references: ['target'] },
          { id: 'target', found: true, referencedBy: ['source'] },
        ],
      });
    });
  });

  it('오류 문서의 원문과 byte revision을 함께 조회하고 별도 프로세스에서도 같은 revision을 계산한다', /** 실제 파일의 잘못된 UTF-8을 재인코딩하지 않는다. */ async () => {
    const raw =
      'id: broken\nname: 오류 문서\ndefinition: 설명\ndomains: [도메인]\nvalue: .nan\n# �\n';
    const bytes = Buffer.concat([
      Buffer.from(raw.slice(0, -2), 'utf8'),
      Buffer.from([0x80, 0x0a]),
    ]);
    const target = path.join(project, '.codocs', 'broken.yaml');
    await writeFile(target, bytes);
    const session = createWorkspaceQuerySession({ cwd: project });
    const get = await session.get(['broken']);
    const revision = createHash('sha256').update(bytes).digest('hex');
    expect(get).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [{ id: 'broken', found: true, rawYaml: raw, revision }],
    });
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      "import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));",
      target,
    ]);
    expect(stdout).toBe(revision);
    expect(revision).not.toBe(
      createHash('sha256').update(raw, 'utf8').digest('hex'),
    );
  });

  describe('부분 스캔 후 이전 조회 결과 보존', () => {
    /** @codocs [[작업 공간:미확인 문서]]#L12-L13 */
    it('문서 경로의 확인이 실패하면 이전 본문과 revision을 미확인 상태로 반환한다', async () => {
      const raw =
        "id: alpha\nname: 알파\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: '이전 본문'\n";
      const target = await file('alpha.yaml', raw);
      const session = createWorkspaceQuerySession({ cwd: project });
      const initial = await session.get(['alpha']);
      if (
        !initial.success ||
        !initial.results[0]?.found ||
        initial.results[0].conflict
      )
        throw new Error('초기 문서 조회 실패');
      const revision = initial.results[0].revision;
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });

      await session.refresh();
      const result = await session.get(['alpha']);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        results: [
          {
            id: 'alpha',
            found: true,
            confirmation: 'unconfirmed',
            revision,
            document: { definition: '이전 본문' },
          },
        ],
      });
    });

    /** @codocs [[작업 공간:작업 공간 조회 세션]]#L56 */
    it('부분 스캔에서 색인 밖 ID를 조회하면 부재로 확정하지 않는다', async () => {
      const target = await file(
        'alpha.yaml',
        'id: alpha\nname: alpha\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.get(['alpha']);
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });

      await session.refresh();
      const result = await session.get(['outside']);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        results: [{ id: 'outside', found: false, confirmation: 'unconfirmed' }],
      });
      if (result.success)
        expect(result.results[0]?.diagnostics).not.toContainEqual(
          expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
        );
    });

    it('부분 스캔에서 목록을 조회하면 이전 항목을 포함한 개수를 반환한다', async () => {
      const target = await file(
        'alpha.yaml',
        'id: alpha\nname: alpha\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
      );
      await file(
        'beta.yaml',
        'id: beta\nname: beta\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.list();
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });

      await session.refresh();
      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        totalCount: 2,
      });
    });
  });

  it('failed는 이전 Catalog를 응답에 노출하지 않고 확인된 원인으로 실패한다', /** 미지원 .codocs 정션으로 failed 전환을 만든다. */ async () => {
    await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.get(['alpha'])).toMatchObject({ success: true });
    const codocs = path.join(project, '.codocs');
    const saved = path.join(project, 'saved-codocs');
    await rename(codocs, saved);
    await symlink(saved, codocs, 'junction');

    await session.refresh();
    const list = await session.list();
    const get = await session.get(['alpha']);
    expect(list).toMatchObject({ success: false, scanStatus: 'failed' });
    expect(get).toMatchObject({ success: false, scanStatus: 'failed' });
    expect(list).not.toHaveProperty('items');
    expect(get).not.toHaveProperty('results');
  });

  it('50개 고정 페이지가 cursor만으로 필터와 결정적 순서를 복원한다', /** 역순 생성과 필터 복원을 함께 확인한다. */ async () => {
    for (let index = 59; index >= 0; index--)
      await file(
        `doc-${index}.yaml`,
        `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
      );
    await file(
      'other.yaml',
      'id: other\nname: other\ndomains: [기타]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
    );
    await file(
      'other-kind.yaml',
      'id: other-kind\nname: other-kind\ndomains: [업무]\nkind: decision\nstatus: confirmed\ndefinition: 본문\n',
    );
    await file(
      'other-status.yaml',
      'id: other-status\nname: other-status\ndomains: [업무]\nkind: policy\nstatus: proposed\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const first = await session.list({
      domain: '업무',
      kind: documentKinds.policy,
      status: documentStatuses.confirmed,
    });
    expect(first).toMatchObject({
      success: true,
      totalCount: 60,
      returnedCount: 50,
    });
    if (!first.success || !first.nextCursor)
      throw new Error('다음 cursor 없음');
    expect(first.items.map((item) => item.id)).toEqual(
      Array.from(
        { length: 50 },
        (_, index) => `doc-${String(index).padStart(2, '0')}`,
      ),
    );
    const second = await session.list({ cursor: first.nextCursor });
    expect(second).toMatchObject({
      success: true,
      totalCount: 60,
      returnedCount: 10,
      nextCursor: null,
    });
    expect(second.success && second.items.map((item) => item.id)).toEqual(
      Array.from(
        { length: 10 },
        (_, index) => `doc-${String(index + 50).padStart(2, '0')}`,
      ),
    );
  });

  describe('목록 표시 변경에 따른 cursor 유효성', () => {
    /** @codocs [[작업 공간:목록 페이지 조회]]#L19 @codocs [[작업 공간:조회 커서]]#L15 */
    it('본문만 변경하면 기존 cursor로 다음 페이지를 조회한다', async () => {
      for (let index = 0; index < 51; index++)
        await file(
          `doc-${index}.yaml`,
          `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
        );
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list();
      if (!first.success || !first.nextCursor)
        throw new Error('다음 cursor 없음');
      await file(
        'doc-50.yaml',
        'id: doc-50\nname: doc-50\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 새 본문\n',
      );

      await vi.waitFor(
        async () => {
          const synchronized = await session.get(['doc-50']);
          expect(synchronized).toMatchObject({
            success: true,
            results: [{ document: { definition: '새 본문' } }],
          });
        },
        { timeout: 5_000, interval: 25 },
      );
      const result = await session.list({ cursor: first.nextCursor });

      expect(result).toMatchObject({
        success: true,
        totalCount: 51,
        returnedCount: 1,
        nextCursor: null,
        items: [{ id: 'doc-50' }],
      });
    });

    /** @codocs [[작업 공간:목록 페이지 조회]]#L13 */
    it('cursor와 최초 목록의 도메인과 다른 필터를 전달하면 입력 오류를 반환한다', async () => {
      for (let index = 0; index < 51; index++)
        await file(
          `doc-${index}.yaml`,
          `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
        );
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list({ domain: '업무' });
      if (!first.success || !first.nextCursor)
        throw new Error('다음 cursor 없음');

      const result = await session.list({
        cursor: first.nextCursor,
        domain: '기타',
      });

      expect(result).toMatchObject({
        success: false,
        error: { code: queryDiagnosticCodes.invalidInput },
      });
    });

    it('목록에 표시되는 문서 이름이 바뀌면 기존 cursor를 만료한다', async () => {
      for (let index = 0; index < 51; index++)
        await file(
          `doc-${index}.yaml`,
          `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
        );
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list();
      if (!first.success || !first.nextCursor)
        throw new Error('다음 cursor 없음');
      await file(
        'doc-50.yaml',
        'id: doc-50\nname: 표시 이름 변경\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
      );

      await vi.waitFor(
        async () => {
          const synchronizedFirst = await session.list();
          if (!synchronizedFirst.success || !synchronizedFirst.nextCursor)
            throw new Error('동기화 확인 cursor 없음');
          const synchronized = await session.list({
            cursor: synchronizedFirst.nextCursor,
          });
          if (!synchronized.success) throw new Error('목록 동기화 실패');
          expect(synchronized.items).toContainEqual(
            expect.objectContaining({
              id: 'doc-50',
              name: '표시 이름 변경',
            }),
          );
        },
        { timeout: 5_000, interval: 25 },
      );
      const result = await session.list({ cursor: first.nextCursor });

      expect(result).toMatchObject({
        success: false,
        error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
      });
    });

    it.each([
      { name: '새 문서 추가', changed: 'new' },
      { name: '문서 오류 발생', changed: 'error' },
      { name: 'ID 충돌 발생', changed: 'conflict' },
    ])(
      '$name으로 목록 표시가 바뀌면 기존 cursor를 만료한다',
      async ({ changed }) => {
        for (let index = 0; index < 51; index++)
          await file(
            `doc-${index}.yaml`,
            `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
          );
        const session = createWorkspaceQuerySession({ cwd: project });
        const first = await session.list();
        if (!first.success || !first.nextCursor)
          throw new Error('다음 cursor 없음');
        if (changed === 'new')
          await file(
            'new.yaml',
            'id: new\nname: new\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
          );
        if (changed === 'error')
          await file(
            'doc-50.yaml',
            "id: doc-50\nname: doc-50\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: '[[Missing]]'\n",
          );
        if (changed === 'conflict')
          await file(
            'duplicate.yaml',
            'id: doc-50\nname: duplicate\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
          );

        await vi.waitFor(
          async () => {
            const synchronizedFirst = await session.list();
            if (!synchronizedFirst.success || !synchronizedFirst.nextCursor)
              throw new Error('동기화 확인 cursor 없음');
            const synchronized = await session.list({
              cursor: synchronizedFirst.nextCursor,
            });
            if (!synchronized.success) throw new Error('목록 동기화 실패');
            if (changed === 'new')
              expect(synchronized.items).toContainEqual(
                expect.objectContaining({ id: 'new' }),
              );
            if (changed === 'error')
              expect(synchronized.items).toContainEqual(
                expect.objectContaining({ id: 'doc-50', hasErrors: true }),
              );
            if (changed === 'conflict')
              expect(synchronized.items).toContainEqual(
                expect.objectContaining({ id: 'doc-50', conflict: true }),
              );
          },
          { timeout: 5_000, interval: 25 },
        );
        const result = await session.list({ cursor: first.nextCursor });

        expect(result).toMatchObject({
          success: false,
          error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
        });
      },
    );
  });

  describe('문서 삭제·ID 순서·필터 포함 여부 변경에 따른 cursor 만료', () => {
    it.each([
      { label: '문서를 삭제', replacement: null },
      {
        label: '마지막 문서 ID를 첫 번째로 정렬되는 ID로 변경',
        replacement: 'id: aaa',
      },
    ])('$label하면 기존 cursor를 만료한다', async ({ replacement }) => {
      for (let index = 0; index < 51; index++) {
        const id = `doc-${String(index).padStart(2, '0')}`;
        await file(
          `${id}.yaml`,
          `id: ${id}\nname: ${id}\ndomains: [업무]\ndefinition: 본문\n`,
        );
      }
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list();
      if (!first.success || !first.nextCursor)
        throw new Error('다음 cursor 없음');
      const input = { cursor: first.nextCursor };
      if (replacement === null) {
        await rm(path.join(project, '.codocs/doc-50.yaml'));
      } else {
        await file(
          'doc-50.yaml',
          `${replacement}\nname: doc-50\ndomains: [업무]\ndefinition: 본문\n`,
        );
      }

      await vi.waitFor(
        async () => {
          const synchronized = await session.list();
          expect(synchronized).toMatchObject({
            success: true,
            totalCount: replacement === null ? 50 : 51,
          });
          if (synchronized.success)
            expect(synchronized.items.map((item) => item.id)).toEqual(
              replacement === null
                ? expect.not.arrayContaining(['doc-50'])
                : expect.arrayContaining(['aaa']),
            );
        },
        { timeout: 5_000, interval: 25 },
      );
      const result = await session.list(input);

      expect(result).toEqual({
        success: false,
        scanStatus: scanStatuses.complete,
        error: {
          code: workspaceQueryDiagnosticCodes.cursorExpired,
          severity: diagnosticSeverities.error,
          message: workspaceQueryDiagnosticMessages.cursorExpired,
        },
      });
    });

    it.each([
      {
        label: '도메인',
        domains: '기타',
        kind: documentKinds.policy,
        status: documentStatuses.confirmed,
      },
      {
        label: '종류',
        domains: '업무',
        kind: documentKinds.decision,
        status: documentStatuses.confirmed,
      },
      {
        label: '상태',
        domains: '업무',
        kind: documentKinds.policy,
        status: documentStatuses.proposed,
      },
    ])(
      '문서의 $label을 변경해 기존 필터에서 제외하면 기존 cursor를 만료한다',
      async ({ domains, kind, status }) => {
        for (let index = 0; index < 51; index++) {
          const id = `doc-${String(index).padStart(2, '0')}`;
          await file(
            `${id}.yaml`,
            `id: ${id}\nname: ${id}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
          );
        }
        const filters = {
          domain: '업무',
          kind: documentKinds.policy,
          status: documentStatuses.confirmed,
        };
        const session = createWorkspaceQuerySession({ cwd: project });
        const first = await session.list(filters);
        if (!first.success || !first.nextCursor)
          throw new Error('다음 cursor 없음');
        const input = { cursor: first.nextCursor };
        await file(
          'doc-50.yaml',
          `id: doc-50\nname: doc-50\ndomains: [${domains}]\nkind: ${kind}\nstatus: ${status}\ndefinition: 본문\n`,
        );

        await vi.waitFor(
          async () => {
            const synchronized = await session.list(filters);
            expect(synchronized).toMatchObject({
              success: true,
              totalCount: 50,
            });
          },
          { timeout: 5_000, interval: 25 },
        );
        const result = await session.list(input);

        expect(result).toEqual({
          success: false,
          scanStatus: scanStatuses.complete,
          error: {
            code: workspaceQueryDiagnosticCodes.cursorExpired,
            severity: diagnosticSeverities.error,
            message: workspaceQueryDiagnosticMessages.cursorExpired,
          },
        });
      },
    );
  });

  describe('cursor 서명과 세션 수명', () => {
    it('서명에 정규화되지 않은 base64url 문자를 넣으면 cursor를 거부한다', async () => {
      for (let index = 0; index < 51; index++)
        await file(
          `doc-${index}.yaml`,
          `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
        );
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list();
      if (!first.success || !first.nextCursor)
        throw new Error('다음 cursor 없음');
      const [encoded, signature] = first.nextCursor.split('.');
      if (!encoded || !signature) throw new Error('서명 cursor 형식 오류');
      const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const lastIndex = alphabet.indexOf(signature.at(-1) ?? '');
      if (lastIndex < 0 || (lastIndex & 3) !== 0)
        throw new Error('canonical 서명 형식 오류');
      const alternateSignature = `${signature.slice(0, -1)}${alphabet[lastIndex | 1]}`;
      expect(Buffer.from(alternateSignature, 'base64url')).toEqual(
        Buffer.from(signature, 'base64url'),
      );
      const tampered = `${encoded}.${alternateSignature}`;

      const result = await session.list({ cursor: tampered });

      expect(result).toMatchObject({
        success: false,
        error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
      });
    });

    it('명시적으로 새로 고침하면 이전 cursor를 만료한다', async () => {
      for (let index = 0; index < 51; index++)
        await file(
          `doc-${index}.yaml`,
          `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
        );
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list();
      if (!first.success || !first.nextCursor)
        throw new Error('다음 cursor 없음');
      await session.refresh();

      const result = await session.list({ cursor: first.nextCursor });

      expect(result).toMatchObject({
        success: false,
        error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
      });
    });

    /** @codocs [[작업 공간:목록 페이지 조회]]#L20 */
    it('새 세션에서 이전 cursor를 사용하면 만료 오류를 반환한다', async () => {
      for (let index = 0; index < 51; index++)
        await file(
          `doc-${index}.yaml`,
          `id: doc-${String(index).padStart(2, '0')}\nname: doc-${String(index).padStart(2, '0')}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n`,
        );
      const session = createWorkspaceQuerySession({ cwd: project });
      const first = await session.list();
      if (!first.success || !first.nextCursor)
        throw new Error('다음 cursor 없음');
      vi.resetModules();
      const restarted = await import('./index.js');
      const other = restarted.createWorkspaceQuerySession({ cwd: project });

      const result = await other.list({ cursor: first.nextCursor });

      expect(result).toMatchObject({
        success: false,
        error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
      });
      await other.close();
    });
  });
});

describe('경로와 catalog 버전 기반 문서 조회', () => {
  it('이전 ID로 찾은 현재 ID 누락 문서를 경로로 조회하면 내용과 진단을 유지한다', async () => {
    const documentPath = await file(
      'missing-id.yaml',
      'name: 이전 이름\ndomains: [업무]\ndefinition: 본문\ndeprecatedAliases: [{ id: old-name }]\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const matched = await session.match('oldName');
    if (!matched.success) throw new Error('코드 매칭 실패');
    const candidate = matched.candidates[0];
    if (!candidate) throw new Error('이전 ID 후보 없음');

    const result = await session.getByPaths(
      [candidate.path],
      matched.catalogVersion,
    );

    expect(result).toMatchObject({
      success: true,
      catalogVersion: matched.catalogVersion,
      results: [
        {
          path: path.relative(project, documentPath),
          found: true,
          document: { name: '이전 이름', definition: '본문' },
          diagnostics: [
            {
              code: 'missing_required_field',
              path: path.relative(project, documentPath),
              fieldPath: ['id'],
            },
          ],
        },
      ],
    });
    if (!result.success) throw new Error('경로 조회 실패');
    expect(result.results[0]).not.toHaveProperty('id');
  });

  it('직접 참조와 역참조를 경로 링크로 구분한다', async () => {
    await file(
      'source.yaml',
      "id: source\nname: 출발\ndomains: [업무]\ndefinition: '[[대상]]'\n",
    );
    await file(
      'target.yaml',
      'id: target\nname: 대상\ndomains: [업무]\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const matched = await session.match('source target');
    if (!matched.success) throw new Error('코드 매칭 실패');

    const result = await session.getByPaths(
      ['.codocs/source.yaml', '.codocs/target.yaml'],
      matched.catalogVersion,
    );

    expect(result).toMatchObject({
      success: true,
      results: [
        {
          references: [
            { path: path.join('.codocs', 'target.yaml'), id: 'target' },
          ],
        },
        {
          referencedBy: [
            { path: path.join('.codocs', 'source.yaml'), id: 'source' },
          ],
        },
      ],
    });
    if (!result.success) throw new Error('경로 조회 실패');
    expect(result.results[0]).not.toHaveProperty('referencedBy');
    expect(result.results[1]).not.toHaveProperty('references');
  });

  it('본문 변경으로 catalog가 갱신되면 이전 버전의 경로 조회를 거부한다', async () => {
    await file(
      'stable.yaml',
      'id: stable\nname: stable\ndomains: [업무]\ndefinition: 이전 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const first = await session.match('stable');
    if (!first.success) throw new Error('초기 매칭 실패');
    await file(
      'stable.yaml',
      'id: stable\nname: stable\ndomains: [업무]\ndefinition: 새 본문\n',
    );
    await vi.waitFor(
      async () => {
        const changed = await session.match('stable');
        if (!changed.success) throw new Error('변경 매칭 실패');
        expect(changed.catalogVersion).toBeGreaterThan(first.catalogVersion);
      },
      { timeout: 5_000, interval: 25 },
    );

    const result = await session.getByPaths(
      ['.codocs/stable.yaml'],
      first.catalogVersion,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.catalogVersionMismatch },
      expectedCatalogVersion: first.catalogVersion,
    });
    if (result.success || !('catalogVersion' in result))
      throw new Error('catalog 버전 불일치가 아님');
    expect(result.catalogVersion).toBeGreaterThan(first.catalogVersion);
  });

  it('부분 관측에서 확인하지 못한 경로는 부재로 확정하지 않는다', async () => {
    const target = await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const initial = await session.match('alpha');
    if (!initial.success) throw new Error('초기 매칭 실패');
    ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
    const refreshed = await session.refresh();
    if (!refreshed.success) throw new Error('부분 갱신 실패');

    const result = await session.getByPaths(
      ['.codocs/outside.yaml'],
      session.catalogVersion,
    );

    expect(result).toMatchObject({
      success: true,
      scanStatus: scanStatuses.partial,
      results: [
        {
          path: path.join('.codocs', 'outside.yaml'),
          found: false,
          confirmation: 'unconfirmed',
        },
      ],
    });
    if (result.success)
      expect(result.results[0]?.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
      );
  });

  it('한글과 공백이 있는 CRLF 문서의 ID 오류 위치와 revision을 그대로 반환한다', async () => {
    await mkdir(path.join(project, '.codocs', '하위 폴더'));
    const raw =
      'id: Invalid_Id\r\nname: 오류 문서\r\ndomains: [업무]\r\ndefinition: 😀본문\r\ndeprecatedAliases: [{ id: old-name }]\r\n';
    await file('하위 폴더/오류 문서.yaml', raw);
    const session = createWorkspaceQuerySession({ cwd: project });
    const matched = await session.match('oldName');
    if (!matched.success) throw new Error('코드 매칭 실패');
    const candidate = matched.candidates[0];
    if (!candidate) throw new Error('형식 오류 ID 후보 없음');

    const result = await session.getByPaths(
      [candidate.path],
      matched.catalogVersion,
    );

    expect(result).toMatchObject({
      success: true,
      results: [
        {
          path: path.join('.codocs', '하위 폴더', '오류 문서.yaml'),
          revision: createHash('sha256').update(raw, 'utf8').digest('hex'),
          source: {
            path: path.join('.codocs', '하위 폴더', '오류 문서.yaml'),
            uri: pathToFileURL(
              path.join(project, '.codocs', '하위 폴더', '오류 문서.yaml'),
            ).href,
          },
          diagnostics: [
            expect.objectContaining({
              fieldPath: ['id'],
              range: {
                start: { line: 0, character: 4 },
                end: { line: 0, character: 14 },
              },
            }),
          ],
        },
      ],
    });
    if (!result.success) throw new Error('경로 조회 실패');
    const source = result.results[0]?.found
      ? result.results[0].source
      : undefined;
    expect(source?.offsetRange?.start).toBe(0);
    expect(source?.range?.start).toEqual({ line: 0, character: 0 });
    expect(result.results[0]).not.toHaveProperty('id');
  });
});

describe('live 참조와 선택 최신 확인', () => {
  it('미저장 본문을 조회하면 디스크 출처를 변경하지 않고 같은 버전의 대상 내용을 반환한다', async () => {
    await file(
      'target.yaml',
      'id: target\nname: 대상\ndomains: [업무]\ndefinition: disk\nstatus: deprecated\n',
    );
    await file(
      'source.yaml',
      'id: source\nname: 출처\ndefinition: 저장된 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const result = await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "😀[[대상]] [[대상]]"\r\n',
      documentVersion: 1,
    });
    expect(result).toMatchObject({
      success: true,
      documentVersion: 1,
      targets: [
        {
          path: path.join('.codocs', 'target.yaml'),
          document: { definition: 'disk' },
        },
      ],
    });
    if (!result.success) throw new Error('참조 조회 실패');
    expect(
      result.diagnostics.filter(
        (item) => item.code === catalogDiagnosticCodes.deprecatedReference,
      ),
    ).toHaveLength(2);
    expect(result.targets[0]).toMatchObject({
      source: {
        uri: pathToFileURL(path.join(project, '.codocs/target.yaml')).href,
      },
    });
    expect(await session.get(['source'])).toMatchObject({
      results: [{ document: { definition: '저장된 본문' } }],
    });
  });

  it('최초 탐색 중 새 버전 요청이 오면 이전 문서 결과를 적용하지 않는다', async () => {
    await file('target.yaml', 'id: target\nname: 대상\ndefinition: disk\n');
    const session = createWorkspaceQuerySession({ cwd: project });
    const first = session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[대상]]"',
      documentVersion: 1,
    });
    const second = session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: 삭제',
      documentVersion: 2,
    });
    expect(await first).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.requestSuperseded },
    });
    expect(await second).toMatchObject({
      success: true,
      documentVersion: 2,
      occurrences: [],
    });
  });

  it('이전 버전 요청이 늦게 도착하면 최신 출처를 대체하지 않는다', async () => {
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: 최신',
      documentVersion: 2,
    });
    expect(
      await session.references({
        sourcePath: '.codocs/source.yaml',
        text: 'definition: "[[대상]]"',
        documentVersion: 1,
      }),
    ).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.requestSuperseded },
    });
  });

  it('조회 중 출처를 닫으면 진행 중 결과를 폐기한다', async () => {
    const session = createWorkspaceQuerySession({ cwd: project });
    const pending = session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[대상]]"',
      documentVersion: 1,
    });
    session.closeDocument('.codocs/source.yaml');
    expect(await pending).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.requestSuperseded },
    });
  });

  it('조회 중 취소하면 진행 중 결과를 폐기한다', async () => {
    const session = createWorkspaceQuerySession({ cwd: project });
    const controller = new AbortController();
    const pending = session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[대상]]"',
      documentVersion: 1,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.requestSuperseded },
    });
  });

  it('최초 탐색 중 세션을 닫으면 완료 알림과 버전 게시를 막는다', async () => {
    const session = createWorkspaceQuerySession({ cwd: project });
    const listener = vi.fn();
    session.onDidChangeSnapshot(listener);
    const pending = session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: 설명',
      documentVersion: 1,
    });
    await session.close();
    expect(await pending).toMatchObject({ success: false });
    expect(listener).not.toHaveBeenCalled();
    expect(session.catalogVersion).toBe(0);
    expect(await session.refresh()).toMatchObject({ success: false });
  });

  it('완료 알림에서는 게시된 버전을 조회하고 해제 후에는 알리지 않는다', async () => {
    const session = createWorkspaceQuerySession({ cwd: project });
    const versions: number[] = [];
    const dispose = session.onDidChangeSnapshot((event) => {
      expect(session.catalogVersion).toBe(event.catalogVersion);
      versions.push(event.catalogVersion);
    });
    await session.refresh();
    expect(versions).toEqual([session.catalogVersion]);
    dispose();
    await session.refresh();
    expect(versions).toHaveLength(1);
  });

  it('listener가 실패해도 게시한 snapshot과 다른 listener를 유지한다', async () => {
    const session = createWorkspaceQuerySession({ cwd: project });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    session.onDidChangeSnapshot(() => {
      throw new Error('listener');
    });
    session.onDidChangeSnapshot(listener);
    expect(await session.refresh()).toMatchObject({ success: true });
    expect(listener).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it.each([
    { label: '내용 변경', moved: false },
    { label: '확인가능 이동', moved: true },
  ])(
    '$label을 완료 관측하면 선택을 유지하고 최신 내용을 확인한다',
    async ({ moved }) => {
      const original = await file(
        'target.yaml',
        'id: target\nname: 대상\ndomains: [업무]\ndefinition: 이전\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.refresh();
      const token = session.captureCandidate(
        { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
        '.codocs/target.yaml',
        session.catalogVersion,
      )!;
      expect(token).toBeTypeOf('string');
      if (moved)
        await rename(original, path.join(project, '.codocs/새 경로.yaml'));
      await file(
        moved ? '새 경로.yaml' : 'target.yaml',
        'id: target\nname: 대상\ndomains: [업무]\ndefinition: 최신\n',
      );
      await session.refresh();
      const confirmed = await session.confirmCandidate(token);
      expect(confirmed).toMatchObject({
        catalogVersion: session.catalogVersion,
        result: {
          path: moved
            ? path.join('.codocs', '새 경로.yaml')
            : path.join('.codocs', 'target.yaml'),
          document: { definition: '최신' },
        },
      });
    },
  );

  it('코드 매칭으로 명시 선택한 후보를 이동 후에도 원래 매칭 근거로 확인한다', async () => {
    const original = await file(
      'target.yaml',
      'id: target\nname: 대상\ndefinition: 내용\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const matched = await session.match('target');
    if (!matched.success) throw new Error('매칭 실패');
    const token = session.captureCandidate(
      { text: 'target' },
      '.codocs/target.yaml',
      matched.catalogVersion,
    )!;
    await rename(original, path.join(project, '.codocs/moved.yaml'));
    await session.refresh();
    expect(await session.confirmCandidate(token)).toMatchObject({
      result: { path: path.join('.codocs', 'moved.yaml') },
    });
  });

  it.each([
    { label: '삭제', raw: undefined },
    {
      label: '옛 경로를 다른 문서가 재사용',
      raw: 'id: other\nname: 대상\ndefinition: 다른 문서\n',
    },
    {
      label: '미관측 내용 변경',
      raw: 'id: target\nname: 대상\ndefinition: 변경\n',
    },
  ])(
    '$label이 표시 후 발생하면 오래된 파일을 열 후보를 반환하지 않는다',
    async ({ raw }) => {
      const original = await file(
        'target.yaml',
        'id: target\nname: 대상\ndefinition: 내용\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.refresh();
      const token = session.captureCandidate(
        { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
        '.codocs/target.yaml',
        session.catalogVersion,
      )!;
      if (raw === undefined) await rm(original);
      else await writeFile(original, raw);
      expect(await session.confirmCandidate(token)).toBeUndefined();
    },
  );

  it('옛 경로 재사용을 완료 관측해도 다른 ID를 같은 선택으로 연결하지 않는다', async () => {
    await file('target.yaml', 'id: target\nname: 대상\ndefinition: 내용\n');
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    await file('target.yaml', 'id: other\nname: 대상\ndefinition: 내용\n');
    await session.refresh();
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it('참조가 live 출처에서 삭제되면 기존 선택을 무효화한다', async () => {
    await file('target.yaml', 'id: target\nname: 대상\ndefinition: 내용\n');
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[대상]]"',
      documentVersion: 1,
    });
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: 삭제',
      documentVersion: 2,
    });
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it('새 조회를 반복해도 대상 전체 색인 버전과 완료 알림을 변경하지 않는다', async () => {
    await file('target.yaml', 'id: target\nname: 대상\ndefinition: 내용\n');
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();
    const version = session.catalogVersion;
    const listener = vi.fn();
    session.onDidChangeSnapshot(listener);
    await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[대상]]"',
      documentVersion: 1,
    });
    await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[대상]] [[대상]]"',
      documentVersion: 2,
    });
    expect(session.catalogVersion).toBe(version);
    expect(listener).not.toHaveBeenCalled();
  });
});
