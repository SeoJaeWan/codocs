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
        '_codocs:\n  id: alpha\n  name: Alpha\ndefinition: 본문\n',
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
        '_codocs:\n  id: alpha\n  name: Alpha\ndefinition: 본문\n',
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
        '_codocs:\n  id: alpha\n  name: Alpha\ndefinition: 본문\n',
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
        '_codocs:\n  id: alpha\n  name: Alpha\ndefinition: 본문\n',
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
        '_codocs:\n  id: shared\n  name: A\ndefinition: 본문\n',
      );
      await file(
        'b.yaml',
        '_codocs:\n  id: shared\n  name: B\ndefinition: 본문\n',
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
      await file('no-id.yaml', '_codocs:\n  name: No ID\ndefinition: 본문\n');
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
        '_codocs:\n  id: locked\n  name: Locked\ndefinition: 본문\n',
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
        '_codocs:\n  id: absolute\n  name: Absolute\ndefinition: 본문\n',
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
        '_codocs:\n  id: item\n  name: Item\ndefinition: 본문\n',
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
        '_codocs:\n  id: new\n  name: New\ndefinition: 본문\n',
      );
      const result = await session.validate('.codocs/new.yaml');
      expect(result).toMatchObject({
        success: false,
        error: { code: 'index_not_ready' },
      });
    });
  });
  it('문서 목록이 같아도 .codocs 변경을 새 catalog 버전의 다음 조회에 반영한다', async () => {
    await file(
      'stable.yaml',
      '_codocs:\n  id: stable\n  name: stable\ndefinition: 이전 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    const firstVersion = session.catalogVersion;
    await file(
      'stable.yaml',
      '_codocs:\n  id: stable\n  name: stable\ndefinition: 새 본문\n',
    );

    await vi.waitFor(
      async () => {
        const synchronized = await session.get(['stable']);
        expect(synchronized).toMatchObject({
          success: true,
          results: [{ address: 'stable', document: { definition: '새 본문' } }],
        });
        expect(session.catalogVersion).toBeGreaterThan(firstVersion);
      },
      { timeout: 5_000, interval: 25 },
    );
  });

  it('refresh 집계는 같은 탐색의 파일·ID 단위 항목 수·진단을 반영한다', async () => {
    await file(
      'alpha.yaml',
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
    );
    await file(
      'duplicate.yaml',
      '_codocs:\n  id: alpha\n  name: duplicate\ndefinition: 본문\n',
    );
    await file('broken.yaml', 'id: [\n');
    await file('unidentified.yaml', '_codocs:\n  name: missing id\n');
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
    // 같은 ID의 두 문서는 목록에 각각 나오지만 항목 수는 ID 하나로 센다.
    expect(list.items).toHaveLength(2);
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
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
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
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
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
          { address: 'alpha', found: true, confirmation: 'unconfirmed' },
          {
            address: 'outside',
            found: false,
            confirmation: 'unconfirmed',
          },
        ],
      });
      if (get.success)
        expect(get.results[1]?.diagnostics).not.toContainEqual(
          expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
        );
    } finally {
      spy.mockRestore();
      await session.close();
    }
  });

  it('완료 snapshot 없이 감시가 실패하면 조회 실패를 반환한다', async () => {
    const target = await file(
      'alpha.yaml',
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
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
  it('동시 refresh가 같은 결과를 공유하고 조회가 보유한 결과를 재사용한다', async () => {
    await file(
      'alpha.yaml',
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.list();
    const version = session.catalogVersion;
    expect(await session.get(['alpha'])).toMatchObject({ success: true });
    expect(session.catalogVersion).toBe(version);
    const first = session.refresh();
    const second = session.refresh();
    expect(first).toBe(second);
    expect(await first).toMatchObject({
      success: true,
      scanStatus: 'complete',
    });
    await session.close();
  });
  describe('문서 목록과 상세 조회', () => {
    it('이름:섹션 주소를 조회하면 문서 revision과 같은 revision의 섹션 결과를 반환한다', async () => {
      await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: 알파\n정의: 본문\n규칙: 내용\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.get(['알파', '알파:규칙']);

      expect(result).toMatchObject({ success: true, scanStatus: 'complete' });
      if (!result.success) return;
      const [document, section] = result.results;
      expect(section).toMatchObject({
        address: '알파:규칙',
        name: '알파',
        id: 'alpha',
        section: { name: '규칙', content: '내용' },
      });
      expect(section?.found && !section.conflict && section.revision).toBe(
        document?.found && !document.conflict ? document.revision : undefined,
      );
    });

    it('주소마다 형식 오류·없는 이름·없는 섹션을 그 결과에만 표시한다', async () => {
      await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: 알파\n정의: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.get(['알파', '없음', '알파:없음', 'a:b:c']);

      expect(result).toMatchObject({
        success: true,
        results: [
          { found: true },
          { diagnostics: [{ code: queryDiagnosticCodes.notFound }] },
          { diagnostics: [{ code: queryDiagnosticCodes.sectionNotFound }] },
          { diagnostics: [{ code: queryDiagnosticCodes.invalidInput }] },
        ],
      });
    });

    it('부분 스캔에서도 형식 오류 주소는 미확인으로 바꾸지 않는다', async () => {
      const target = await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: 알파\n정의: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.get(['알파']);
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
      await session.refresh();

      const result = await session.get(['a:b:c']);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        results: [
          { diagnostics: [{ code: queryDiagnosticCodes.invalidInput }] },
        ],
      });
    });

    it('부분 스캔에서 이전 문서의 없는 섹션은 부재로 확정하지 않는다', async () => {
      const target = await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: 알파\n정의: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.get(['알파']);
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
      await session.refresh();

      const result = await session.get(['알파:없음']);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        results: [{ found: false, confirmation: 'unconfirmed' }],
      });
    });

    it('이름 변경 도구용 ID 조회는 유일한 ID의 경로를 반환하고 없거나 중복된 ID는 경로를 반환하지 않는다', async () => {
      await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: 알파\n정의: 본문\n',
      );
      await file('a.yaml', '_codocs:\n  id: same\n  name: 하나\n정의: 본문\n');
      await file('b.yaml', '_codocs:\n  id: same\n  name: 둘\n정의: 본문\n');
      const session = createWorkspaceQuerySession({ cwd: project });

      const found = await session.resolveIdPath('alpha');
      const missing = await session.resolveIdPath('missing');
      const duplicate = await session.resolveIdPath('same');

      expect(found).toMatchObject({
        success: true,
        path: path.join('.codocs', 'alpha.yaml'),
      });
      expect(missing).toEqual({ success: true, scanStatus: 'complete' });
      expect(duplicate).toEqual({ success: true, scanStatus: 'complete' });
    });

    it('ID 문자열로 상세 조회하면 이름 주소가 아니므로 not_found다', async () => {
      await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: 알파\n정의: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.get(['alpha']);

      expect(result).toMatchObject({
        success: true,
        results: [{ found: false }],
      });
    });

    it('문서 하나가 있는 프로젝트를 목록 조회하면 한 항목과 완료 상태를 반환한다', async () => {
      const raw =
        "_codocs:\r\n  id: alpha\r\n  name: 알파\r\ndefinition: '본문'\r\n";
      await file('alpha.yaml', raw);
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        items: [{ id: 'alpha', name: '알파', sections: ['definition'] }],
      });
    });

    it('CRLF 문서를 상세 조회하면 원본 UTF-8 바이트의 revision을 반환한다', async () => {
      const raw =
        "_codocs:\r\n  id: alpha\r\n  name: 알파\r\ndefinition: '본문'\r\n";
      await file('alpha.yaml', raw);
      const session = createWorkspaceQuerySession({ cwd: project });
      const addresses = ['알파'];

      const result = await session.get(addresses);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        results: [
          {
            address: addresses[0],
            found: true,
            revision: createHash('sha256').update(raw, 'utf8').digest('hex'),
          },
        ],
      });
    });

    it.each([1, 10, 20])(
      '%i개 이름 주소를 상세 조회하면 실제 파일의 모든 결과를 요청 순서로 반환한다',
      async (size) => {
        const ids = Array.from(
          { length: size },
          (_, index) => `doc-${String(index).padStart(2, '0')}`,
        );
        await Promise.all(
          ids.map((id) =>
            file(
              `${id}.yaml`,
              `_codocs:\n  id: ${id}\n  name: ${id}\ndefinition: ${id} 본문\n`,
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
          expect(result.results.map((item) => item.address)).toEqual(
            requestedIds,
          );
      },
    );

    it('21개 고유 주소를 상세 조회하면 일부 결과 없이 전체 요청 입력 오류를 반환한다', async () => {
      const ids = Array.from(
        { length: 21 },
        (_, index) => `doc-${String(index).padStart(2, '0')}`,
      );
      await Promise.all(
        ids.map((id) =>
          file(
            `${id}.yaml`,
            `_codocs:\n  id: ${id}\n  name: ${id}\ndefinition: ${id} 본문\n`,
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

    it('실제 파일의 이름 참조를 상세 조회하면 직접 참조와 역참조 문서 이름을 반환한다', async () => {
      await file(
        'source.yaml',
        "_codocs:\n  id: source\n  name: 출발\ndefinition: '[[대상]]'\n",
      );
      await file(
        'target.yaml',
        '_codocs:\n  id: target\n  name: 대상\ndefinition: 대상 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.get(['출발', '대상']);

      expect(result).toMatchObject({
        success: true,
        results: [
          { address: '출발', found: true, references: ['대상'] },
          { address: '대상', found: true, referencedBy: ['출발'] },
        ],
      });
    });
  });

  it('오류 문서의 원문과 byte revision을 함께 조회하고 별도 프로세스에서도 같은 revision을 계산한다', /** 실제 파일의 잘못된 UTF-8을 재인코딩하지 않는다. */ async () => {
    const raw =
      '_codocs:\n  id: broken\n  name: 오류 문서\ndefinition: 설명\nvalue: .nan\n# �\n';
    const bytes = Buffer.concat([
      Buffer.from(raw.slice(0, -2), 'utf8'),
      Buffer.from([0x80, 0x0a]),
    ]);
    const target = path.join(project, '.codocs', 'broken.yaml');
    await writeFile(target, bytes);
    const session = createWorkspaceQuerySession({ cwd: project });
    const get = await session.get(['오류 문서']);
    const revision = createHash('sha256').update(bytes).digest('hex');
    expect(get).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [{ address: '오류 문서', found: true, rawYaml: raw, revision }],
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
    it('문서 경로의 확인이 실패하면 이전 본문과 revision을 미확인 상태로 반환한다', async () => {
      const raw =
        "_codocs:\n  id: alpha\n  name: 알파\ndefinition: '이전 본문'\n";
      const target = await file('alpha.yaml', raw);
      const session = createWorkspaceQuerySession({ cwd: project });
      const initial = await session.get(['알파']);
      if (
        !initial.success ||
        !initial.results[0]?.found ||
        initial.results[0].conflict
      )
        throw new Error('초기 문서 조회 실패');
      const revision = initial.results[0].revision;
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });

      await session.refresh();
      const result = await session.get(['알파']);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        results: [
          {
            address: '알파',
            found: true,
            confirmation: 'unconfirmed',
            revision,
            document: { definition: '이전 본문' },
          },
        ],
      });
    });

    it('부분 스캔에서 색인 밖 이름을 조회하면 부재로 확정하지 않는다', async () => {
      const target = await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.get(['alpha']);
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });

      await session.refresh();
      const result = await session.get(['outside']);

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        results: [
          { address: 'outside', found: false, confirmation: 'unconfirmed' },
        ],
      });
      if (result.success)
        expect(result.results[0]?.diagnostics).not.toContainEqual(
          expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
        );
    });

    it('부분 스캔에서 목록을 조회하면 이전 항목을 포함해 반환한다', async () => {
      const target = await file(
        'alpha.yaml',
        '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
      );
      await file(
        'beta.yaml',
        '_codocs:\n  id: beta\n  name: beta\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.list();
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });

      await session.refresh();
      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        items: [{ name: 'alpha' }, { name: 'beta' }],
      });
    });
  });

  it('failed는 이전 Catalog를 응답에 노출하지 않고 확인된 원인으로 실패한다', /** 미지원 .codocs 정션으로 failed 전환을 만든다. */ async () => {
    await file(
      'alpha.yaml',
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
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

  describe('parent 기반 목록', () => {
    /** 개발 아래에 문서가 있고 성능·순환·형식 오류 문서가 따로 있는 프로젝트를 만든다. */
    async function writeTreeProject(): Promise<void> {
      await file(
        'dev.yaml',
        '_codocs:\n  id: dev\n  name: 개발\n개요: 설명\n규칙: 내용\n',
      );
      await file(
        'api.yaml',
        '_codocs:\n  id: api\n  name: API\n  parent:\n    - 개발\n정의: 본문\n',
      );
      await file(
        'orphan.yaml',
        '_codocs:\n  id: orphan\n  name: 고아\n  parent:\n    - 성능\n정의: 본문\n',
      );
    }

    it('parent를 생략하면 최상위 문서와 unreachable을 페이지 정보 없이 반환한다', async () => {
      await writeTreeProject();
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        items: [
          {
            id: 'dev',
            name: '개발',
            sections: ['개요', '규칙'],
            childCount: 1,
            conflict: false,
          },
        ],
        unreachable: [{ id: 'orphan', name: '고아', hasErrors: true }],
      });
      for (const key of ['totalCount', 'returnedCount', 'nextCursor'])
        expect(result).not.toHaveProperty(key);
    });

    it('parent를 주면 그 이름의 직속 자식만 반환하고 unreachable은 담지 않는다', async () => {
      await writeTreeProject();
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list({ parent: '개발' });

      expect(result).toMatchObject({
        success: true,
        items: [{ id: 'api', childCount: 0 }],
      });
      expect(result).not.toHaveProperty('unreachable');
    });

    it('자식이 없는 문서를 parent로 주면 빈 items로 성공한다', async () => {
      await writeTreeProject();
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list({ parent: 'API' });

      expect(result).toMatchObject({ success: true, items: [] });
    });

    it('없는 이름을 parent로 주면 not_found로 실패한다', async () => {
      await writeTreeProject();
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list({ parent: '없음' });

      expect(result).toMatchObject({
        success: false,
        scanStatus: 'complete',
        error: { code: queryDiagnosticCodes.notFound },
      });
      expect(result).not.toHaveProperty('items');
    });

    it.each([
      { label: 'cursor', input: { cursor: 'x' } },
      { label: '제거된 필터', input: { kind: 'policy' } },
      { label: '문자열이 아닌 parent', input: { parent: 1 } },
    ])('$label 입력을 전달하면 입력 오류를 반환한다', async ({ input }) => {
      await writeTreeProject();
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list(
        input as Parameters<typeof session.list>[0],
      );

      expect(result).toMatchObject({
        success: false,
        error: { code: queryDiagnosticCodes.invalidInput },
      });
    });

    it('이름이나 ID가 같은 문서는 문서마다 conflict 항목과 모든 경로를 반환한다', async () => {
      await file('a.yaml', '_codocs:\n  id: same\n  name: 하나\n개요: 본문\n');
      await file('b.yaml', '_codocs:\n  id: same\n  name: 둘\n개요: 본문\n');
      const session = createWorkspaceQuerySession({ cwd: project });

      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        items: [
          { name: '둘', conflict: true },
          { name: '하나', conflict: true },
        ],
      });
      if (result.success)
        expect(
          result.items.map((item) => item.conflict && item.paths.length),
        ).toEqual([2, 2]);
    });

    it('다시 조회해도 문서가 바뀌지 않으면 같은 목록을 반환한다', async () => {
      await writeTreeProject();
      const session = createWorkspaceQuerySession({ cwd: project });

      const first = await session.list();
      await session.refresh();
      const second = await session.list();

      expect(second).toEqual(first);
    });
  });

  describe('부분 스캔과 감시 실패의 parent 기반 목록', () => {
    /** 개발 문서와 고아 문서를 만든 뒤 첫 문서의 확인을 실패시켜 partial 상태로 만든다. */
    async function partialSession(): Promise<WorkspaceQuerySession> {
      const target = await file(
        'dev.yaml',
        '_codocs:\n  id: dev\n  name: 개발\n개요: 설명\n',
      );
      await file(
        'orphan.yaml',
        '_codocs:\n  id: orphan\n  name: 고아\n  parent:\n    - 성능\n정의: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.list();
      ioFailures.set(target, { operations: ['lstat'], code: 'EACCES' });
      await session.refresh();
      return session;
    }

    it('부분 스캔에서 없는 parent는 not_found로 확정하지 않고 미확인 진단을 반환한다', async () => {
      const session = await partialSession();

      const result = await session.list({ parent: '없음' });

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        items: [],
        diagnostics: [{ code: catalogDiagnosticCodes.unconfirmedReference }],
      });
    });

    it('부분 스캔에서 이전 항목은 미확인으로 표시하고 unreachable도 미확인으로 표시한다', async () => {
      const session = await partialSession();

      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        items: [{ id: 'dev', confirmation: 'unconfirmed' }],
        unreachable: [
          {
            id: 'orphan',
            confirmation: 'unconfirmed',
            diagnostics: [
              { code: catalogDiagnosticCodes.unconfirmedReference },
            ],
          },
        ],
      });
    });

    it('감시 실패에서 없는 parent는 마지막 완료 snapshot의 미확인 결과로 반환한다', async () => {
      await file('dev.yaml', '_codocs:\n  id: dev\n  name: 개발\n개요: 설명\n');
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
        const result = await session.list({ parent: '없음' });

        expect(result).toMatchObject({ success: true, scanStatus: 'partial' });
        expect(result).not.toHaveProperty('error');
      } finally {
        spy.mockRestore();
        await session.close();
      }
    });
  });
});

