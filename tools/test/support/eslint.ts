import { ESLint } from 'eslint';

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
          disallowAutomaticSingleRunInference: true,
        },
      },
    },
  });
}
