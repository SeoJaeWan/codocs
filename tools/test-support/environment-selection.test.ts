import { describe, expect, it } from 'vitest';
import { assertEnvironmentHost } from '../environment-tests/preparation.mjs';
import local from '../../vitest.config.js';
import native from '../../vitest.environment.config.mjs';

describe('로컬 기능과 CI 환경 검사 선택', () => {
  it.each(['win32', 'darwin'] as const)(
    '%s CI 호스트이면 실제 환경 검사를 허용한다',
    (platform) => {
      expect(() =>
        assertEnvironmentHost({ ['CI']: 'true' }, platform),
      ).not.toThrow();
    },
  );
  it.each([{ ['CI']: undefined }, { ['CI']: 'false' }])(
    'CI=$CI 로컬 호스트이면 준비 실패로 거부한다',
    (env) => {
      expect(() => assertEnvironmentHost(env, 'win32')).toThrow(
        'ENVIRONMENT_PREPARATION_FAILED',
      );
    },
  );
  it('지원하지 않는 CI 호스트이면 성공·skip 대신 준비 실패로 거부한다', () => {
    expect(() => assertEnvironmentHost({ ['CI']: 'true' }, 'linux')).toThrow(
      'ENVIRONMENT_PREPARATION_FAILED',
    );
  });
  it('기본 로컬 명령과 환경 명령의 수집 범위를 분리한다', () => {
    expect(local.test?.include).toEqual([
      'packages/**/*.test.ts',
      'tools/test-support/**/*.test.ts',
      'tools/check/**/*.test.ts',
    ]);
    expect(native.test?.include).toEqual([
      'tools/environment-tests/**/*.contract.test.ts',
    ]);
  });
});
