import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
} from '../diagnostics/index.js';
import { resolveWorkspacePath } from '../index.js';
import type { ProjectRoot } from '../project-root/index.js';
import { detectFileSystemTestCapabilities } from '../test-support/file-system.js';

let fixture: string;
let project: string;
let outside: string;
let selectedRoot: ProjectRoot;
const {
  symlink: symlinkSupported,
  permissionDenial: permissionDenialSupported,
} = await detectFileSystemTestCapabilities();
beforeEach(
  /** 테스트마다 고유한 실제 파일 fixture를 생성한다. */ async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'codocs-path-'));
    project = path.join(fixture, 'project');
    outside = path.join(fixture, 'outside');
    await mkdir(path.join(project, '.codocs'), { recursive: true });
    selectedRoot = {
      startCwd: project,
      projectRoot: project,
      realPath: await realpath(project),
      codocsPath: path.join(project, '.codocs'),
    };
    await mkdir(outside);
    await writeFile(path.join(outside, 'target.yaml'), '원문');
    await writeFile(path.join(outside, 'sibling.yaml'), '형제');
  },
);
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe('resolveWorkspacePath: 프로젝트 파일 접근 범위', () => {
  describe('일반 파일과 연결 파일·폴더의 허용 범위', () => {
    it('프로젝트 안의 일반 파일을 요청하면 발견 경로와 파일 접근 범위를 반환한다', async () => {
      const input = '.codocs/term.yaml';
      await writeFile(path.join(project, input), '원문');

      const result = await resolveWorkspacePath(selectedRoot, input);

      expect(result).toMatchObject({
        success: true,
        path: path.normalize(input),
        kind: 'file',
        access: { read: true, write: true },
        scope: { kind: 'workspace' },
      });
    });

    it.skipIf(!symlinkSupported)(
      '외부 파일 링크를 요청하면 그 파일의 읽기와 쓰기 범위를 허용한다',
      /** 외부 파일 링크를 요청하면 그 파일의 읽기와 쓰기 범위를 허용한다. */ async () => {
        await symlink(
          path.join(outside, 'target.yaml'),
          path.join(project, '.codocs', 'file.yaml'),
        );
        expect(
          await resolveWorkspacePath(selectedRoot, '.codocs/file.yaml'),
        ).toMatchObject({
          success: true,
          realPath: await realpath(path.join(outside, 'target.yaml')),
          kind: 'file',
          access: { read: true, write: true },
          scope: { kind: 'linkedFile' },
        });
      },
    );
    it.skipIf(!symlinkSupported)(
      '외부 폴더 링크의 하위 파일을 요청하면 읽기와 쓰기 범위를 허용한다',
      /** 외부 폴더 링크의 하위 파일을 요청하면 읽기와 쓰기 범위를 허용한다. */ async () => {
        await symlink(outside, path.join(project, '.codocs', 'folder'));
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            '.codocs/folder/target.yaml',
          ),
        ).toMatchObject({
          success: true,
          realPath: await realpath(path.join(outside, 'target.yaml')),
          scope: { kind: 'linkedDirectory' },
        });
      },
    );
  });

  describe('연결 범위 밖 직접 접근 차단', () => {
    it.skipIf(!symlinkSupported)(
      '연결된 파일의 실제 외부 경로를 직접 요청하면 거부한다',
      /** 연결된 파일의 실제 외부 경로를 직접 요청하면 거부한다. */ async () => {
        await symlink(
          path.join(outside, 'target.yaml'),
          path.join(project, '.codocs', 'file.yaml'),
        );
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            path.join(outside, 'target.yaml'),
          ),
        ).toMatchObject({
          success: false,
          status: 'denied',
        });
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            path.join(outside, 'sibling.yaml'),
          ),
        ).toMatchObject({
          success: false,
          status: 'denied',
        });
        expect(await resolveWorkspacePath(selectedRoot, outside)).toMatchObject(
          {
            success: false,
            status: 'denied',
          },
        );
      },
    );
    it.skipIf(!symlinkSupported)(
      '폴더 링크에서 ..로 연결 루트를 벗어나면 거부한다',
      /** 폴더 링크에서 ..로 연결 루트를 벗어나면 거부한다. */ async () => {
        await symlink(outside, path.join(project, '.codocs', 'folder'));
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            '.codocs/folder/../file.yaml',
          ),
        ).toMatchObject({
          success: false,
          status: 'denied',
        });
      },
    );
    it.skipIf(!symlinkSupported)(
      '파일 링크에서 ..로 부모나 형제에 접근하면 거부한다',
      /** 파일 링크에서 ..로 부모나 형제에 접근하면 거부한다. */ async () => {
        await symlink(
          path.join(outside, 'target.yaml'),
          path.join(project, '.codocs', 'file.yaml'),
        );
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            '.codocs/file.yaml/../sibling.yaml',
          ),
        ).toMatchObject({
          success: false,
          status: 'denied',
        });
      },
    );
  });

  describe('경로 정규화와 연결 루트 이탈 판정', () => {
    it('일반 .codocs 파일을 상대와 논리 절대 경로로 요청하면 같은 확인 대상을 반환한다', /** 일반 .codocs 파일을 상대와 논리 절대 경로로 요청하면 같은 확인 대상을 반환한다. */ async () => {
      const logicalPath = path.join(project, '.codocs', '한글 Case.yaml');
      await writeFile(logicalPath, '원문');
      for (const input of ['.codocs/한글 Case.yaml', logicalPath]) {
        expect(await resolveWorkspacePath(selectedRoot, input)).toMatchObject({
          success: true,
          logicalPath,
          path: path.join('.codocs', '한글 Case.yaml'),
          realPath: await realpath(logicalPath),
          scope: {
            kind: 'workspace',
            logicalPath: path.join(project, '.codocs'),
          },
          access: { read: true, write: true },
          diagnostics: [],
        });
      }
    });
    it('일반 하위 폴더 안에서 ..를 요청하면 .codocs 안의 파일로 정규화한다', /** 일반 하위 폴더 안에서 ..를 요청하면 .codocs 안의 파일로 정규화한다. */ async () => {
      await mkdir(path.join(project, '.codocs', 'nested'));
      await writeFile(path.join(project, '.codocs', 'target.yaml'), '원문');
      expect(
        await resolveWorkspacePath(
          selectedRoot,
          './.codocs/nested/../target.yaml',
        ),
      ).toMatchObject({
        success: true,
        path: path.join('.codocs', 'target.yaml'),
      });
    });
    it.skipIf(!symlinkSupported)(
      '연결 폴더 하위에서 ..로 연결 루트까지만 돌아오면 허용한다',
      /** 연결 폴더 하위에서 ..로 연결 루트까지만 돌아오면 허용한다. */ async () => {
        await mkdir(path.join(outside, 'nested'));
        await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            '.codocs/folder/nested/../target.yaml',
          ),
        ).toMatchObject({
          success: true,
          path: path.join('.codocs', 'folder', 'target.yaml'),
          realPath: await realpath(path.join(outside, 'target.yaml')),
        });
      },
    );
    it.skipIf(!symlinkSupported)(
      '연결 폴더 하위에서 ..를 반복해 연결 루트 밖으로 요청하면 거부한다',
      /** 연결 폴더 하위에서 ..를 반복해 연결 루트 밖으로 요청하면 거부한다. */ async () => {
        await mkdir(path.join(outside, 'nested'));
        await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
        const result = await resolveWorkspacePath(
          selectedRoot,
          '.codocs/folder/nested/../../sibling.yaml',
        );
        expect(result).toMatchObject({
          success: false,
          status: 'denied',
          diagnostics: [
            {
              code: workspaceDiagnosticCodes.pathOutsideWorkspace,
              message: workspaceDiagnosticMessages.pathOutsideWorkspace,
              severity: 'error',
            },
          ],
        });
        expect(result).not.toHaveProperty('realPath');
      },
    );
    it.skipIf(!symlinkSupported)(
      '논리 절대 경로의 폴더 링크 뒤에 ..가 있으면 정규화 전에 거부한다',
      /** 논리 절대 경로의 폴더 링크 뒤에 ..가 있으면 정규화 전에 거부한다. */ async () => {
        await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            path.join(project, '.codocs', 'folder') +
              path.sep +
              '..' +
              path.sep +
              'target.yaml',
          ),
        ).toMatchObject({ success: false, status: 'denied' });
      },
    );
    it('.codocs에서 ..로 프로젝트 안의 임의 파일에 접근하면 거부한다', /** .codocs에서 ..로 프로젝트 안의 임의 파일에 접근하면 거부한다. */ async () => {
      await writeFile(path.join(project, 'outside.yaml'), '원문');
      expect(
        await resolveWorkspacePath(selectedRoot, '.codocs/../outside.yaml'),
      ).toMatchObject({
        success: false,
        status: 'denied',
      });
      expect(
        await resolveWorkspacePath(selectedRoot, 'outside.yaml'),
      ).toMatchObject({
        success: false,
        status: 'denied',
      });
    });
    it('.codocs와 접두사만 같은 폴더를 요청하면 거부한다', /** .codocs와 접두사만 같은 폴더를 요청하면 거부한다. */ async () => {
      await mkdir(path.join(project, '.codocs-other'));
      expect(
        await resolveWorkspacePath(selectedRoot, '.codocs-other'),
      ).toMatchObject({
        success: false,
        status: 'denied',
      });
    });
  });

  describe('중첩 연결과 경로 별칭 유지', () => {
    it.skipIf(!symlinkSupported)(
      '.codocs 자체가 외부 폴더 링크이면 하위 파일을 허용하고 연결 루트 밖 이동은 거부한다',
      /** .codocs 자체가 외부 폴더 링크이면 하위 파일을 허용하고 연결 루트 밖 이동은 거부한다. */ async () => {
        await rm(path.join(project, '.codocs'), { recursive: true });
        await symlink(outside, path.join(project, '.codocs'), 'dir');
        expect(
          await resolveWorkspacePath(selectedRoot, '.codocs/target.yaml'),
        ).toMatchObject({
          success: true,
          path: path.join('.codocs', 'target.yaml'),
          realPath: await realpath(path.join(outside, 'target.yaml')),
          scope: {
            kind: 'linkedDirectory',
            logicalPath: path.join(project, '.codocs'),
            realPath: await realpath(outside),
          },
        });
        expect(
          await resolveWorkspacePath(selectedRoot, '.codocs/../sibling.yaml'),
        ).toMatchObject({
          success: false,
          status: 'denied',
        });
      },
    );
    it.skipIf(!symlinkSupported)(
      '외부 폴더 안에 별도 외부 파일 링크가 있으면 해당 파일만 새 연결 범위로 허용한다',
      /** 외부 폴더 안에 별도 외부 파일 링크가 있으면 해당 파일만 새 연결 범위로 허용한다. */ async () => {
        const shared = path.join(fixture, 'shared.yaml');
        await writeFile(shared, '공유');
        await symlink(shared, path.join(outside, 'nested.yaml'), 'file');
        await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            '.codocs/folder/nested.yaml',
          ),
        ).toMatchObject({
          success: true,
          scope: {
            kind: 'linkedFile',
            logicalPath: path.join(project, '.codocs', 'folder', 'nested.yaml'),
            realPath: await realpath(shared),
          },
        });
        expect(
          await resolveWorkspacePath(
            selectedRoot,
            '.codocs/folder/nested.yaml/../sibling.yaml',
          ),
        ).toMatchObject({ success: false, status: 'denied' });
      },
    );
    it.skipIf(!symlinkSupported)(
      '파일 링크가 다른 파일 링크를 가리키면 최종 확인한 실제 파일을 반환한다',
      /** 파일 링크가 다른 파일 링크를 가리키면 최종 확인한 실제 파일을 반환한다. */ async () => {
        await symlink('target.yaml', path.join(outside, 'chain.yaml'), 'file');
        await symlink(
          path.join(outside, 'chain.yaml'),
          path.join(project, '.codocs', 'file.yaml'),
          'file',
        );
        expect(
          await resolveWorkspacePath(selectedRoot, '.codocs/file.yaml'),
        ).toMatchObject({
          success: true,
          realPath: await realpath(path.join(outside, 'target.yaml')),
          scope: { kind: 'linkedFile' },
        });
      },
    );
    it.skipIf(!symlinkSupported)(
      '두 폴더 링크가 같은 외부 폴더에 도달하면 서로 다른 논리 경로를 보존한다',
      /** 두 폴더 링크가 같은 외부 폴더에 도달하면 서로 다른 논리 경로를 보존한다. */ async () => {
        await symlink(outside, path.join(project, '.codocs', '공통A'), 'dir');
        await symlink(outside, path.join(project, '.codocs', '공통B'), 'dir');
        const first = await resolveWorkspacePath(
          selectedRoot,
          '.codocs/공통A/target.yaml',
        );
        const second = await resolveWorkspacePath(
          selectedRoot,
          '.codocs/공통B/target.yaml',
        );
        expect(first).toMatchObject({
          success: true,
          path: path.join('.codocs', '공통A', 'target.yaml'),
        });
        expect(second).toMatchObject({
          success: true,
          path: path.join('.codocs', '공통B', 'target.yaml'),
        });
        if (!first.success || !second.success)
          throw new Error('두 연결을 확인해야 한다');
        expect(first.realPath).toBe(second.realPath);
      },
    );
    it.skipIf(!symlinkSupported)(
      '한글과 Unicode 표기가 다른 링크 이름을 요청하면 두 논리 경로를 별도로 유지한다',
      /** 한글과 Unicode 표기가 다른 링크 이름을 요청하면 두 논리 경로를 별도로 유지한다. */ async () => {
        const names = ['Mixed-가.yaml', 'Mixed-가.yaml'];
        await mkdir(path.join(project, '.codocs', 'first'));
        await mkdir(path.join(project, '.codocs', 'second'));
        await symlink(
          path.join(outside, 'target.yaml'),
          path.join(project, '.codocs', 'first', names[0] ?? ''),
          'file',
        );
        await symlink(
          path.join(outside, 'target.yaml'),
          path.join(project, '.codocs', 'second', names[1] ?? ''),
          'file',
        );
        for (const [index, name] of names.entries()) {
          const folder = index === 0 ? 'first' : 'second';
          expect(
            await resolveWorkspacePath(
              selectedRoot,
              path.join('.codocs', folder, name),
            ),
          ).toMatchObject({
            success: true,
            path: path.join('.codocs', folder, name),
          });
        }
      },
    );
  });

  describe('누락·접근 실패와 잘못된 경로 진단', () => {
    it('유효한 프로젝트에 .codocs가 없으면 누락 상태와 확인한 논리 경로를 반환한다', /** 유효한 프로젝트에 .codocs가 없으면 누락 상태와 확인한 논리 경로를 반환한다. */ async () => {
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
    it.skipIf(!symlinkSupported)(
      '.codocs 자체가 깨진 링크이면 부재 대신 대상 확인 실패를 반환한다',
      /** .codocs 자체가 깨진 링크이면 부재 대신 대상 확인 실패를 반환한다. */ async () => {
        await rm(path.join(project, '.codocs'), { recursive: true });
        await symlink(
          path.join(fixture, 'missing'),
          path.join(project, '.codocs'),
          'dir',
        );
        expect(
          await resolveWorkspacePath(selectedRoot, '.codocs'),
        ).toMatchObject({
          success: false,
          status: 'unavailable',
          diagnostics: [
            {
              code: workspaceDiagnosticCodes.pathUnavailable,
              path: '.codocs',
              ioCode: 'ENOENT',
            },
          ],
        });
      },
    );
    it.skipIf(!symlinkSupported)(
      '하위 파일 링크가 깨지면 원문·실경로·좌표 없이 실패 경로와 실제 ENOENT를 반환한다',
      /** 하위 파일 링크가 깨지면 원문·실경로·좌표 없이 실패 경로와 실제 ENOENT를 반환한다. */ async () => {
        await symlink(
          path.join(outside, 'missing.yaml'),
          path.join(project, '.codocs', 'broken.yaml'),
          'file',
        );
        const result = await resolveWorkspacePath(
          selectedRoot,
          '.codocs/broken.yaml',
        );
        expect(result).toEqual({
          success: false,
          status: 'unavailable',
          logicalPath: path.join(project, '.codocs', 'broken.yaml'),
          path: path.join('.codocs', 'broken.yaml'),
          diagnostics: [
            {
              code: workspaceDiagnosticCodes.pathUnavailable,
              severity: 'error',
              message: workspaceDiagnosticMessages.pathUnavailable,
              path: path.join('.codocs', 'broken.yaml'),
              ioCode: 'ENOENT',
            },
          ],
        });
        for (const key of ['realPath', 'raw', 'id'])
          expect(result).not.toHaveProperty(key);
        expect(result.diagnostics[0]).not.toHaveProperty('range');
      },
    );
    it('.codocs 자체가 파일이면 디렉터리 진단을 반환한다', /** .codocs 자체가 파일이면 디렉터리 진단을 반환한다. */ async () => {
      await rm(path.join(project, '.codocs'), { recursive: true });
      await writeFile(path.join(project, '.codocs'), '원문');
      expect(await resolveWorkspacePath(selectedRoot, '.codocs')).toMatchObject(
        {
          success: false,
          status: 'unavailable',
          diagnostics: [
            {
              code: workspaceDiagnosticCodes.notDirectory,
              message: workspaceDiagnosticMessages.notDirectory,
              path: '.codocs',
            },
          ],
        },
      );
    });
    it.each([
      { name: 'null', input: null },
      { name: '숫자', input: 1 },
      { name: '객체', input: {} },
      { name: '빈 문자열', input: '' },
      { name: '공백', input: ' ' },
      { name: 'NUL 포함 문자열', input: '.codocs/\0bad' },
    ])(
      '$name 경로를 요청하면 확인하지 않은 경로를 만들지 않고 거부한다',
      async ({ input }) => {
        const result = await resolveWorkspacePath(selectedRoot, input);
        expect(result).toEqual({
          success: false,
          status: 'denied',
          diagnostics: [
            {
              code: workspaceDiagnosticCodes.invalidWorkspacePath,
              severity: 'error',
              message: workspaceDiagnosticMessages.invalidPath,
            },
          ],
        });
      },
    );
    it.skipIf(!symlinkSupported)(
      '파일 링크 두 개가 서로를 가리키면 실제 ELOOP를 실패 진단으로 반환한다',
      /** 파일 링크 두 개가 서로를 가리키면 실제 ELOOP를 실패 진단으로 반환한다. */ async () => {
        await symlink(
          'b.yaml',
          path.join(project, '.codocs', 'a.yaml'),
          'file',
        );
        await symlink(
          'a.yaml',
          path.join(project, '.codocs', 'b.yaml'),
          'file',
        );
        expect(
          await resolveWorkspacePath(selectedRoot, '.codocs/a.yaml'),
        ).toMatchObject({
          success: false,
          status: 'unavailable',
          diagnostics: [
            { code: workspaceDiagnosticCodes.pathUnavailable, ioCode: 'ELOOP' },
          ],
        });
      },
    );
    it('루트 선택 후 루트가 삭제되면 .codocs 부재로 숨기지 않고 루트 실패를 반환한다', /** 루트 선택 후 루트가 삭제되면 .codocs 부재로 숨기지 않고 루트 실패를 반환한다. */ async () => {
      await rm(project, { recursive: true });
      expect(await resolveWorkspacePath(selectedRoot, '.codocs')).toMatchObject(
        {
          success: false,
          status: 'unavailable',
          diagnostics: [
            {
              code: workspaceDiagnosticCodes.projectRootUnavailable,
              path: project,
            },
          ],
        },
      );
    });
    it.each([
      { name: '점', suffix: path.sep + '.' },
      { name: '구분자', suffix: path.sep },
    ])(
      '파일 뒤에 $name을 붙여 디렉터리 탐색을 요청하면 파일로 성공시키지 않는다',
      async ({ suffix }) => {
        await writeFile(path.join(project, '.codocs', 'file.yaml'), '원문');
        const result = await resolveWorkspacePath(
          selectedRoot,
          '.codocs/file.yaml' + suffix,
        );
        expect(result).toMatchObject({
          success: false,
          status: 'unavailable',
          diagnostics: [{ code: workspaceDiagnosticCodes.notDirectory }],
        });
      },
    );
    it.skipIf(!permissionDenialSupported)(
      '하위 폴더 탐색 권한이 없으면 실제 EACCES와 실패 경로만 반환한다',
      /** 권한이 없는 실제 임시 폴더에서 파일 조회 실패를 확인하고 권한을 복구한다. */ async () => {
        const folder = path.join(project, '.codocs', 'restricted');
        await mkdir(folder);
        await writeFile(path.join(folder, 'file.yaml'), '원문');
        await chmod(folder, 0);
        try {
          const result = await resolveWorkspacePath(
            selectedRoot,
            '.codocs/restricted/file.yaml',
          );
          expect(result).toMatchObject({
            success: false,
            status: 'unavailable',
            path: path.join('.codocs', 'restricted', 'file.yaml'),
            diagnostics: [
              {
                code: workspaceDiagnosticCodes.pathUnavailable,
                message: workspaceDiagnosticMessages.pathUnavailable,
                ioCode: 'EACCES',
              },
            ],
          });
          expect(result).not.toHaveProperty('realPath');
        } finally {
          await chmod(folder, 0o700);
        }
      },
    );
    it.skipIf(!symlinkSupported)(
      '연결 파일에 OS 쓰기 권한이 없어도 정책 범위는 읽기와 쓰기를 허용한다',
      /** 실제 쓰기는 하지 않고 연결 범위 정책과 OS 파일 권한이 별개임을 확인한다. */ async () => {
        const target = path.join(outside, 'target.yaml');
        await chmod(target, 0o400);
        await symlink(
          target,
          path.join(project, '.codocs', 'readonly.yaml'),
          'file',
        );
        try {
          expect(
            await resolveWorkspacePath(selectedRoot, '.codocs/readonly.yaml'),
          ).toMatchObject({
            success: true,
            access: { read: true, write: true },
            scope: { kind: 'linkedFile' },
          });
        } finally {
          await chmod(target, 0o600);
        }
      },
    );
  });
});
