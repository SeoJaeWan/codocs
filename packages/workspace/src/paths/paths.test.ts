import {
  chmod,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveProjectRoot,
  resolveWorkspacePath,
  type WorkspacePathResult,
} from '../index.js';
import {
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
} from '../diagnostics/index.js';

let fixture: string;
let project: string;
let outside: string;
beforeEach(
  /** 테스트마다 고유한 실제 파일 fixture를 생성한다. */ async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'codocs-path-'));
    project = path.join(fixture, 'project');
    outside = path.join(fixture, 'outside');
    await mkdir(path.join(project, '.codocs'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(outside, 'target.yaml'), '원문');
    await writeFile(path.join(outside, 'sibling.yaml'), '형제');
  },
);
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

/** 실제 프로젝트 루트에서 입력 경로의 현 시점 접근 범위를 확인한다. */
async function resolve(input: unknown): Promise<WorkspacePathResult> {
  const selected = await resolveProjectRoot({ cwd: project });
  if (!selected.success) throw new Error('fixture 루트 선택 실패');
  return resolveWorkspacePath(selected.root, input);
}

describe('연결 경로 접근 판정', /** 연결 경로 접근 판정. */ () => {
  it('외부 파일 링크를 요청하면 그 파일의 읽기와 쓰기 범위를 허용한다', /** 외부 파일 링크를 요청하면 그 파일의 읽기와 쓰기 범위를 허용한다. */ async () => {
    await symlink(
      path.join(outside, 'target.yaml'),
      path.join(project, '.codocs', 'file.yaml'),
    );
    expect(await resolve('.codocs/file.yaml')).toMatchObject({
      success: true,
      realPath: await realpath(path.join(outside, 'target.yaml')),
      kind: 'file',
      access: { read: true, write: true },
      scope: { kind: 'linkedFile' },
    });
  });
  it('외부 폴더 링크의 하위 파일을 요청하면 읽기와 쓰기 범위를 허용한다', /** 외부 폴더 링크의 하위 파일을 요청하면 읽기와 쓰기 범위를 허용한다. */ async () => {
    await symlink(outside, path.join(project, '.codocs', 'folder'));
    expect(await resolve('.codocs/folder/target.yaml')).toMatchObject({
      success: true,
      realPath: await realpath(path.join(outside, 'target.yaml')),
      scope: { kind: 'linkedDirectory' },
    });
  });
  it('연결된 파일의 실제 외부 경로를 직접 요청하면 거부한다', /** 연결된 파일의 실제 외부 경로를 직접 요청하면 거부한다. */ async () => {
    await symlink(
      path.join(outside, 'target.yaml'),
      path.join(project, '.codocs', 'file.yaml'),
    );
    expect(await resolve(path.join(outside, 'target.yaml'))).toMatchObject({
      success: false,
      status: 'denied',
    });
    expect(await resolve(path.join(outside, 'sibling.yaml'))).toMatchObject({
      success: false,
      status: 'denied',
    });
    expect(await resolve(outside)).toMatchObject({
      success: false,
      status: 'denied',
    });
  });
  it('폴더 링크에서 ..로 연결 루트를 벗어나면 거부한다', /** 폴더 링크에서 ..로 연결 루트를 벗어나면 거부한다. */ async () => {
    await symlink(outside, path.join(project, '.codocs', 'folder'));
    expect(await resolve('.codocs/folder/../file.yaml')).toMatchObject({
      success: false,
      status: 'denied',
    });
  });
  it('파일 링크에서 ..로 부모나 형제에 접근하면 거부한다', /** 파일 링크에서 ..로 부모나 형제에 접근하면 거부한다. */ async () => {
    await symlink(
      path.join(outside, 'target.yaml'),
      path.join(project, '.codocs', 'file.yaml'),
    );
    expect(await resolve('.codocs/file.yaml/../sibling.yaml')).toMatchObject({
      success: false,
      status: 'denied',
    });
  });
  it('일반 .codocs 파일을 상대와 논리 절대 경로로 요청하면 같은 확인 대상을 반환한다', /** 일반 .codocs 파일을 상대와 논리 절대 경로로 요청하면 같은 확인 대상을 반환한다. */ async () => {
    const logicalPath = path.join(project, '.codocs', '한글 Case.yaml');
    await writeFile(logicalPath, '원문');
    for (const input of ['.codocs/한글 Case.yaml', logicalPath]) {
      expect(await resolve(input)).toMatchObject({
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
    expect(await resolve('./.codocs/nested/../target.yaml')).toMatchObject({
      success: true,
      path: path.join('.codocs', 'target.yaml'),
    });
  });
  it('연결 폴더 하위에서 ..로 연결 루트까지만 돌아오면 허용한다', /** 연결 폴더 하위에서 ..로 연결 루트까지만 돌아오면 허용한다. */ async () => {
    await mkdir(path.join(outside, 'nested'));
    await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
    expect(await resolve('.codocs/folder/nested/../target.yaml')).toMatchObject(
      {
        success: true,
        path: path.join('.codocs', 'folder', 'target.yaml'),
        realPath: await realpath(path.join(outside, 'target.yaml')),
      },
    );
  });
  it('연결 폴더 하위에서 ..를 반복해 연결 루트 밖으로 요청하면 거부한다', /** 연결 폴더 하위에서 ..를 반복해 연결 루트 밖으로 요청하면 거부한다. */ async () => {
    await mkdir(path.join(outside, 'nested'));
    await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
    const result = await resolve('.codocs/folder/nested/../../sibling.yaml');
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
  });
  it('논리 절대 경로의 폴더 링크 뒤에 ..가 있으면 정규화 전에 거부한다', /** 논리 절대 경로의 폴더 링크 뒤에 ..가 있으면 정규화 전에 거부한다. */ async () => {
    await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
    expect(
      await resolve(
        path.join(project, '.codocs', 'folder') +
          path.sep +
          '..' +
          path.sep +
          'target.yaml',
      ),
    ).toMatchObject({ success: false, status: 'denied' });
  });
  it('.codocs에서 ..로 프로젝트 안의 임의 파일에 접근하면 거부한다', /** .codocs에서 ..로 프로젝트 안의 임의 파일에 접근하면 거부한다. */ async () => {
    await writeFile(path.join(project, 'outside.yaml'), '원문');
    expect(await resolve('.codocs/../outside.yaml')).toMatchObject({
      success: false,
      status: 'denied',
    });
    expect(await resolve('outside.yaml')).toMatchObject({
      success: false,
      status: 'denied',
    });
  });
  it('.codocs와 접두사만 같은 폴더를 요청하면 거부한다', /** .codocs와 접두사만 같은 폴더를 요청하면 거부한다. */ async () => {
    await mkdir(path.join(project, '.codocs-other'));
    expect(await resolve('.codocs-other')).toMatchObject({
      success: false,
      status: 'denied',
    });
  });
  it('.codocs 자체가 외부 폴더 링크이면 하위 파일을 허용하고 연결 루트 밖 이동은 거부한다', /** .codocs 자체가 외부 폴더 링크이면 하위 파일을 허용하고 연결 루트 밖 이동은 거부한다. */ async () => {
    await rm(path.join(project, '.codocs'), { recursive: true });
    await symlink(outside, path.join(project, '.codocs'), 'dir');
    expect(await resolve('.codocs/target.yaml')).toMatchObject({
      success: true,
      path: path.join('.codocs', 'target.yaml'),
      realPath: await realpath(path.join(outside, 'target.yaml')),
      scope: {
        kind: 'linkedDirectory',
        logicalPath: path.join(project, '.codocs'),
        realPath: await realpath(outside),
      },
    });
    expect(await resolve('.codocs/../sibling.yaml')).toMatchObject({
      success: false,
      status: 'denied',
    });
  });
  it('외부 폴더 안에 별도 외부 파일 링크가 있으면 해당 파일만 새 연결 범위로 허용한다', /** 외부 폴더 안에 별도 외부 파일 링크가 있으면 해당 파일만 새 연결 범위로 허용한다. */ async () => {
    const shared = path.join(fixture, 'shared.yaml');
    await writeFile(shared, '공유');
    await symlink(shared, path.join(outside, 'nested.yaml'), 'file');
    await symlink(outside, path.join(project, '.codocs', 'folder'), 'dir');
    expect(await resolve('.codocs/folder/nested.yaml')).toMatchObject({
      success: true,
      scope: {
        kind: 'linkedFile',
        logicalPath: path.join(project, '.codocs', 'folder', 'nested.yaml'),
        realPath: await realpath(shared),
      },
    });
    expect(
      await resolve('.codocs/folder/nested.yaml/../sibling.yaml'),
    ).toMatchObject({ success: false, status: 'denied' });
  });
  it('파일 링크가 다른 파일 링크를 가리키면 최종 확인한 실제 파일을 반환한다', /** 파일 링크가 다른 파일 링크를 가리키면 최종 확인한 실제 파일을 반환한다. */ async () => {
    await symlink('target.yaml', path.join(outside, 'chain.yaml'), 'file');
    await symlink(
      path.join(outside, 'chain.yaml'),
      path.join(project, '.codocs', 'file.yaml'),
      'file',
    );
    expect(await resolve('.codocs/file.yaml')).toMatchObject({
      success: true,
      realPath: await realpath(path.join(outside, 'target.yaml')),
      scope: { kind: 'linkedFile' },
    });
  });
  it('두 폴더 링크가 같은 외부 폴더에 도달하면 서로 다른 논리 경로를 보존한다', /** 두 폴더 링크가 같은 외부 폴더에 도달하면 서로 다른 논리 경로를 보존한다. */ async () => {
    await symlink(outside, path.join(project, '.codocs', '공통A'), 'dir');
    await symlink(outside, path.join(project, '.codocs', '공통B'), 'dir');
    const first = await resolve('.codocs/공통A/target.yaml');
    const second = await resolve('.codocs/공통B/target.yaml');
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
  });
  it('한글과 Unicode 표기가 다른 링크 이름을 요청하면 두 논리 경로를 별도로 유지한다', /** 한글과 Unicode 표기가 다른 링크 이름을 요청하면 두 논리 경로를 별도로 유지한다. */ async () => {
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
      expect(await resolve(path.join('.codocs', folder, name))).toMatchObject({
        success: true,
        path: path.join('.codocs', folder, name),
      });
    }
  });
  it('유효한 프로젝트에 .codocs가 없으면 누락 상태와 확인한 논리 경로를 반환한다', /** 유효한 프로젝트에 .codocs가 없으면 누락 상태와 확인한 논리 경로를 반환한다. */ async () => {
    await rm(path.join(project, '.codocs'), { recursive: true });
    expect(await resolve('.codocs')).toEqual({
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
  it('.codocs 자체가 깨진 링크이면 부재 대신 대상 확인 실패를 반환한다', /** .codocs 자체가 깨진 링크이면 부재 대신 대상 확인 실패를 반환한다. */ async () => {
    await rm(path.join(project, '.codocs'), { recursive: true });
    await symlink(
      path.join(fixture, 'missing'),
      path.join(project, '.codocs'),
      'dir',
    );
    expect(await resolve('.codocs')).toMatchObject({
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
  });
  it('하위 파일 링크가 깨지면 원문·실경로·좌표 없이 실패 경로와 실제 ENOENT를 반환한다', /** 하위 파일 링크가 깨지면 원문·실경로·좌표 없이 실패 경로와 실제 ENOENT를 반환한다. */ async () => {
    await symlink(
      path.join(outside, 'missing.yaml'),
      path.join(project, '.codocs', 'broken.yaml'),
      'file',
    );
    const result = await resolve('.codocs/broken.yaml');
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
  });
  it('.codocs 자체가 파일이면 디렉터리 진단을 반환한다', /** .codocs 자체가 파일이면 디렉터리 진단을 반환한다. */ async () => {
    await rm(path.join(project, '.codocs'), { recursive: true });
    await writeFile(path.join(project, '.codocs'), '원문');
    expect(await resolve('.codocs')).toMatchObject({
      success: false,
      status: 'unavailable',
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.notDirectory,
          message: workspaceDiagnosticMessages.notDirectory,
          path: '.codocs',
        },
      ],
    });
  });
  it('비문자열·공백·NUL 경로를 받으면 확인하지 않은 경로를 만들지 않고 거부한다', /** 비문자열·공백·NUL 경로를 받으면 확인하지 않은 경로를 만들지 않고 거부한다. */ async () => {
    for (const input of [null, 1, {}, '', ' ', '.codocs/\0bad']) {
      expect(await resolve(input)).toEqual({
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
    }
  });
  it('파일 링크 두 개가 서로를 가리키면 실제 ELOOP를 실패 진단으로 반환한다', /** 파일 링크 두 개가 서로를 가리키면 실제 ELOOP를 실패 진단으로 반환한다. */ async () => {
    await symlink('b.yaml', path.join(project, '.codocs', 'a.yaml'), 'file');
    await symlink('a.yaml', path.join(project, '.codocs', 'b.yaml'), 'file');
    expect(await resolve('.codocs/a.yaml')).toMatchObject({
      success: false,
      status: 'unavailable',
      diagnostics: [
        { code: workspaceDiagnosticCodes.pathUnavailable, ioCode: 'ELOOP' },
      ],
    });
  });
  it('루트 선택 후 루트가 삭제되면 .codocs 부재로 숨기지 않고 루트 실패를 반환한다', /** 루트 선택 후 루트가 삭제되면 .codocs 부재로 숨기지 않고 루트 실패를 반환한다. */ async () => {
    const selected = await resolveProjectRoot({ cwd: project });
    if (!selected.success) throw new Error('fixture 루트 선택 실패');
    await rm(project, { recursive: true });
    expect(await resolveWorkspacePath(selected.root, '.codocs')).toMatchObject({
      success: false,
      status: 'unavailable',
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.projectRootUnavailable,
          path: project,
        },
      ],
    });
  });
  it('파일 뒤에 점이나 구분자로 디렉터리 탐색을 요청하면 파일로 성공시키지 않는다', /** 파일 뒤에 점이나 구분자로 디렉터리 탐색을 요청하면 파일로 성공시키지 않는다. */ async () => {
    await writeFile(path.join(project, '.codocs', 'file.yaml'), '원문');
    for (const suffix of [path.sep + '.', path.sep]) {
      expect(await resolve('.codocs/file.yaml' + suffix)).toMatchObject({
        success: false,
        status: 'unavailable',
        diagnostics: [{ code: workspaceDiagnosticCodes.notDirectory }],
      });
    }
  });
  it('하위 폴더 탐색 권한이 없으면 실제 EACCES와 실패 경로만 반환한다', /** 권한이 없는 실제 임시 폴더에서 파일 조회 실패를 확인하고 권한을 복구한다. */ async () => {
    const folder = path.join(project, '.codocs', 'restricted');
    await mkdir(folder);
    await writeFile(path.join(folder, 'file.yaml'), '원문');
    await chmod(folder, 0);
    try {
      const result = await resolve('.codocs/restricted/file.yaml');
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
  });
  it('연결 파일에 OS 쓰기 권한이 없어도 정책 범위는 읽기와 쓰기를 허용한다', /** 실제 쓰기는 하지 않고 연결 범위 정책과 OS 파일 권한이 별개임을 확인한다. */ async () => {
    const target = path.join(outside, 'target.yaml');
    await chmod(target, 0o400);
    await symlink(
      target,
      path.join(project, '.codocs', 'readonly.yaml'),
      'file',
    );
    try {
      expect(await resolve('.codocs/readonly.yaml')).toMatchObject({
        success: true,
        access: { read: true, write: true },
        scope: { kind: 'linkedFile' },
      });
    } finally {
      await chmod(target, 0o600);
    }
  });
});
