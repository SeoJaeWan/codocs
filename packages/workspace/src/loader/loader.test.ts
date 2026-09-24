import {
  createLink as symlink,
  fileSymlinksSupported,
} from '../test-support/links.js';
import { ioFailures } from '../test-support/file-system.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const { withIoFailures } = await import('../test-support/file-system.js');
  return withIoFailures(actual);
});
import {
  scanStatuses,
  schemaDiagnosticCodes,
  yamlDiagnosticCodes,
} from '@codocs/core';
import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceDiagnosticCodes } from '../diagnostics/index.js';
import { loadWorkspace } from './index.js';
import { workspaceDocumentStatuses } from './domain-values.js';

let fixture: string;
let project: string;
let codocs: string;
let outside: string;
const raw =
  'id: shared-term\r\nname: 용어\r\ndefinition: 정의\r\ndomains: [업무]\r\n';
beforeEach(
  /** 고유한 실제 프로젝트와 외부 폴더를 준비한다. */ async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'codocs-loader-'));
    project = path.join(fixture, 'project');
    codocs = path.join(project, '.codocs');
    outside = path.join(fixture, 'outside');
    await mkdir(codocs, { recursive: true });
    await mkdir(outside);
  },
);
afterEach(
  /** 오류 주입과 각 테스트의 fixture를 정리한다. */ async () => {
    ioFailures.clear();
    await rm(fixture, { recursive: true, force: true });
  },
);

/** 프로젝트 아래 상대 경로에 원문을 그대로 기록한다. */
async function document(relative: string, source: string): Promise<void> {
  const target = path.join(codocs, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, 'utf8');
}

