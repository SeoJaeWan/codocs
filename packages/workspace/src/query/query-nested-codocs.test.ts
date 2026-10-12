import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogDiagnosticCodes,
  documentPathExample,
  queryDiagnosticCodes,
} from '@codocs/core';
import { ioFailures } from '../test-support/file-system.js';
import { workspaceDiagnosticCodes } from '../diagnostics/index.js';
import { failingRename } from '../test-support/storage-faults.js';
import { calculateRevision } from '../revision/index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
  type WorkspaceQuerySessionOptions,
} from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});

const execute = promisify(execFile);
const rootText =
  '_codocs:\n  id: root-doc\n  name: 루트 문서\ndefinition: 루트\n';
let project: string;
const sessions: WorkspaceQuerySession[] = [];

/** 프로젝트 상대 경로에 파일을 만든다. 상위 폴더도 만든다. */
async function file(relative: string, text: string): Promise<void> {
  const target = path.join(project, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}

/** 문서 하나의 원문을 만든다. */
function documentText(id: string, name: string): string {
  return `_codocs:\n  id: ${id}\n  name: ${name}\ndefinition: 본문\n`;
}

/** 같은 프로젝트를 선택한 새 세션을 만들고 정리 대상으로 등록한다. */
function newSession(
  options: WorkspaceQuerySessionOptions = {},
): WorkspaceQuerySession {
  const session = createWorkspaceQuerySession(
    { cwd: project },
    undefined,
    options,
  );
  sessions.push(session);
  return session;
}

/** 경로가 디스크에 있는지 확인한다. */
async function exists(relative: string): Promise<boolean> {
  try {
    await lstat(path.join(project, ...relative.split('/')));
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), 'codocs-nested-'));
  await execute('git', ['init', project]);
  await file('.gitignore', '.workbench/\n');
  await file('.codocs/root.yaml', rootText);
});

afterEach(async () => {
  ioFailures.clear();
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  vi.unstubAllEnvs();
  await rmWithRetry(project, { recursive: true, force: true });
});

describe('WorkspaceQuerySession: 하위 .codocs 탐색과 조회', () => {
  it('인정된 하위 .codocs의 문서를 이름으로 조회한다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const result = await newSession().get(['코어']);

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [
        {
          found: true,
          source: { path: 'packages/core/.codocs/a.yaml' },
        },
      ],
    });
  });

  it('인정된 하위 .codocs의 문서를 최상위 목록에 담는다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const result = await newSession().list();

    expect(result).toMatchObject({ success: true, scanStatus: 'complete' });
    if (!result.success) return;
    expect(result.items.map((item) => item.id).sort()).toEqual([
      'core-a',
      'root-doc',
    ]);
  });

  it('하위 .codocs 문서 경로로 검증하면 그 파일의 진단을 돌려준다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const result = await newSession().validate('packages/core/.codocs/a.yaml');

    expect(result).toMatchObject({
      success: true,
      path: 'packages/core/.codocs/a.yaml',
      diagnostics: [],
    });
  });

  it('.gitignore가 제외한 위치에 이미 있는 문서는 색인하지 않는다', async () => {
    await file('.workbench/x/.codocs/a.yaml', documentText('hidden', '숨김'));
    const result = await newSession().get(['숨김']);

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [{ found: false }],
    });
  });

  it('.gitignore가 제외한 위치의 문서 경로로 검증하면 제외된 위치를 알리는 invalid_path로 거부한다', async () => {
    await file('.workbench/x/.codocs/a.yaml', documentText('hidden', '숨김'));
    const result = await newSession().validate('.workbench/x/.codocs/a.yaml');

    expect(result).toMatchObject({
      success: false,
      error: { code: queryDiagnosticCodes.invalidPath },
    });
    if (result.success) return;
    expect(result.error.message).toContain('.workbench/x/.codocs');
  });

  it('서로 다른 .codocs에 같은 이름의 문서가 있으면 이름 충돌 진단을 낸다', async () => {
    await file(
      'packages/core/.codocs/a.yaml',
      documentText('core-a', '루트 문서'),
    );
    const result = await newSession().validate();

    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    expect(
      result.diagnostics
        .filter((item) => item.code === catalogDiagnosticCodes.duplicateName)
        .map((item) => item.path)
        .sort(),
    ).toEqual(['.codocs/root.yaml', 'packages/core/.codocs/a.yaml'].sort());
  });

  it('.gitignore가 제외한 폴더의 .codocs는 Git이 강제로 추적해도 색인하지 않는다', async () => {
    await file('.gitignore', 'build/\n');
    await file('build/.codocs/a.yaml', documentText('built', '빌드'));
    await execute('git', ['-C', project, 'add', '-f', 'build/.codocs/a.yaml']);
    const result = await newSession().get(['빌드']);

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [{ found: false }],
    });
  });

  it('git 실행 파일을 찾을 수 없어도 하위 .codocs를 인정하고 탐색이 complete다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    vi.stubEnv('PATH', '');
    const result = await newSession().get(['코어']);

    expect(result).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [{ found: true }],
    });
  });
});

