import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import tseslint from 'typescript-eslint';
import codosc from './eslintRules.mjs';

const root = process.cwd();
const eslint = new ESLint({ cwd: root });

/** 외부 JSON 값이 문자열 키를 가진 객체인지 확인한다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 실제 설정과 타입 프로그램으로 검사 결과의 규칙 ID를 반환한다. */
async function ruleIds(code: string, owner = 'workspace'): Promise<string[]> {
  const results = await eslint.lintText(code, {
    filePath: path.join(root, 'packages', owner, 'src/index.ts'),
  });
  return results.flatMap((result) =>
    result.messages.map((message) => message.ruleId ?? 'parser'),
  );
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
      'codosc/korean-jsdoc',
    ],
    [
      'plugin JSDoc',
      'function value(): number { return 1; }\nvalue();',
      'jsdoc/require-jsdoc',
    ],
    [
      'English JSDoc',
      '/** Returns a value. */\nfunction value(): number { return 1; }\nvalue();',
      'codosc/korean-jsdoc',
    ],
    [
      'assigned function JSDoc',
      'const value = (): number => 1;\nvalue();',
      'codosc/korean-jsdoc',
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
      'codosc/korean-jsdoc',
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
      "import '@codosc/core/src/index.js';",
      'codosc/package-boundaries',
    ],
    [
      'relative internal',
      "import '../../core/src/index.js';",
      'codosc/package-boundaries',
    ],
    [
      'relative entry',
      "import '../../core/src/index.ts';",
      'codosc/package-boundaries',
    ],
    [
      're-export internal',
      "export * from '../../core/src/index.js';",
      'codosc/package-boundaries',
    ],
    [
      'dynamic internal',
      "await import('../../core/src/index.js');",
      'codosc/package-boundaries',
    ],
    ['wrong direction', "import '@codosc/mcp';", 'codosc/package-boundaries'],
  ])('%s rejects with %s', async (_label, code, ruleId) => {
    expect(await ruleIds(code)).toContain(ruleId);
  });

  it('정상 진입점과 짧은 콜백 및 처리된 Promise를 허용한다', /** 정상 코드 전체의 규칙 결과를 확인한다. */ async () => {
    expect(
      await ruleIds(
        "import '@codosc/core';\n[1].map((value) => value + 1);\nawait Promise.resolve(1);\n/** 값을 반환한다. */\nexport function value(): number { return 1; }",
      ),
    ).toEqual([]);
    expect(await ruleIds('export {};', 'core')).toEqual([]);
    expect(
      await ruleIds(
        "import 'yaml';\nimport 'zod';\nimport 'pluralize';",
        'core',
      ),
    ).toEqual([]);
    expect(await ruleIds("import 'node:fs';", 'core')).toContain(
      'codosc/package-boundaries',
    );
  });

  it.each([
    'node:fs/promises',
    'fs',
    'vscode',
    'vscode-languageserver/node',
    '@modelcontextprotocol/sdk/server/index.js',
  ])(
    'core의 호스트 의존성 %s를 거부한다',
    /** 호스트 모듈을 순수 패키지에서 배제한다. */ async (specifier) => {
      expect(await ruleIds(`import '${specifier}';`, 'core')).toContain(
        'codosc/package-boundaries',
      );
    },
  );

  it('tsconfig 별칭으로 해석된 내부 소스 접근을 거부한다', /** 실제 TypeScript 경로 해석으로 우회 경로를 검사한다. */ async () => {
    const fixture = path.join(root, '.workbench/fixtures/resolvedBoundary');
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
          plugins: { codosc },
          rules: { 'codosc/package-boundaries': 'error' },
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
    ).toEqual(['codosc/package-boundaries']);
  });

  it('Promise 콜백 오용과 긴 콜백 설명 누락을 검출한다', /** 타입 기반 콜백 오류와 설명 범위를 확인한다. */ async () => {
    expect(
      await ruleIds('[1].forEach(async () => { await Promise.resolve(1); });'),
    ).toContain('@typescript-eslint/no-misused-promises');
    expect(
      await ruleIds(
        '[1].map((value) => {\n const next = value + 1;\n const result = next + 1;\n return result;\n});',
      ),
    ).toContain('codosc/korean-jsdoc');
  });
});

