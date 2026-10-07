import { defineConfig } from 'eslint/config';
import checkFile from 'eslint-plugin-check-file';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import boundaries from 'eslint-plugin-boundaries';
import codocs from './tools/development-checks/eslint-rules.mjs';

/** 내부 패키지의 폴더 이름과 공개 이름이다. */
const packages = {
  core: '@codocs/core',
  workspace: '@codocs/workspace',
  'language-server': '@codocs/language-server',
  mcp: '@codocs/mcp',
  vscode: '@codocs/vscode',
};

/** 패키지별 허용된 내부 의존 방향이다. */
const allowedDependencies = {
  core: [],
  workspace: ['core'],
  'language-server': ['core', 'workspace'],
  mcp: ['core', 'workspace'],
  vscode: [],
};

/** core가 사용할 수 없는 호스트 의존성의 모듈 이름 패턴이다. */
const coreHostSources = [
  'vscode',
  'vscode/**',
  'vscode-languageserver',
  'vscode-languageserver-*',
  'vscode-languageserver/**',
  'vscode-languageserver-*/**',
  'vscode-languageclient',
  'vscode-languageclient-*',
  'vscode-languageclient/**',
  'vscode-languageclient-*/**',
  'vscode-jsonrpc',
  'vscode-jsonrpc-*',
  'vscode-jsonrpc/**',
  'vscode-jsonrpc-*/**',
  '@modelcontextprotocol/**',
];

/**
 * 패키지 경계를 검사하는 boundaries/dependencies 정책을 만든다.
 * 허용하지 않은 내부 패키지, 공개 이름이 아닌 접근, core의 호스트 의존성을 거부한다.
 * @returns 정책 배열
 */
function packageBoundaryPolicies() {
  const names = Object.keys(packages);
  const policies = [];
  for (const owner of names) {
    const allowed = allowedDependencies[owner];
    const forbidden = names.filter(
      (name) => name !== owner && !allowed.includes(name),
    );
    const from = { element: { type: owner } };
    if (forbidden.length > 0) {
      // 해석되는 경로로 접근하든, 빌드 전이라 해석되지 않든 허용하지 않은 패키지는 거부한다.
      policies.push({
        from,
        disallow: { to: { element: { type: forbidden } } },
      });
      policies.push({
        from,
        disallow: {
          dependency: { source: forbidden.map((name) => packages[name]) },
        },
      });
    }
    // 허용된 패키지도 공개 이름이 아닌 상대 경로·별칭으로는 접근할 수 없다.
    for (const name of allowed) {
      policies.push({
        from,
        disallow: {
          to: { element: { type: name } },
          dependency: { source: '!' + packages[name] },
        },
      });
    }
    // 공개 진입점이 아닌 subpath 접근은 해석 여부와 관계없이 거부한다.
    policies.push({
      from,
      disallow: { dependency: { source: '@codocs/*/**' } },
    });
  }
  // 아직 생성되지 않은 출력처럼 해석되지 않는 상대 경로는 소속을 알 수 없으므로 거부한다.
  policies.push({
    disallow: {
      to: { file: { path: null }, module: { origin: 'local' } },
    },
  });
  policies.push({
    from: { element: { type: 'core' } },
    disallow: { dependency: { source: coreHostSources } },
  });
  policies.push({
    from: { element: { type: 'core' } },
    disallow: { to: { module: { origin: 'core' } } },
  });
  return policies;
}

export default defineConfig(
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.workbench/**',
    ],
  },
  {
    files: [
      '**/*.{ts,js,mjs,cjs}',
      '.codocs/**/*.yaml',
      'examples/.codocs/**/*.yaml',
    ],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        {
          '**/*.{ts,js,mjs,cjs,yaml}': 'KEBAB_CASE',
          '.codocs/**/*.yaml': 'KEBAB_CASE',
          'examples/.codocs/**/*.yaml': 'KEBAB_CASE',
        },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        {
          'packages/**/': 'KEBAB_CASE',
          'tools/**/': 'KEBAB_CASE',
          '.codocs/**/': 'KEBAB_CASE',
        },
      ],
    },
  },
  {
    files: ['.codocs/**/*.yaml', 'examples/.codocs/**/*.yaml'],
    processor: 'check-file/eslint-processor-check-file',
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './packages/*/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { codocs, boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json', './packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
      },
      'boundaries/elements': Object.keys(packages).map((type) => ({
        type,
        pattern: 'packages/' + type,
      })),
      'boundaries/additional-dependency-nodes': [
        {
          selector: 'TSImportType > Literal',
          name: 'import-type',
          kind: 'type',
        },
      ],
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        { ignoreVoid: false },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase'] },
        {
          selector: 'property',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'property', modifiers: ['requiresQuotes'], format: null },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          checkAllOrigins: true,
          checkUnknownLocals: true,
          policies: packageBoundaryPolicies(),
        },
      ],
      'codocs/no-raw-domain-value': 'error',
    },
  },
  {
    files: ['**/*.{ts,js,mjs,cjs}'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: { FunctionDeclaration: true, MethodDefinition: true },
          contexts: [
            'VariableDeclarator > ArrowFunctionExpression',
            'VariableDeclarator > FunctionExpression',
            'PropertyDefinition > ArrowFunctionExpression',
            'Property > FunctionExpression',
            'Property > ArrowFunctionExpression',
            'ReturnStatement > ArrowFunctionExpression',
            'ReturnStatement > FunctionExpression',
            'NewExpression > ArrowFunctionExpression',
            'NewExpression > FunctionExpression',
            'AssignmentExpression > ArrowFunctionExpression',
            'AssignmentExpression > FunctionExpression',
            'ExportDefaultDeclaration > ArrowFunctionExpression',
            'ExportDefaultDeclaration > FunctionExpression',
            // 함수 인자로 넘기는 콜백은 5줄 이상일 때만 설명을 요구한다.
            {
              context: 'CallExpression > ArrowFunctionExpression',
              minLineCount: 5,
            },
            {
              context: 'CallExpression > FunctionExpression',
              minLineCount: 5,
            },
          ],
        },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/match-description': ['error', { matchDescription: '[가-힣]' }],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-description': 'off',
      'jsdoc/match-description': 'off',
    },
  },
  {
    files: ['packages/vscode/src/client-manager/client-manager.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
