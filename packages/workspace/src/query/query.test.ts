import { catalogDiagnosticCodes, queryDiagnosticCodes } from '@codocs/core';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceQuerySession,
  workspaceQueryDiagnosticCodes,
} from './index.js';

let project: string;
const execFileAsync = promisify(execFile);

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
    await rm(project, { recursive: true, force: true });
  },
);

/** 실제 fixture의 발견 파일을 쓴다. */
async function file(name: string, raw: string): Promise<string> {
  const target = path.join(project, '.codocs', name);
  await writeFile(target, raw);
  return target;
}

/** 목록에 필요한 필드를 가진 문서를 만든다. */
function document(id: string, name = id, definition = '본문'): string {
  return `id: ${id}\nname: ${name}\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: '${definition}'\n`;
}

describe('workspace 조회 세션', /** scan과 조회 응답의 연결을 검증한다. */ () => {
  it('원문 UTF-8 byte의 SHA-256 revision과 scanStatus를 list/get에 제공한다', /** 원문 개행을 유지한 revision을 확인한다. */ async () => {
    const raw =
      "id: alpha\r\nname: 알파\r\ndomains: [업무]\r\ndefinition: '본문'\r\n";
    await file('alpha.yaml', raw);
    const session = createWorkspaceQuerySession({ cwd: project });
    const list = await session.list();
    expect(list).toMatchObject({
      success: true,
      scanStatus: 'complete',
      totalCount: 1,
      returnedCount: 1,
      nextCursor: null,
    });
    const get = await session.get(['alpha']);
    expect(get).toMatchObject({
      success: true,
      scanStatus: 'complete',
      results: [
        {
          id: 'alpha',
          found: true,
          revision: createHash('sha256').update(raw, 'utf8').digest('hex'),
        },
      ],
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

  it('partial은 이전 원문과 revision을 unconfirmed로 보존하고 색인 밖 ID를 not_found로 확정하지 않는다', /** 깨진 링크로 실제 partial 전환을 만든다. */ async () => {
    const raw = document('alpha', '알파', '이전 본문');
    const target = await file('alpha.yaml', raw);
    await file('beta.yaml', document('beta', '베타'));
    const session = createWorkspaceQuerySession({ cwd: project });
    const complete = await session.get(['alpha']);
    if (!complete.success) throw new Error('초기 조회 실패');
    const completeResult = complete.results[0];
    if (!completeResult?.found || completeResult.conflict)
      throw new Error('초기 문서 없음');
    const revision = completeResult.revision;
    await rm(target);
    await symlink('missing-target.yaml', target);

    const partial = await session.get(['alpha', 'outside']);
    expect(partial).toMatchObject({ success: true, scanStatus: 'partial' });
    if (!partial.success) throw new Error('partial 조회 실패');
    const alpha = partial.results[0];
    expect(alpha).toMatchObject({
      id: 'alpha',
      found: true,
      confirmation: 'unconfirmed',
      revision,
    });
    if (!alpha?.found || alpha.conflict || !('document' in alpha))
      throw new Error('보존 문서 없음');
    expect(alpha.document).toMatchObject({ definition: '이전 본문' });
    expect(
      alpha.diagnostics.some(
        /** 미확인 최신성 진단을 확인한다. */ (diagnostic) =>
          diagnostic.code === catalogDiagnosticCodes.unconfirmedReference,
      ),
    ).toBe(true);
    expect(partial.results[1]).toMatchObject({
      id: 'outside',
      found: false,
      confirmation: 'unconfirmed',
    });
    expect(partial.results[1]?.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
    );
    expect(await session.list()).toMatchObject({
      success: true,
      scanStatus: 'partial',
      totalCount: 2,
    });
  });

  it('failed는 이전 Catalog를 응답에 노출하지 않고 확인된 원인으로 실패한다', /** 깨진 .codocs로 실제 failed 전환을 만든다. */ async () => {
    await file('alpha.yaml', document('alpha'));
    const session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.get(['alpha'])).toMatchObject({ success: true });
    const codocs = path.join(project, '.codocs');
    const saved = path.join(project, 'saved-codocs');
    await rename(codocs, saved);
    await symlink('missing-codocs', codocs);

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
        document(`doc-${String(index).padStart(2, '0')}`),
      );
    await file(
      'other.yaml',
      document('other').replace('domains: [업무]', 'domains: [기타]'),
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    const first = await session.list({ domain: '업무' });
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
  });

  it('본문만 바뀐 cursor는 유지하고 표시 projection 변경과 조건 불일치는 거부한다', /** 실제 파일 변경 뒤 같은 token을 재사용한다. */ async () => {
    for (let index = 0; index < 51; index++)
      await file(
        `doc-${index}.yaml`,
        document(`doc-${String(index).padStart(2, '0')}`),
      );
    const session = createWorkspaceQuerySession({ cwd: project });
    const first = await session.list({ domain: '업무' });
    if (!first.success || !first.nextCursor)
      throw new Error('다음 cursor 없음');

    await file('doc-50.yaml', document('doc-50', 'doc-50', '새 본문'));
    expect(await session.list({ cursor: first.nextCursor })).toMatchObject({
      success: true,
      returnedCount: 1,
    });
    const mismatch = await session.list({
      cursor: first.nextCursor,
      domain: '기타',
    });
    expect(mismatch).toMatchObject({
      success: false,
      error: { code: queryDiagnosticCodes.invalidInput },
    });

    await file('doc-50.yaml', document('doc-50', '표시 이름 변경'));
    expect(await session.list({ cursor: first.nextCursor })).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });
  });

  it('포함·hasErrors·conflict 변화는 각각 기존 cursor를 만료한다', /** 목록 projection의 모든 판정 값을 실제 파일로 바꾼다. */ async () => {
    for (let index = 0; index < 51; index++)
      await file(
        `doc-${index}.yaml`,
        document(`doc-${String(index).padStart(2, '0')}`),
      );
    const session = createWorkspaceQuerySession({ cwd: project });
    let first = await session.list();
    if (!first.success || !first.nextCursor)
      throw new Error('포함 변화 cursor 없음');
    await file('new.yaml', document('new'));
    expect(await session.list({ cursor: first.nextCursor })).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });

    first = await session.list();
    if (!first.success || !first.nextCursor)
      throw new Error('오류 변화 cursor 없음');
    await file('new.yaml', document('new', 'new', '[[Missing]]'));
    expect(await session.list({ cursor: first.nextCursor })).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });

    first = await session.list();
    if (!first.success || !first.nextCursor)
      throw new Error('충돌 변화 cursor 없음');
    await file('duplicate.yaml', document('new', 'duplicate'));
    expect(await session.list({ cursor: first.nextCursor })).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });
  });

  it('변조·명시 refresh·새 process 비밀키의 cursor를 첫 페이지 대신 거부한다', /** 각 만료 원인이 동일한 안전한 오류로 끝나는지 확인한다. */ async () => {
    for (let index = 0; index < 51; index++)
      await file(
        `doc-${index}.yaml`,
        document(`doc-${String(index).padStart(2, '0')}`),
      );
    const session = createWorkspaceQuerySession({ cwd: project });
    const first = await session.list();
    if (!first.success || !first.nextCursor)
      throw new Error('다음 cursor 없음');
    const cursor = first.nextCursor;
    const [encoded, signature] = cursor.split('.');
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
    expect(
      Buffer.from(alternateSignature, 'base64url').toString('base64url'),
    ).toBe(signature);
    const tampered = `${encoded}.${alternateSignature}`;
    expect(await session.list({ cursor: tampered })).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });
    expect(await session.refresh()).toMatchObject({ success: true });
    expect(await session.list({ cursor })).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });

    vi.resetModules();
    const restarted = await import('./index.js');
    const other = restarted.createWorkspaceQuerySession({ cwd: project });
    expect(await other.list({ cursor })).toMatchObject({
      success: false,
      error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
    });
  });
});
