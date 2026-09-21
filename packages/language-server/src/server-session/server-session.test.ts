import {
  catalogConfirmations,
  diagnosticSeverities,
  matcherComparisonKinds,
  matcherEvidenceKinds,
  scanStatuses,
  type CodeMatchEvidence,
} from '@codocs/core';
import {
  workspaceLifecycleStates,
  workspaceDiagnosticCodes,
  type WorkspaceMatchResult,
} from '@codocs/workspace';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  documentMatchErrorCodes,
  LanguageServerSession,
  type WorkspaceSessionBoundary,
  type WorkspaceSessionFactory,
} from './index.js';

const temporaryRoots: string[] = [];
const runningSessions: LanguageServerSession[] = [];

afterEach(async () => {
  await Promise.all(
    runningSessions.splice(0).map((session) => session.close()),
  );
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const fixtureParent = path.resolve('.workbench/fixtures');
  await mkdir(fixtureParent, { recursive: true });
  const root = await mkdtemp(path.join(fixtureParent, 'language-server-'));
  temporaryRoots.push(root);
  return root;
}

async function initialize(
  session: LanguageServerSession,
  roots: readonly string[],
): Promise<void> {
  runningSessions.push(session);
  await session.initialize({
    processId: null,
    rootUri: null,
    capabilities: {},
    workspaceFolders: roots.map((root) => ({
      uri: pathToFileURL(root).href,
      name: path.basename(root),
    })),
  });
}

async function writeDocument(
  root: string,
  id: string,
  name = id,
): Promise<void> {
  const directory = path.join(root, '.codocs');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${id}.yaml`),
    `id: ${id}\nname: ${name}\ndefinition: test definition\ndomains:\n  - test\n`,
    'utf8',
  );
}

function openDocument(
  session: LanguageServerSession,
  root: string,
  text: string,
  version = 1,
): string {
  const uri = pathToFileURL(path.join(root, 'source.unknown')).href;
  session.openDocument({
    textDocument: {
      uri,
      languageId: 'unknown-language',
      version,
      text,
    },
  });
  return uri;
}

function evidence(source: string): CodeMatchEvidence {
  return {
    kind: matcherEvidenceKinds.current,
    comparison: matcherComparisonKinds.exact,
    token: '',
    range: { start: 0, end: 0 },
    sourceId: source,
    consecutiveTokens: 1,
  };
}

function matchSuccess(source: string): WorkspaceMatchResult {
  const found = evidence(source);
  return {
    success: true,
    scanStatus: scanStatuses.complete,
    catalogVersion: 1,
    refreshing: false,
    candidates: [
      {
        id: source,
        documentId: source,
        path: `.codocs/${source}.yaml`,
        domains: ['test'],
        confirmation: catalogConfirmations.confirmed,
        evidence: [found],
        diagnostics: [],
        errors: [],
      },
    ],
    evidence: [found],
    diagnostics: [],
    partial: false,
    status: scanStatuses.complete,
    failures: [],
  };
}

function fakeBoundary(
  match: (text: string) => Promise<WorkspaceMatchResult>,
): WorkspaceSessionBoundary {
  return {
    readiness: { state: workspaceLifecycleStates.ready, ready: true },
    match,
    refresh: () =>
      Promise.resolve({
        success: true,
        scanStatus: scanStatuses.complete,
        fileCount: 0,
        itemCount: 0,
        errorCount: 0,
        warningCount: 0,
        countsComplete: true,
        diagnostics: [],
      }),
    close: () => Promise.resolve(),
  };
}

describe('LanguageServerSession: 작업 공간별 현재 문서 매칭', () => {
  it('서로 다른 두 루트는 각각의 조회 세션으로만 매칭한다', async () => {
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    const seenRoots: string[] = [];
    const factory: WorkspaceSessionFactory = (root) => {
      seenRoots.push(root);
      const id = root === firstRoot ? 'first-root' : 'second-root';
      return fakeBoundary(() => Promise.resolve(matchSuccess(id)));
    };
    const session = new LanguageServerSession(factory);
    await initialize(session, [firstRoot, secondRoot]);
    const firstUri = openDocument(session, firstRoot, 'anything');
    const secondUri = openDocument(session, secondRoot, 'anything');

    const first = await session.matchDocument({
      textDocument: { uri: firstUri },
      version: 1,
    });
    const second = await session.matchDocument({
      textDocument: { uri: secondUri },
      version: 1,
    });

    expect(session.workspaceCount).toBe(2);
    expect(seenRoots.sort()).toEqual([firstRoot, secondRoot].sort());
    expect(first.success && first.candidates[0]?.id).toBe('first-root');
    expect(second.success && second.candidates[0]?.id).toBe('second-root');
  });

  it('저장하지 않은 문법 오류 원문을 실제 workspace catalog와 매칭한다', async () => {
    const root = await temporaryRoot();
    await writeDocument(root, 'return-zone', 'Return Zone');
    const session = new LanguageServerSession();
    await initialize(session, [root]);
    const uri = openDocument(session, root, 'class Broken { returnZone(');

    const result = await session.matchDocument({
      textDocument: { uri },
      version: 1,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'return-zone',
    ]);
    expect(result.evidence[0]).toMatchObject({
      token: 'returnZone',
      offsetRange: { start: 15, end: 25 },
      range: {
        start: { line: 0, character: 15 },
        end: { line: 0, character: 25 },
      },
    });
  });

  it('이모지와 CRLF 뒤의 실제 매칭 범위를 UTF-16 LSP 좌표로 반환한다', async () => {
    const root = await temporaryRoot();
    await writeDocument(root, 'return-zone');
    const session = new LanguageServerSession();
    await initialize(session, [root]);
    const uri = openDocument(session, root, '😀x\r\nab\nreturnZone');

    const result = await session.matchDocument({
      textDocument: { uri },
      version: 1,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.evidence[0]).toMatchObject({
      offsetRange: { start: 8, end: 18 },
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 10 },
      },
    });
  });

  it('요청 버전이 현재 열린 문서보다 오래되면 workspace를 호출하지 않는다', async () => {
    const root = await temporaryRoot();
    const match = vi.fn(() => Promise.resolve(matchSuccess('current')));
    const session = new LanguageServerSession(() => fakeBoundary(match));
    await initialize(session, [root]);
    const uri = openDocument(session, root, 'current', 4);

    const result = await session.matchDocument({
      textDocument: { uri },
      version: 3,
    });

    expect(result).toMatchObject({
      success: false,
      code: documentMatchErrorCodes.staleDocumentVersion,
      requestedVersion: 3,
      currentVersion: 4,
    });
    expect(match).not.toHaveBeenCalled();
  });

  it('매칭 도중 새 전체 원문 버전이 오면 이전 비동기 결과를 폐기한다', async () => {
    const root = await temporaryRoot();
    let finish: ((result: WorkspaceMatchResult) => void) | undefined;
    const delayed = new Promise<WorkspaceMatchResult>((resolve) => {
      finish = resolve;
    });
    const session = new LanguageServerSession(() =>
      fakeBoundary(() => delayed),
    );
    await initialize(session, [root]);
    const uri = openDocument(session, root, 'oldText', 1);

    const pending = session.matchDocument({
      textDocument: { uri },
      version: 1,
    });
    session.changeDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: 'newText' }],
    });
    finish?.(matchSuccess('old-text'));
    const result = await pending;

    expect(result).toMatchObject({
      success: false,
      code: documentMatchErrorCodes.staleDocumentVersion,
      requestedVersion: 1,
      currentVersion: 2,
    });
  });

  it('없는 .codocs를 만들지 않고 기다린 뒤 생성된 catalog를 관측한다', async () => {
    const root = await temporaryRoot();
    const session = new LanguageServerSession();
    await initialize(session, [root]);
    const uri = openDocument(session, root, 'lateCatalog');

    const before = await session.matchDocument({ textDocument: { uri } });
    expect(before.success && before.candidates).toEqual([]);
    await expect(access(path.join(root, '.codocs'))).rejects.toThrow();

    await writeDocument(root, 'late-catalog');
    await vi.waitFor(
      async () => {
        const result = await session.matchDocument({ textDocument: { uri } });
        expect(result.success && result.candidates[0]?.id).toBe('late-catalog');
      },
      { timeout: 5_000, interval: 100 },
    );
  });

  it('기존 .codocs 문서가 바뀌면 다음 매칭에 새 catalog 버전을 사용한다', async () => {
    const root = await temporaryRoot();
    await writeDocument(root, 'alpha-zone');
    const session = new LanguageServerSession();
    await initialize(session, [root]);
    const uri = openDocument(session, root, 'alphaZone');
    const first = await session.matchDocument({ textDocument: { uri } });
    expect(first.success && first.candidates[0]?.id).toBe('alpha-zone');
    if (!first.success) return;

    await rm(path.join(root, '.codocs', 'alpha-zone.yaml'));
    await writeDocument(root, 'beta-zone');
    session.changeDocument({
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: 'betaZone' }],
    });

    await vi.waitFor(
      async () => {
        const changed = await session.matchDocument({
          textDocument: { uri },
          version: 2,
        });
        expect(changed.success && changed.candidates[0]?.id).toBe('beta-zone');
        if (!changed.success) return;
        expect(changed.catalogVersion).toBeGreaterThan(first.catalogVersion);
      },
      { timeout: 5_000, interval: 100 },
    );
  });

  it('workspace 조회 실패를 빈 성공으로 바꾸지 않고 상태와 진단을 보존한다', async () => {
    const root = await temporaryRoot();
    const boundary = fakeBoundary(() =>
      Promise.resolve({
        success: false,
        scanStatus: scanStatuses.failed,
        error: {
          code: workspaceDiagnosticCodes.readFailed,
          severity: diagnosticSeverities.error,
          message: 'watcher failed',
        },
      }),
    );
    Object.defineProperty(boundary, 'readiness', {
      value: {
        state: workspaceLifecycleStates.failed,
        ready: false,
        cause: 'watcher failed',
      },
    });
    const session = new LanguageServerSession(() => boundary);
    await initialize(session, [root]);
    const uri = openDocument(session, root, 'anything');

    const result = await session.matchDocument({ textDocument: { uri } });

    expect(result).toMatchObject({
      success: false,
      code: documentMatchErrorCodes.workspaceQueryFailed,
      scanStatus: scanStatuses.failed,
      workspaceState: {
        state: workspaceLifecycleStates.failed,
        cause: 'watcher failed',
      },
      error: {
        code: workspaceDiagnosticCodes.readFailed,
        message: 'watcher failed',
      },
    });
  });
});
