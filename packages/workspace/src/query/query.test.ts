/* eslint-disable codocs/korean-jsdoc -- Vitest의 인라인 콜백은 선언 함수가 아니다. */
import {
  diagnosticSeverities,
  documentKinds,
  documentStatuses,
  queryDiagnosticCodes,
  scanStatuses,
} from '@codocs/core';
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
  workspaceQueryDiagnosticMessages,
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

describe('workspace 조회 세션', /** scan과 조회 응답의 연결을 검증한다. */ () => {
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
    it('문서 경로가 깨진 링크로 바뀌면 이전 본문과 revision을 미확인 상태로 반환한다', async () => {
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
      await rm(target);
      await symlink('missing-target.yaml', target);

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

    it('부분 스캔에서 색인 밖 ID를 조회하면 부재로 확정하지 않는다', async () => {
      const target = await file(
        'alpha.yaml',
        'id: alpha\nname: alpha\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
      );
      const session = createWorkspaceQuerySession({ cwd: project });
      await session.get(['alpha']);
      await rm(target);
      await symlink('missing-target.yaml', target);

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
      await rm(target);
      await symlink('missing-target.yaml', target);

      await session.refresh();
      const result = await session.list();

      expect(result).toMatchObject({
        success: true,
        scanStatus: 'partial',
        totalCount: 2,
      });
    });
  });

  it('failed는 이전 Catalog를 응답에 노출하지 않고 확인된 원인으로 실패한다', /** 깨진 .codocs로 실제 failed 전환을 만든다. */ async () => {
    await file(
      'alpha.yaml',
      'id: alpha\nname: alpha\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n',
    );
    const session = createWorkspaceQuerySession({ cwd: project });
    expect(await session.get(['alpha'])).toMatchObject({ success: true });
    const codocs = path.join(project, '.codocs');
    const saved = path.join(project, 'saved-codocs');
    await rename(codocs, saved);
    await symlink('missing-codocs', codocs);

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

  describe('목록 표시 변경에 따른 cursor 유효성', () => {
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

      await session.refresh();
      const result = await session.list({ cursor: first.nextCursor });

      expect(result).toMatchObject({
        success: false,
        error: { code: workspaceQueryDiagnosticCodes.cursorExpired },
      });
    });

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

      await session.refresh();
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

        await session.refresh();
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

      await session.refresh();
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

        await session.refresh();
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
    });
  });
});
