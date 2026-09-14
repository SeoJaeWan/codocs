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
import { resolveProjectRoot } from '../index.js';
import {
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
} from '../diagnostics/index.js';

let fixture: string;
beforeEach(
  /** 테스트마다 고유한 실제 파일 fixture를 생성한다. */ async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'codosc-root-'));
  },
);
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe('프로젝트 루트 선택', /** 프로젝트 루트 선택. */ () => {
  it('project를 생략하면 시작 cwd를 루트로 유지한다', /** project를 생략하면 시작 cwd를 루트로 유지한다. */ async () => {
    const result = await resolveProjectRoot({ cwd: fixture });
    expect(result).toMatchObject({
      success: true,
      root: {
        projectRoot: fixture,
        startCwd: fixture,
        codocsPath: path.join(fixture, '.codocs'),
      },
    });
  });
  it('상대 project를 지정하면 시작 cwd 기준 디렉터리를 선택한다', /** 상대 project를 지정하면 시작 cwd 기준 디렉터리를 선택한다. */ async () => {
    await mkdir(path.join(fixture, '선택 폴더'));
    expect(
      await resolveProjectRoot({ cwd: fixture, project: './선택 폴더' }),
    ).toMatchObject({
      success: true,
      root: { projectRoot: path.join(fixture, '선택 폴더') },
    });
  });
  it('절대 project를 지정하면 시작 cwd와 무관하게 지정한 디렉터리를 선택한다', /** 절대 project를 지정하면 시작 cwd와 무관하게 지정한 디렉터리를 선택한다. */ async () => {
    const selected = path.join(fixture, 'selected');
    await mkdir(selected);
    expect(
      await resolveProjectRoot({ cwd: fixture, project: selected }),
    ).toMatchObject({ success: true, root: { projectRoot: selected } });
  });
  it('상위에 .codocs와 .git이 있으면 하위 cwd를 루트로 유지한다', /** 상위에 .codocs와 .git이 있으면 하위 cwd를 루트로 유지한다. */ async () => {
    await mkdir(path.join(fixture, '.codocs'));
    await mkdir(path.join(fixture, '.git'));
    const child = path.join(fixture, 'child');
    await mkdir(child);
    expect(await resolveProjectRoot({ cwd: child })).toMatchObject({
      success: true,
      root: { projectRoot: child },
    });
  });
  it('없는 디렉터리를 선택하면 정상 빈 프로젝트로 반환하지 않는다', /** 없는 디렉터리를 선택하면 정상 빈 프로젝트로 반환하지 않는다. */ async () => {
    expect(
      await resolveProjectRoot({ cwd: fixture, project: 'missing' }),
    ).toMatchObject({ success: false });
  });
  it('파일을 루트로 선택하면 디렉터리 검증에 실패한다', /** 파일을 루트로 선택하면 디렉터리 검증에 실패한다. */ async () => {
    await writeFile(path.join(fixture, 'file'), '원문');
    expect(
      await resolveProjectRoot({ cwd: fixture, project: 'file' }),
    ).toMatchObject({ success: false });
  });
  it('비문자열이나 빈 project를 지정하면 실패한다', /** 비문자열이나 빈 project를 지정하면 실패한다. */ async () => {
    for (const project of ['', '  ', 0, null])
      expect(await resolveProjectRoot({ cwd: fixture, project })).toMatchObject(
        { success: false },
      );
  });
  it('없는 루트를 선택하면 실제 ENOENT 코드와 선택 경로만 반환한다', /** 없는 루트를 선택하면 실제 ENOENT 코드와 선택 경로만 반환한다. */ async () => {
    const selected = path.join(fixture, 'missing');
    const result = await resolveProjectRoot({
      cwd: fixture,
      project: selected,
    });
    expect(result).toEqual({
      success: false,
      projectRoot: selected,
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.projectRootUnavailable,
          severity: 'error',
          message: workspaceDiagnosticMessages.rootUnavailable,
          path: selected,
          ioCode: 'ENOENT',
        },
      ],
    });
    expect(result).not.toHaveProperty('root');
    expect(result.diagnostics[0]).not.toHaveProperty('range');
  });
  it('객체가 아닌 옵션을 받으면 경로나 실제 대상을 만들지 않고 실패한다', /** 객체가 아닌 옵션을 받으면 경로나 실제 대상을 만들지 않고 실패한다. */ async () => {
    for (const input of [null, [], 7, 'project']) {
      expect(await resolveProjectRoot(input)).toEqual({
        success: false,
        diagnostics: [
          {
            code: workspaceDiagnosticCodes.invalidProjectRoot,
            severity: 'error',
            message: workspaceDiagnosticMessages.invalidRootOptions,
          },
        ],
      });
    }
  });
  it('상대 cwd나 NUL을 받으면 시작 루트를 만들지 않고 실패한다', /** 상대 cwd나 NUL을 받으면 시작 루트를 만들지 않고 실패한다. */ async () => {
    for (const cwd of ['relative', '', 1, null, '/nul\0path']) {
      expect(await resolveProjectRoot({ cwd })).toEqual({
        success: false,
        diagnostics: [
          {
            code: workspaceDiagnosticCodes.invalidProjectRoot,
            severity: 'error',
            message: workspaceDiagnosticMessages.invalidCwd,
          },
        ],
      });
    }
  });
  it('cwd를 생략하면 호출 시점의 현재 디렉터리를 고정한다', /** cwd를 생략하면 호출 시점의 현재 디렉터리를 고정한다. */ async () => {
    const cwd = process.cwd();
    expect(await resolveProjectRoot()).toMatchObject({
      success: true,
      root: { startCwd: cwd, projectRoot: cwd },
    });
  });
  it('상대 project에 ..가 있으면 시작 cwd의 상위 지정 루트를 선택한다', /** 상대 project에 ..가 있으면 시작 cwd의 상위 지정 루트를 선택한다. */ async () => {
    const child = path.join(fixture, 'child');
    await mkdir(child);
    expect(
      await resolveProjectRoot({ cwd: child, project: '..' }),
    ).toMatchObject({
      success: true,
      root: { startCwd: child, projectRoot: fixture },
    });
  });
  it('루트가 폴더 링크이면 논리 선택 경로와 확인한 실제 경로를 구분한다', /** 루트가 폴더 링크이면 논리 선택 경로와 확인한 실제 경로를 구분한다. */ async () => {
    const alias = path.join(fixture, '별칭');
    const target = path.join(fixture, '실제');
    await mkdir(target);
    await symlink(target, alias, 'dir');
    expect(
      await resolveProjectRoot({ cwd: fixture, project: alias }),
    ).toMatchObject({
      success: true,
      root: {
        projectRoot: alias,
        realPath: await realpath(target),
        codocsPath: path.join(alias, '.codocs'),
      },
    });
  });
  it('루트 읽기와 탐색 권한이 없으면 빈 프로젝트가 아닌 실제 접근 실패를 반환한다', /** 루트 읽기와 탐색 권한이 없으면 빈 프로젝트가 아닌 실제 접근 실패를 반환한다. */ async () => {
    const restricted = path.join(fixture, 'restricted');
    await mkdir(restricted);
    await chmod(restricted, 0);
    try {
      expect(await resolveProjectRoot({ cwd: restricted })).toEqual({
        success: false,
        projectRoot: restricted,
        diagnostics: [
          {
            code: workspaceDiagnosticCodes.projectRootUnavailable,
            severity: 'error',
            message: workspaceDiagnosticMessages.rootUnavailable,
            path: restricted,
            ioCode: 'EACCES',
          },
        ],
      });
    } finally {
      await chmod(restricted, 0o700);
    }
  });
  it('공백과 한글이 있는 루트를 선택하면 입력 이름을 trim하거나 변환하지 않는다', /** 공백과 한글이 있는 루트를 선택하면 입력 이름을 trim하거나 변환하지 않는다. */ async () => {
    const selected = path.join(fixture, ' 한글 Case ');
    await mkdir(selected);
    expect(
      await resolveProjectRoot({ cwd: fixture, project: ' 한글 Case ' }),
    ).toMatchObject({ success: true, root: { projectRoot: selected } });
  });
  it('project 접근자가 예외를 던지면 Promise 거부 없이 입력 진단을 반환한다', /** project 접근자가 예외를 던지면 Promise 거부 없이 입력 진단을 반환한다. */ async () => {
    const input = Object.defineProperty({ cwd: fixture }, 'project', {
      /** 예외를 던지는 외부 접근자를 재현한다. */
      get: () => {
        throw new Error('외부 접근자 오류');
      },
    });
    expect(await resolveProjectRoot(input)).toEqual({
      success: false,
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.invalidProjectRoot,
          severity: 'error',
          message: workspaceDiagnosticMessages.invalidRootOptions,
        },
      ],
    });
  });
  it('Proxy 입력이 폐기되어 있으면 Promise 거부 없이 입력 진단을 반환한다', /** Proxy 입력이 폐기되어 있으면 Promise 거부 없이 입력 진단을 반환한다. */ async () => {
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(await resolveProjectRoot(proxy.proxy)).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: workspaceDiagnosticCodes.invalidProjectRoot,
          message: workspaceDiagnosticMessages.invalidRootOptions,
        },
      ],
    });
  });
});
