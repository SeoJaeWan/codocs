import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleIde } from '../build/build.mjs';
import {
  nameReferenceConfig,
  nameReferenceJs,
  nameReferenceTs,
} from './name-references/index.js';
import {
  queryContractConfig,
  queryContractJs,
  queryContractTs,
} from './query-contract/index.js';

import { resolvePnpm } from '../check/runtime.mjs';

const root = process.cwd();
mkdirSync(path.join(root, '.workbench/fixtures'), { recursive: true });
const fixture = mkdtempSync(
  path.join(root, '.workbench/fixtures/빌드 소비자 with spaces-'),
);
afterAll(
  /** 실행별 소비자와 설치 store를 정리한다. */ () => {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  },
);
const consumer = path.join(fixture, 'consumer');
const folders = ['core', 'workspace', 'mcp', 'language-server', 'vscode'];
const names = ['core', 'workspace', 'mcp', 'language-server', 'vscode'];
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');

/** 실제 subprocess를 실행해 stdout과 실패 상태를 확인한다. */
function run(args: string[], cwd = consumer): string {
  return execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

/** 원본 또는 배포된 예제를 소스 없는 소비자의 공개 파서와 검증기로 검사한다. */
function checkExamples(directory: string): void {
  const cases = [
    {
      relative: 'examples/.codocs/order.yaml',
      expected: {
        id: 'sample-order',
        name: '가상 주문',
        definition:
          '가상 고객의 구매 요청이며 [[가상 주문 처리]] 절차를 따른다.',
        domains: ['sample-sales'],
        examples: ['가상 주문 SAMPLE-001을 생성한다.'],
      },
    },
    {
      relative: 'examples/.codocs/fulfillment.yaml',
      expected: {
        id: 'sample-fulfillment',
        name: '가상 주문 처리',
        definition:
          '가상 프로젝트에서 [[가상 주문]]를 확인한 뒤 가상 배송 상태를 기록한다.',
        domains: ['sample-sales'],
      },
    },
  ].map((item) => ({
    ...item,
    source: readFileSync(path.join(root, item.relative), 'utf8'),
  }));
  const script = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseYaml, validateDocument, getKeyRange, getValueRange, getPropertyRange, buildCatalog } from '@codocs/core';
const observations = [];
for (const item of ${JSON.stringify(cases)}) {
  const filePath = path.join(process.argv[2], item.relative);
  const source = readFileSync(filePath, 'utf8');
  assert.equal(source, item.source);
  const parsed = parseYaml(source, filePath);
  assert.equal(parsed.success, true, JSON.stringify(parsed.diagnostics));
  assert.equal(parsed.source, source);
  observations.push({path: item.relative, parsed});
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.data, item.expected);
  const before = structuredClone(parsed);
  const validated = validateDocument({data: parsed.data, source: parsed.source, fields: parsed.fields, path: filePath, ...(parsed.rootRange ? {rootRange: parsed.rootRange} : {})});
  assert.equal(validated.success, true, JSON.stringify(validated.errors));
  assert.deepEqual(validated.data, item.expected);
  assert.deepEqual(validated.errors, []);
  assert.deepEqual(validated.warnings, []);
  assert.deepEqual(parsed, before);
  const key = getKeyRange(parsed, ['id']);
  const value = getValueRange(parsed, ['id']);
  const property = getPropertyRange(parsed, ['id']);
  assert.ok(key && value && property);
  assert.equal(source.slice(key.start, key.end), 'id');
  assert.equal(source.slice(value.start, value.end), item.expected.id);
  const newline = source.includes('\\r\\n') ? '\\r\\n' : '\\n';
  assert.equal(source.slice(property.start, property.end), 'id: ' + item.expected.id + newline);
}
const catalog = buildCatalog({status: 'complete', observations});
for (const document of catalog.documents.values()) {
  assert.equal(document.occurrences.length, 1);
  assert.equal(document.occurrences[0].resolution.status, 'resolved');
  assert.equal(document.references.length, 1);
  assert.equal(document.referencedBy.length, 1);
}
console.log('2 examples parsed and validated');`;
  writeFileSync(path.join(consumer, 'examples.mjs'), script);
  expect(run(['examples.mjs', directory])).toContain(
    '2 examples parsed and validated',
  );
}

/** 디렉터리 안의 실제 출력 파일을 상대 경로로 반환한다. */
function outputFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? outputFiles(target) : [target];
  });
}

beforeAll(
  /** 이전 출력 없는 빌드와 소스 없는 별도 소비자를 준비한다. */ () => {
    // build 명령 자체가 모든 dist를 지우며, 이전 산출물로 성공하지 않는다.
    run(['tools/build/build.mjs', 'build'], root);
    const resolvedFixture = path.resolve(fixture);
    if (
      !resolvedFixture.startsWith(
        path.resolve(root, '.workbench/fixtures') + path.sep,
      )
    )
      throw new Error('Fixture path escapes workspace');
    rmSync(resolvedFixture, { recursive: true, force: true });
    mkdirSync(consumer, { recursive: true });
    const coreManifest: unknown = JSON.parse(
      readFileSync(path.join(root, 'packages/core/package.json'), 'utf8'),
    );
    if (
      typeof coreManifest !== 'object' ||
      coreManifest === null ||
      !('dependencies' in coreManifest)
    )
      throw new Error('Core dependencies missing');
    writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify({
        type: 'module',
        dependencies: coreManifest.dependencies,
      }),
    );
    const coreRequire = createRequire(
      path.join(root, 'packages/core/package.json'),
    );
    for (const dependency of ['yaml', 'zod']) {
      const directory = path.dirname(
        coreRequire.resolve(dependency + '/package.json'),
      );
      cpSync(directory, path.join(consumer, 'node_modules', dependency), {
        recursive: true,
      });
    }
    for (let index = 0; index < folders.length; index++) {
      const folder = folders[index];
      const name = names[index];
      if (!folder || !name) throw new Error('Invalid package mapping');
      const source = path.join(root, 'packages', folder);
      const destination = path.join(consumer, 'node_modules/@codocs', name);
      mkdirSync(destination, { recursive: true });
      cpSync(
        path.join(source, 'package.json'),
        path.join(destination, 'package.json'),
      );
      cpSync(path.join(source, 'dist'), path.join(destination, 'dist'), {
        recursive: true,
      });
    }
  },
  60_000,
);

describe('실제 빌드 package 소비자', /** JS와 선언 파일을 소스 없이 소비한다. */ () => {
  it('이름 참조 공개 JS 소비자가 추출·색인·갱신·rename 계획과 실제 파일 상태를 확인한다', /** 링크 없는 소스 없는 소비자에서 공개 루트 계산 계약을 실행한다. */ () => {
    writeFileSync(path.join(consumer, 'name-references.mjs'), nameReferenceJs);
    expect(run(['name-references.mjs'])).toContain(
      'Name reference JS contract verified',
    );
  });

  it('이름 참조 공개 d.ts 소비자가 strict 상태 분기와 진단 코드 합집합을 좁힌다', /** 내부 subpath와 검증되지 않은 데이터 접근도 선언으로 거부한다. */ () => {
    writeFileSync(path.join(consumer, 'name-references.ts'), nameReferenceTs);
    writeFileSync(
      path.join(consumer, 'name-references.json'),
      JSON.stringify(nameReferenceConfig),
    );
    expect(run([tsc, '-p', 'name-references.json'])).toBe('');
  });

  it('MCP 공개 JS 소비자가 소스 없이 조회 handler와 package root 경계를 실행한다', /** 실제 dist만 복사한 소비자에서 목록·상세·입력 오류를 확인한다. */ () => {
    writeFileSync(path.join(consumer, 'query-contract.mjs'), queryContractJs);
    expect(run(['query-contract.mjs'])).toContain(
      'MCP query JS contract verified',
    );
  });

  it('MCP 공개 d.ts 소비자가 strict scanStatus와 결과 union을 좁힌다', /** 성공·실패 및 없음·충돌·본문 분기의 필드 존재를 검사한다. */ () => {
    writeFileSync(path.join(consumer, 'query-contract.ts'), queryContractTs);
    writeFileSync(
      path.join(consumer, 'query-contract.json'),
      JSON.stringify(queryContractConfig),
    );
    expect(run([tsc, '-p', 'query-contract.json'])).toBe('');
  });

  it('이름 참조 tarball 소비자가 symlink 없이 공개 JS·d.ts와 내부 subpath 거부를 실행한다', /** 기존 링크 fixture 실패와 독립적으로 실제 pack 배포를 추출해 소비한다. */ () => {
    const directory = mkdtempSync(path.join(fixture, 'name packed '));
    const packed = path.join(directory, 'consumer');
    const pnpm = resolvePnpm();
    mkdirSync(packed);
    writeFileSync(
      path.join(packed, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    for (const folder of ['core', 'workspace']) {
      const archive = path.join(directory, folder + '.tgz');
      run(
        [
          pnpm,
          '--dir',
          path.join(root, 'packages', folder),
          'pack',
          '--out',
          archive,
        ],
        root,
      );
      const files = execFileSync('tar', ['-tzf', archive], {
        encoding: 'utf8',
      });
      expect(files).toContain('package/dist/index.js');
      expect(files).toContain('package/dist/index.d.ts');
      expect(files).not.toContain('package/src/');
      const destination = path.join(packed, 'node_modules/@codocs', folder);
      mkdirSync(destination, { recursive: true });
      execFileSync('tar', [
        '-xzf',
        archive,
        '-C',
        destination,
        '--strip-components=1',
      ]);
      expect(existsSync(path.join(destination, 'src'))).toBe(false);
    }
    for (const dependency of ['yaml', 'zod'])
      cpSync(
        path.join(consumer, 'node_modules', dependency),
        path.join(packed, 'node_modules', dependency),
        { recursive: true },
      );
    writeFileSync(path.join(packed, 'name-references.mjs'), nameReferenceJs);
    writeFileSync(path.join(packed, 'name-references.ts'), nameReferenceTs);
    writeFileSync(
      path.join(packed, 'name-references.json'),
      JSON.stringify(nameReferenceConfig),
    );
    expect(run(['name-references.mjs'], packed)).toContain(
      'Name reference JS contract verified',
    );
    expect(run([tsc, '-p', 'name-references.json'], packed)).toBe('');
  });

  it('workspace tarball만 설치한 JS·TS 소비자가 실제 문서를 로딩하고 내부 subpath를 거부한다', /** 소스 없는 배포 소비자의 실제 IO와 구분된 반환 타입 및 exports 경계를 검증한다. */ () => {
    const directory = mkdtempSync(path.join(fixture, 'workspace packed '));
    const packedConsumer = path.join(directory, 'consumer');
    try {
      mkdirSync(packedConsumer);
      const pnpm = resolvePnpm();
      for (const folder of ['core', 'workspace']) {
        const archive = path.join(directory, folder + '.tgz');
        run(
          [
            pnpm,
            '--dir',
            path.join(root, 'packages', folder),
            'pack',
            '--out',
            archive,
          ],
          root,
        );
        const files = execFileSync('tar', ['-tzf', archive], {
          encoding: 'utf8',
        });
        expect(files).toContain('package/dist/index.js');
        expect(files).toContain('package/dist/index.d.ts');
        expect(files).not.toContain('package/src/');
      }
      writeFileSync(
        path.join(packedConsumer, 'package.json'),
        JSON.stringify({
          type: 'module',
          dependencies: {
            '@codocs/core': 'file:../core.tgz',
            '@codocs/workspace': 'file:../workspace.tgz',
          },
        }),
      );
      // private workspace 의존성도 같은 실제 tarball로 해석하도록 소비자 전용 workspace를 고정한다.
      writeFileSync(
        path.join(packedConsumer, 'pnpm-workspace.yaml'),
        "packages: ['.']\noverrides:\n  '@codocs/core': 'file:../core.tgz'\n",
      );
      const install = [
        pnpm,
        'install',
        '--store-dir',
        path.join(directory, 'pnpm-store'),
        '--cache-dir',
        path.join(directory, 'pnpm-cache'),
      ];
      // 새 tarball과 전이 의존성을 전용 store에 준비한 뒤 실제 설치를 offline/frozen으로 반복한다.
      for (const options of [[], ['--offline', '--frozen-lockfile']]) {
        const installed = spawnSync(
          process.execPath,
          [...install, ...options],
          {
            cwd: packedConsumer,
            encoding: 'utf8',
          },
        );
        expect(installed.status, installed.stdout + installed.stderr).toBe(0);
        rmSync(path.join(packedConsumer, 'node_modules'), {
          recursive: true,
          force: true,
        });
      }
      const restored = spawnSync(
        process.execPath,
        [...install, '--offline', '--frozen-lockfile'],
        { cwd: packedConsumer, encoding: 'utf8' },
      );
      expect(restored.status, restored.stdout + restored.stderr).toBe(0);
      for (const name of ['core', 'workspace']) {
        expect(
          existsSync(
            path.join(packedConsumer, 'node_modules/@codocs', name, 'src'),
          ),
        ).toBe(false);
      }
      writeFileSync(
        path.join(packedConsumer, 'workspace.mjs'),
        `import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, realpath, rm} from 'node:fs/promises';