describe('WorkspaceQuerySession.write: 하위 .codocs 저장', () => {
  it('없는 폴더의 하위 .codocs에 create하면 폴더를 모두 만들고 저장한 문서를 색인에 반영한다', async () => {
    const session = newSession();
    const saved = await session.write({
      mode: 'create',
      path: 'packages/new/.codocs/a.yaml',
      document: {
        _codocs: { id: 'new-a', name: '새 문서' },
        definition: '본문',
      },
    });

    expect(saved).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    expect(await session.get(['새 문서'])).toMatchObject({
      results: [{ found: true }],
    });
  });

  it('changes의 하위 .codocs create가 반영 중 실패하면 이번 요청이 만든 폴더를 모두 지운다', async () => {
    const session = newSession({
      storage: { operations: { rename: failingRename(() => true) } },
    });
    const result = await session.write({
      changes: [
        {
          mode: 'create',
          path: 'packages/new/.codocs/a.yaml',
          document: {
            _codocs: { id: 'new-a', name: '새 문서' },
            definition: '본문',
          },
        },
        {
          mode: 'update',
          id: 'root-doc',
          revision: calculateRevision(Buffer.from(rootText)),
          set: { definition: '바뀜' },
        },
      ],
    });

    expect(result).toMatchObject({ success: false, saved: false });
    expect(await exists('packages')).toBe(false);
  });

  it.each([
    [
      '단일 create',
      {
        mode: 'create',
        path: '.workbench/x/.codocs/a.yaml',
        document: { _codocs: { id: 'hidden', name: '숨김' }, definition: '가' },
      },
    ],
    [
      'changes의 create',
      {
        changes: [
          {
            mode: 'create',
            path: '.workbench/x/.codocs/a.yaml',
            document: {
              _codocs: { id: 'hidden', name: '숨김' },
              definition: '가',
            },
          },
        ],
      },
    ],
  ])(
    '.gitignore가 제외한 위치로 %s하면 원인과 예시를 담아 invalid_workspace_path로 거부하고 폴더를 만들지 않는다',
    async (_label, request) => {
      const result = await newSession().write(request);

      expect(result).toMatchObject({
        success: false,
        saved: false,
        error: { code: workspaceDiagnosticCodes.invalidWorkspacePath },
      });
      if (result.success) return;
      expect(result.error.message).toContain('.workbench/x/.codocs');
      expect(result.error.message).toContain(documentPathExample);
      expect(await exists('.workbench')).toBe(false);
    },
  );

  it('git 실행 파일을 찾을 수 없어도 루트와 .gitignore가 제외하지 않은 하위 .codocs에 create·update가 저장된다', async () => {
    vi.stubEnv('PATH', '');
    const session = newSession();
    const created = await session.write({
      mode: 'create',
      path: 'packages/core/.codocs/a.yaml',
      document: {
        _codocs: { id: 'core-a', name: '코어' },
        definition: '본문',
      },
    });
    const updated = await session.write({
      mode: 'update',
      id: 'root-doc',
      revision: calculateRevision(Buffer.from(rootText)),
      set: { definition: '바뀜' },
    });

    expect(created).toMatchObject({ success: true, saved: true });
    expect(updated).toMatchObject({ success: true, saved: true });
    expect(await exists('packages/core/.codocs/a.yaml')).toBe(true);
  });

  it('루트 .codocsignore를 읽지 못하면 루트 문서 저장은 성공하고 하위 위치 create는 거부한다', async () => {
    await file('.codocsignore', 'examples/\n');
    ioFailures.set(path.join(project, '.codocsignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const session = newSession();
    const rejected = await session.write({
      mode: 'create',
      path: 'packages/core/.codocs/a.yaml',
      document: {
        _codocs: { id: 'core-a', name: '코어' },
        definition: '본문',
      },
    });
    const saved = await session.write({
      mode: 'update',
      id: 'root-doc',
      revision: calculateRevision(Buffer.from(rootText)),
      set: { definition: '바뀜' },
    });

    expect(rejected).toMatchObject({
      success: false,
      saved: false,
      error: { code: workspaceDiagnosticCodes.invalidWorkspacePath },
    });
    expect(await exists('packages')).toBe(false);
    expect(saved).toMatchObject({ success: true, saved: true });
  });

  it('하위 .codocs의 문서를 루트 .codocs로 move하면 새 경로로 조회되고 원래 .codocs는 남는다', async () => {
    const nested = documentText('core-a', '코어');
    await file('packages/core/.codocs/a.yaml', nested);
    const session = newSession();
    const moved = await session.write({
      mode: 'move',
      id: 'core-a',
      revision: calculateRevision(Buffer.from(nested)),
      path: '.codocs/core-a.yaml',
    });

    expect(moved).toMatchObject({
      success: true,
      source: { path: '.codocs/core-a.yaml' },
      indexUpdated: true,
    });
    expect(await exists('packages/core/.codocs')).toBe(true);
  });
});

describe('WorkspaceQuerySession.setExcludedDirectories: 별도로 열린 하위 폴더의 .codocs 제외', () => {
  it('제외한 하위 폴더의 .codocs는 색인하지 않고 제외하지 않은 하위 폴더의 .codocs는 색인한다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    await file('packages/web/.codocs/b.yaml', documentText('web-b', '웹'));
    await file(
      'packages/core/deep/.codocs/c.yaml',
      documentText('core-c', '깊은'),
    );
    const session = newSession();
    session.setExcludedDirectories(['packages/core']);

    const core = await session.get(['코어']);
    const deep = await session.get(['깊은']);
    const web = await session.get(['웹']);

    expect(core).toMatchObject({ results: [{ found: false }] });
    expect(deep).toMatchObject({ results: [{ found: false }] });
    expect(web).toMatchObject({ results: [{ found: true }] });
  });

  it('제외한 하위 폴더의 .codocs에 create하면 invalid_workspace_path로 거부하고 폴더를 만들지 않는다', async () => {
    const session = newSession();
    session.setExcludedDirectories(['packages/core']);
    const rejected = await session.write({
      mode: 'create',
      path: 'packages/core/.codocs/a.yaml',
      document: {
        _codocs: { id: 'core-a', name: '코어' },
        definition: '본문',
      },
    });

    expect(rejected).toMatchObject({
      success: false,
      saved: false,
      error: { code: workspaceDiagnosticCodes.invalidWorkspacePath },
    });
    expect(await exists('packages')).toBe(false);
  });

  it('제외한 하위 폴더의 .codocs 문서 경로로 검증하면 제외된 위치를 알리는 invalid_path로 거부한다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const session = newSession();
    session.setExcludedDirectories(['packages/core']);
    const result = await session.validate('packages/core/.codocs/a.yaml');

    expect(result).toMatchObject({
      success: false,
      error: { code: queryDiagnosticCodes.invalidPath },
    });
  });

  it('실행 중 하위 폴더를 제외하면 재시작 없이 그 문서를 색인에서 지우고 제외를 풀면 다시 색인한다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const session = newSession();
    expect(await session.get(['코어'])).toMatchObject({
      results: [{ found: true }],
    });

    session.setExcludedDirectories(['packages/core']);
    await vi.waitFor(
      async () =>
        expect(await session.get(['코어'])).toMatchObject({
          scanStatus: 'complete',
          results: [{ found: false }],
        }),
      { timeout: 10_000, interval: 100 },
    );

    session.setExcludedDirectories([]);
    await vi.waitFor(
      async () =>
        expect(await session.get(['코어'])).toMatchObject({
          scanStatus: 'complete',
          results: [{ found: true }],
        }),
      { timeout: 10_000, interval: 100 },
    );
  });
});

