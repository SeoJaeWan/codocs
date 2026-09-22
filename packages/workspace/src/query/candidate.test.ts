import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as workspacePaths from '../paths/index.js';
import * as loader from '../loader/index.js';
import { scanStatuses } from '@codocs/core';
import { workspaceTargetKinds } from '../paths/domain-values.js';
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
  it.each(['취소', '선택 해제', '출처 닫기', '세션 종료'])(
    '%s이 파일 확인 중 발생하면 결과를 폐기한다',
    async (change) => {
      await session.refresh();
      const token = session.captureCandidate(
        { reference: { name: '대상' }, sourcePath: '.codocs/source.yaml' },
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
      if (change === '취소') controller.abort();
      else if (change === '세션 종료') await session.close();
      else if (change === '출처 닫기')
        session.closeDocument('.codocs/source.yaml');
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

  it('같은 이름이 여러 경로에 있어도 명시적으로 선택한 확인 후보를 연다', async () => {
    await writeFile(
      path.join(project, '.codocs/other.yaml'),
      'id: other\nname: 대상\ndomains: [다른업무]\ndefinition: 내용\n',
    );
    await session.refresh();
    const token = session.captureCandidate(
      {
        reference: { name: '대상' },
        sourcePath: '.codocs/source.yaml',
        explicit: true,
      },
      '.codocs/target.yaml',
      session.catalogVersion,
    );
    expect(await session.confirmCandidate(token!)).toMatchObject({
      result: { path: '.codocs/target.yaml' },
    });
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

  it('ID 오류 문서의 파일 객체가 유지되면 내용 변경 뒤 이전 선택도 최신 내용을 연다', async () => {
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
    await writeFile(
      path.join(project, '.codocs/target.yaml'),
      'id: BAD_ID\nname: 대상\ndefinition: 바뀐 내용\n',
    );
    await session.refresh();
    expect(await session.confirmCandidate(token)).toMatchObject({
      result: { document: { id: 'BAD_ID', definition: '바뀐 내용' } },
    });
  });
});

describe('완료 관측 교체와 명시 후보의 확인', () => {
  it('파일 확인 중 시작된 갱신이 완료될 때까지 기다려 최신 관측으로 재확인한다', async () => {
    await session.refresh();
    const token = session.captureCandidate(
      { text: 'target' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const resolvePath = workspacePaths.resolveWorkspacePath;
    vi.spyOn(workspacePaths, 'resolveWorkspacePath').mockImplementationOnce(
      async (...args) => {
        const result = await resolvePath(...args);
        entered();
        await gate;
        return result;
      },
    );
    const pending = session.confirmCandidate(token);
    await started;
    const load = loader.loadWorkspace;
    let scanEntered!: () => void;
    const scanning = new Promise<void>((resolve) => {
      scanEntered = resolve;
    });
    let finishScan!: () => void;
    const scanGate = new Promise<void>((resolve) => {
      finishScan = resolve;
    });
    vi.spyOn(loader, 'loadWorkspace').mockImplementationOnce(
      async (...args) => {
        const scan = await load(...args);
        scanEntered();
        await scanGate;
        return scan;
      },
    );
    const refresh = session.refresh();
    await scanning;
    resume();
    finishScan();
    await refresh;
    expect(await pending).toMatchObject({
      catalogVersion: session.catalogVersion,
      result: { path: '.codocs/target.yaml' },
    });
  });

  it('클릭 대기가 만료되어도 공유 갱신은 취소하지 않고 나중에 완료한다', async () => {
    await session.refresh();
    const token = session.captureCandidate(
      { text: 'target' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    const version = session.catalogVersion;
    const load = loader.loadWorkspace;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(loader, 'loadWorkspace').mockImplementationOnce(
      async (...args) => {
        const scan = await load(...args);
        entered();
        await gate;
        return scan;
      },
    );
    const refresh = session.refresh();
    await started;
    vi.useFakeTimers();
    try {
      const pending = session.confirmCandidate(token);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await pending).toBeUndefined();
      expect(session.catalogVersion).toBe(version);
    } finally {
      vi.useRealTimers();
      finish();
      await refresh;
    }
    expect(session.catalogVersion).toBeGreaterThan(version);
  });

  it('미확인으로 보존된 후보는 전체 partial의 확인 후보와 달리 선택하지 않는다', async () => {
    await session.refresh();
    const load = loader.loadWorkspace;
    vi.spyOn(loader, 'loadWorkspace').mockImplementation(async (...args) => {
      const scan = await load(...args);
      if (scan.status === scanStatuses.failed) return scan;
      return {
        ...scan,
        status: scanStatuses.partial,
        documents: [],
        observations: [],
        failures: [
          {
            kind: workspaceTargetKinds.file,
            path: '.codocs/target.yaml',
            diagnostics: [],
          },
        ],
      };
    });
    await session.refresh();
    expect(
      session.captureCandidate(
        {
          reference: { name: '대상' },
          sourcePath: '.codocs/source.yaml',
          explicit: true,
        },
        '.codocs/target.yaml',
        session.catalogVersion,
      ),
    ).toBeUndefined();
  });
  it.each([false, true])(
    '파일 확인 중 관측이 교체되면 삭제 여부 %s에 맞게 최신 후보만 반환한다',
    async (removed) => {
      await session.refresh();
      const token = session.captureCandidate(
        { text: 'target' },
        '.codocs/target.yaml',
        session.catalogVersion,
      )!;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const original = workspacePaths.resolveWorkspacePath;
      vi.spyOn(workspacePaths, 'resolveWorkspacePath').mockImplementationOnce(
        async (...args) => {
          const result = await original(...args);
          entered();
          await gate;
          return result;
        },
      );
      const pending = session.confirmCandidate(token);
      await started;
      if (removed) await rm(path.join(project, '.codocs/target.yaml'));
      await session.refresh();
      resume();
      const result = await pending;
      if (removed) expect(result).toBeUndefined();
      else
        expect(result).toMatchObject({
          catalogVersion: session.catalogVersion,
          result: { path: '.codocs/target.yaml' },
        });
    },
  );

  it('부분 관측에서도 개별 확인 후보는 명시 선택으로 열고 단일 연결로 추측하지 않는다', async () => {
    const original = loader.loadWorkspace;
    vi.spyOn(loader, 'loadWorkspace').mockImplementation(async (...args) => {
      const scan = await original(...args);
      if (scan.status === scanStatuses.failed) return scan;
      return {
        ...scan,
        status: scanStatuses.partial,
        failures: [
          {
            kind: workspaceTargetKinds.file,
            path: '.codocs/unread.yaml',
            diagnostics: [],
          },
        ],
      };
    });
    await session.refresh();
    const origin = {
      reference: { name: '대상' },
      sourcePath: '.codocs/source.yaml',
      explicit: true,
    };
    const token = session.captureCandidate(
      origin,
      '.codocs/target.yaml',
      session.catalogVersion,
    );
    expect(await session.confirmCandidate(token!)).toMatchObject({
      result: { path: '.codocs/target.yaml' },
    });
    expect(
      session.captureCandidate(
        { ...origin, explicit: false },
        '.codocs/target.yaml',
        session.catalogVersion,
      ),
    ).toBeUndefined();
  });

  it('같은 메타데이터로 옛 경로를 재사용해도 파일 객체가 바뀌면 이전 선택을 거부한다', async () => {
    await session.refresh();
    const token = session.captureCandidate(
      { text: 'target' },
      '.codocs/target.yaml',
      session.catalogVersion,
    )!;
    await rm(path.join(project, '.codocs/target.yaml'));
    await writeFile(
      path.join(project, '.codocs/target.yaml'),
      'id: target\nname: 대상\ndomains: [업무]\ndefinition: 다른 문서\n',
    );
    await session.refresh();
    expect(await session.confirmCandidate(token)).toBeUndefined();
  });

  it.each([false, true])(
    '코드 직접 매칭 밖의 역방향 %s 관계를 확인하고 관계가 사라지면 거부한다',
    async (reverse) => {
      await writeFile(
        path.join(project, '.codocs/related.yaml'),
        `id: related\nname: 관계\ndefinition: "${reverse ? '[[대상]]' : '내용'}"\n`,
      );
      if (!reverse)
        await writeFile(
          path.join(project, '.codocs/target.yaml'),
          'id: target\nname: 대상\ndomains: [업무]\ndefinition: "[[관계]]"\n',
        );
      await session.refresh();
      const token = session.captureCandidate(
        {
          text: 'target',
          relationship: { path: '.codocs/target.yaml', reverse },
        },
        '.codocs/related.yaml',
        session.catalogVersion,
      )!;
      expect(await session.confirmCandidate(token)).toMatchObject({
        result: { path: '.codocs/related.yaml' },
      });
      await writeFile(
        path.join(
          project,
          reverse ? '.codocs/related.yaml' : '.codocs/target.yaml',
        ),
        reverse
          ? 'id: related\nname: 관계\ndefinition: 관계 삭제\n'
          : 'id: target\nname: 대상\ndomains: [업무]\ndefinition: 관계 삭제\n',
      );
      await session.refresh();
      expect(await session.confirmCandidate(token)).toBeUndefined();
    },
  );
});