import path from 'node:path';
import {loadWorkspace, resolveWorkspacePath, workspaceDiagnosticCodes, workspaceDiagnosticMessages} from '@codocs/workspace';
import * as core from '@codocs/core';
assert.equal(workspaceDiagnosticCodes.readFailed, 'workspace_read_failed');
assert.equal(workspaceDiagnosticMessages.readFailed, '작업 경로를 읽을 수 없습니다.');
assert.equal('workspaceDiagnosticCodes' in core, false);
assert.equal('workspaceDiagnosticMessages' in core, false);
assert.ok(import.meta.resolve('@codocs/workspace').startsWith(new URL('./node_modules/', import.meta.url).href));
const temporary = await mkdtemp(path.join(process.cwd(), '실제 프로젝트 '));
try {
  const project = path.join(temporary, 'project');
  const codocs = path.join(project, '.codocs');
  const external = path.join(temporary, '외부 공통');
  await mkdir(path.join(codocs, '하위 폴더'), {recursive: true});
  await mkdir(external);
  const termRaw = '# 원문 😀\\r\\nid: packed-term\\r\\nname: 용어\\r\\ndefinition: 정의\\r\\ndomains: [영역]\\r\\ncustom: {nested: [null, true, 1]}\\r\\n';
  const knowledgeRaw = 'id: packed-knowledge\\nname: 제목\\ndefinition: 본문\\ndomains: [영역]\\n';
  const parseRaw = 'name: [\\n';
  const schemaRaw = 'name: ID 누락\\ndefinition: 정의\\ndomains: [영역]\\n';
  const externalFile = path.join(temporary, '외부 용어.yaml');
  await writeFile(externalFile, termRaw);
  await writeFile(path.join(external, '공유 지식.yml'), knowledgeRaw);
  await writeFile(path.join(codocs, '하위 폴더', '파싱 오류.yaml'), parseRaw);
  await writeFile(path.join(codocs, '하위 폴더', 'ID 누락.yml'), schemaRaw);
  await symlink(externalFile, path.join(codocs, '연결 용어.yaml'), 'file');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(external, path.join(codocs, '공통A'), linkType);
  await symlink(external, path.join(codocs, '공통B'), linkType);
  await symlink(codocs, path.join(external, '돌아가기'), linkType);
  const scan = await loadWorkspace({cwd: temporary, project: 'project'});
  assert.equal(scan.status, 'complete');
  assert.equal(scan.root.projectRoot, project);
  assert.deepEqual(scan.failures, []);
  assert.equal(scan.documents.length, 5);
  assert.equal(scan.skippedCycles.length, 2);
  for (const cycle of scan.skippedCycles) {
    assert.equal(cycle.realPath, await realpath(codocs));
    assert.equal(cycle.diagnostics[0].code, 'circular_directory_link');
    assert.equal(cycle.diagnostics[0].severity, 'warning');
  }
  const byPath = new Map(scan.documents.map(document => [document.source.path, document]));
  const term = byPath.get(path.join('.codocs', '연결 용어.yaml'));
  assert.ok(term);
  assert.equal(term.status, 'valid');
  assert.equal(term.raw, termRaw);
  assert.equal(term.source.logicalPath, path.join(codocs, '연결 용어.yaml'));
  assert.equal(term.source.realPath, await realpath(externalFile));
  assert.equal(Object.hasOwn(term.data, 'type'), false);
  assert.equal(term.data.id, 'packed-term');
  assert.equal(term.data.name, '용어');
  assert.deepEqual(term.data.custom, {nested: [null, true, 1]});
  assert.equal(term.scope.kind, 'linkedFile');
  assert.deepEqual(term.access, {read: true, write: true});
  assert.equal(term.diagnostics.length, 1);
  const warning = term.diagnostics[0];
  assert.equal(warning.code, 'unknown_field');
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.path, term.source.path);
  assert.deepEqual(warning.fieldPath, ['custom']);
  assert.deepEqual(warning.range, {start: {line: 5, character: 0}, end: {line: 5, character: 6}});
  for (const branch of ['공통A', '공통B']) {
    const document = byPath.get(path.join('.codocs', branch, '공유 지식.yml'));
    assert.ok(document);
    assert.equal(document.status, 'valid');
    assert.equal(document.raw, knowledgeRaw);
    assert.equal(document.source.realPath, await realpath(path.join(external, '공유 지식.yml')));
    assert.equal(document.data.id, 'packed-knowledge');
    assert.equal(document.scope.kind, 'linkedDirectory');
    assert.deepEqual(document.access, {read: true, write: true});
  }
  for (const [filename, raw, status, code] of [
    ['파싱 오류.yaml', parseRaw, 'parseError', 'invalid_yaml'],
    ['ID 누락.yml', schemaRaw, 'validationError', 'missing_required_field'],
  ]) {
    const sourcePath = path.join('.codocs', '하위 폴더', filename);
    const document = byPath.get(sourcePath);
    assert.ok(document);
    assert.equal(document.status, status);
    assert.equal(document.raw, raw);
    assert.equal(document.source.logicalPath, path.join(project, sourcePath));
    assert.equal(document.source.realPath, await realpath(path.join(project, sourcePath)));
    assert.equal(Object.hasOwn(document, 'data'), false);
    assert.ok(document.diagnostics.some(issue => issue.code === code && issue.path === sourcePath && issue.range));
  }
  const denied = await resolveWorkspacePath(scan.root, externalFile);
  assert.equal(denied.success, false);
  assert.equal(denied.status, 'denied');
  for (const sourcePath of [['.codocs', '연결 용어.yaml', '..'].join(path.sep), ['.codocs', '공통A', '..', '형제.yaml'].join(path.sep)]) {
    const result = await resolveWorkspacePath(scan.root, sourcePath);
    assert.equal(result.success, false);
    assert.equal(result.status, 'denied');
  }
  await symlink(path.join(temporary, '없는 파일.yaml'), path.join(codocs, '깨진 연결.yaml'), 'file');
  const partial = await loadWorkspace({project});
  assert.equal(partial.status, 'partial');
  assert.equal(partial.documents.length, 5);
  assert.equal(partial.failures.length, 1);
  const failure = partial.failures[0];
  assert.equal(failure.path, path.join('.codocs', '깨진 연결.yaml'));
  assert.equal(failure.diagnostics[0].code, 'path_unavailable');
  assert.equal(failure.diagnostics[0].ioCode, 'ENOENT');
  for (const key of ['raw', 'realPath', 'id', 'range']) assert.equal(Object.hasOwn(failure, key), false);
  const emptyProject = path.join(temporary, 'empty');
  await mkdir(emptyProject);
  const empty = await loadWorkspace({project: emptyProject});
  assert.equal(empty.status, 'complete');
  assert.deepEqual(empty.documents, []);
  const failed = await loadWorkspace({project: path.join(temporary, 'missing')});
  assert.equal(failed.status, 'failed');
  assert.equal(Object.hasOwn(failed, 'root'), false);
  assert.equal(failed.failures.length, 1);
  for (const subpath of ['src/index.js', 'dist/index.js', 'dist/loader/index.js']) {
    await assert.rejects(import('@codocs/workspace/' + subpath), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  }
  console.log('Workspace packed JS contract verified');
} finally {
  await rm(temporary, {recursive: true, force: true});
}`,
      );
      expect(run(['workspace.mjs'], packedConsumer)).toContain(
        'Workspace packed JS contract verified',
      );
      const config = {
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noEmit: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          types: [],
          skipLibCheck: false,
        },
        files: ['workspace.ts'],
      };
      writeFileSync(
        path.join(packedConsumer, 'tsconfig.json'),
        JSON.stringify(config),
      );
      writeFileSync(
        path.join(packedConsumer, 'workspace.ts'),
        `import {loadWorkspace, resolveWorkspacePath, workspaceDiagnosticCodes, workspaceDiagnosticMessages} from '@codocs/workspace';