describe('WorkspaceQuerySession: 실행 중 하위 .codocs 변경 반영', () => {
  it('실행 중 새 하위 .codocs가 생기면 재시작 없이 그 문서를 색인에 반영한다', async () => {
    const session = newSession();
    await session.list();
    await file('packages/late/.codocs/a.yaml', documentText('late-a', '늦게'));

    await vi.waitFor(
      async () =>
        expect(await session.get(['늦게'])).toMatchObject({
          results: [{ found: true }],
        }),
      { timeout: 10_000, interval: 100 },
    );
  });

  it('실행 중 하위 .codocs가 지워지면 재시작 없이 그 문서를 색인에서 지운다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const session = newSession();
    expect(await session.get(['코어'])).toMatchObject({
      results: [{ found: true }],
    });
    await rmWithRetry(path.join(project, 'packages', 'core', '.codocs'), {
      recursive: true,
      force: true,
    });

    await vi.waitFor(
      async () =>
        expect(await session.get(['코어'])).toMatchObject({
          scanStatus: 'complete',
          results: [{ found: false }],
        }),
      { timeout: 10_000, interval: 100 },
    );
  });

  it('실행 중 .codocsignore가 하위 .codocs 위치를 제외하면 인정 범위를 다시 계산해 그 문서를 색인에서 지운다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const session = newSession();
    expect(await session.get(['코어'])).toMatchObject({
      results: [{ found: true }],
    });
    await file('.codocsignore', 'packages/\n');

    await vi.waitFor(
      async () =>
        expect(await session.get(['코어'])).toMatchObject({
          scanStatus: 'complete',
          results: [{ found: false }],
        }),
      { timeout: 10_000, interval: 100 },
    );
  });

  it('실행 중 하위 .codocs 문서 내용이 바뀌면 바뀐 내용을 색인에 반영한다', async () => {
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어'));
    const session = newSession();
    expect(await session.get(['코어'])).toMatchObject({
      results: [{ found: true }],
    });
    await file('packages/core/.codocs/a.yaml', documentText('core-a', '코어2'));

    await vi.waitFor(
      async () =>
        expect(await session.get(['코어2'])).toMatchObject({
          results: [{ found: true }],
        }),
      { timeout: 10_000, interval: 100 },
    );
  });
});
