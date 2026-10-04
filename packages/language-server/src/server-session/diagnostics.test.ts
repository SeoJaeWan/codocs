import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogDiagnosticCodes } from '@codocs/core';
import { LanguageServerSession } from './index.js';
import { WorkspaceQuerySession } from '@codocs/workspace';

const io = vi.hoisted(() => ({ blocked: '', code: 'EACCES' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    /** 실제 접근 경계에서만 OS별 실패를 주입한다. 파싱·색인·진단은 실행한다. */
    access: async (...args: Parameters<typeof actual.access>) => {
      if (String(args[0]) === io.blocked)
        throw Object.assign(new Error(io.code), { code: io.code });
      return actual.access(...args);
    },
  };
});

let root: string;
let session: LanguageServerSession;
let uri: string;
const saved =
  'id: target\nname: 출처\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n';

beforeEach(async () => {
  io.blocked = '';
  await mkdir('.workbench/fixtures', { recursive: true });
  root = await mkdtemp(path.resolve('.workbench/fixtures/diagnostics-'));
  await mkdir(path.join(root, '.codocs'));
  await writeFile(path.join(root, '.codocs/source.yaml'), saved);
  await writeFile(
    path.join(root, '.codocs/target.yaml'),
    'id: target\nname: 대상\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
  );
  uri = pathToFileURL(path.join(root, '.codocs/source.yaml')).href;
  session = new LanguageServerSession();
  await session.initialize({
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: {},
  });
  await session.refreshWorkspaces();
});
afterEach(async () => {
  io.blocked = '';
  await session.close();
  await rm(root, { recursive: true, force: true });
});

