import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import codosc from './tools/developmentChecks/eslintRules.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.workbench/**',
    ],
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
    plugins: { codosc, jsdoc },
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
      'codosc/package-boundaries': 'error',
      'codosc/korean-jsdoc': 'error',
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
