import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codeCollectionStatuses } from '../code-reference/index.js';
import { calculateRevision } from '../revision/index.js';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from './index.js';

const targetText =
  '_codocs:\n  id: target\n  name: 대상\ndefinition: 본문\n업무: 값\n내용: 값\n';
const otherText =
  '_codocs:\n  id: other\n  name: 다른 문서\ndefinition: 본문\n';
let root: string;
const sessions: WorkspaceQuerySession[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-query-code-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(root));
  await mkdir(path.join(root, '.codocs'));
  await writeFile(path.join(root, '.codocs', 'target.yaml'), targetText);
  await writeFile(path.join(root, '.codocs', 'other.yaml'), otherText);
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** 같은 프로젝트를 선택한 새 세션을 만들고 정리 대상으로 등록한다. */
function newSession(): WorkspaceQuerySession {
  const session = createWorkspaceQuerySession({ cwd: root });
  sessions.push(session);
  return session;
}

describe('WorkspaceQuerySession.validate: 코드 참조 진단', () => {
  it('경로를 생략하면 전체 코드의 확정 오류를 원본 경로·위치·error로 돌려준다', async () => {
    await writeFile(
      path.join(root, 'source.ts'),
      [
        '// @codocs [[대상:없는 섹션]]',
        '// @codocs [[없는 문서]]',
        '// @codocs [[닫히지 않음',
      ].join('\n'),
    );
    const result = await newSession().validate();
    expect(result).toMatchObject({
      success: true,
      codeScanStatus: codeCollectionStatuses.complete,
      diagnosticsComplete: true,
    });
    if (!result.success) return;
    const code = result.diagnostics.filter((item) => item.path === 'source.ts');
    expect(code).toMatchObject([
      {
        code: 'codocs.codeReference.missing_section',
        severity: 'error',
        range: { start: { line: 0, character: 3 } },
      },
      {
        code: 'codocs.codeReference.missing',
        severity: 'error',
        range: { start: { line: 1, character: 3 } },
      },
      {
        code: 'codocs.codeReference.invalid',
        severity: 'error',
        range: { start: { line: 2, character: 3 } },
      },
    ]);
  });

  it('같은 이름의 문서가 둘이면 모호한 코드 표기를 error로 돌려준다', async () => {
    await writeFile(
      path.join(root, '.codocs', 'dup.yaml'),
      '_codocs:\n  id: dup\n  name: 대상\ndefinition: 중복\n',
    );
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[대상]]');
    const result = await newSession().validate();
    if (!result.success) throw new Error('검증이 성공해야 합니다.');
    expect(
      result.diagnostics.filter((item) => item.path === 'source.ts'),
    ).toMatchObject([
      { code: 'codocs.codeReference.ambiguous', severity: 'error' },
    ]);
  });

  it('YAML 하나를 지정하면 그 문서를 후보로 갖는 코드 오류만 포함하고 무관한 코드와 문서 오류는 제외한다', async () => {
    await writeFile(
      path.join(root, '.codocs', 'broken.yaml'),
      '_codocs:\n  id: broken\n  name: [\n',
    );
    await writeFile(
      path.join(root, 'related.ts'),
      '// @codocs [[대상:없는 섹션]]',
    );
    await writeFile(
      path.join(root, 'unrelated.ts'),
      '// @codocs [[없는 문서]]',
    );
    const result = await newSession().validate('.codocs/target.yaml');
    if (!result.success) throw new Error('검증이 성공해야 합니다.');
    expect(result.path).toBe(path.join('.codocs', 'target.yaml'));
    expect(result.diagnostics.map((item) => item.path)).toEqual(['related.ts']);
  });

  it('코드 파일 경로는 .codocs YAML이 아니므로 거절한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[없는 문서]]');
    const result = await newSession().validate('source.ts');
    expect(result).toMatchObject({
      success: false,
      error: { code: 'invalid_path' },
    });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '읽지 못한 코드 파일이 있으면 확인한 진단은 돌려주되 완전한 진단으로 표시하지 않는다',
    async () => {
      await writeFile(path.join(root, 'source.ts'), '// @codocs [[없는 문서]]');
      const locked = path.join(root, 'locked.ts');
      await writeFile(locked, '// @codocs [[대상]]');
      await chmod(locked, 0o000);
      try {
        const result = await newSession().validate();
        expect(result).toMatchObject({
          success: true,
          scanStatus: 'complete',
          codeScanStatus: codeCollectionStatuses.incomplete,
          diagnosticsComplete: false,
          codeFailures: [{ path: 'locked.ts' }],
        });
        if (!result.success) return;
        expect(result.diagnostics.map((item) => item.path)).toContain(
          'source.ts',
        );
      } finally {
        await chmod(locked, 0o600);
      }
    },
  );

  it('첫 검증 뒤 코드 파일을 고치면 다음 검증이 감시 지연 없이 최신 원문을 반영한다', async () => {
    const source = path.join(root, 'source.ts');
    await writeFile(source, '// @codocs [[없는 문서]]');
    const session = newSession();
    const first = await session.validate();
    await writeFile(source, '// 참조 없음 그리고 길이가 다른 원문');
    const second = await session.validate();
    if (!first.success || !second.success)
      throw new Error('검증이 성공해야 합니다.');
    expect(first.diagnostics.some((item) => item.path === 'source.ts')).toBe(
      true,
    );
    expect(second.diagnostics.some((item) => item.path === 'source.ts')).toBe(
      false,
    );
  });
});

