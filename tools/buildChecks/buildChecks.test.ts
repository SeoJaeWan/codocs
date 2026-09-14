import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { bundleIde } from '../build/build.mjs';

const root = process.cwd();
const fixture = path.join(root, '.workbench/fixtures/빌드 소비자 with spaces');
const consumer = path.join(fixture, 'consumer');
const folders = ['core', 'workspace', 'mcp', 'languageServer', 'vscode'];
const names = ['core', 'workspace', 'mcp', 'language-server', 'vscode'];
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');

/** 실제 subprocess를 실행해 stdout과 실패 상태를 확인한다. */
function run(args: string[], cwd = consumer): string {
  return execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

/** 원본 또는 배포된 예제를 소스 없는 소비자의 공개 파서로 검사한다. */
function checkExamples(directory: string): void {
  const cases = [
    {
      relative: 'examples/.codocs/terms.yaml',
      expected: {
        type: 'term',
        id: 'sample-order',
        name: '가상 주문',
        definition:
          '가상 고객의 구매 요청이며 [[sample-fulfillment]] 절차를 따른다.',
        domain: 'sample-sales',
        examples: ['가상 주문 SAMPLE-001을 생성한다.'],
      },
    },
    {
      relative: 'examples/.codocs/knowledge.yaml',
      expected: {
        type: 'knowledge',
        id: 'sample-fulfillment',
        title: '가상 주문 처리',
        body: '가상 프로젝트에서 [[sample-order]]를 확인한 뒤 가상 배송 상태를 기록한다.',
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
import { parseYaml, getKeyRange, getValueRange, getPropertyRange } from '@codosc/core';
for (const item of ${JSON.stringify(cases)}) {
  const filePath = path.join(process.argv[2], item.relative);
  const source = readFileSync(filePath, 'utf8');
  assert.equal(source, item.source);
  const parsed = parseYaml(source, filePath);
  assert.equal(parsed.success, true, JSON.stringify(parsed.diagnostics));
  assert.equal(parsed.source, source);
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.data, item.expected);
  const key = getKeyRange(parsed, ['id']);
  const value = getValueRange(parsed, ['id']);
  const property = getPropertyRange(parsed, ['id']);
  assert.ok(key && value && property);
  assert.equal(source.slice(key.start, key.end), 'id');
  assert.equal(source.slice(value.start, value.end), item.expected.id);
  const newline = source.includes('\\r\\n') ? '\\r\\n' : '\\n';
  assert.equal(source.slice(property.start, property.end), 'id: ' + item.expected.id + newline);
}
console.log('2 examples parsed');`;
  writeFileSync(path.join(consumer, 'examples.mjs'), script);
  expect(run(['examples.mjs', directory])).toContain('2 examples parsed');
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
    const yamlDirectory = path.dirname(
      coreRequire.resolve('yaml/package.json'),
    );
    cpSync(yamlDirectory, path.join(consumer, 'node_modules/yaml'), {
      recursive: true,
    });
    for (let index = 0; index < folders.length; index++) {
      const folder = folders[index];
      const name = names[index];
      if (!folder || !name) throw new Error('Invalid package mapping');
      const source = path.join(root, 'packages', folder);
      const destination = path.join(consumer, 'node_modules/@codosc', name);
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
  it('기존 예제 두 파일은 단일 매핑으로 해석되고 ID·참조·본문을 유지한다', /** 공개 API로 실제 YAML과 원문 위치를 고정 기대값에 대조한다. */ () => {
    checkExamples(root);
  });

  it('Node subprocess가 ESM import 및 CJS require 진입점을 실제 로드한다', /** package 이름과 exports를 통해 모든 실제 출력을 로드한다. */ () => {
    const script = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ${JSON.stringify(names)}) {
  const value = await import('@codosc/' + name);
  if (typeof value !== 'object') throw new Error('Invalid module: ' + name);
}
for (const name of ['language-server', 'vscode']) {
  if (typeof require('@codosc/' + name) !== 'object') throw new Error('Invalid CJS');
}
const { parseYaml, getValueRange, yamlDiagnosticCodes } = await import('@codosc/core');
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
        existsSync(path.join(consumer, 'node_modules/@codosc', name, 'src')),
      ).toBe(false);
    }
  });

  it('빌드된 파서에 문법 오류나 중복 키를 입력하면 약속한 오류 코드 문자열을 반환한다', /** 기능 테스트는 공통 상수를 사용하므로, 이 계약 테스트는 명시적인 문자열로 외부 반환 코드의 호환성을 따로 검증한다. */ () => {
    const script = `import assert from 'node:assert/strict';
import { parseYaml } from '@codosc/core';
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

  it('별도 TS 소비자가 dist d.ts를 해석하고 금지 subpath를 거부한다', /** 타입 namespace를 출력 없이 검사하고 해석 경로를 확인한다. */ () => {
    const code =
      names
        .map(
          (name, index) =>
            `import type * as Package${index} from '@codosc/${name}';\nexport type Module${index} = typeof Package${index};`,
        )
        .join('\n') +
      "\nimport { parseYaml, getKeyRange, getValueRange, getPropertyRange, offsetToPosition, yamlDiagnosticCodes } from '@codosc/core';\nimport type { YamlParseResult, FieldPath, OffsetRange, SourcePosition, YamlDiagnostic, YamlDiagnosticCode } from '@codosc/core';\nconst parsed: YamlParseResult = parseYaml('name: test');\nconst path: FieldPath = ['name'];\nexport const ranges: (OffsetRange | undefined)[] = [getKeyRange(parsed, path), getValueRange(parsed, path), getPropertyRange(parsed, path)];\nexport const position: SourcePosition | undefined = offsetToPosition('😀', 2);\nexport const diagnostics: readonly YamlDiagnostic[] = parsed.diagnostics;\nexport const diagnosticCode: YamlDiagnosticCode = yamlDiagnosticCodes.invalidYaml;\nexport const returnedCodes: readonly YamlDiagnosticCode[] = diagnostics.map(issue => issue.code);\n";
    const config = {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        types: [],
        skipLibCheck: false,
      },
      files: ['consume.ts'],
    };
    writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify(config));
    writeFileSync(path.join(consumer, 'consume.ts'), code);
    const trace = run([tsc, '-p', 'tsconfig.json', '--traceResolution']);
    for (const name of names) {
      expect(trace.replaceAll('\\', '/')).toContain(
        `@codosc/${name}/dist/index.d.ts`,
      );
    }
    expect(trace).not.toContain('/src/index.ts');
    writeFileSync(
      path.join(consumer, 'consume.ts'),
      "import type * as Hidden from '@codosc/core/src/index.js';\nexport type Value = typeof Hidden;\n",
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
  await import('@codosc/core/dist/index.js');
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
      const extension = ['languageServer', 'vscode'].includes(folder)
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
        'examples/.codocs/terms.yaml',
        'examples/.codocs/knowledge.yaml',
      ]) {
        expect(
          readFileSync(
            path.join(root, 'packages', folder, 'dist', relative),
            'utf8',
          ),
        ).toBe(readFileSync(path.join(root, relative), 'utf8'));
      }
      checkExamples(
        path.join(consumer, 'node_modules/@codosc', folder, 'dist'),
      );
    }
    expect(
      readFileSync(
        path.join(root, 'packages/vscode/dist/server/index.cjs'),
        'utf8',
      ),
    ).toBe(
      readFileSync(
        path.join(root, 'packages/languageServer/dist/index.cjs'),
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
    const pnpm = [
      process.env.CODOSC_PNPM_CLI,
      process.env.npm_execpath,
      path.join(root, '.workbench/runtime/package/bin/pnpm.cjs'),
      path.join(root, '.workbench/runtime/pnpm/node_modules/pnpm/bin/pnpm.cjs'),
    ].find(
      (candidate) => candidate?.endsWith('pnpm.cjs') && existsSync(candidate),
    );
    if (!pnpm)
      throw new Error('Set CODOSC_PNPM_CLI to the task-local pnpm.cjs');
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
        'examples/.codocs/terms.yaml',
        'examples/.codocs/knowledge.yaml',
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
      "import { parseYaml } from '@codosc/core';\nimport '@codosc/workspace';\nexport const loaded = parseYaml('name: bundled').success;\n",
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
