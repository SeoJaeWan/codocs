import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRunnerArgs } from './cli.mjs';

test('기능과 성능 모두 동일 후보 파일 쌍을 선택한다', /** 두 실행 모드의 명시 파일 선택을 검사한다. */ () => {
  for (const mode of ['functional', 'performance']) {
    const selected = parseRunnerArgs([
      '--mode',
      mode,
      '--vsix',
      'candidate.vsix',
      '--mcp-tgz',
      'candidate.tgz',
    ]);
    assert.equal(selected.vsix, 'candidate.vsix');
    assert.equal(selected.mcpTgz, 'candidate.tgz');
  }
});

test('후보 입력 누락과 중복은 준비 전에 거부한다', /** 준비 전 잘못된 조합을 거부한다. */ () => {
  assert.throws(() => parseRunnerArgs(['--vsix', 'candidate.vsix']), /함께/);
  assert.throws(() => parseRunnerArgs(['--mcp-tgz', 'candidate.tgz']), /함께/);
  assert.throws(() => parseRunnerArgs(['--vsix', 'a', '--vsix', 'b']), /중복/);
});
