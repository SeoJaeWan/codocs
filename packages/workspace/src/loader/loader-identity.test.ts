import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from '../index.js';
import { workspaceTargetKinds } from '../paths/domain-values.js';
import { resolveWorkspacePath } from '../paths/index.js';

vi.mock(
  '../paths/index.js',
  /** 실제 IO 경로 해석을 유지하며 판정 정보만 보조 검사에서 변경한다. */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<typeof import('../paths/index.js')>();
    return {
      ...original,
      resolveWorkspacePath: vi.fn(original.resolveWorkspacePath),
    };
  },
);

let fixture: string;
let project: string;
let codocs: string;
const raw = 'id: term\nname: 이름\ndefinition: 정의\ndomains: [업무]\n';
beforeEach(
  /** 실제 fixture는 별도이며 가상 식별 정보는 각 테스트에만 적용한다. */ async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'codocs-loader-identity-'));
    project = path.join(fixture, 'project');
    codocs = path.join(project, '.codocs');
    await mkdir(codocs, { recursive: true });
  },
);
afterEach(
  /** 보조 mock과 자기 fixture만 정리한다. */ async () => {
    vi.mocked(resolveWorkspacePath).mockReset();
    const original =
      await vi.importActual<typeof import('../paths/index.js')>(
        '../paths/index.js',
      );
    vi.mocked(resolveWorkspacePath).mockImplementation(
      original.resolveWorkspacePath,
    );
    await rm(fixture, { recursive: true, force: true });
  },
);

describe('폴더 조상 식별의 보조 회귀 검사', /** 다른 OS에서 실행했다는 증거로 사용하지 않는 보조 검사다. */ () => {
  it('같은 실제 폴더의 realPath 표기가 다르면 현재 bigint 폴더 정보로 순환을 중단한다', /** 실제 폴더 IO를 유지하며 서로 다른 실경로 표기만 모의한다. */ async () => {
    await writeFile(path.join(codocs, 'ok.yaml'), raw);
    await symlink(codocs, path.join(codocs, 'back'), 'dir');
    const original =
      await vi.importActual<typeof import('../paths/index.js')>(
        '../paths/index.js',
      );
    vi.mocked(resolveWorkspacePath).mockImplementation(
      /** 연결 경로의 실경로 표기만 다르게 만들어 조상 식별을 확인한다. */ async (
        root,
        input,
      ) => {
        const target = await original.resolveWorkspacePath(root, input);
        if (target.success && target.logicalPath.endsWith(path.sep + 'back'))
          return {
            ...target,
            realPath: target.realPath + '-alternate-spelling',
          };
        return target;
      },
    );
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(1);
    expect(result.skippedCycles).toHaveLength(1);
    expect(result.skippedCycles[0]?.path).toBe(path.join('.codocs', 'back'));
  });
  it('폴더 식별 정보가 0이면 다른 폴더를 같은 조상으로 합치지 않는다', /** 제공되지 않은 식별 정보도 realPath 비교만 수행한다. */ async () => {
    await mkdir(path.join(codocs, 'nested'));
    await writeFile(path.join(codocs, 'nested', 'ok.yaml'), raw);
    const original =
      await vi.importActual<typeof import('../paths/index.js')>(
        '../paths/index.js',
      );
    vi.mocked(resolveWorkspacePath).mockImplementation(
      /** 시스템에서 의미 없는 0 값을 제공한 조건을 모의한다. */ async (
        root,
        input,
      ) => {
        const target = await original.resolveWorkspacePath(root, input);
        return target.success && target.kind === workspaceTargetKinds.directory
          ? { ...target, directoryIdentity: { device: 0n, inode: 0n } }
          : target;
      },
    );
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(1);
    expect(result.skippedCycles).toEqual([]);
  });
});
