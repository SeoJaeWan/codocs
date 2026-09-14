import {
  chmod,
  link,
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
  parseYaml,
  validateDocument,
  workspaceDiagnosticCodes,
} from '@codosc/core';
import { loadWorkspace, resolveWorkspacePath } from '../index.js';

let fixture: string;
let project: string;
let codocs: string;
let outside: string;
const raw =
  'type: term\r\nid: shared-term\r\nname: 용어\r\ndefinition: 정의\r\ndomain: 업무\r\n';
beforeEach(
  /** 고유한 실제 프로젝트와 외부 폴더를 준비한다. */ async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'codosc-loader-'));
    project = path.join(fixture, 'project');
    codocs = path.join(project, '.codocs');
    outside = path.join(fixture, 'outside');
    await mkdir(codocs, { recursive: true });
    await mkdir(outside);
  },
);
afterEach(
  /** 각 테스트에서 만든 fixture만 정리한다. */ async () => {
    await rm(fixture, { recursive: true, force: true });
  },
);

/** 프로젝트 아래 상대 경로에 원문을 그대로 기록한다. */
async function document(relative: string, source = raw): Promise<void> {
  const target = path.join(codocs, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, 'utf8');
}

describe('경로별 workspace 문서 로더', /** 실제 IO의 경로와 스캔 상태를 확인한다. */ () => {
  it('한글과 공백 경로의 yaml과 yml을 읽으면 CRLF 원문과 실제 경로를 보존한다', /** 사용자 YAML과 경로를 재포맷하지 않는다. */ async () => {
    for (const name of ['한글 폴더/Mixed.yaml', 'other/내용.yml'])
      await document(name);
    await document('skip.txt', '잘못된 YAML');
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(2);
    for (const item of result.documents) {
      expect(item.status).toBe('valid');
      expect(item.raw).toBe(raw);
      expect(item.source.realPath).toBe(
        await realpath(item.source.logicalPath),
      );
      expect(item.source.path).toBe(
        path.relative(project, item.source.logicalPath),
      );
      expect(item.access).toEqual({ read: true, write: true });
    }
    expect(result.failures).toEqual([]);
  });
  it('다른 Unicode와 대소문자 이름으로 같은 파일을 연결하면 두 발견 경로를 유지한다', /** 경로를 임의로 정규화하여 문서를 병합하지 않는다. */ async () => {
    const target = path.join(outside, 'target.yaml');
    await writeFile(target, raw);
    const names = ['first/Mixed-가.yaml', 'second/mixed-가.yml'];
    for (const name of names) {
      const file = path.join(codocs, name);
      await mkdir(path.dirname(file), { recursive: true });
      await symlink(target, file, 'file');
    }
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(2);
    expect(
      result.documents.map(
        /** 경로 표기를 그대로 비교한다. */ (item) => item.source.path,
      ),
    ).toEqual(
      names.map(
        /** 프로젝트 상대 경로를 계산한다. */ (name) =>
          path.join('.codocs', name),
      ),
    );
    expect(result.documents[0]?.source.realPath).toBe(
      result.documents[1]?.source.realPath,
    );
  });
  it('BOM과 주석이 있는 원문 및 빈 YAML을 읽으면 원문을 유지하고 내용 오류만 분리한다', /** 읽은 원문을 파서에 그대로 전달한다. */ async () => {
    const source = '\uFEFF# 한글 주석\r\n' + raw;
    await document('bom.yaml', source);
    await document('empty.yml', '');
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.failures).toEqual([]);
    expect(result.documents).toMatchObject([
      { status: 'valid', raw: source },
      { status: 'parseError', raw: '' },
    ]);
  });
  it('상위에만 .codocs가 있는 하위 디렉터리에서 읽으면 선택한 루트의 정상 빈 프로젝트다', /** 상위 프로젝트를 선택하지 않는다. */ async () => {
    await document('parent.yaml');
    const child = path.join(project, 'child');
    await mkdir(child);
    const result = await loadWorkspace({ cwd: child });
    expect(result).toMatchObject({
      status: 'complete',
      root: { projectRoot: child },
      documents: [],
      failures: [],
      diagnostics: [],
    });
  });
  it('빈 .codocs를 읽으면 정상 0개이며 상대 project는 시작 cwd를 기준으로 한다', /** 비어 있는 루트와 명시 선택을 확인한다. */ async () => {
    expect(
      await loadWorkspace({ cwd: fixture, project: 'project' }),
    ).toMatchObject({
      status: 'complete',
      root: { projectRoot: project },
      documents: [],
    });
  });
  it('외부 파일과 폴더 링크를 읽으면 논리 경로와 읽기 쓰기 범위를 제공한다', /** 외부 연결 범위는 부모 전체로 확장하지 않는다. */ async () => {
    const file = path.join(outside, '외부 파일.yaml');
    await writeFile(file, raw);
    await symlink(file, path.join(codocs, 'file.yml'), 'file');
    await symlink(outside, path.join(codocs, 'folder'), 'dir');
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(2);
    expect(
      result.documents.map(
        /** 연결 종류를 비교한다. */ (item) => item.scope.kind,
      ),
    ).toEqual(['linkedFile', 'linkedDirectory']);
    if (result.status === 'failed') throw new Error('정상 루트가 필요하다');
    for (const item of result.documents)
      expect(
        await resolveWorkspacePath(result.root, item.source.path),
      ).toMatchObject({ success: true, access: { read: true, write: true } });
    expect(
      await resolveWorkspacePath(
        result.root,
        path.join(outside, 'sibling.yaml'),
      ),
    ).toMatchObject({ success: false, status: 'denied' });
    expect(
      await resolveWorkspacePath(
        result.root,
        '.codocs/file.yml/../sibling.yaml',
      ),
    ).toMatchObject({ success: false, status: 'denied' });
  });
  it('.codocs 자체가 외부 폴더 링크이면 그 하위 문서를 읽는다', /** 명시적으로 연결된 스캔 루트를 처리한다. */ async () => {
    await rm(codocs, { recursive: true });
    await writeFile(path.join(outside, 'term.yaml'), raw);
    await symlink(outside, codocs, 'dir');
    const result = await loadWorkspace({ cwd: project });
    expect(result).toMatchObject({
      status: 'complete',
      documents: [{ status: 'valid', scope: { kind: 'linkedDirectory' } }],
    });
  });
  it('자기와 부모 폴더로 돌아오는 연결이 있으면 연결만 건너뛰고 정상 문서를 읽는다', /** 확인된 순환은 탐색 누락과 별도로 기록한다. */ async () => {
    await document('nested/ok.yaml');
    await symlink(codocs, path.join(codocs, 'self'), 'dir');
    await symlink(codocs, path.join(codocs, 'nested', 'parent'), 'dir');
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(1);
    expect(result.skippedCycles).toHaveLength(2);
    expect(result.failures).toEqual([]);
    for (const cycle of result.skippedCycles)
      expect(cycle.diagnostics).toMatchObject([
        {
          code: workspaceDiagnosticCodes.circularDirectoryLink,
          path: cycle.path,
        },
      ]);
  });
  it('여러 연결을 거쳐 조상으로 돌아오면 순환 연결만 중단한다', /** 별도 정상 문서는 계속 처리한다. */ async () => {
    const second = path.join(fixture, 'second');
    await mkdir(second);
    await writeFile(path.join(second, 'ok.yaml'), raw);
    await symlink(outside, path.join(codocs, 'first'), 'dir');
    await symlink(second, path.join(outside, 'second'), 'dir');
    await symlink(codocs, path.join(second, 'back'), 'dir');
    await document('normal.yaml');
    const result = await loadWorkspace({ cwd: project });
    expect(result).toMatchObject({
      status: 'complete',
      skippedCycles: [
        { path: path.join('.codocs', 'first', 'second', 'back') },
      ],
    });
    expect(result.documents).toHaveLength(2);
  });
  it('다른 두 가지가 같은 폴더에 도달하면 양쪽 논리 경로를 각각 읽는다', /** 전역 중복 제거로 중복 ID를 숨기지 않는다. */ async () => {
    await writeFile(path.join(outside, 'same.yaml'), raw);
    await symlink(outside, path.join(codocs, 'SharedA'), 'dir');
    await symlink(outside, path.join(codocs, 'sharedB'), 'dir');
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.skippedCycles).toEqual([]);
    expect(
      result.documents.map(
        /** 발견한 논리 경로를 확인한다. */ (item) => item.source.path,
      ),
    ).toEqual([
      path.join('.codocs', 'SharedA', 'same.yaml'),
      path.join('.codocs', 'sharedB', 'same.yaml'),
    ]);
    expect(result.documents[0]?.source.realPath).toBe(
      result.documents[1]?.source.realPath,
    );
    for (const item of result.documents) {
      if (item.status !== 'valid') throw new Error('유효 문서가 필요하다');
      expect(item.data.id).toBe('shared-term');
    }
  });
  it('같은 파일의 링크 별칭과 hardlink를 읽으면 모든 발견 경로를 보존한다', /** 파일 실제 경로가 같아도 대표 별칭을 고르지 않는다. */ async () => {
    await document('original.yaml');
    await symlink('original.yaml', path.join(codocs, 'alias.yml'), 'file');
    await link(
      path.join(codocs, 'original.yaml'),
      path.join(codocs, 'hardlink.yaml'),
    );
    const result = await loadWorkspace({ cwd: project });
    expect(result.documents).toHaveLength(3);
    expect(result.documents[0]?.source.realPath).toBe(
      result.documents[2]?.source.realPath,
    );
  });
  it('정상 파싱 오류 ID 누락이 섞이면 원문과 core 진단을 보존하며 스캔은 완료다', /** 내용 오류는 정상 검증 데이터와 구분한다. */ async () => {
    const broken = 'type: [\n';
    const missing = raw.replace('id: shared-term\r\n', '');
    await document('valid.yaml');
    await document('parse.yml', broken);
    await document('missing.yaml', missing);
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.failures).toEqual([]);
    const invalid = result.documents.find(
      /** 파싱 오류 파일을 선택한다. */ (item) => item.status === 'parseError',
    );
    expect(invalid).toMatchObject({ raw: broken, status: 'parseError' });
    expect(invalid).not.toHaveProperty('data');
    expect(invalid?.diagnostics).toEqual(
      parseYaml(broken).diagnostics.map(
        /** 파서 좌표에 확인한 경로만 추가한다. */ (item) => ({
          ...item,
          path: path.join('.codocs', 'parse.yml'),
        }),
      ),
    );
    const absent = result.documents.find(
      /** 스키마 오류 파일을 선택한다. */ (item) =>
        item.status === 'validationError',
    );
    expect(absent).toMatchObject({ raw: missing });
    expect(absent).not.toHaveProperty('data');
    const parsed = parseYaml(missing);
    if (!parsed.success) throw new Error('매핑이어야 한다');
    const validation = validateDocument({
      data: parsed.data,
      fields: parsed.fields,
      ...(parsed.rootRange === undefined
        ? {}
        : { rootRange: parsed.rootRange }),
      source: missing,
      path: path.join('.codocs', 'missing.yaml'),
    });
    expect(absent?.diagnostics).toEqual([
      ...validation.errors,
      ...validation.warnings,
    ]);
    expect(absent?.diagnostics[0]?.range).toBeDefined();
  });
  it('스키마 경고만 있으면 유효 문서와 원래 사용자 속성 좌표를 보존한다', /** 미등록 필드는 성공을 막지 않는다. */ async () => {
    await document('warning.yaml', raw + 'custom: 보존\r\n');
    const result = await loadWorkspace({ cwd: project });
    const item = result.documents[0];
    expect(result.status).toBe('complete');
    expect(item).toMatchObject({
      status: 'valid',
      data: { custom: '보존' },
      diagnostics: [
        {
          code: 'unknown_field',
          severity: 'warning',
          range: { start: { line: 5, character: 0 } },
        },
      ],
    });
  });
  it('깨진 링크가 있으면 실패 경로만 보관하고 정상 문서를 계속 읽어 부분 완료다', /** 얻지 못한 원문과 실제 경로를 만들지 않는다. */ async () => {
    await document('ok.yaml');
    await symlink(
      path.join(outside, 'missing.yaml'),
      path.join(codocs, 'broken.yml'),
      'file',
    );
    const result = await loadWorkspace({ cwd: project });
    expect(result).toMatchObject({
      status: 'partial',
      failures: [
        {
          path: path.join('.codocs', 'broken.yml'),
          diagnostics: [{ ioCode: 'ENOENT' }],
        },
      ],
    });
    expect(result.documents).toHaveLength(1);
    expect(result.failures[0]).not.toHaveProperty('raw');
    expect(result.failures[0]).not.toHaveProperty('realPath');
    expect(result.failures[0]).not.toHaveProperty('id');
  });
  it('하위 파일을 실제로 읽을 수 없으면 확인한 실제 경로와 IO 실패를 보관한다', /** chmod 권한 실패를 실제 readFile로 확인한다. */ async () => {
    await document('restricted.yaml');
    await document('ok.yaml');
    const target = path.join(codocs, 'restricted.yaml');
    await chmod(target, 0);
    try {
      const result = await loadWorkspace({ cwd: project });
      expect(result).toMatchObject({
        status: 'partial',
        failures: [
          {
            kind: 'file',
            path: path.join('.codocs', 'restricted.yaml'),
            realPath: await realpath(target),
            diagnostics: [
              { code: workspaceDiagnosticCodes.readFailed, ioCode: 'EACCES' },
            ],
          },
        ],
      });
      expect(result.documents).toHaveLength(1);
      expect(result.failures[0]).not.toHaveProperty('raw');
    } finally {
      await chmod(target, 0o600);
    }
  });
  it('하위 폴더 열거를 실제로 실패하면 누락 범위와 정상 파일을 함께 반환한다', /** execute만 있는 폴더에서 readdir 실패를 확인한다. */ async () => {
    await document('restricted/hidden.yaml');
    await document('ok.yaml');
    const folder = path.join(codocs, 'restricted');
    await chmod(folder, 0o100);
    try {
      const result = await loadWorkspace({ cwd: project });
      expect(result).toMatchObject({
        status: 'partial',
        failures: [
          {
            kind: 'directory',
            path: path.join('.codocs', 'restricted'),
            diagnostics: [
              { code: workspaceDiagnosticCodes.readFailed, ioCode: 'EACCES' },
            ],
          },
        ],
      });
      expect(result.documents).toHaveLength(1);
    } finally {
      await chmod(folder, 0o700);
    }
  });
  it('루트 또는 .codocs를 읽을 수 없으면 빈 성공 대신 전체 실패다', /** 실제 권한 실패를 복구하면서 확인한다. */ async () => {
    for (const target of [project, codocs]) {
      await chmod(target, 0);
      try {
        const result = await loadWorkspace({ cwd: project });
        expect(result.status).toBe('failed');
        expect(result.documents).toEqual([]);
        expect(result.diagnostics[0]).toMatchObject({ ioCode: 'EACCES' });
      } finally {
        await chmod(target, 0o700);
      }
    }
  });
  it('없는 루트와 파일 루트 또는 파일 .codocs이면 전체 실패다', /** 잘못된 루트와 잘못된 스캔 시작 대상을 구분한다. */ async () => {
    const file = path.join(fixture, 'file');
    await writeFile(file, raw);
    for (const cwd of [path.join(fixture, 'missing'), file])
      expect((await loadWorkspace({ cwd })).status).toBe('failed');
    await rm(codocs, { recursive: true });
    await writeFile(codocs, raw);
    expect(await loadWorkspace({ cwd: project })).toMatchObject({
      status: 'failed',
      failures: [
        {
          path: '.codocs',
          diagnostics: [{ code: workspaceDiagnosticCodes.notDirectory }],
        },
      ],
    });
  });
  it('깨진 .codocs 링크이면 정상 부재로 숨기지 않고 전체 실패다', /** 존재하는 연결의 대상 실패를 기록한다. */ async () => {
    await rm(codocs, { recursive: true });
    await symlink(path.join(outside, 'missing'), codocs, 'dir');
    expect(await loadWorkspace({ cwd: project })).toMatchObject({
      status: 'failed',
      failures: [{ path: '.codocs', diagnostics: [{ ioCode: 'ENOENT' }] }],
    });
  });
  it('루트 입력이 잘못되거나 접근자가 던지면 예외 대신 실패 진단을 반환한다', /** strict unknown 입력 계약을 유지한다. */ async () => {
    for (const options of [
      null,
      [],
      'project',
      { cwd: 'relative' },
      {
        /** 입력 접근자 예외를 만든다. */
        get cwd(): never {
          throw new Error('입력 접근 실패');
        },
      },
    ])
      expect((await loadWorkspace(options)).status).toBe('failed');
  });
});
