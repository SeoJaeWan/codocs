import { ESLint } from 'eslint';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
mkdirSync(path.join(root, '.workbench'), { recursive: true });
const fixture = mkdtempSync(path.join(root, '.workbench/eslint-source-'));
const project = path.join(fixture, 'tsconfig.json');
const cliConfig = path.join(fixture, 'eslint.config.mjs');
writeFileSync(
  project,
  JSON.stringify({
    extends: '../../tsconfig.runtime.json',
    compilerOptions: {
      noEmit: true,
      types: ['node'],
      baseUrl: '../..',
      paths: {
        '@codocs/core': ['packages/core/src/index.ts'],
        '@codocs/workspace': ['packages/workspace/src/index.ts'],
        '@codocs/mcp': ['packages/mcp/src/index.ts'],
      },
    },
    include: ['../../packages/**/*.ts', '../../tools/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  }),
);
writeFileSync(
  cliConfig,
  `import config from ${JSON.stringify(pathToFileURL(path.join(root, 'eslint.config.mjs')).href)};\n` +
    `export default [...config, { files: ['**/*.ts'], languageOptions: { parserOptions: { project: [${JSON.stringify(project)}], disallowAutomaticSingleRunInference: true } } }];\n`,
);
process.once(
  'exit',
  /** 이 시험 프로세스가 생성한 타입·CLI 설정만 종료 뒤 정리한다. */ () => {
    rmSync(fixture, { recursive: true, force: true });
  },
);

/** 실제 CLI 검사도 제품 선언 dist 대신 같은 소스 타입 설정을 사용한다. */
export function fixtureEslintConfig(): string {
  return cliConfig;
}

/** 같은 경로의 메모리 소스를 반복 검사해도 전체 타입 정보를 유지한다. */
export function createFixtureEslint(
  options: Pick<ESLint.Options, 'cwd' | 'fix'> = {},
): ESLint {
  return new ESLint({
    cwd: process.cwd(),
    ...options,
    overrideConfig: {
      languageOptions: {
        parserOptions: {
          project: [project],
          disallowAutomaticSingleRunInference: true,
        },
      },
    },
  });
}
