import { createLink } from '../test-support/links.js';
import { ioFailures, simulatedFileLinks } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
} from '../diagnostics/index.js';
import { resolveWorkspacePath } from '../index.js';
import type { ProjectRoot } from '../project-root/index.js';

let fixture: string;
let project: string;
let outside: string;
let selectedRoot: ProjectRoot;
beforeEach(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), 'codocs-path-'));
  project = path.join(fixture, 'project');
  outside = path.join(fixture, 'outside');
  await mkdir(path.join(project, '.codocs'), { recursive: true });
  await mkdir(outside);
  selectedRoot = {
    startCwd: project,
    projectRoot: project,
    realPath: await realpath(project),
    codocsPath: path.join(project, '.codocs'),
  };
});
afterEach(async () => {
  ioFailures.clear();
  simulatedFileLinks.clear();
  await rm(fixture, { recursive: true, force: true });
});

describe('resolveWorkspacePath: 일반 .codocs 경계', () => {
  /** @codocs [[작업 공간:작업 공간 경로 확인]]#L6-L7 @codocs [[작업 공간:파일 접근 범위]]#L7 @codocs [[작업 공간:발견 경로]]#L6-L7 */
  it('일반 파일은 경로와 접근 범위를 제공한다', async () => {
    const file = path.join(project, '.codocs', '한글.yaml');
    await writeFile(file, '원문');
    for (const input of ['.codocs/한글.yaml', file]) {
      expect(await resolveWorkspacePath(selectedRoot, input)).toMatchObject({
        success: true,
        logicalPath: file,
        realPath: await realpath(file),
        path: path.join('.codocs', '한글.yaml'),
        kind: 'file',
        scope: { kind: 'workspace' },
        access: { read: true, write: true },
      });
    }
  });

  /** @codocs [[작업 공간:파일 접근 범위]]#L16 */
  it('일반 폴더의 ..는 허용하되 .codocs 밖 이동은 거부한다', async () => {
    await mkdir(path.join(project, '.codocs', 'nested'));
    await writeFile(path.join(project, '.codocs', 'target.yaml'), '원문');
    expect(
      await resolveWorkspacePath(selectedRoot, '.codocs/nested/../target.yaml'),
    ).toMatchObject({
      success: true,
      path: path.join('.codocs', 'target.yaml'),
    });
    expect(
      await resolveWorkspacePath(selectedRoot, '.codocs/../outside.yaml'),
    ).toMatchObject({
      success: false,
      status: 'denied',
      diagnostics: [{ code: workspaceDiagnosticCodes.pathOutsideWorkspace }],
    });
    expect(
      await resolveWorkspacePath(selectedRoot, path.join(outside, 'file.yaml')),
    ).toMatchObject({ success: false, status: 'denied' });
  });

  it('없는 .codocs만 missing으로 확인한다', async () => {
    await rm(path.join(project, '.codocs'), { recursive: true });
    expect(await resolveWorkspacePath(selectedRoot, '.codocs')).toEqual({
      success: false,
      status: 'missing',
      logicalPath: path.join(project, '.codocs'),
      path: '.codocs',
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.pathUnavailable,
          severity: 'error',
          message: workspaceDiagnosticMessages.pathUnavailable,
          path: '.codocs',
          ioCode: 'ENOENT',
        },
      ],
    });
  });

  it('선택한 .codocs가 정션이면 대상이 내부여도 unavailable이다', async () => {
    const target = path.join(project, 'ordinary');
    await mkdir(target);
    await rm(path.join(project, '.codocs'), { recursive: true });
    await createLink(target, path.join(project, '.codocs'), 'junction');
    expect(await resolveWorkspacePath(selectedRoot, '.codocs')).toMatchObject({
      success: false,
      status: 'unavailable',
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.unsupportedWorkspaceLink,
          path: '.codocs',
        },
      ],
    });
  });

  /** @codocs [[작업 공간:작업 공간 경로 확인]]#L12-L13 @codocs [[작업 공간:파일 접근 범위]]#L14-L15 */
  it('중간 정션은 대상이 .codocs 안이어도 거부하며 ..로 숨길 수 없다', async () => {
    const target = path.join(project, '.codocs', 'ordinary');
    await mkdir(target);
    await writeFile(path.join(target, 'target.yaml'), '원문');
    await createLink(
      target,
      path.join(project, '.codocs', 'folder'),
      'junction',
    );
    for (const input of [
      '.codocs/folder/target.yaml',
      '.codocs/folder/../ordinary/target.yaml',
    ]) {
      expect(await resolveWorkspacePath(selectedRoot, input)).toMatchObject({
        success: false,
        status: 'denied',
        diagnostics: [
          { code: workspaceDiagnosticCodes.unsupportedWorkspaceLink },
        ],
      });
    }
  });

  it('파일 연결과 깨진 연결은 모두 미지원이며 부재가 아니다', async () => {
    const target = path.join(project, '.codocs', 'target.yaml');
    await writeFile(target, '원문');
    for (const name of ['linked.yaml', 'broken.yaml']) {
      const linked = path.join(project, '.codocs', name);
      await writeFile(linked, '파일 연결을 대신하는 열거 항목');
      simulatedFileLinks.add(linked);
    }
    for (const input of ['linked.yaml', 'broken.yaml']) {
      const result = await resolveWorkspacePath(
        selectedRoot,
        path.join('.codocs', input),
      );
      expect(result).toMatchObject({
        success: false,
        status: 'denied',
        diagnostics: [
          {
            code: workspaceDiagnosticCodes.unsupportedWorkspaceLink,
            path: path.join('.codocs', input),
          },
        ],
      });
      expect(result).not.toHaveProperty('realPath');
    }
  });

  it('파일 뒤의 구분자는 디렉터리로 성공시키지 않는다', async () => {
    await writeFile(path.join(project, '.codocs', 'file.yaml'), '원문');
    expect(
      await resolveWorkspacePath(selectedRoot, '.codocs/file.yaml/'),
    ).toMatchObject({
      success: false,
      status: 'unavailable',
      diagnostics: [{ code: workspaceDiagnosticCodes.notDirectory }],
    });
  });

  it('IO 실패는 부재와 구분한다', async () => {
    const file = path.join(project, '.codocs', 'file.yaml');
    await writeFile(file, '원문');
    ioFailures.set(file, { operations: ['lstat'], code: 'EACCES' });
    expect(
      await resolveWorkspacePath(selectedRoot, '.codocs/file.yaml'),
    ).toMatchObject({
      success: false,
      status: 'unavailable',
      diagnostics: [
        { code: workspaceDiagnosticCodes.pathUnavailable, ioCode: 'EACCES' },
      ],
    });
  });

  it.each([null, 1, {}, '', ' ', '.codocs/\0bad'])(
    '잘못된 경로 %s를 거부한다',
    async (input) => {
      expect(await resolveWorkspacePath(selectedRoot, input)).toMatchObject({
        success: false,
        status: 'denied',
        diagnostics: [{ code: workspaceDiagnosticCodes.invalidWorkspacePath }],
      });
    },
  );
});
