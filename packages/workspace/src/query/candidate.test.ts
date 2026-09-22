import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as workspacePaths from '../paths/index.js';
import { WorkspaceQuerySession } from './index.js';

let project: string;
let session: WorkspaceQuerySession;
beforeEach(async () => {
  const parent = path.resolve('.workbench/fixtures');
  await mkdir(parent, { recursive: true });
  project = await mkdtemp(path.join(parent, 'candidate-'));
  await mkdir(path.join(project, '.codocs'));
  await writeFile(
    path.join(project, '.codocs/target.yaml'),
    'id: target\nname: 대상\ndomains: [업무]\ndefinition: 내용\n',
  );
  session = new WorkspaceQuerySession({ cwd: project });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await session.close();
  await rm(project, { recursive: true, force: true });
});

describe('후보 개별 파일 확인의 비동기 경합', () => {
  it.each(['색인 갱신', '취소', '선택 해제'])(
    '%s이 파일 확인 중 발생하면 결과를 폐기한다',
    async (change) => {
      await session.refresh();
      const token = session.captureCandidate(
        { text: 'target' },
        '.codocs/target.yaml',
        session.catalogVersion,
      )!;
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const original = workspacePaths.resolveWorkspacePath;
      const check = vi
        .spyOn(workspacePaths, 'resolveWorkspacePath')
        .mockImplementationOnce(
          /** 파일 확인 도중 상태 변경을 결정적으로 재현한다. */
          async (...args) => {
            const result = await original(...args);
            await gate;
            return result;
          },
        );
      const controller = new AbortController();
      const pending = session.confirmCandidate(token, controller.signal);
      await vi.waitFor(() => expect(check).toHaveBeenCalled());
      if (change === '색인 갱신') await session.refresh();
      else if (change === '취소') controller.abort();
      else session.releaseCandidate(token);
      resume();
      expect(await pending).toBeUndefined();
    },
  );
});

describe('선택 후보 확인의 거부·보존 계약', () => {
  it('선택 당시 ID가 중복이면 선택한 경로가 삭제된 뒤 남은 문서로 이동하지 않는다', async () => {
    await writeFile(
      path.join(project, '.codocs/other.yaml'),
      'id: target\nname: 대상\ndomains: [업무]\ndefinition: 내용\n',
    );
    await session.refresh();
    const token = session.captureCandidate(
      { text: 'target' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    expect(token).toBeTypeOf('string');
    await rm(path.join(project, '.codocs/target.yaml'));
    await session.refresh();
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it('버전이 오래된 선택 요청이면 근거 토큰을 만들지 않는다', async () => {
    await session.refresh();
    expect(
      session.captureCandidate(
        { text: 'target' },
        '.codocs/target.yaml',
        session.catalogVersion - 1,
      ),
    ).toBeUndefined();
  });

  it('원래 매칭에 없는 경로이면 선택하지 않는다', async () => {
    await session.refresh();
    expect(
      session.captureCandidate(
        { text: 'unrelated' },
        '.codocs/target.yaml',
        session.catalogVersion,
      ),
    ).toBeUndefined();
  });

  it('같은 이름이 여러 경로에 있으면 참조 선택을 만들지 않는다', async () => {
    await writeFile(
      path.join(project, '.codocs/other.yaml'),
      'id: other\nname: 대상\ndomains: [다른업무]\ndefinition: 내용\n',
    );
    await session.refresh();
    expect(
      session.captureCandidate(
        { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
        '.codocs/target.yaml',
        session.catalogVersion,
      ),
    ).toBeUndefined();
  });

  it('선택 뒤 이름 후보가 추가되면 임의의 기존 대상을 다시 선택하지 않는다', async () => {
    await session.refresh();
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    await writeFile(
      path.join(project, '.codocs/other.yaml'),
      'id: other\nname: 대상\ndefinition: 내용\n',
    );
    await session.refresh();
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it('선택 근거의 입력 객체를 바꿔도 원래 매칭을 보존한다', async () => {
    await session.refresh();
    const origin = { text: 'target' };
    const token = session.captureCandidate(
      origin,
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    origin.text = 'unrelated';
    expect(await session.confirmCandidate(token)).toMatchObject({
      result: { path: '.codocs/target.yaml' },
    });
  });

  it('취소한 확인 요청이면 후보를 반환하지 않는다', async () => {
    await session.refresh();
    const token = session.captureCandidate(
      { text: 'target' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    const controller = new AbortController();
    controller.abort();
    expect(
      await session.confirmCandidate(token, controller.signal),
    ).toBeUndefined();
  });

  it('표시 종료로 선택을 해제하면 후보를 반환하지 않는다', async () => {
    await session.refresh();
    const token = session.captureCandidate(
      { text: 'target' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    session.releaseCandidate(token);
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it('출처를 닫으면 참조 선택을 해제한다', async () => {
    await session.refresh();
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    session.closeDocument('.codocs/source.yaml');
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it('ID 오류 문서도 같은 관측에서 이름 연결과 내용·진단을 유지한다', async () => {
    await writeFile(
      path.join(project, '.codocs/target.yaml'),
      'id: BAD_ID\nname: 대상\ndefinition: 내용\n',
    );
    const live = await session.references({
      sourcePath: '.codocs/source.yaml',
      text: 'definition: "[[대상]]"',
      documentVersion: 1,
    });
    expect(live).toMatchObject({
      success: true,
      targets: [{ found: true, document: { id: 'BAD_ID' } }],
    });
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    const confirmed = await session.confirmCandidate(token);
    expect(confirmed?.result).toMatchObject({
      found: true,
      document: { id: 'BAD_ID' },
    });
    expect(confirmed?.result.id).toBeUndefined();
    expect(confirmed?.result.diagnostics).not.toEqual([]);
  });

  it('ID 오류 문서는 관측이 달라지면 동일성을 추측하지 않는다', async () => {
    await writeFile(
      path.join(project, '.codocs/target.yaml'),
      'id: BAD_ID\nname: 대상\ndefinition: 내용\n',
    );
    await session.refresh();
    const token = session.captureCandidate(
      { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    await session.refresh();
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });
});