describe('설치와 패키지 계약', /** 설치와 공개 진입점 및 의존 방향을 확인한다. */ () => {
  it('실제 Node 버전과 직접 도구 의존성이 정확하게 고정돼 있다', /** 런타임과 manifest 고정을 외부 입력 검증 후 확인한다. */ () => {
    expect(process.versions.node).toBe(
      readFileSync(path.join(root, '.node-version'), 'utf8').trim(),
    );
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    if (!isRecord(manifest) || !isRecord(manifest.devDependencies))
      throw new Error('Invalid root manifest');
    expect(manifest.packageManager).toBe('pnpm@10.34.5');
    for (const [name, version] of Object.entries(manifest.devDependencies)) {
      expect(typeof version, name).toBe('string');
      expect(version, name).toMatch(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u);
    }
  });

  it('다섯 패키지와 정확한 의존 방향 및 exports만 존재한다', /** 패키지 manifest를 외부 입력으로 검증한다. */ () => {
    const dependencies: Record<string, string[]> = {
      core: [],
      workspace: ['@codosc/core'],
      languageServer: ['@codosc/core', '@codosc/workspace'],
      mcp: ['@codosc/core', '@codosc/workspace'],
      vscode: [],
    };
    for (const [folder, expected] of Object.entries(dependencies)) {
      const manifest: unknown = JSON.parse(
        readFileSync(
          path.join(root, 'packages', folder, 'package.json'),
          'utf8',
        ),
      );
      expect(manifest).toMatchObject({ private: true });
      if (!isRecord(manifest)) throw new Error('Invalid manifest');
      if (!isRecord(manifest.exports)) throw new Error('Invalid exports');
      expect(Object.keys(manifest.exports)).toEqual(['.']);
      const actual: unknown = manifest.dependencies ?? {};
      if (!isRecord(actual)) throw new Error('Invalid dependencies');
      const internal = Object.entries(actual).filter(([name]) =>
        name.startsWith('@codosc/'),
      );
      expect(internal.map(([name]) => name)).toEqual(expected);
      expect(internal.every(([, version]) => version === 'workspace:*')).toBe(
        true,
      );
    }
  });

  it('frozen 재설치는 성공하고 불일치 manifest 설치는 실패한다', /** 실제 pnpm 프로세스와 격리 fixture로 lockfile을 검증한다. */ () => {
    const pnpm = path.join(root, '.workbench/runtime/package/bin/pnpm.cjs');
    const fallback = process.env.npm_execpath;
    const executable =
      process.env.CODOSC_PNPM_CLI ??
      (fallback?.endsWith('pnpm.cjs') ? fallback : pnpm);
    const environment = { ...process.env };
    environment.CI = 'true';
    const matching = path.join(root, '.workbench/fixtures/frozenMatching');
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
      'languageServer',
      'vscode',
      'mcp',
    ]) {
      const destination = path.join(matching, 'packages', folder);
      mkdirSync(destination, { recursive: true });
      copyFileSync(
        path.join(root, 'packages', folder, 'package.json'),
        path.join(destination, 'package.json'),
      );
      mkdirSync(path.join(destination, 'src'), { recursive: true });
      copyFileSync(
        path.join(root, 'packages', folder, 'src/index.ts'),
        path.join(destination, 'src/index.ts'),
      );
    }
    execFileSync(
      process.execPath,
      [
        executable,
        'install',
        '--frozen-lockfile',
        '--store-dir',
        path.join(root, '.workbench/pnpm-store'),
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
        },
        files: ['src/consumer.ts'],
      }),
    );
    writeFileSync(consumer, "import '@codosc/core';\n");
    execFileSync(process.execPath, [tsc, '-p', consumerConfig], {
      cwd: matching,
      encoding: 'utf8',
    });
    writeFileSync(
      consumer,
      "import type * as Hidden from '@codosc/core/src/index.js';\nexport type Value = typeof Hidden;\n",
    );
    const importFailure = spawnSync(
      process.execPath,
      [tsc, '-p', consumerConfig],
      { cwd: matching, encoding: 'utf8' },
    );
    expect(importFailure.status).not.toBe(0);
    expect(importFailure.stdout + importFailure.stderr).toContain('TS2307');
    const fixture = path.join(root, '.workbench/fixtures/frozenMismatch');
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
        path.join(root, '.workbench/pnpm-store'),
      ],
      { cwd: fixture, encoding: 'utf8', env: environment },
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(
      'ERR_PNPM_OUTDATED_LOCKFILE',
    );
  });
});
