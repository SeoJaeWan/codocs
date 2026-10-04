import { catalogConfirmations, scanStatuses } from '@codocs/core';
import {
  codeCollectionStatuses,
  workspaceLifecycleStates,
  type WorkspaceCodeReferenceSnapshot as CodeSnapshot,
  type WorkspacePathGetResponse,
} from '@codocs/workspace';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LanguageServerSession,
  type WorkspaceSessionBoundary,
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

function pathDetails(
  source: string,
  expectedCatalogVersion: number,
): WorkspacePathGetResponse {
  const documentPath = `.codocs/${source}.yaml`;
  return {
    success: true,
    scanStatus: scanStatuses.complete,
    catalogVersion: expectedCatalogVersion,
    results: [
      {
        path: documentPath,
        found: true,
        source: {
          path: documentPath,
          uri: pathToFileURL(path.resolve(documentPath)).href,
        },
        confirmation: catalogConfirmations.confirmed,
        id: source,
        document: {
          id: source,
          name: source,
          definition: `${source} definition`,
          domains: ['test'],
        },
        diagnostics: [],
      },
    ],
  };
}

function fakeBoundary(
  getByPaths: WorkspaceSessionBoundary['getByPaths'] = (
    _paths,
    expectedCatalogVersion,
  ) => Promise.resolve(pathDetails('unused', expectedCatalogVersion)),
): WorkspaceSessionBoundary {
  return {
    readiness: { state: workspaceLifecycleStates.ready, ready: true },
    catalogVersion: 1,
    getByPaths,
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

describe('LanguageServerSession: 코드 식별자 Hover 없음', () => {
  it('마커가 아닌 일반 코드 식별자에 Hover하면 문서 조회 없이 null을 반환한다', async () => {
    const root = await temporaryRoot();
    const getByPaths = vi.fn(
      (_paths: readonly string[], expectedCatalogVersion: number) =>
        Promise.resolve(pathDetails('zone', expectedCatalogVersion)),
    );
    const session = new LanguageServerSession(() => fakeBoundary(getByPaths));
    await initialize(session, [root]);
    const uri = openDocument(session, root, 'const returnZone = 1;');

    const hover = await session.hoverDocument({
      textDocument: { uri },
      position: { line: 0, character: 8 },
    });

    expect(hover).toBeNull();
    expect(getByPaths).not.toHaveBeenCalled();
  });
});

describe('LanguageServerSession: 같은 코드 관측의 재알림 억제', () => {
  it('동일한 workspace 코드 관측을 반복 게시하면 변경 알림을 한 번만 보낸다', async () => {
    const root = await temporaryRoot();
    let publish: ((snapshot: CodeSnapshot) => void) | undefined;
    const session = new LanguageServerSession(() => ({
      ...fakeBoundary(),
      onDidChangeCodeReferences: (
        listener: (snapshot: CodeSnapshot) => void,
      ) => {
        publish = listener;
        return () => undefined;
      },
    }));
    await initialize(session, [root]);
    const changed = vi.fn();
    session.onDidChange(changed);
    const snapshot: CodeSnapshot = {
      status: codeCollectionStatuses.complete,
      hasCompletedCollection: true,
      codeGeneration: 3,
      documentGeneration: 1,
      occurrences: [],
      confirmedCount: 0,
      failures: [],
    };
    publish!(snapshot);
    publish!({ ...snapshot });
    publish!({ ...snapshot });
    expect(changed).toHaveBeenCalledTimes(1);
    publish!({ ...snapshot, codeGeneration: 4 });
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