import type {WorkspaceScanResult, WorkspaceDocumentResult, WorkspaceScanDiagnostic, WorkspaceScanFailure, WorkspaceDocumentSource, WorkspaceSkippedCycle, WorkspaceDiagnostic, WorkspaceDiagnosticCode} from '@codocs/workspace';
import type {Diagnostic, DiagnosticCode} from '@codocs/core';
const workspaceCode: WorkspaceDiagnosticCode = workspaceDiagnosticCodes.readFailed;
const workspaceIssue: WorkspaceDiagnostic = {code: workspaceCode, severity: 'error', message: workspaceDiagnosticMessages.readFailed};
const commonIssue: Diagnostic<WorkspaceDiagnosticCode> = workspaceIssue;
void commonIssue;
// @ts-expect-error workspace codes exclude YAML parser codes
const invalidWorkspaceCode: WorkspaceDiagnosticCode = 'invalid_yaml';
// @ts-expect-error core codes exclude workspace IO codes
const invalidCoreCode: DiagnosticCode = 'workspace_read_failed';
// @ts-expect-error workspace diagnostic code type is owned by workspace
import type {WorkspaceDiagnosticCode as RemovedCoreCode} from '@codocs/core';
void invalidWorkspaceCode; void invalidCoreCode;
const scan: WorkspaceScanResult = await loadWorkspace({project: 'project'});
const documents: readonly WorkspaceDocumentResult[] = scan.documents;
const failures: readonly WorkspaceScanFailure[] = scan.failures;
const cycles: readonly WorkspaceSkippedCycle[] = scan.skippedCycles;
const diagnostics: readonly WorkspaceScanDiagnostic[] = scan.diagnostics;
void failures; void cycles;
if (scan.status === 'complete' || scan.status === 'partial') {
  const root: string = scan.root.projectRoot;
  const checked = await resolveWorkspacePath(scan.root, '.codocs/terms.yaml');
  if (checked.success) {const write: true = checked.access.write; void write;}
  void root;
} else {
  const root: string | undefined = scan.root?.projectRoot;
  void root;
  // @ts-expect-error failed scans may not expose a confirmed root
  const absent: string = scan.root.projectRoot;
  void absent;
}
for (const document of documents) {
  const source: WorkspaceDocumentSource = document.source;
  const raw: string = document.raw;
  void source; void raw;
  if (document.status === 'valid') {
    const id: string = document.data.id;
    void id;
    const name: string = document.data.name;
    const domains: string[] = document.data.domains;
    void name; void domains;
    // @ts-expect-error document names remain strings
    const wrong: number = document.data.name;
    void wrong;
  } else {
    const status: 'parseError' | 'validationError' = document.status;
    void status;
    // @ts-expect-error read content errors have no validated data
    const absent = document.data;
    void absent;
  }
  // @ts-expect-error document status must be narrowed before reading data
  const unnarrowed = document.data;
  void unnarrowed;
}
for (const issue of diagnostics) {
  if (issue.code === 'workspace_read_failed' || issue.code === 'path_unavailable') {
    const ioCode: string | undefined = issue.ioCode;
    void ioCode;
  }
}
`,
      );
      const trace = run(
        [tsc, '-p', 'tsconfig.json', '--traceResolution'],
        packedConsumer,
      );
      const normalizedTrace = trace.replaceAll('\\', '/');
      expect(normalizedTrace).toMatch(
        /@codocs\/workspace[^\n]*\/dist\/index\.d\.ts/,
      );
      expect(normalizedTrace).toMatch(
        /@codocs\/core[^\n]*\/dist\/index\.d\.ts/,
      );
      expect(normalizedTrace).not.toContain('/src/index.ts');
      for (const subpath of [
        'src/index.js',
        'dist/index.js',
        'dist/loader/index.js',
      ]) {
        writeFileSync(
          path.join(packedConsumer, 'workspace.ts'),
          `import type * as Hidden from '@codocs/workspace/${subpath}';\nexport type Value = typeof Hidden;\n`,
        );
        const failure = spawnSync(
          process.execPath,
          [tsc, '-p', 'tsconfig.json'],
          { cwd: packedConsumer, encoding: 'utf8' },
        );
        expect(failure.status).toBe(2);
        expect(failure.stdout + failure.stderr).toContain('TS2307');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('기존 예제 두 파일은 단일 매핑으로 해석되고 ID·참조·본문을 유지한다', /** 공개 API로 실제 YAML과 원문 위치를 고정 기대값에 대조한다. */ () => {
    checkExamples(root);
  });

  it('Node subprocess가 ESM import 및 CJS require 진입점을 실제 로드한다', /** package 이름과 exports를 통해 모든 실제 출력을 로드한다. */ () => {
    const script = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ${JSON.stringify(names)}) {
  const value = await import('@codocs/' + name);
  if (typeof value !== 'object') throw new Error('Invalid module: ' + name);
}
for (const name of ['language-server', 'vscode']) {
  if (typeof require('@codocs/' + name) !== 'object') throw new Error('Invalid CJS');
}
const { parseYaml, getValueRange, yamlDiagnosticCodes, validateDocument } = await import('@codocs/core');
const validated = validateDocument({ data: {id: 'order', name: '주문', definition: '정의', domains: ['영역'], custom: {nested: [null, 1, true]}} });
if (!validated.success || validated.data.custom.nested[1] !== 1 || validated.warnings.length !== 1) throw new Error('Validator dependency failed');
if (!import.meta.resolve('zod').startsWith(new URL('./node_modules/zod/', import.meta.url).href)) throw new Error('Zod dependency must be local');
const parsed = parseYaml('name: "한글 😀"\\n');
const range = getValueRange(parsed, ['name']);
if (!parsed.success || parsed.data.name !== '한글 😀' || !range || parsed.source.slice(range.start, range.end) !== '"한글 😀"') throw new Error('Parser API failed');
const invalid = parseYaml('name: [');
if (invalid.success || !invalid.diagnostics.some(issue => issue.code === yamlDiagnosticCodes.invalidYaml)) throw new Error('Invalid YAML diagnostic failed');
const unsupported = parseYaml('name: first\\nname: second');
if (unsupported.success || !unsupported.diagnostics.some(issue => issue.code === yamlDiagnosticCodes.unsupportedYamlFeature)) throw new Error('Unsupported YAML diagnostic failed');
if (!import.meta.resolve('yaml').startsWith(new URL('./node_modules/yaml/', import.meta.url).href)) throw new Error('Yaml dependency must be local');
console.log('JS packages loaded');`;
    writeFileSync(path.join(consumer, 'consume.mjs'), script);
    expect(run(['consume.mjs'])).toContain('JS packages loaded');
    for (const name of names) {
      expect(
        existsSync(path.join(consumer, 'node_modules/@codocs', name, 'src')),
      ).toBe(false);
    }
  });

  it('빌드된 파서에 문법 오류나 중복 키를 입력하면 약속한 오류 코드 문자열을 반환한다', /** 기능 테스트는 공통 상수를 사용하므로, 이 계약 테스트는 명시적인 문자열로 외부 반환 코드의 호환성을 따로 검증한다. */ () => {
    const script = `import assert from 'node:assert/strict';
import { parseYaml } from '@codocs/core';
const invalid = parseYaml('name: [');
assert.equal(invalid.success, false);
assert.ok(invalid.diagnostics.some(issue => issue.code === 'invalid_yaml'));
const unsupported = parseYaml('name: first\\nname: second');
assert.equal(unsupported.success, false);
assert.ok(unsupported.diagnostics.some(issue => issue.code === 'unsupported_yaml_feature'));
console.log('Diagnostic code contract verified');`;
    writeFileSync(path.join(consumer, 'diagnosticCodes.mjs'), script);
    expect(run(['diagnosticCodes.mjs'])).toContain(
      'Diagnostic code contract verified',
    );
  });

  it('빌드된 검증기를 파일과 객체 후보에 사용하면 외부 진단 계약과 입력을 보존한다', /** 실제 파일을 읽고 제품 코드·심각도·경로·UTF-16 위치와 불변성을 검사한다. */ () => {
    const source =
      '# 앞\n---\n{id: Bad-ID, definition: 정의, domains: [영역], examples: ["😀", false], aliases: [old]} # 뒤\n';
    const filePath = path.join(consumer, 'invalid terms.yaml');
    writeFileSync(filePath, source);
    const script = `import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseYaml, validateDocument, schemaDiagnosticMessages} from '@codocs/core';
const filePath = process.argv[2];
const source = readFileSync(filePath, 'utf8');
const parsed = parseYaml(source, filePath);
assert.equal(parsed.success, true);
const input = {data: parsed.data, source: parsed.source, fields: parsed.fields, rootRange: parsed.rootRange, path: filePath};
const before = structuredClone(input);
const result = validateDocument(input);
assert.equal(result.success, false);
assert.equal(Object.hasOwn(result, 'data'), false);
assert.deepEqual(input, before);
const expected = [
  ['missing_required_field', ['name'], source.slice(source.indexOf('{'), source.indexOf('}') + 1)],
  ['invalid_field_type', ['examples', 1], 'false'],
  ['invalid_field_value', ['id'], 'Bad-ID'],
];
assert.equal(result.errors.length, expected.length);
for (const [code, fieldPath, slice] of expected) {
  const issue = result.errors.find(item => JSON.stringify(item.fieldPath) === JSON.stringify(fieldPath));
  assert.ok(issue);
  assert.equal(issue.code, code);
  assert.equal(issue.severity, 'error');
  assert.equal(issue.path, filePath);
  if (code === 'invalid_field_value') assert.equal(issue.message, schemaDiagnosticMessages.invalidId);
  const start = source.indexOf(slice);
  const offsetPosition = offset => {const lines = source.slice(0, offset).split('\\n'); return {line: lines.length - 1, character: lines.at(-1).length};};
  assert.deepEqual(issue.range, {start: offsetPosition(start), end: offsetPosition(start + slice.length)});
}
assert.equal(result.warnings.length, 1);
const warning = result.warnings[0];
assert.equal(warning.code, 'unknown_field');
assert.equal(warning.message, schemaDiagnosticMessages.unknownField);
assert.equal(warning.severity, 'warning');
assert.equal(warning.path, filePath);
assert.deepEqual(warning.fieldPath, ['aliases']);
const aliasStart = source.split('\\n')[2].indexOf('aliases');
assert.deepEqual(warning.range, {start: {line: 2, character: aliasStart}, end: {line: 2, character: aliasStart + 'aliases'.length}});
const candidate = {id: 'sample', name: ' 标题 😀 ', definition: ' Body [[sample-order]] ', domains: [' Sales '], aliases: [' Old '], custom: {nested: [null, true, 1.5, {'a.b': ' Value '}]}};
const candidateBefore = structuredClone(candidate);
const accepted = validateDocument({data: candidate});
assert.equal(accepted.success, true);
assert.deepEqual(accepted.data, candidateBefore);
assert.deepEqual(candidate, candidateBefore);
assert.deepEqual(accepted.errors, []);
assert.deepEqual(accepted.warnings.map(issue => [issue.code, issue.severity, issue.fieldPath]), [['unknown_field', 'warning', ['aliases']], ['unknown_field', 'warning', ['custom']]]);
assert.equal(Object.hasOwn(accepted.data, 'status'), false);
for (const issue of accepted.warnings) {assert.equal(Object.hasOwn(issue, 'path'), false); assert.equal(Object.hasOwn(issue, 'range'), false);}
const rejectedCandidate = {...candidate, domains: []};
const rejectedBefore = structuredClone(rejectedCandidate);
const rejected = validateDocument({data: rejectedCandidate});
assert.equal(rejected.success, false);
assert.equal(rejected.errors[0].code, 'invalid_field_value');
assert.deepEqual(rejected.errors[0].fieldPath, ['domains']);
assert.equal(Object.hasOwn(rejected.errors[0], 'range'), false);
assert.equal(Object.hasOwn(rejected, 'data'), false);
assert.deepEqual(rejectedCandidate, rejectedBefore);
console.log('Validator external contract verified');`;
    writeFileSync(path.join(consumer, 'validatorContract.mjs'), script);
    expect(run(['validatorContract.mjs', filePath])).toContain(
      'Validator external contract verified',
    );
  });

  it('별도 TS 소비자가 dist d.ts를 해석하고 금지 subpath를 거부한다', /** 타입 namespace를 출력 없이 검사하고 해석 경로를 확인한다. */ () => {
    const code =
      names
        .map(
          (name, index) =>
            `import type * as Package${index} from '@codocs/${name}';\nexport type Module${index} = typeof Package${index};`,
        )
        .join('\n') +
      "\nimport { parseYaml, getKeyRange, getValueRange, getPropertyRange, offsetToPosition, yamlDiagnosticCodes, validateDocument } from '@codocs/core';\nimport type { YamlParseResult, FieldPath, OffsetRange, SourcePosition, YamlDiagnostic, YamlDiagnosticCode, Document } from '@codocs/core';\nconst parsed: YamlParseResult = parseYaml('name: test');\nconst path: FieldPath = ['name'];\nexport const ranges: (OffsetRange | undefined)[] = [getKeyRange(parsed, path), getValueRange(parsed, path), getPropertyRange(parsed, path)];\nexport const position: SourcePosition | undefined = offsetToPosition('😀', 2);\nexport const diagnostics: readonly YamlDiagnostic[] = parsed.diagnostics;\nexport const diagnosticCode: YamlDiagnosticCode = yamlDiagnosticCodes.invalidYaml;\nexport const returnedCodes: readonly YamlDiagnosticCode[] = diagnostics.map(issue => issue.code);\nconst validated = validateDocument({data: parsed.success ? parsed.data : {}});\nif (validated.success) {\n  const data: Document = validated.data;\n  const name: string = data.name; void name;\n  const domains: string[] = data.domains; void domains;\n}\n";
    const validatorTypes = `
// @ts-expect-error 이전 성공 타입은 단일 Document로 대체됐다.
import type { Term, Knowledge } from '@codocs/core';
import type { DocumentValidationResult, ValidateDocumentInput, JsonValue, SchemaDiagnostic, SchemaDiagnosticCode } from '@codocs/core';
const input: ValidateDocumentInput = {data: {}};
const result: DocumentValidationResult = validateDocument(input);
export const issues: readonly SchemaDiagnostic[] = [...result.errors, ...result.warnings];
export const code: SchemaDiagnosticCode = 'invalid_field_value';
export const json: JsonValue = {nested: [null, false, 1, 'value']};
if (result.success) {
  const document: Document = result.data;
  const id: string = document.id;
  void id;
  const fields: string[] = [document.name, document.definition, ...document.domains];
  const examples: string[] | undefined = document.examples;
  const aliases: {name: string; message?: string | undefined}[] | undefined = document.deprecatedAliases;
  const kind: 'policy' | 'procedure' | 'decision' | 'discussion' | undefined = document.kind;
  const status: 'proposed' | 'confirmed' | 'deprecated' | undefined = document.status;
  void fields; void examples; void aliases; void kind; void status;
  // @ts-expect-error document.name must remain a string
  const wrongName: number = document.name;
  // @ts-expect-error document.domains must remain a string array
  const wrongDomains: number[] = document.domains;
  void wrongName; void wrongDomains;
} else {
  // @ts-expect-error failure must not expose validated data
  const absent = result.data;
  void absent;
}
// @ts-expect-error unknown success must be narrowed before reading data
const unnarrowed = result.data;
void unnarrowed;
// @ts-expect-error document schema is internal
import {documentSchema} from '@codocs/core';
void documentSchema;
// @ts-expect-error term structure is internal
import {termStructure} from '@codocs/core';
void termStructure;
// @ts-expect-error knowledge structure is internal
import {knowledgeStructure} from '@codocs/core';
void knowledgeStructure;
`;
    const config = {
      compilerOptions: {
        strict: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        // Zod 선언의 URL 전역 참조도 실제 기본 라이브러리로 검사한다.
        lib: ['ES2022', 'DOM'],
        types: [],
        skipLibCheck: false,
      },
      files: ['consume.ts'],
    };
    writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify(config));
    writeFileSync(path.join(consumer, 'consume.ts'), code + validatorTypes);
    const trace = run([tsc, '-p', 'tsconfig.json', '--traceResolution']);
    for (const name of names) {
      expect(trace.replaceAll('\\', '/')).toContain(
        `@codocs/${name}/dist/index.d.ts`,
      );
    }
    expect(trace).not.toContain('/src/index.ts');
    // 공개 입력 타입만 사용해도 root 선언의 Zod URL 의존성은 남는다.
    writeFileSync(
      path.join(consumer, 'consume.ts'),
      "import type {ValidateDocumentInput} from '@codocs/core';\nexport const input: ValidateDocumentInput = {data: {}};\n",
    );
    writeFileSync(
      path.join(consumer, 'tsconfig.json'),
      JSON.stringify({
        ...config,
        compilerOptions: { ...config.compilerOptions, lib: ['ES2022'] },
      }),
    );
    const esOnlyFailure = spawnSync(
      process.execPath,
      [tsc, '-p', 'tsconfig.json'],
      { cwd: consumer, encoding: 'utf8' },
    );
    expect(esOnlyFailure.status).not.toBe(0);
    expect(esOnlyFailure.stdout + esOnlyFailure.stderr).toContain(
      "TS2304: Cannot find name 'URL'",
    );
    writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify(config));
    writeFileSync(
      path.join(consumer, 'consume.ts'),
      "import type * as Hidden from '@codocs/core/src/index.js';\nexport type Value = typeof Hidden;\n",
    );
    const failure = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], {
      cwd: consumer,
      encoding: 'utf8',
    });
    expect(failure.status).not.toBe(0);
    expect(failure.stdout + failure.stderr).toContain('TS2307');
  });

  it('Node도 package 내부 subpath를 거부한다', /** runtime exports가 내부 접근을 차단하는지 실제 오류 코드로 확인한다. */ () => {
    writeFileSync(
      path.join(consumer, 'hidden.mjs'),
      `try {
  await import('@codocs/core/dist/index.js');
  process.exit(1);
} catch (error) {
  if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  console.log(error.code);
}`,
    );
    expect(run(['hidden.mjs'])).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('각 출력 형식, test 제외 및 실제 배포 asset 복사를 확인한다', /** 가이드와 가상 YAML 및 서버 배치가 source와 동일한지 확인한다. */ () => {
    for (const folder of folders) {
      const directory = path.join(root, 'packages', folder, 'dist');
      const extension = ['language-server', 'vscode'].includes(folder)
        ? 'cjs'
        : 'js';
      expect(existsSync(path.join(directory, `index.${extension}`))).toBe(true);
      expect(existsSync(path.join(directory, 'index.d.ts'))).toBe(true);
      expect(
        outputFiles(directory).every(
          (file) => !/\.(test|spec)\.[cm]?[jt]s(?:\.map)?$/u.test(file),
        ),
      ).toBe(true);
    }
    for (const folder of ['mcp', 'vscode']) {
      for (const relative of [
        'docs/guide/README.md',
        'examples/.codocs/order.yaml',
        'examples/.codocs/fulfillment.yaml',
      ]) {
        expect(
          readFileSync(
            path.join(root, 'packages', folder, 'dist', relative),
            'utf8',
          ),
        ).toBe(readFileSync(path.join(root, relative), 'utf8'));
      }
      checkExamples(
        path.join(consumer, 'node_modules/@codocs', folder, 'dist'),
      );
    }
    expect(
      readFileSync(
        path.join(root, 'packages/vscode/dist/server/index.cjs'),
        'utf8',
      ),
    ).toBe(
      readFileSync(
        path.join(root, 'packages/language-server/dist/index.cjs'),
        'utf8',
      ),
    );
  });

  it('test 입력 파일을 실제 tsc 출력에서 제외한다', /** 실제 package build 설정으로 test 파일을 추가한 격리 source를 emit한다. */ () => {
    const directory = path.join(fixture, 'exclude tests');
    mkdirSync(path.join(directory, 'src'), { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(path.join(directory, 'src/index.ts'), 'export {};\n');
    writeFileSync(
      path.join(directory, 'src/ignored.test.ts'),
      'export const ignored = true;\n',
    );
    writeFileSync(
      path.join(directory, 'src/ignored.spec.ts'),
      'export const ignored = true;\n',
    );
    const sourceConfig: unknown = JSON.parse(
      readFileSync(
        path.join(root, 'packages/core/tsconfig.build.json'),
        'utf8',
      ),
    );
    if (
      typeof sourceConfig !== 'object' ||
      sourceConfig === null ||
      Array.isArray(sourceConfig)
    )
      throw new Error('Invalid build config');
    writeFileSync(
      path.join(directory, 'tsconfig.json'),
      JSON.stringify({
        ...sourceConfig,
        extends: path.join(root, 'packages/core/tsconfig.json'),
        include: ['src/**/*.ts'],
        compilerOptions: {
          noEmit: false,
          declaration: true,
          rootDir: 'src',
          outDir: 'dist',
        },
      }),
    );
    run([tsc, '-p', 'tsconfig.json'], directory);
    expect(
      outputFiles(path.join(directory, 'dist')).every(
        (file) => !file.includes('ignored'),
      ),
    ).toBe(true);
  });

  it('pnpm pack 결과에 guide/example/server asset을 포함한다', /** 실제 tarball의 파일 목록으로 배포 asset 포함을 확인한다. */ () => {
    const pnpm = resolvePnpm();
    for (const folder of ['mcp', 'vscode']) {
      const archive = path.join(fixture, folder + '.tgz');
      run(
        [
          pnpm,
          '--dir',
          path.join(root, 'packages', folder),
          'pack',
          '--out',
          archive,
        ],
        root,
      );
      const files = execFileSync('tar', ['-tzf', archive], {
        encoding: 'utf8',
      });
      for (const relative of [
        'docs/guide/README.md',
        'examples/.codocs/order.yaml',
        'examples/.codocs/fulfillment.yaml',
      ]) {
        expect(files).toContain('package/dist/' + relative);
      }
      expect(files).not.toContain('package/src/');
      const extracted = path.join(fixture, 'packed', folder);
      mkdirSync(extracted, { recursive: true });
      execFileSync('tar', ['-xzf', archive, '-C', extracted]);
      expect(
        readFileSync(
          path.join(extracted, 'package/dist/docs/guide/README.md'),
          'utf8',
        ),
      ).toBe(readFileSync(path.join(root, 'docs/guide/README.md'), 'utf8'));
      checkExamples(path.join(extracted, 'package/dist'));
      if (folder === 'vscode')
        expect(files).toContain('package/dist/server/index.cjs');
    }
  });

  it('실제 tsc 오류와 같은 source의 독립 esbuild 성공을 구분한다', /** 의도적 타입 오류는 타입 검사에서 실패하고 번들은 실행 가능함을 보여 준다. */ async () => {
    const directory = path.join(fixture, 'type error');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    const source = path.join(directory, 'index.ts');
    writeFileSync(
      source,
      'export const value: number = "intentional-type-error";\n',
    );
    writeFileSync(
      path.join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: path.join(root, 'tsconfig.runtime.json'),
        compilerOptions: { noEmit: true, types: [] },
        files: ['index.ts'],
      }),
    );
    const failure = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(failure.status).not.toBe(0);
    expect(failure.stdout + failure.stderr).toContain('TS2322');
    await bundleIde([source], path.join(directory, 'index.cjs'));
    expect(
      run(
        [
          '-e',
          "if (require('./index.cjs').value !== 'intentional-type-error') process.exit(1);",
        ],
        directory,
      ),
    ).toBe('');
  });

  it('CJS 서버 bundle에서 ESM package를 소비하고 vscode를 external로 유지한다', /** 실제 package import와 호스트 모듈 external 처리를 같은 빌드 함수로 검사한다. */ async () => {
    const source = path.join(consumer, 'adapter.ts');
    writeFileSync(
      source,
      `import { parseYaml, validateDocument } from '@codocs/core';
import '@codocs/workspace';
const source = 'id: bundled\\nname: 名前 😀\\ndefinition: 定義\\ndomains: [Sales]\\n';
const parsed = parseYaml(source);
if (!parsed.success) throw new Error('Bundled parser failed');
const result = validateDocument({data: parsed.data, source: parsed.source, fields: parsed.fields, ...(parsed.rootRange ? {rootRange: parsed.rootRange} : {})});
if (!result.success || result.data.name !== '名前 😀' || result.errors.length || result.warnings.length) throw new Error('Bundled validator failed');
const invalid = validateDocument({data: {...result.data, id: 'Bad-ID'}});
if (invalid.success || invalid.errors[0]?.code !== 'invalid_field_value') throw new Error('Bundled validator error failed');
export const loaded = true;
`,
    );
    await bundleIde([source], path.join(consumer, 'adapter.cjs'));
    expect(
      run(['-e', "if (!require('./adapter.cjs').loaded) process.exit(1);"]),
    ).toBe('');
    writeFileSync(
      source,
      "import * as vscode from 'vscode';\nexport const host = vscode;\n",
    );
    const output = await bundleIde([source], path.join(consumer, 'host.cjs'), [
      'vscode',
    ]);
    expect(
      Object.values(output.metafile.outputs).flatMap((file) => file.imports),
    ).toContainEqual(
      expect.objectContaining({ path: 'vscode', external: true }),
    );
    expect(readFileSync(path.join(consumer, 'host.cjs'), 'utf8')).toContain(
      'require("vscode")',
    );
  });
});
