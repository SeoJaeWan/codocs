import { ESLint } from 'eslint';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import codocs from './eslint-rules.mjs';

const root = process.cwd();
mkdirSync(path.join(root, '.workbench/fixtures'), { recursive: true });
const fixture = mkdtempSync(path.join(root, '.workbench/fixtures/lint-rules-'));
afterAll(
  /** 자체 규칙의 임시 경로를 정리한다. */ () => {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  },
);

/** 외부 일반 규칙을 제외하고 지정한 자체 규칙만 실행한다. */
async function diagnostics(
  code: string,
  rule: string,
  filePath: string,
): Promise<string[]> {
  const eslint = new ESLint({
    cwd: root,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { codocs },
        rules: { ['codocs/' + rule]: 'error' },
      },
    ],
  });
  return (await eslint.lintText(code, { filePath })).flatMap((result) =>
    result.messages.map((message) => message.ruleId ?? 'fatal'),
  );
}

describe('자체 패키지 경계 규칙', () => {
  it.each([
    "import '@codocs/core/src/index.js';",
    "import '../../core/src/index.js';",
    "export * from '../../core/src/index.ts';",
    "export {value} from '../../core/src/value.js';",
    "await import('../../core/src/index.js');",
    "type Hidden = import('../../core/src/index.js').Hidden;",
    "const value = require('../../core/src/index.js');",
    "import '@codocs/mcp';",
  ])('내부 접근 %s를 거부한다', async (code) => {
    expect(
      await diagnostics(
        code,
        'package-boundaries',
        path.join(root, 'packages/workspace/src/index.ts'),
      ),
    ).toEqual(['codocs/package-boundaries']);
  });
  it.each([
    'node:fs/promises',
    'fs',
    'vscode',
    'vscode-languageserver/node',
    '@modelcontextprotocol/sdk/server/index.js',
  ])('core의 호스트 의존성 %s를 거부한다', async (specifier) => {
    expect(
      await diagnostics(
        `import '${specifier}';`,
        'package-boundaries',
        path.join(root, 'packages/core/src/index.ts'),
      ),
    ).toEqual(['codocs/package-boundaries']);
  });
  it.each([
    ['workspace', "import '@codocs/core';"],
    ['core', "import 'yaml'; import 'zod';"],
  ])('%s의 허용된 의존 방향을 유지한다', async (folder, code) => {
    expect(
      await diagnostics(
        code,
        'package-boundaries',
        path.join(root, 'packages', folder, 'src/index.ts'),
      ),
    ).toEqual([]);
  });
  it('tsconfig 별칭으로 내부 소스를 가져오는 우회도 거부한다', async () => {
    const core = path.join(fixture, 'packages/core/src');
    const workspace = path.join(fixture, 'packages/workspace/src');
    mkdirSync(core, { recursive: true });
    mkdirSync(workspace, { recursive: true });
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
    expect(
      await diagnostics(
        "import '@hidden-core';",
        'package-boundaries',
        path.join(workspace, 'index.ts'),
      ),
    ).toEqual(['codocs/package-boundaries']);
  });
});

describe('자체 한국어 설명 규칙', () => {
  it.each([
    'function value(): number {return 1;}',
    '/** Returns a value. */\nfunction value(): number {return 1;}',
    'const value = (): number => 1;',
    'class Example {value(): number {return 1;}}',
    '[1].map(value => {\nconst next = value + 1;\nconst result = next + 1;\nreturn result;\n});',
  ])('설명 누락 %s를 진단한다', async (code) => {
    expect(
      await diagnostics(
        code,
        'korean-jsdoc',
        path.join(root, 'packages/core/src/index.ts'),
      ),
    ).toEqual(['codocs/korean-jsdoc']);
  });
  it.each([
    '/** 값을 반환한다. */\nexport function value(): number {return 1;}',
    '/** 값을 반환한다. */\nconst value = (): number => 1;',
    'class Example {/** 값을 반환한다. */\nvalue(): number {return 1;}}',
    '[1].map(value => value + 1);',
  ])('한국어 설명과 짧은 콜백 %s를 허용한다', async (code) => {
    expect(
      await diagnostics(
        code,
        'korean-jsdoc',
        path.join(root, 'packages/core/src/index.ts'),
      ),
    ).toEqual([]);
  });
});
