import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changePlanDiagnosticCodes } from '@codocs/core';
import { rename } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { ioFailures } from '../test-support/file-system.js';
import {
  collectWorkspaceCodeEvidence,
  workspaceCodeEvidenceDiagnosticCodes,
} from '../code-reference/index.js';
import { loadWorkspace } from '../loader/index.js';
import { calculateRevision } from '../revision/index.js';
import { saveWorkspaceChange } from './index.js';

const zoneText =
  '_codocs:\n  id: zone\n  name: 구역\ndefinition: 설명\n업무: 값\n내용: 값\n';
let root: string;
let folder: string;
let zoneFile: string;
const replacement = {
  _codocs: { id: 'zone', name: '구역' },
  definition: '설명',
  업무: '값',
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-protection-'));
  vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(root));
  folder = path.join(root, '.codocs');
  zoneFile = path.join(folder, 'zone.yaml');
  await mkdir(folder);
  await writeFile(zoneFile, zoneText);
});

afterEach(async () => {
  ioFailures.clear();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** 실제 원문 바이트에서 독립적으로 계산한 전체 교체 요청을 만든다. */
function replaceRequest(): {
  mode: string;
  id: string;
  revision: string;
  document: typeof replacement;
} {
  return {
    mode: 'replace',
    id: 'zone',
    revision: calculateRevision(Buffer.from(zoneText)),
    document: replacement,
  };
}

describe('saveWorkspaceChange: 섹션 삭제의 코드 참조 보호', () => {
  it('참조하는 코드가 없는 섹션을 전체 교체로 삭제하면 후보 바이트를 저장한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// 참조 없음');
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan);
    expect(result).toMatchObject({ success: true, saved: true, changed: true });
    expect(await readFile(zoneFile, 'utf8')).not.toContain('내용');
  });

  it('삭제할 섹션을 코드가 참조하면 거절하고 원문 바이트와 임시 파일 상태를 보존한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[구역:내용]]');
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan);
    expect(result).toMatchObject({
      success: false,
      saved: false,
      diagnostics: [
        {
          code: changePlanDiagnosticCodes.brokenReference,
          path: 'source.ts',
        },
      ],
    });
    expect(await readFile(zoneFile, 'utf8')).toBe(zoneText);
    expect(await readdir(folder)).toEqual(['zone.yaml']);
  });

  it('삭제하는 섹션과 무관한 코드의 기존 오류 표기가 있어도 저장한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[없는 문서]]');
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan);
    expect(result).toMatchObject({ success: true, saved: true });
  });

  it('텍스트 수정은 코드 증거 수집 없이 저장한다', async () => {
    const collect = vi.fn(collectWorkspaceCodeEvidence);
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(
      {
        mode: 'update',
        id: 'zone',
        revision: calculateRevision(Buffer.from(zoneText)),
        set: { definition: '새 설명' },
      },
      scan,
      { collectCodeEvidence: collect },
    );
    expect(result).toMatchObject({ success: true, saved: true });
    expect(collect).not.toHaveBeenCalled();
  });

  it('섹션 삭제는 첫 계획과 최종 재탐색 뒤에 각각 코드 증거를 새로 수집한다', async () => {
    const collect = vi.fn(collectWorkspaceCodeEvidence);
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan, {
      collectCodeEvidence: collect,
    });
    expect(result).toMatchObject({ success: true, saved: true });
    expect(collect.mock.calls).toEqual([[root], [root]]);
  });
});

