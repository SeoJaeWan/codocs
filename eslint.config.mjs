import { defineConfig } from 'eslint/config';
import checkFile from 'eslint-plugin-check-file';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import codocs from './tools/development-checks/eslint-rules.mjs';

export default defineConfig(
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
    plugins: { codocs, jsdoc },
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
        { selector: 'property', format: ['camelCase'] },
        { selector: 'property', modifiers: ['requiresQuotes'], format: null },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
      'codocs/package-boundaries': 'error',
      'codocs/no-raw-domain-value': 'error',
      'codocs/korean-jsdoc': 'error',
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
          ],
        },
      ],
    },
  },
);