describe('경로와 catalog 버전 기반 문서 조회', () => {
  it('현재 ID가 누락된 문서를 경로로 조회하면 내용과 진단을 유지한다', async () => {
    const documentPath = await file(
      'missing-id.yaml',
      '_codocs:\n  name: 이전 이름\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();

    const result = await session.getByPaths(
      [path.relative(project, documentPath)],
      session.catalogVersion,
    );

    expect(result).toMatchObject({
      success: true,
      catalogVersion: session.catalogVersion,
      results: [
        {
          path: path.relative(project, documentPath),
          found: true,
          document: { _codocs: { name: '이전 이름' }, definition: '본문' },
          diagnostics: [
            {
              code: 'missing_required_field',
              path: path.relative(project, documentPath),
              fieldPath: ['_codocs', 'id'],
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
      "_codocs:\n  id: source\n  name: 출발\ndefinition: '[[대상]]'\n",
    );
    await file(
      'target.yaml',
      '_codocs:\n  id: target\n  name: 대상\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();

    const result = await session.getByPaths(
      ['.codocs/source.yaml', '.codocs/target.yaml'],
      session.catalogVersion,
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
      '_codocs:\n  id: stable\n  name: stable\ndefinition: 이전 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();
    const first = { catalogVersion: session.catalogVersion };
    await file(
      'stable.yaml',
      '_codocs:\n  id: stable\n  name: stable\ndefinition: 새 본문\n',
    );
    await vi.waitFor(
      async () => {
        await session.list();
        expect(session.catalogVersion).toBeGreaterThan(first.catalogVersion);
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
      '_codocs:\n  id: alpha\n  name: alpha\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();
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
      '_codocs:\r\n  id: Invalid_Id\r\n  name: 오류 문서\r\ndefinition: 😀본문\r\n';
    await file('하위 폴더/오류 문서.yaml', raw);
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();

    const result = await session.getByPaths(
      [path.join('.codocs', '하위 폴더', '오류 문서.yaml')],
      session.catalogVersion,
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
              fieldPath: ['_codocs', 'id'],
              range: {
                start: { line: 1, character: 6 },
                end: { line: 1, character: 16 },
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
      '_codocs:\n  id: target\n  name: 대상\ndefinition: disk\nstatus: deprecated\n',
    );
    await file(
      'source.yaml',
      '_codocs:\n  id: source\n  name: 출처\ndefinition: 저장된 본문\n',
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
    expect(result.diagnostics.map((item) => item.code)).not.toContain(
      'deprecated_reference',
    );
    expect(result.targets[0]).toMatchObject({
      source: {
        uri: pathToFileURL(path.join(project, '.codocs/target.yaml')).href,
      },
    });
    expect(await session.get(['출처'])).toMatchObject({
      results: [{ document: { definition: '저장된 본문' } }],
    });
  });

  it('최초 탐색 중 새 버전 요청이 오면 이전 문서 결과를 적용하지 않는다', async () => {
    await file(
      'target.yaml',
      '_codocs:\n  id: target\n  name: 대상\ndefinition: disk\n',
    );
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
        '_codocs:\n  id: target\n  name: 대상\ndefinition: 이전\n',
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
        '_codocs:\n  id: target\n  name: 대상\ndefinition: 최신\n',
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

  it('이름 참조로 명시 선택한 후보를 이동 후에도 원래 참조 근거로 확인한다', async () => {
    const original = await file(
      'target.yaml',
      '_codocs:\n  id: target\n  name: 대상\ndefinition: 내용\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
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
      raw: '_codocs:\n  id: other\n  name: 대상\ndefinition: 다른 문서\n',
    },
    {
      label: '미관측 내용 변경',
      raw: '_codocs:\n  id: target\n  name: 대상\ndefinition: 변경\n',
    },
  ])(
    '$label이 표시 후 발생하면 오래된 파일을 열 후보를 반환하지 않는다',
    async ({ raw }) => {
      const original = await file(
        'target.yaml',
        '_codocs:\n  id: target\n  name: 대상\ndefinition: 내용\n',
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
    await file(
      'target.yaml',
      '_codocs:\n  id: target\n  name: 대상\ndefinition: 내용\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    await session.refresh();
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    await file(
      'target.yaml',
      '_codocs:\n  id: other\n  name: 대상\ndefinition: 내용\n',
    );
    await session.refresh();
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it('참조가 live 출처에서 삭제되면 기존 선택을 무효화한다', async () => {
    await file(
      'target.yaml',
      '_codocs:\n  id: target\n  name: 대상\ndefinition: 내용\n',
    );
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
    await file(
      'target.yaml',
      '_codocs:\n  id: target\n  name: 대상\ndefinition: 내용\n',
    );
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

describe('문서 이름과 섹션 참조의 조회와 검증', () => {
  /** 환불 문서와 섹션 참조를 쓴 결제 문서를 만든다. */
  async function writeRefundProject(): Promise<void> {
    await file(
      'refund.yaml',
      '_codocs:\n  id: refund\n  name: 환불\n환불정책: 정책\n',
    );
    await file(
      'payment.yaml',
      '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불정책]] [[환불:없는섹션]]"\n',
    );
  }

  it('validate는 섹션이 없는 참조를 section_reference_not_found 오류로 반환한다', async () => {
    await writeRefundProject();
    const session = createWorkspaceQuerySession({ cwd: project });

    const result = await session.validate();

    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: queryDiagnosticCodes.sectionReferenceNotFound,
        severity: diagnosticSeverities.error,
        path: path.join('.codocs', 'payment.yaml'),
      }),
    ]);
  });

  it('get은 섹션 진단을 보이고 references와 referencedBy는 문서 이름 목록으로 유지한다', async () => {
    await writeRefundProject();
    const session = createWorkspaceQuerySession({ cwd: project });

    const result = await session.get(['결제', '환불']);

    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    expect(result.results[0]).toMatchObject({
      found: true,
      references: ['환불'],
      referencedBy: [],
      diagnostics: [{ code: queryDiagnosticCodes.sectionReferenceNotFound }],
    });
    expect(result.results[1]).toMatchObject({
      found: true,
      references: [],
      referencedBy: ['결제'],
    });
  });
});
