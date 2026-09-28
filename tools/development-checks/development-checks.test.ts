import { ESLint } from 'eslint';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import codocs from './eslint-rules.mjs';

import { resolvePnpm } from '../toolchain.mjs';
import {
  createFixtureEslint,
  fixtureEslintConfig,
} from '../test/support/eslint.js';

const root = process.cwd();
mkdirSync(path.join(root, '.workbench/fixtures'), { recursive: true });
const suiteFixture = mkdtempSync(
  path.join(root, '.workbench/fixtures/development-'),
);
afterAll(
  /** 실행별 임시 프로젝트를 정리한다. */ () => {
    rmSync(suiteFixture, { recursive: true, force: true, maxRetries: 3 });
  },
);
const eslint = createFixtureEslint({ cwd: root });

/** 외부 JSON 값이 문자열 키를 가진 객체인지 확인한다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('개발 규칙의 실제 성공과 실패', /** 규칙별 실패와 정상 코드 fixture를 구성한다. */ () => {
  it.each([
    [
      'floating Promise',
      'Promise.resolve(1);',
      '@typescript-eslint/no-floating-promises',
    ],
    [
      'void Promise',
      'void Promise.resolve(1);',
      '@typescript-eslint/no-floating-promises',
    ],
    [
      'public return',
      '/** 값을 반환한다. */\nexport function value() { return 1; }',
      '@typescript-eslint/explicit-module-boundary-types',
    ],
    [
      'missing JSDoc',
      'function value(): number { return 1; }\nvalue();',
      'codocs/korean-jsdoc',
    ],
    [
      'plugin JSDoc',
      'function value(): number { return 1; }\nvalue();',
      'jsdoc/require-jsdoc',
    ],
    [
      'English JSDoc',
      '/** Returns a value. */\nfunction value(): number { return 1; }\nvalue();',
      'codocs/korean-jsdoc',
    ],
    [
      'assigned function JSDoc',
      'const value = (): number => 1;\nvalue();',
      'codocs/korean-jsdoc',
    ],
    [
      'assigned plugin JSDoc',
      'const value = (): number => 1;\nvalue();',
      'jsdoc/require-jsdoc',
    ],
    [
      'method plugin JSDoc',
      'class Example { value(): number { return 1; } }\nnew Example().value();',
      'jsdoc/require-jsdoc',
    ],
    [
      'method JSDoc',
      'class Example { value(): number { return 1; } }\nnew Example().value();',
      'codocs/korean-jsdoc',
    ],
    [
      'variable name',
      'const bad_name = 1;\nconsole.log(bad_name);',
      '@typescript-eslint/naming-convention',
    ],
    [
      'property name',
      'const value = { bad_name: 1 };\nconsole.log(value);',
      '@typescript-eslint/naming-convention',
    ],
    [
      'type name',
      'export interface bad_name { value: number }',
      '@typescript-eslint/naming-convention',
    ],
    [
      'subpath import',
      "import '@codocs/core/src/index.js';",
      'codocs/package-boundaries',
    ],
    [
      'relative internal',
      "import '../../core/src/index.js';",
      'codocs/package-boundaries',
    ],
    [
      'relative entry',
      "import '../../core/src/index.ts';",
      'codocs/package-boundaries',
    ],
    [
      're-export internal',
      "export * from '../../core/src/index.js';",
      'codocs/package-boundaries',
    ],
    [
      'dynamic internal',
      "await import('../../core/src/index.js');",
      'codocs/package-boundaries',
    ],
    ['wrong direction', "import '@codocs/mcp';", 'codocs/package-boundaries'],
  ])(
    '%s 코드를 검사하면 %s 규칙 오류를 반환한다',
    async (_label, code, ruleId) => {
      const results = await eslint.lintText(code, {
        filePath: path.join(root, 'packages/workspace/src/index.ts'),
      });
      expect(
        results.flatMap((result) =>
          result.messages.map((message) => message.ruleId),
        ),
      ).toContain(ruleId);
    },
  );

  describe('허용된 코드와 패키지 경계', () => {
    it('공개 진입점과 처리된 Promise를 검사하면 규칙 오류를 반환하지 않는다', async () => {
      const code =
        "import '@codocs/core';\n[1].map((value) => value + 1);\nawait Promise.resolve(1);\n/** 값을 반환한다. */\nexport function value(): number { return 1; }";
      const results = await eslint.lintText(code, {
        filePath: path.join(root, 'packages/workspace/src/index.ts'),
      });
      expect(results.flatMap((result) => result.messages)).toEqual([]);
    });

    it('core의 빈 진입점을 검사하면 규칙 오류를 반환하지 않는다', async () => {
      const code = 'export {};';
      const results = await eslint.lintText(code, {
        filePath: path.join(root, 'packages/core/src/index.ts'),
      });
      expect(results.flatMap((result) => result.messages)).toEqual([]);
    });

    it('core의 허용된 외부 의존성을 가져오면 경계 오류를 반환하지 않는다', async () => {
      const code = "import 'yaml';\nimport 'zod';\nimport 'pluralize';";
      const results = await eslint.lintText(code, {
        filePath: path.join(root, 'packages/core/src/index.ts'),
      });
      expect(results.flatMap((result) => result.messages)).toEqual([]);
    });
  });

  it.each([
    'node:fs/promises',
    'node:fs',
    'fs',
    'vscode',
    'vscode-languageserver/node',
    '@modelcontextprotocol/sdk/server/index.js',
  ])('core가 %s를 가져오면 패키지 경계 오류를 반환한다', async (specifier) => {
    const code = `import '${specifier}';`;
    const results = await eslint.lintText(code, {
      filePath: path.join(root, 'packages/core/src/index.ts'),
    });
    expect(
      results.flatMap((result) =>
        result.messages.map((message) => message.ruleId),
      ),
    ).toContain('codocs/package-boundaries');
  });

  it('tsconfig 별칭으로 해석된 내부 소스 접근을 거부한다', /** 실제 TypeScript 경로 해석으로 우회 경로를 검사한다. */ async () => {
    const fixture = path.join(suiteFixture, 'resolved-boundary');
    const workspace = path.join(fixture, 'packages/workspace/src');
    const core = path.join(fixture, 'packages/core/src');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(core, { recursive: true });
    writeFileSync(path.join(core, 'index.ts'), 'export {};\n');
    writeFileSync(
      path.join(fixture, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          baseUrl: '.',
          paths: { '@hidden-core': ['packages/core/src/index.ts'] },
        },
      }),
    );
    const boundaryLint = new ESLint({
      cwd: root,
      ignore: false,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser },
          plugins: { codocs },
          rules: { 'codocs/package-boundaries': 'error' },
        },
      ],
    });
    const results = await boundaryLint.lintText("import '@hidden-core';", {
      filePath: path.join(workspace, 'index.ts'),
    });
    expect(
      results.flatMap((result) =>
        result.messages.map((message) => message.ruleId),
      ),
    ).toEqual(['codocs/package-boundaries']);
  });

  it('비동기 forEach 콜백을 검사하면 Promise 오용 오류를 반환한다', async () => {
    const code = '[1].forEach(async () => { await Promise.resolve(1); });';
    const results = await eslint.lintText(code, {
      filePath: path.join(root, 'packages/workspace/src/index.ts'),
    });
    expect(
      results.flatMap((result) =>
        result.messages.map((message) => message.ruleId),
      ),
    ).toContain('@typescript-eslint/no-misused-promises');
  });

  it('설명 없는 긴 콜백을 검사하면 한국어 JSDoc 오류를 반환한다', async () => {
    const code =
      '[1].map((value) => {\n const next = value + 1;\n const result = next + 1;\n return result;\n});';
    const results = await eslint.lintText(code, {
      filePath: path.join(root, 'packages/workspace/src/index.ts'),
    });
    expect(
      results.flatMap((result) =>
        result.messages.map((message) => message.ruleId),
      ),
    ).toContain('codocs/korean-jsdoc');
  });
});

