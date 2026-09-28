import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  discoverToolTests,
  selectToolTests,
  testSuites,
} from './selection.mjs';

test('실제 수집과 미래 파일의 관리·OS 선택은 누락과 교집합 없이 전체에 일치한다', /** namespace별 후속 파일도 같은 배치 계약을 따른다. */ () => {
  for (const files of [
    discoverToolTests(),
    [
      ...discoverToolTests(),
      'tools/ci/future.test.mjs',
      'tools/test/future.test.mjs',
    ],
  ]) {
    const all = selectToolTests(files);
    const management = selectToolTests(files, testSuites.management);
    const os = selectToolTests(files, testSuites.os);
    assert.deepEqual([...management, ...os].sort(), all);
    assert.deepEqual(
      management.filter((file) => os.includes(file)),
      [],
    );
    for (const file of [
      'tools/ci/ci-release.integration.test.mjs',
      'tools/ci/release-flow.test.mjs',
      'tools/build/release-version.test.mjs',
    ])
      assert.ok(management.includes(file));
    for (const file of [
      'tools/build/release-source.test.mjs',
      'tools/build/release-contract.test.mjs',
      'tools/build/release-metadata.test.mjs',
      'tools/test/runtime/release-ci.test.mjs',
    ])
      assert.ok(os.includes(file));
  }
  assert.deepEqual(
    selectToolTests(
      ['tools\\ci\\future.test.mjs', 'tools\\test\\future.test.mjs'],
      testSuites.management,
    ),
    ['tools/ci/future.test.mjs'],
  );
  assert.deepEqual(
    selectToolTests(
      ['tools\\ci\\future.test.mjs', 'tools\\test\\future.test.mjs'],
      testSuites.os,
    ),
    ['tools/test/future.test.mjs'],
  );
  assert.throws(() => selectToolTests([], 'unknown'), /unknown test suite/u);
});
