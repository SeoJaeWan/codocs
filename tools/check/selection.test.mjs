import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import local from '../../vitest.config.ts';
import native from '../../vitest.environment.config.mjs';
import { assertEnvironmentHost } from '../environment-tests/preparation.mjs';
const require = createRequire(
  new URL('../../packages/core/package.json', import.meta.url),
);
const { parse } = require('yaml');

/** 조건별 실행 결과와 변경 보존을 확인한다. */
function verifySelection() {
  const localFiles = globSync(local.test.include);
  const nativeFiles = globSync(native.test.include);
  assert.ok(localFiles.length > 0);
  assert.ok(nativeFiles.length > 0);
  assert.deepEqual(
    localFiles.filter((file) => nativeFiles.includes(file)),
    [],
  );
  const workflow = parse(
    readFileSync(
      new URL('../../.github/workflows/environment.yml', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(workflow.jobs.environment.strategy.matrix.os, [
    'windows-2025',
    'macos-15',
  ]);
  const steps = workflow.jobs.environment.steps;
  assert.equal(
    steps.find((step) => step.uses?.startsWith('actions/checkout@')).with.ref,
    '${{ github.sha }}',
  );
  assert.deepEqual(
    steps.filter((step) => step.run).map((step) => step.run),
    [
      'pnpm install --frozen-lockfile',
      'pnpm test:environment --reporter=default --reporter=json --outputFile=.workbench/environment/results.json',
    ],
  );
  const hook = readFileSync(
    new URL('./pre-commit.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(hook.includes("'test:run'"));
  assert.ok(hook.includes("'tools/vscode-tests/run.mjs'"));
  assert.doesNotMatch(hook, /test:environment|performance:|vitest.environment/);
}
test(
  'CI와 로컬 기능 수집 목록은 겹치지 않고 두 OS의 같은 SHA만 계약 검사에 연결한다',
  verifySelection,
);

/** 조건별 실행 결과와 변경 보존을 확인한다. */
function verifyPreparation() {
  assert.throws(
    () => assertEnvironmentHost({}, 'win32'),
    /ENVIRONMENT_PREPARATION_FAILED/,
  );
  assert.throws(
    () => assertEnvironmentHost({ CI: 'true' }, 'linux'),
    /ENVIRONMENT_PREPARATION_FAILED/,
  );
  assert.doesNotThrow(() => assertEnvironmentHost({ CI: 'true' }, 'win32'));
  assert.doesNotThrow(() => assertEnvironmentHost({ CI: 'true' }, 'darwin'));
}
test('CI 필수 조건이 없으면 skip 대신 준비 실패를 반환한다', verifyPreparation);