describe('전체 지식 문서의 저장·편집 진단 통합', () => {
  it.each(['색인 갱신', '세션 교체', '종료'])(
    '%s 뒤 완료된 이전 저장 진단 관측은 게시하지 않는다',
    async (change) => {
      await session.close();
      const queries: WorkspaceQuerySession[] = [];
      session = new LanguageServerSession((cwd) => {
        const query = new WorkspaceQuerySession({ cwd });
        queries.push(query);
        return query;
      });
      const folder = { uri: pathToFileURL(root).href, name: 'fixture' };
      await session.initialize({
        processId: null,
        rootUri: folder.uri,
        capabilities: {},
      });
      await session.refreshWorkspaces();
      const query = queries[0]!;
      const read = query.diagnostics.bind(query);
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(query, 'diagnostics').mockImplementationOnce(async () => {
        const snapshot = await read();
        entered();
        await gate;
        return snapshot;
      });
      const pending = session.diagnostics();
      await started;
      if (change === '색인 갱신') await session.refreshWorkspaces();
      if (change === '세션 교체')
        await session.changeWorkspaceFolders([folder], [folder]);
      if (change === '종료') await session.close();
      release();
      expect(await pending).toBeUndefined();
    },
  );
  it.each(['EACCES', 'EPERM'])(
    '%s로 일부 파일을 읽지 못하면 삭제로 단정하지 않고 과거 결과를 상태로 남긴다',
    async (code) => {
      await session.diagnostics();
      io.blocked = path.join(root, '.codocs/source.yaml');
      io.code = code;
      await session.refreshWorkspaces();
      const result = await session.diagnostics();
      expect(
        result?.documents.find((document) => document.uri === uri)?.diagnostics,
      ).toEqual([]);
      const failure = result?.statuses[0]?.failures.find(
        (item) => item.uri === uri,
      );
      expect(failure?.reason).toContain(code);
      expect(failure?.previousDiagnostics).toContainEqual(
        expect.stringContaining('ID'),
      );
    },
  );

  it('전체 재검사 실패 뒤 편집하면 이전 밑줄을 제거하고 과거 관측으로만 안내한다', async () => {
    session.openDocument({
      textDocument: { uri, languageId: 'yaml', version: 1, text: saved },
    });
    await session.diagnostics();
    io.blocked = path.join(root, '.codocs');
    await session.refreshWorkspaces();
    const unchanged = await session.diagnostics();
    expect(
      unchanged?.documents.find((document) => document.uri === uri)
        ?.diagnostics,
    ).toContainEqual(
      expect.objectContaining({ code: catalogDiagnosticCodes.duplicateId }),
    );
    session.changeDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [
        { text: '# 앞줄 추가\n' + saved.replace('id: target', 'id: unique') },
      ],
    });
    const edited = await session.diagnostics();
    expect(
      edited?.documents.find((document) => document.uri === uri),
    ).toMatchObject({ version: 2, diagnostics: [] });
    const failure = edited?.statuses[0]?.failures.find(
      (item) => item.uri === uri,
    );
    expect(failure?.previousDiagnostics).toContainEqual(
      expect.stringContaining('ID'),
    );
  });

  it('읽기 권한이 복구되면 실패 안내를 해제하고 최신 빈 진단을 게시한다', async () => {
    await session.diagnostics();
    io.blocked = path.join(root, '.codocs');
    await session.refreshWorkspaces();
    await session.diagnostics();
    await writeFile(
      path.join(root, '.codocs/source.yaml'),
      saved.replace('id: target', 'id: unique'),
    );
    io.blocked = '';
    await session.refreshWorkspaces();
    const result = await session.diagnostics();
    expect(result?.statuses[0]?.failures).toEqual([]);
    expect(
      result?.documents.find((document) => document.uri === uri)?.diagnostics,
    ).toEqual([]);
  });
  it('파일을 열지 않아도 전체 저장 색인의 중복 위치를 반환한다', async () => {
    const result = await session.diagnostics();
    expect(result?.documents).toHaveLength(2);
    expect(
      result?.documents.find((document) => document.uri === uri)?.diagnostics,
    ).toContainEqual(
      expect.objectContaining({
        code: catalogDiagnosticCodes.duplicateId,
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 10 },
        },
      }),
    );
  });

  it('열린 문서의 중복 해소 편집은 저장 진단보다 우선하며 닫으면 저장 진단으로 돌아간다', async () => {
    session.openDocument({
      textDocument: {
        uri,
        languageId: 'yaml',
        version: 1,
        text: saved.replace('id: target', 'id: unique'),
      },
    });
    expect(
      (await session.diagnostics())?.documents.find(
        (document) => document.uri === uri,
      ),
    ).toMatchObject({ version: 1, diagnostics: [] });
    session.closeDocument(uri);
    const restored = (await session.diagnostics())?.documents.find(
      (document) => document.uri === uri,
    );
    expect(restored).not.toHaveProperty('version');
    expect(restored?.diagnostics).toContainEqual(
      expect.objectContaining({ code: catalogDiagnosticCodes.duplicateId }),
    );
  });

  it('Windows의 인코딩된 드라이브 URI로 열어도 저장 문서를 중복 게시하지 않는다', async () => {
    const encoded = uri.replace(/^file:\/\/\/([A-Za-z]):/u, 'file:///$1%3A');
    session.openDocument({
      textDocument: {
        uri: encoded,
        languageId: 'yaml',
        version: 1,
        text: saved.replace('id: target', 'id: unique'),
      },
    });
    const result = await session.diagnostics();
    expect(result?.documents).toHaveLength(2);
    expect(
      result?.documents.find((document) => document.uri === uri),
    ).toMatchObject({ version: 1, diagnostics: [] });
  });

  it('삭제를 완전한 관측으로 확인하면 저장 문서를 진단 목록에서 제거한다', async () => {
    await session.diagnostics();
    await rm(path.join(root, '.codocs/source.yaml'));
    await session.refreshWorkspaces();
    expect(
      (await session.diagnostics())?.documents.some(
        (document) => document.uri === uri,
      ),
    ).toBe(false);
  });

  it('저장 파일을 이동하면 옛 경로 대신 새 경로에 중복 진단을 제공한다', async () => {
    await rename(
      path.join(root, '.codocs/source.yaml'),
      path.join(root, '.codocs/moved.yaml'),
    );
    await session.refreshWorkspaces();
    const result = await session.diagnostics();
    expect(result?.documents.some((document) => document.uri === uri)).toBe(
      false,
    );
    expect(
      result?.documents.find((document) => document.uri.endsWith('/moved.yaml'))
        ?.diagnostics,
    ).toContainEqual(
      expect.objectContaining({ code: catalogDiagnosticCodes.duplicateId }),
    );
  });

  it('다른 미저장 ID를 운영 색인에 합치지 않는다', async () => {
    session.openDocument({
      textDocument: {
        uri,
        languageId: 'yaml',
        version: 1,
        text: saved.replace('id: target', 'id: unsaved'),
      },
    });
    const other = pathToFileURL(path.join(root, '.codocs/new.yaml')).href;
    session.openDocument({
      textDocument: {
        uri: other,
        languageId: 'yaml',
        version: 1,
        text: 'id: unsaved\nname: 새 문서\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
      },
    });
    const result = await session.diagnostics();
    expect(
      result?.documents.find((document) => document.uri === other)?.diagnostics,
    ).toEqual([]);
  });

  it('현재 문서를 편집한 동안 늦게 완료된 진단은 게시 후보를 반환하지 않는다', async () => {
    session.openDocument({
      textDocument: { uri, languageId: 'yaml', version: 1, text: saved },
    });
    const pending = session.diagnostics();
    session.changeDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: saved.replace('id: target', 'id: unique') }],
    });
    expect(await pending).toBeUndefined();
    await vi.waitFor(async () =>
      expect(
        (await session.diagnostics())?.documents.find(
          (document) => document.uri === uri,
        ),
      ).toMatchObject({ version: 2, diagnostics: [] }),
    );
  });
});