describe('saveWorkspaceChange: 임시 파일 기록과 반영 사이 늦게 생긴 참조', () => {
  it('반영 직전에 새 코드 참조가 생기면 최종 재검사로 거절하고 원문을 보존한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan, {
      beforeApply: async () => {
        await writeFile(path.join(root, 'late.ts'), '// @codocs [[구역:내용]]');
      },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      diagnostics: [
        {
          code: changePlanDiagnosticCodes.brokenReference,
          path: 'late.ts',
        },
      ],
    });
    expect(await readFile(zoneFile, 'utf8')).toBe(zoneText);
    expect(await readdir(folder)).toEqual(['zone.yaml']);
  });

  it('반영 직전에 새 문서 참조가 생기면 최종 재탐색 계획으로 거절하고 원문을 보존한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan, {
      beforeApply: async () => {
        await writeFile(
          path.join(folder, 'referrer.yaml'),
          '_codocs:\n  id: referrer\n  name: 참조 문서\ndefinition: "[[구역:내용]]"\n',
        );
      },
    });
    expect(result).toMatchObject({
      success: false,
      saved: false,
      diagnostics: [
        {
          code: changePlanDiagnosticCodes.brokenReference,
          path: path.join('.codocs', 'referrer.yaml'),
        },
      ],
    });
    expect(await readFile(zoneFile, 'utf8')).toBe(zoneText);
    expect(await readdir(folder)).toEqual(['referrer.yaml', 'zone.yaml']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '반영 직전에 읽을 수 없는 코드 파일이 생기면 보호를 증명하지 못해 거절한다',
    async () => {
      const scan = await loadWorkspace({ cwd: root });
      const locked = path.join(root, 'locked.ts');
      try {
        const result = await saveWorkspaceChange(replaceRequest(), scan, {
          beforeApply: async () => {
            await writeFile(locked, '// @codocs [[구역:내용]]');
            await chmod(locked, 0o000);
          },
        });
        expect(result).toMatchObject({
          success: false,
          saved: false,
          diagnostics: [
            { code: workspaceCodeEvidenceDiagnosticCodes.incomplete },
          ],
        });
        expect(await readFile(zoneFile, 'utf8')).toBe(zoneText);
      } finally {
        await chmod(locked, 0o600);
      }
    },
  );

  it('교체 재시도 사이에 새 코드 참조가 생기면 다음 시도의 재검사로 거절하고 원문을 보존한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    let attempts = 0;
    let spoofed = false;
    /** 재시도 판단이 끝난 뒤 실제 플랫폼 값으로 되돌린다. */
    const restorePlatform = (): void => {
      if (spoofed && platform)
        Object.defineProperty(process, 'platform', platform);
      spoofed = false;
    };
    try {
      const result = await saveWorkspaceChange(replaceRequest(), scan, {
        operations: {
          rename: async (source, destination) => {
            attempts++;
            if (attempts === 1) {
              // 첫 교체 실패와 재시도 사이의 동기화 지점에서 코드 참조를 만든다.
              await writeFile(
                path.join(root, 'late.ts'),
                '// @codocs [[구역:내용]]',
              );
              // Windows의 일시적 교체 거부만 재시도하므로 재시도 판단 동안만 플랫폼을 맞춘다.
              Object.defineProperty(process, 'platform', { value: 'win32' });
              spoofed = true;
              // 거부가 전파되는 마이크로태스크가 끝나면 즉시 실제 플랫폼으로 되돌린다.
              setImmediate(restorePlatform);
              throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
            }
            await rename(source, destination);
          },
        },
      });
      expect(attempts).toBe(1);
      expect(result).toMatchObject({
        success: false,
        saved: false,
        diagnostics: [
          {
            code: changePlanDiagnosticCodes.brokenReference,
            path: 'late.ts',
          },
        ],
      });
      expect(await readFile(zoneFile, 'utf8')).toBe(zoneText);
    } finally {
      restorePlatform();
    }
  });

  it('섹션을 삭제하지 않는 수정은 늦게 생긴 코드 참조와 관계없이 저장한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(
      {
        mode: 'update',
        id: 'zone',
        revision: calculateRevision(Buffer.from(zoneText)),
        set: { definition: '새 설명' },
      },
      scan,
      {
        beforeApply: async () => {
          await writeFile(
            path.join(root, 'late.ts'),
            '// @codocs [[구역:내용]]',
          );
        },
      },
    );
    expect(result).toMatchObject({ success: true, saved: true });
  });
});

describe('saveWorkspaceChange: .codocsignore 제외 코드의 보호 경계', () => {
  it('.codocsignore가 제외한 코드가 삭제할 섹션을 참조해도 보호하지 않고 저장한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// @codocs [[구역:내용]]');
    await writeFile(path.join(root, '.codocsignore'), 'source.ts\n');
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan);
    expect(result).toMatchObject({ success: true, saved: true });
  });

  it('.codocsignore를 읽지 못하면 코드 증거를 확정하지 못해 섹션 삭제를 거절하고 원문을 보존한다', async () => {
    await writeFile(path.join(root, 'source.ts'), '// 참조 없음');
    await writeFile(path.join(root, '.codocsignore'), 'other.ts\n');
    ioFailures.set(path.join(root, '.codocsignore'), {
      operations: ['lstat'],
      code: 'EACCES',
    });
    const scan = await loadWorkspace({ cwd: root });
    const result = await saveWorkspaceChange(replaceRequest(), scan);
    expect(result).toMatchObject({ success: false, saved: false });
    expect(await readFile(zoneFile, 'utf8')).toBe(zoneText);
  });
});
