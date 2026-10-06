import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  changePlanDiagnosticCodes,
  changePlanStatuses,
  extractCodeReferences,
} from '@codocs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  codeFileReasons,
  workspaceCodeEvidenceDiagnosticCodes,
} from '../code-reference/index.js';
import type { WorkspaceCodeEvidence } from '../code-reference/index.js';
import { loadWorkspace } from '../loader/index.js';
import { planProtectedWorkspaceChange } from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

const zoneText =
  '_codocs:\n  id: zone\n  name: 구역\ndefinition: 설명\n업무: 값\n내용: 값\n';
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-protected-plan-'));
  await mkdir(path.join(root, '.codocs'));
  await writeFile(path.join(root, '.codocs', 'zone.yaml'), zoneText);
});

afterEach(async () => {
  await rmWithRetry(root, { recursive: true, force: true });
});

/** 코드 파일 원문에서 표기를 추출해 완전한 증거로 만든다. */
function evidenceOf(files: Record<string, string>): WorkspaceCodeEvidence {
  return {
    complete: true,
    failures: [],
    files: Object.entries(files).map(([filePath, text]) => ({
      path: filePath,
      text,
      revision: filePath,
      markers: extractCodeReferences(text),
    })),
  };
}

/** 현재 프로젝트 관측에서 zone 문서의 revision을 가져온다. */
function zoneRevision(scan: Awaited<ReturnType<typeof loadWorkspace>>): string {
  const revision = scan.documents.find((item) =>
    item.source.path.endsWith('zone.yaml'),
  )?.revision;
  if (!revision) throw new Error('zone 문서를 찾지 못했습니다.');
  return revision;
}

describe('planProtectedWorkspaceChange: 섹션 삭제에만 코드 참조 보호 적용', () => {
  it('참조하는 코드가 없는 섹션을 전체 교체로 삭제하면 후보를 돌려준다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const request = {
      mode: 'replace',
      id: 'zone',
      revision: zoneRevision(scan),
      document: {
        _codocs: { id: 'zone', name: '구역' },
        definition: '설명',
        업무: '값',
      },
    };
    const result = await planProtectedWorkspaceChange(request, scan, () =>
      Promise.resolve(evidenceOf({ 'source.ts': '// 참조 없음' })),
    );
    expect(result).toMatchObject({
      status: changePlanStatuses.candidate,
      removedSections: ['내용'],
    });
  });

  it('삭제할 섹션을 코드가 참조하면 코드 경로와 위치를 가진 단절 오류로 거절한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const request = {
      mode: 'replace',
      id: 'zone',
      revision: zoneRevision(scan),
      document: {
        _codocs: { id: 'zone', name: '구역' },
        definition: '설명',
        업무: '값',
      },
    };
    const result = await planProtectedWorkspaceChange(request, scan, () =>
      Promise.resolve(evidenceOf({ 'source.ts': '// @codocs [[구역:내용]]' })),
    );
    expect(result).toMatchObject({
      status: changePlanStatuses.failed,
      diagnostics: [
        {
          code: changePlanDiagnosticCodes.brokenReference,
          path: 'source.ts',
        },
      ],
    });
    if (result.status !== changePlanStatuses.failed) return;
    expect(result.diagnostics[0]?.range).toBeDefined();
  });

  it('삭제하는 섹션과 무관한 코드의 기존 오류 표기는 거절 근거로 보지 않는다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const request = {
      mode: 'update',
      id: 'zone',
      revision: zoneRevision(scan),
      unset: ['내용'],
    };
    const result = await planProtectedWorkspaceChange(request, scan, () =>
      Promise.resolve(
        evidenceOf({
          'source.ts': '// @codocs [[없는 문서]] @codocs [[구역:업무]]',
        }),
      ),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
  });

  it('대상 문서 자신의 이전 원문에 있는 표기는 변경하지 않는 코드 증거로 쓰지 않는다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const request = {
      mode: 'update',
      id: 'zone',
      revision: zoneRevision(scan),
      unset: ['내용'],
    };
    const result = await planProtectedWorkspaceChange(request, scan, () =>
      Promise.resolve(
        evidenceOf({ '.codocs/zone.yaml': '내용: @codocs [[구역:내용]]' }),
      ),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
  });

  it('코드 증거가 완전하지 않으면 참조 보호를 증명하지 못해 후보를 거절한다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    const request = {
      mode: 'update',
      id: 'zone',
      revision: zoneRevision(scan),
      unset: ['내용'],
    };
    const result = await planProtectedWorkspaceChange(request, scan, () =>
      Promise.resolve({
        complete: false,
        files: [],
        failures: [
          {
            path: 'locked.ts',
            reason: codeFileReasons.read,
            message: '읽기 실패',
          },
        ],
      } satisfies WorkspaceCodeEvidence),
    );
    expect(result).toMatchObject({
      status: changePlanStatuses.failed,
      diagnostics: [
        {
          code: workspaceCodeEvidenceDiagnosticCodes.incomplete,
          path: path.join('.codocs', 'zone.yaml'),
        },
      ],
    });
  });

  it.each([
    ['텍스트 수정', { mode: 'update', set: { definition: '새 설명' } }],
    ['섹션 추가', { mode: 'update', set: { 새섹션: '값' } }],
    ['변경 없는 요청', { mode: 'update', set: { definition: '설명' } }],
  ])('%s는 코드 수집을 요구하지 않는다', async (_name, extra) => {
    const scan = await loadWorkspace({ cwd: root });
    let collected = 0;
    await planProtectedWorkspaceChange(
      { id: 'zone', revision: zoneRevision(scan), ...extra },
      scan,
      () => {
        collected++;
        return Promise.resolve(evidenceOf({}));
      },
    );
    expect(collected).toBe(0);
  });

  it('새 문서 생성은 코드 수집을 요구하지 않는다', async () => {
    const scan = await loadWorkspace({ cwd: root });
    let collected = 0;
    const result = await planProtectedWorkspaceChange(
      {
        mode: 'create',
        path: '.codocs/new.yaml',
        document: {
          _codocs: { id: 'new', name: '새 문서' },
          definition: '본문',
        },
      },
      scan,
      () => {
        collected++;
        return Promise.resolve(evidenceOf({}));
      },
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    expect(collected).toBe(0);
  });
});