describe('실제 파일의 ESLint CLI 검사', () => {
  it.each(['false', 'true'])(
    'CI=%s에서도 타입 기반 위반과 정상 코드를 구분한다',
    (ci) => {
      const fixture = path.join(
        root,
        `packages/workspace/src/lint-fixture-${randomUUID()}`,
      );
      mkdirSync(fixture);
      try {
        writeFileSync(
          path.join(fixture, 'invalid.ts'),
          `import type { ReferenceResolutionStatus } from '@codocs/core';
const status: ReferenceResolutionStatus = 'ambiguous';
console.log(status);
Promise.resolve(1);
`,
        );
        writeFileSync(
          path.join(fixture, 'valid.ts'),
          `import { referenceResolutionStatuses, type ReferenceResolutionStatus } from '@codocs/core';
const status: ReferenceResolutionStatus = referenceResolutionStatuses.ambiguous;
console.log(status);
await Promise.resolve(1);
`,
        );
        const env = { ...process.env };
        Reflect.set(env, 'CI', ci);
        Reflect.deleteProperty(env, 'TSESTREE_SINGLE_RUN');
        const result = spawnSync(
          process.execPath,
          [
            path.join(root, 'node_modules/eslint/bin/eslint.js'),
            '--config',
            fixtureEslintConfig(),
            fixture,
            '--format',
            'json',
          ],
          {
            cwd: root,
            encoding: 'utf8',
            env,
            timeout: 60_000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(1);
        const reports: unknown = JSON.parse(result.stdout);
        if (!Array.isArray(reports))
          throw new Error('ESLint 결과가 배열이 아니다');
        const invalid = reports.find(
          (report: unknown) =>
            isRecord(report) &&
            report.filePath === path.join(fixture, 'invalid.ts'),
        ) as unknown;
        const valid = reports.find(
          (report: unknown) =>
            isRecord(report) &&
            report.filePath === path.join(fixture, 'valid.ts'),
        ) as unknown;
        expect(valid).toMatchObject({ errorCount: 0, warningCount: 0 });
        expect(invalid).toMatchObject({
          messages: expect.arrayContaining([
            expect.objectContaining({
              ruleId: '@typescript-eslint/no-floating-promises',
            }),
            expect.objectContaining({ ruleId: 'codocs/no-raw-domain-value' }),
          ]) as unknown,
        });
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );
});

describe('파일과 폴더 이름', /** 실제 ESLint 설정으로 경로 규칙을 확인한다. */ () => {
  it.each([
    ['tools/good-name/good-name.test.mjs', []],
    ['tools/good-name/badName.mjs', ['check-file/filename-naming-convention']],
    ['tools/badName/index.mjs', ['check-file/folder-naming-convention']],
    ['.codocs/good-name/good-name.yaml', []],
    [
      '.codocs/good-name/badName.yaml',
      ['check-file/filename-naming-convention'],
    ],
    ['.codocs/badName/index.yaml', ['check-file/folder-naming-convention']],
  ])(
    '%s의 이름 규칙을 검사한다',
    /** 경로별 허용과 거부 결과를 확인한다. */ async (filename, expected) => {
      const results = await eslint.lintText('', {
        filePath: path.join(root, filename),
      });
      expect(
        results.flatMap((result) =>
          result.messages.map((message) => message.ruleId),
        ),
      ).toEqual(expected);
    },
  );
});

describe('설치와 패키지 계약', /** 설치와 공개 진입점 및 의존 방향을 확인한다. */ () => {
  describe('루트 도구와 패키지 manifest', () => {
    it('.node-version을 읽으면 실행 중인 Node 버전과 일치한다', () => {
      const declared = readFileSync(
        path.join(root, '.node-version'),
        'utf8',
      ).trim();
      expect(process.versions.node).toBe(declared);
    });

    it('루트 manifest를 읽으면 pnpm 버전이 고정돼 있다', () => {
      const manifest: unknown = JSON.parse(
        readFileSync(path.join(root, 'package.json'), 'utf8'),
      );
      if (!isRecord(manifest)) throw new Error('Invalid root manifest');
      expect(manifest.packageManager).toBe('pnpm@10.34.5');
    });

    it('루트 개발 의존성을 읽으면 모든 버전이 정확한 값으로 고정돼 있다', () => {
      const manifest: unknown = JSON.parse(
        readFileSync(path.join(root, 'package.json'), 'utf8'),
      );
      if (!isRecord(manifest) || !isRecord(manifest.devDependencies))
        throw new Error('Invalid root manifest');
      for (const [name, version] of Object.entries(manifest.devDependencies)) {
        expect(typeof version, name).toBe('string');
        expect(version, name).toMatch(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u);
      }
    });

    it.each([
      ['core', []],
      ['workspace', ['@codocs/core']],
      ['language-server', ['@codocs/core', '@codocs/workspace']],
      ['mcp', ['@codocs/core', '@codocs/workspace']],
      ['vscode', []],
    ] as const)(
      '%s manifest를 읽으면 내부 의존 방향과 공개 진입점이 일치한다',
      (folder, expected) => {
        const manifest: unknown = JSON.parse(
          readFileSync(
            path.join(root, 'packages', folder, 'package.json'),
            'utf8',
          ),
        );
        expect(manifest).toMatchObject({ private: true });
        if (!isRecord(manifest) || !isRecord(manifest.exports))
          throw new Error('Invalid package manifest');
        expect(Object.keys(manifest.exports)).toEqual(['.']);
        const dependencies: unknown = manifest.dependencies ?? {};
        if (!isRecord(dependencies)) throw new Error('Invalid dependencies');
        const internal = Object.entries(dependencies).filter(([name]) =>
          name.startsWith('@codocs/'),
        );
        expect(internal.map(([name]) => name)).toEqual(expected);
        expect(internal.every(([, version]) => version === 'workspace:*')).toBe(
          true,
        );
      },
    );
  });

  it('frozen 재설치 후 공개 JS·타입 소비자를 실행하면 배포 경계를 지킨다', /** 실제 pnpm 프로세스와 격리 fixture로 lockfile을 검증한다. */ () => {
    const executable = resolvePnpm();
    const environment = { ...process.env };
    environment.CI = 'true';
    const matching = path.join(suiteFixture, 'frozen-matching');
    mkdirSync(matching, { recursive: true });
    for (const filename of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.npmrc',
    ]) {
      copyFileSync(path.join(root, filename), path.join(matching, filename));
    }
    for (const folder of [
      'core',
      'workspace',
      'language-server',
      'vscode',
      'mcp',
    ]) {
      const destination = path.join(matching, 'packages', folder);
      mkdirSync(destination, { recursive: true });
      copyFileSync(
        path.join(root, 'packages', folder, 'package.json'),
        path.join(destination, 'package.json'),
      );
      cpSync(
        path.join(root, 'packages', folder, 'src'),
        path.join(destination, 'src'),
        {
          recursive: true,
        },
      );
    }
    execFileSync(
      process.execPath,
      [
        executable,
        'install',
        '--frozen-lockfile',
        '--store-dir',
        path.join(suiteFixture, 'pnpm-store'),
      ],
      { cwd: matching, encoding: 'utf8', env: environment },
    );
    execFileSync(
      process.execPath,
      [
        executable,
        'install',
        '--frozen-lockfile',
        '--store-dir',
        path.join(suiteFixture, 'pnpm-store'),
        '--offline',
      ],
      { cwd: matching, encoding: 'utf8', env: environment },
    );
    // 후속 exports.types가 dist로 바뀌어도 활성 루트 빌드 없이 개발 검사를 실행한다.
    const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
    const emitConfig = path.join(matching, 'packages/core/tsconfig.emit.json');
    writeFileSync(
      emitConfig,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          declaration: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          lib: ['ES2022'],
          types: [],
          // 공통 설정처럼 외부 Zod 선언의 URL 전역 참조를 검사하지 않는다.
          skipLibCheck: true,
          exactOptionalPropertyTypes: true,
          rootDir: 'src',
          outDir: 'dist',
        },
        files: ['src/index.ts'],
      }),
    );
    execFileSync(process.execPath, [tsc, '-p', emitConfig], {
      cwd: matching,
      encoding: 'utf8',
    });
    const consumer = path.join(matching, 'packages/workspace/src/consumer.ts');
    const consumerConfig = path.join(
      matching,
      'packages/workspace/tsconfig.json',
    );
    writeFileSync(
      consumerConfig,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: [],
          exactOptionalPropertyTypes: true,
          target: 'ES2022',
        },
        files: ['src/consumer.ts'],
      }),
    );
    writeFileSync(
      consumer,
      `import { parseYaml, getValueRange, validateDocument } from '@codocs/core';
import type {Document} from '@codocs/core';
const parsed = parseYaml('name: test');
export const range = getValueRange(parsed, ['name']);
const result = validateDocument({data: parsed.success ? parsed.data : {}});
if (result.success) {
  const data: Document = result.data;
  const name: string = data.name; void name;
  const domains: string[] = data.domains; void domains;
} else {
  // @ts-expect-error failure has no validated data
  const absent = result.data;
  void absent;
}
`,
    );
    execFileSync(process.execPath, [tsc, '-p', consumerConfig], {
      cwd: matching,
      encoding: 'utf8',
    });
    const runtimeConsumer = path.join(
      matching,
      'packages/workspace/consumer.mjs',
    );
    writeFileSync(
      runtimeConsumer,
      `import assert from 'node:assert/strict';
import {parseYaml, validateDocument} from '@codocs/core';
const parsed = parseYaml('id: fixture\\nname: タイトル\\ndefinition: Body\\ndomains: [Sales]\\n');
assert.equal(parsed.success, true);
const result = validateDocument({data: parsed.data});
assert.equal(result.success, true);
assert.deepEqual(result.errors, []);
assert.deepEqual(result.warnings, []);
assert.equal(Object.hasOwn(result.data, 'status'), false);
console.log('Frozen validator consumer verified');`,
    );
    expect(
      execFileSync(process.execPath, [runtimeConsumer], {
        cwd: matching,
        encoding: 'utf8',
      }),
    ).toContain('Frozen validator consumer verified');
    writeFileSync(
      consumer,
      "import type * as Hidden from '@codocs/core/src/index.js';\nexport type Value = typeof Hidden;\n",
    );
    const importFailure = spawnSync(
      process.execPath,
      [tsc, '-p', consumerConfig],
      { cwd: matching, encoding: 'utf8' },
    );
    expect(importFailure.status).not.toBe(0);
    expect(importFailure.stdout + importFailure.stderr).toContain('TS2307');
  });
  it('manifest와 lockfile이 불일치하면 frozen 설치가 거부된다', () => {
    const executable = resolvePnpm();
    const environment = { ...process.env };
    environment.CI = 'true';
    const fixture = path.join(suiteFixture, 'frozen-mismatch');
    mkdirSync(fixture, { recursive: true });
    writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({
        name: 'mismatch',
        private: true,
        dependencies: { typescript: '5.9.3' },
      }),
    );
    writeFileSync(
      path.join(fixture, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
    );
    const result = spawnSync(
      process.execPath,
      [
        executable,
        'install',
        '--frozen-lockfile',
        '--ignore-workspace',
        '--store-dir',
        path.join(suiteFixture, 'pnpm-store'),
      ],
      { cwd: fixture, encoding: 'utf8', env: environment },
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(
      'ERR_PNPM_OUTDATED_LOCKFILE',
    );
  });
});