describe('WorkspaceQuerySession.validate: 코드 관측과 문서 게시의 일관성', () => {
  it('코드 수집을 기다리는 사이 문서 색인이 새로 게시되면 이전 진단을 완료 결과로 주지 않는다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[없는 문서]]');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const session = createWorkspaceQuerySession({ cwd: root }, undefined, {
      codeReference: {
        beforeRead: async () => {
          entered();
          await gate;
        },
      },
    });
    sessions.push(session);
    const validating = session.validate();
    await reading;
    // 코드 최초 수집이 멈춘 동기화 지점에서 문서 한 개를 저장해 새 색인을 게시한다.
    const saved = await session.write({
      mode: 'update',
      id: 'other',
      revision: calculateRevision(Buffer.from(otherText)),
      set: { definition: '새 본문' },
    });
    expect(saved).toMatchObject({ success: true, indexUpdated: true });
    release();
    expect(await validating).toMatchObject({
      success: false,
      error: { code: 'index_not_ready' },
    });
  });
});

describe('WorkspaceQuerySession.refresh: 코드 포함 재구성', () => {
  it('세션의 첫 refresh부터 코드 표기를 수집해 진단 수와 일치하는 집계를 돌려준다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[없는 문서]]');
    const result = await newSession().refresh();
    if (!result.success) throw new Error('refresh가 성공해야 합니다.');
    expect(result).toMatchObject({
      scanStatus: 'complete',
      codeScanStatus: codeCollectionStatuses.complete,
      countsComplete: true,
      fileCount: 2,
      itemCount: 2,
      errorCount: 1,
      warningCount: 0,
    });
    expect(result.diagnostics).toMatchObject([
      { code: 'codocs.codeReference.missing', path: 'source.ts' },
    ]);
  });

  it('코드 수집이 완료되지 않았으면 집계를 완료로 표시하지 않는다', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const locked = path.join(root, 'locked.ts');
    await writeFile(locked, '// @codocs [[대상]]');
    await chmod(locked, 0o000);
    try {
      const result = await newSession().refresh();
      expect(result).toMatchObject({
        success: true,
        scanStatus: 'complete',
        codeScanStatus: codeCollectionStatuses.incomplete,
        countsComplete: false,
      });
    } finally {
      await chmod(locked, 0o600);
    }
  });

  it('변경·삭제된 코드 파일은 다음 refresh에서 처음부터 다시 수집해 반영한다', async () => {
    const first = path.join(root, 'first.ts');
    const second = path.join(root, 'second.ts');
    await writeFile(first, '// @codocs [[없는 문서]]');
    await writeFile(second, '// @codocs [[대상:없는 섹션]]');
    const session = newSession();
    const before = await session.refresh();
    await writeFile(first, '// 참조 없음 길이가 다른 원문');
    await unlink(second);
    const after = await session.refresh();
    if (!before.success || !after.success)
      throw new Error('refresh가 성공해야 합니다.');
    expect(before.errorCount).toBe(2);
    expect(after).toMatchObject({
      errorCount: 0,
      countsComplete: true,
      diagnostics: [],
    });
  });

  it('동시에 요청한 refresh는 같은 완료 결과를 공유한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[없는 문서]]');
    const session = newSession();
    const [left, right] = await Promise.all([
      session.refresh(),
      session.refresh(),
    ]);
    expect(left).toBe(right);
  });
});

describe('WorkspaceQuerySession.write: 코드 참조 보호와 전체 교체', () => {
  const replacement = {
    _codocs: { id: 'target', name: '대상' },
    definition: '본문',
    업무: '값',
  };

  it('전체 교체로 코드가 참조하지 않는 섹션을 삭제하면 저장하고 색인에 게시한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[대상:업무]]');
    const session = newSession();
    const result = await session.write({
      mode: 'replace',
      id: 'target',
      revision: calculateRevision(Buffer.from(targetText)),
      document: replacement,
    });
    expect(result).toMatchObject({
      success: true,
      saved: true,
      indexUpdated: true,
    });
    if (!result.success) return;
    const fetched = await session.get(['대상']);
    expect(fetched).toMatchObject({
      success: true,
      results: [{ found: true, revision: result.revision }],
    });
    expect(
      await readFile(path.join(root, '.codocs', 'target.yaml'), 'utf8'),
    ).not.toContain('내용');
  });

  it('코드가 참조하는 섹션을 삭제하면 거절하고 원문 바이트를 보존한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[대상:내용]]');
    const result = await newSession().write({
      mode: 'replace',
      id: 'target',
      revision: calculateRevision(Buffer.from(targetText)),
      document: replacement,
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      error: { code: 'reference_broken', path: 'source.ts' },
    });
    expect(
      await readFile(path.join(root, '.codocs', 'target.yaml'), 'utf8'),
    ).toBe(targetText);
  });
});

describe('WorkspaceQuerySession.previewRename: 이미 만든 코드 색인의 저장 원문', () => {
  it('refresh로 색인을 만든 뒤 새로 저장한 코드 파일도 감시 신호를 기다리지 않고 영향 파일에 포함한다', async () => {
    const session = newSession();
    await session.refresh();
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[대상]]');
    const preview = await session.previewRename({
      targetPath: path.join('.codocs', 'target.yaml'),
      newName: '새 대상',
    });
    expect(preview).toMatchObject({ success: true });
    if (!preview.success) return;
    expect(Object.keys(preview.revisions)).toContain('source.ts');
  });
});
