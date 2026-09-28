import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { root } from '../toolchain.mjs';

/** 릴리스 관리·제품 OS 검사와 기본 전체 실행의 명시적 선택 값이다. */
export const testSuites = Object.freeze({
  all: 'all',
  management: 'release-management',
  os: 'os',
});

/** 새 도구 파일도 전체 수집에 포함하며 중복 glob 관측은 하나로 합친다. */
export function discoverToolTests(cwd = root) {
  return [
    ...new Set(
      globSync(
        ['tools/**/*.test.mjs', 'packages/**/src/**/test-support/*.test.mjs'],
        { cwd },
      ).map((file) => file.replaceAll('\\', '/')),
    ),
  ].sort();
}

/** CI 관리 namespace와 공식 버전 계산만 한 번 실행하고 나머지는 OS마다 유지한다. */
export function selectToolTests(files, suite = testSuites.all) {
  assert.ok(Object.values(testSuites).includes(suite), 'unknown test suite');
  return [...new Set(files.map((file) => file.replaceAll('\\', '/')))]
    .sort()
    .filter(
      /** 발견한 파일은 명시적 관리 책임 또는 OS 보완 집합 중 하나에 속한다. */ (
        file,
      ) => {
        const management =
          file.startsWith('tools/ci/') ||
          file === 'tools/build/release-version.test.mjs';
        return (
          suite === testSuites.all ||
          (suite === testSuites.management ? management : !management)
        );
      },
    );
}
