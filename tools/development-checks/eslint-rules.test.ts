import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFixtureEslint } from '../test/support/eslint.js';

const root = process.cwd();
mkdirSync(path.join(root, '.workbench/fixtures'), { recursive: true });
const fixture = mkdtempSync(path.join(root, '.workbench/fixtures/lint-rules-'));
afterAll(
  /** 시험용 임시 경로를 정리한다. */ () => {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  },
);

const eslint = createFixtureEslint();

/** 실제 eslint.config.mjs로 검사하고 지정한 접두사의 규칙 진단만 돌려준다. */
async function diagnostics(
  code: string,
  rulePrefix: string,
  filePath: string,
  lint = eslint,
): Promise<string[]> {
  const results = await lint.lintText(code, { filePath });
  const messages = results.flatMap((result) => result.messages);
  expect(messages.filter((message) => message.fatal)).toEqual([]);
  return messages
    .map((message) => message.ruleId ?? 'fatal')
    .filter((ruleId) => ruleId.startsWith(rulePrefix));
}

describe('패키지 경계 규칙', () => {
  it.each([
    "import '@codocs/core/src/index.js';",
    "import '../../core/src/index.js';",
    "export * from '../../core/src/index.ts';",
    "export {value} from '../../core/src/value.js';",
    "await import('../../core/src/index.js');",
    "type Hidden = import('../../core/src/index.js').Hidden;",
    "const value = require('../../core/src/index.js');",
    "import '@codocs/mcp';",
    "import type { Hidden } from '../../core/src/index.js';",
    "import { type Hidden } from '@codocs/mcp';",
  ])('내부 접근 %s를 쓰면 한 번 진단한다', async (code) => {
    expect(
      await diagnostics(
        code,
        'boundaries/',
        path.join(root, 'packages/workspace/src/index.ts'),
      ),
    ).toEqual(['boundaries/dependencies']);
  });
  it.each([
    "import 'node:fs/promises';",
    "import 'fs';",
    "import 'vscode';",
    "import 'vscode-languageserver/node';",
    "import '@modelcontextprotocol/sdk/server/index.js';",
    "await import('node:fs');",
    "require('vscode');",
    "import type { Stats } from 'node:fs';",
  ])('core에서 호스트 의존성 %s를 쓰면 진단한다', async (code) => {
    expect(
      await diagnostics(
        code,
        'boundaries/',
        path.join(root, 'packages/core/src/index.ts'),
      ),
    ).toEqual(['boundaries/dependencies']);
  });
  it.each([
    ['workspace', "import '@codocs/core';"],
    ['core', "import 'yaml'; import 'zod';"],
  ])('%s의 허용된 의존 방향을 쓰면 진단하지 않는다', async (folder, code) => {
    expect(
      await diagnostics(
        code,
        'boundaries/',
        path.join(root, 'packages', folder, 'src/index.ts'),
      ),
    ).toEqual([]);
  });
  it('tsconfig 별칭으로 내부 소스를 가져오면 진단한다', async () => {
    const project = path.join(fixture, 'tsconfig.json');
    writeFileSync(
      project,
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          baseUrl: root,
          paths: { '@hidden-core': ['packages/core/src/index.ts'] },
        },
      }),
    );
    const aliasEslint = createFixtureEslint({
      settings: { 'import/resolver': { typescript: { project: [project] } } },
    });
    expect(
      await diagnostics(
        "import '@hidden-core';",
        'boundaries/',
        path.join(root, 'packages/workspace/src/index.ts'),
        aliasEslint,
      ),
    ).toEqual(['boundaries/dependencies']);
  });
});

describe('JSDoc 규칙', () => {
  const extensions = ['ts', 'mjs'];
  describe.each(extensions)('.%s 파일', (extension) => {
    const filePath = path.join(root, 'packages/core/src/index.' + extension);
    it.each([
      ['선언 함수에 JSDoc이 없으면', 'function value() {return 1;}'],
      [
        '설명이 영어뿐이면',
        '/** Returns a value. */\nfunction value() {return 1;}',
      ],
      ['const 화살표 함수에 JSDoc이 없으면', 'const value = () => 1;'],
      ['클래스 메서드에 JSDoc이 없으면', 'class Example {value() {return 1;}}'],
      [
        '5줄 map 콜백에 JSDoc이 없으면',
        '[1].map(value => {\nconst next = value + 1;\nconst result = next + 1;\nreturn result;\n});',
      ],
      ['JSDoc이 비어 있으면', '/** */\nfunction value() {return 1;}'],
      [
        '한국어가 태그 설명에만 있으면',
        '/**\n * @returns 값이다.\n */\nfunction value() {return 1;}',
      ],
    ])('%s 진단한다', async (_name, code) => {
      const ruleIds = await diagnostics(code, 'jsdoc/', filePath);
      expect(ruleIds.length).toBeGreaterThan(0);
    });
    it.each([
      [
        'export 함수에 한국어 설명이 있으면',
        '/** 값을 반환한다. */\nexport function value() {return 1;}',
      ],
      [
        'const 화살표 함수에 한국어 설명이 있으면',
        '/** 값을 반환한다. */\nconst value = () => 1;',
      ],
      [
        '메서드에 한국어 설명이 있으면',
        'class Example {/** 값을 반환한다. */\nvalue() {return 1;}}',
      ],
      ['한 줄 콜백이면', '[1].map(value => value + 1);'],
      [
        '4줄 콜백이면',
        '[1].map(value => {\nconst next = value + 1;\nreturn next;\n});',
      ],
    ])('%s 진단하지 않는다', async (_name, code) => {
      expect(await diagnostics(code, 'jsdoc/', filePath)).toEqual([]);
    });
  });
  it.each([
    ['설명이 없으면', 'function value() {return 1;}', 'jsdoc/require-jsdoc'],
    [
      '설명이 영어뿐이면',
      '/** Returns a value. */\nfunction value() {return 1;}',
      'jsdoc/match-description',
    ],
    [
      'JSDoc이 비어 있으면',
      '/** */\nfunction value() {return 1;}',
      'jsdoc/require-description',
    ],
    [
      '반환 위치의 함수에 JSDoc이 없으면',
      '/** 값을 만든다. */\nexport function make() {\nreturn () => 1;\n}',
      'jsdoc/require-jsdoc',
    ],
  ])('%s 해당 규칙으로 진단한다', async (_name, code, ruleId) => {
    expect(
      await diagnostics(
        code,
        'jsdoc/',
        path.join(root, 'packages/core/src/index.ts'),
      ),
    ).toContain(ruleId);
  });
  it('테스트 파일의 설명 없는 함수는 진단하지 않는다', async () => {
    expect(
      await diagnostics(
        'function value() {return 1;}',
        'jsdoc/',
        path.join(root, 'packages/core/src/change-plan/replace.test.ts'),
      ),
    ).toEqual([]);
  });
});