describe('loadWorkspace: 발견 경로별 문서 읽기', () => {
  it('문서 파일 하나를 읽으면 완료 상태와 원문을 반환한다', async () => {
    const source = raw;
    await document('term.yaml', source);

    const result = await loadWorkspace({ cwd: project });

    expect(result.status).toBe(scanStatuses.complete);
    expect(result.documents).toMatchObject([
      {
        status: workspaceDocumentStatuses.valid,
        raw: source,
        source: { path: path.join('.codocs', 'term.yaml') },
      },
    ]);
  });

  it('한글과 공백 경로의 yaml과 yml을 읽으면 CRLF 원문과 실제 경로를 보존한다', /** 사용자 YAML과 경로를 재포맷하지 않는다. */ async () => {
    for (const name of ['한글 폴더/Mixed.yaml', 'other/내용.yml'])
      await document(name, raw);
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
  it('서로 다른 일반 파일의 Unicode 경로를 그대로 보존한다', async () => {
    const names = ['first/Mixed-가.yaml', 'second/mixed-가.yml'];
    for (const name of names) await document(name, raw);
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents.map((item) => item.source.path)).toEqual(
      names.map((name) => path.join('.codocs', name)),
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
      {
        status: 'valid',
        raw: source,
        revision: createHash('sha256').update(source).digest('hex'),
        utf8Lossless: true,
      },
      {
        status: 'parseError',
        raw: '',
        revision: createHash('sha256').update('').digest('hex'),
        utf8Lossless: true,
      },
    ]);
  });
  it('잘못된 UTF-8 바이트를 읽으면 원본 byte revision과 디코딩 손실을 함께 보존한다', /** 실제 파일 읽기에서 같은 대체 문자로 다른 바이트를 합치지 않는다. */ async () => {
    const prefix = Buffer.from(raw, 'utf8');
    const files = [
      {
        name: 'a.yaml',
        bytes: Buffer.concat([prefix, Buffer.from('# \x80\n', 'binary')]),
      },
      {
        name: 'b.yaml',
        bytes: Buffer.concat([prefix, Buffer.from('# \x81\n', 'binary')]),
      },
    ];
    for (const item of files)
      await writeFile(path.join(codocs, item.name), item.bytes);
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]?.raw).toBe(result.documents[1]?.raw);
    for (const [index, item] of files.entries()) {
      expect(result.documents[index]).toMatchObject({
        revision: createHash('sha256').update(item.bytes).digest('hex'),
        utf8Lossless: false,
      });
    }
    expect(result.documents[0]?.revision).not.toBe(
      result.documents[1]?.revision,
    );
  });
  it('상위에만 .codocs가 있는 하위 디렉터리에서 읽으면 선택한 루트의 정상 빈 프로젝트다', /** 상위 프로젝트를 선택하지 않는다. */ async () => {
    await document('parent.yaml', raw);
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
  it('하위 정션은 경고 후 제외하고 일반 문서는 계속 읽는다', async () => {
    await document('ordinary.yaml', raw);
    await writeFile(path.join(outside, 'external.yaml'), raw);
    await symlink(outside, path.join(codocs, 'linked'), 'junction');
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.source.path).toBe(
      path.join('.codocs', 'ordinary.yaml'),
    );
    expect(result.failures).toEqual([]);
    expect(result.skippedLinks).toMatchObject([
      {
        code: workspaceDiagnosticCodes.unsupportedWorkspaceLink,
        severity: 'warning',
        path: path.join('.codocs', 'linked'),
      },
    ]);
  });

  it('.codocs 자체가 정션이면 전체 실패다', async () => {
    await rm(codocs, { recursive: true });
    await writeFile(path.join(outside, 'term.yaml'), raw);
    await symlink(outside, codocs, 'junction');
    expect(await loadWorkspace({ cwd: project })).toMatchObject({
      status: 'failed',
      documents: [],
      failures: [
        {
          path: '.codocs',
          diagnostics: [
            { code: workspaceDiagnosticCodes.unsupportedWorkspaceLink },
          ],
        },
      ],
    });
  });

  it('하드 링크는 일반 파일로 읽고 발견 경로를 유지한다', async () => {
    await document('original.yaml', raw);
    await link(
      path.join(codocs, 'original.yaml'),
      path.join(codocs, 'hardlink.yaml'),
    );
    const result = await loadWorkspace({ cwd: project });
    expect(result.status).toBe('complete');
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((item) => item.scope.kind)).toEqual([
      'workspace',
      'workspace',
    ]);
  });
  describe('문서 내용 오류와 스캔 완료 상태', () => {
    it('정상 문서를 읽으면 검증된 데이터와 원문을 반환한다', async () => {
      await document('valid.yaml', raw);

      const result = await loadWorkspace({ cwd: project });

      expect(result.status).toBe(scanStatuses.complete);
      expect(result.failures).toEqual([]);
      expect(result.documents).toMatchObject([
        {
          status: workspaceDocumentStatuses.valid,
          raw,
          data: { id: 'shared-term', name: '용어' },
        },
      ]);
    });

    it('문법 오류가 있는 YAML을 읽으면 파싱 진단과 원문을 반환하고 스캔은 완료한다', async () => {
      const source = 'type: [\n';
      await document('parse.yml', source);

      const result = await loadWorkspace({ cwd: project });

      expect(result.status).toBe(scanStatuses.complete);
      expect(result.failures).toEqual([]);
      expect(result.documents[0]).toMatchObject({
        status: workspaceDocumentStatuses.parseError,
        raw: source,
        diagnostics: [
          expect.objectContaining({
            code: yamlDiagnosticCodes.invalidYaml,
            path: path.join('.codocs', 'parse.yml'),
            severity: 'error',
          }),
        ],
      });
      expect(result.documents[0]).not.toHaveProperty('data');
    });

    it('ID가 누락된 YAML을 읽으면 스키마 진단과 원문을 반환하고 스캔은 완료한다', async () => {
      const source = raw.replace('id: shared-term\r\n', '');
      await document('missing.yaml', source);

      const result = await loadWorkspace({ cwd: project });

      expect(result.status).toBe(scanStatuses.complete);
      expect(result.failures).toEqual([]);
      expect(result.documents[0]).toMatchObject({
        status: workspaceDocumentStatuses.validationError,
        raw: source,
        diagnostics: [
          expect.objectContaining({
            code: schemaDiagnosticCodes.missingRequiredField,
            fieldPath: ['id'],
            path: path.join('.codocs', 'missing.yaml'),
            severity: 'error',
          }),
        ],
      });
      expect(result.documents[0]).not.toHaveProperty('data');
      expect(result.documents[0]?.diagnostics[0]?.range).toBeDefined();
    });
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
          range: { start: { line: 4, character: 0 } },
        },
      ],
    });
  });
  it.skipIf(!fileSymlinksSupported)(
    '깨진 파일 연결도 부재로 바꾸지 않고 경고 후 제외한다',
    async () => {
      await document('ok.yaml', raw);
      await symlink(
        path.join(outside, 'missing.yaml'),
        path.join(codocs, 'broken.yml'),
        'file',
      );
      const result = await loadWorkspace({ cwd: project });
      expect(result.status).toBe('complete');
      expect(result.documents).toHaveLength(1);
      expect(result.failures).toEqual([]);
      expect(result.skippedLinks).toMatchObject([
        {
          code: workspaceDiagnosticCodes.unsupportedWorkspaceLink,
          severity: 'warning',
        },
      ]);
    },
  );
  it('하위 파일의 읽기 오류를 받으면 확인한 실제 경로와 IO 실패를 보관한다', /** readFile 오류 응답의 보존을 확인한다. */ async () => {
    await document('restricted.yaml', raw);
    await document('ok.yaml', raw);
    const target = path.join(codocs, 'restricted.yaml');
    ioFailures.set(target, {
      operations: ['access', 'readFile', 'readdir'],
      code: 'EACCES',
    });
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
      ioFailures.clear();
    }
  });
  it('하위 폴더 열거가 실패하면 누락 범위와 정상 파일을 함께 반환한다', /** 폴더 열거의 EACCES 응답을 주입한다. */ async () => {
    await document('restricted/hidden.yaml', raw);
    await document('ok.yaml', raw);
    const folder = path.join(codocs, 'restricted');
    ioFailures.set(folder, { operations: ['readdir'], code: 'EACCES' });
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
      ioFailures.clear();
    }
  });
  describe('스캔 시작 경로 실패', () => {
    it.each(['project', '.codocs'])(
      '%s 디렉터리의 탐색 권한이 없으면 전체 실패를 반환한다',
      async (kind) => {
        const target = kind === 'project' ? project : codocs;
        ioFailures.set(target, {
          operations: ['access', 'readFile', 'readdir'],
          code: 'EACCES',
        });
        try {
          const result = await loadWorkspace({ cwd: project });
          expect(result.status).toBe(scanStatuses.failed);
          expect(result.documents).toEqual([]);
          expect(result.diagnostics[0]).toMatchObject({ ioCode: 'EACCES' });
        } finally {
          ioFailures.clear();
        }
      },
    );

    it('없는 프로젝트 루트를 읽으면 전체 실패를 반환한다', async () => {
      const input = { cwd: path.join(fixture, 'missing') };
      const result = await loadWorkspace(input);
      expect(result.status).toBe(scanStatuses.failed);
    });

    it('파일을 프로젝트 루트로 선택하면 전체 실패를 반환한다', async () => {
      const target = path.join(fixture, 'file');
      await writeFile(target, raw);
      const input = { cwd: target };
      const result = await loadWorkspace(input);
      expect(result.status).toBe(scanStatuses.failed);
    });

    it('.codocs가 파일이면 디렉터리 오류와 함께 전체 실패를 반환한다', async () => {
      await rm(codocs, { recursive: true });
      await writeFile(codocs, raw);
      const result = await loadWorkspace({ cwd: project });
      expect(result).toMatchObject({
        status: scanStatuses.failed,
        failures: [
          {
            path: '.codocs',
            diagnostics: [{ code: workspaceDiagnosticCodes.notDirectory }],
          },
        ],
      });
    });
  });
  it('깨진 .codocs 정션이면 부재가 아니라 미지원 전체 실패다', async () => {
    const target = path.join(outside, 'missing');
    await rm(codocs, { recursive: true });
    await symlink(target, codocs, 'junction');
    expect(await loadWorkspace({ cwd: project })).toMatchObject({
      status: 'failed',
      failures: [
        {
          path: '.codocs',
          diagnostics: [
            { code: workspaceDiagnosticCodes.unsupportedWorkspaceLink },
          ],
        },
      ],
    });
  });
  describe('잘못된 루트 입력 방어', () => {
    it.each([
      { name: 'null', input: null },
      { name: '배열', input: [] },
      { name: '문자열', input: 'project' },
      { name: '상대 cwd', input: { cwd: 'relative' } },
    ])('$name 루트 입력을 받으면 실패 진단을 반환한다', async ({ input }) => {
      const result = await loadWorkspace(input);
      expect(result.status).toBe(scanStatuses.failed);
      expect(result.diagnostics).not.toEqual([]);
    });

    it('루트 입력 접근자가 예외를 던지면 호출을 거부하지 않고 실패 진단을 반환한다', async () => {
      const input = {
        /** 입력 접근자 예외를 재현한다. */
        get cwd(): never {
          throw new Error('입력 접근 실패');
        },
      };
      const result = await loadWorkspace(input);
      expect(result.status).toBe(scanStatuses.failed);
      expect(result.diagnostics).not.toEqual([]);
    });
  });
});
