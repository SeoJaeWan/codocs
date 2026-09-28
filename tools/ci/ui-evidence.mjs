import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 실제 화면에서 완료해야 하는 대표 기능 사례의 계약이다. */
export const uiScenarios = Object.freeze([
  'hover-content-and-relations',
  'yaml-single-special-path',
  'yaml-multiple-candidates',
  'dirty-target-tab',
  'changed-reference-and-save',
  'saved-and-external-refresh',
  'stale-target-latest-content',
  'stale-target-rejected-output',
  'nested-workspace-owner',
]);

/** 고정 버전·후보 해시·설치 응답·전체 실제 입력과 정리를 함께 확인한다. */
export function validateUiEvidence(ui, candidate, stable, platform) {
  assert.ok(ui, 'UI evidence required');
  const product = candidate.artifacts.find((item) => item.product === 'vscode');
  const { result, installation, functional } = ui;
  assert.equal(result.version, stable, 'UI fixed stable mismatch');
  assert.equal(result.platform, platform, 'UI platform mismatch');
  assert.equal(result.vsixSha256, product.sha256, 'UI candidate hash mismatch');
  assert.equal(result.passed, true, 'UI did not pass');
  assert.equal(result.status, 'passed', 'UI status did not pass');
  assert.equal(result.phase, 'complete', 'UI incomplete');
  assert.equal(result.cleaned, true, 'UI cleanup required');
  assert.deepEqual(result.exit, { code: 0, signal: null }, 'UI exit required');
  assert.equal(installation.passed, true, 'VSIX installation did not pass');
  assert.equal(installation.active, true, 'VSIX activation required');
  assert.equal(installation.serverResponse, 'published-diagnostics');
  for (const environment of [installation, functional.environment]) {
    assert.equal(environment.vscode, stable, 'UI host version mismatch');
    assert.equal(environment.platform, platform, 'UI host platform mismatch');
    assert.equal(
      environment.vsixSha256,
      product.sha256,
      'UI host hash mismatch',
    );
    assert.equal(environment.extensionVersion, product.version);
    assert.equal(environment.packageKind, 'installed-vsix');
    assert.equal(environment.renderedUi, true, 'renderer input required');
  }
  assert.deepEqual(
    functional.results.map((item) => item.id).sort(),
    [...uiScenarios].sort(),
    'complete UI scenario set required',
  );
  for (const scenario of functional.results) {
    assert.equal(scenario.passed, true, `UI scenario failed: ${scenario.id}`);
    assert.equal(scenario.input, 'renderer-mouse', 'real mouse input required');
    assert.equal(scenario.cleanupError, undefined, 'UI restoration failed');
  }
  assert.equal(functional.error, undefined, 'functional UI error');
  return ui;
}

/** 출력 파일을 읽고 성공 계약을 확인하며 누락된 증거는 성공으로 처리하지 않는다. */
export async function readUiEvidence(directory, candidate, stable, platform) {
  const ui = {};
  for (const name of ['result', 'installation', 'functional'])
    ui[name] = JSON.parse(
      await readFile(path.join(directory, `${name}.json`), 'utf8'),
    );
  return validateUiEvidence(ui, candidate, stable, platform);
}
