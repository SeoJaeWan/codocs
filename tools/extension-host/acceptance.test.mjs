import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeAcceptance } from './acceptance.cjs';

test('미실행 AC를 통과로 집계하지 않는다', /** 미실행 판정을 확인한다. */ () => {
  const result = summarizeAcceptance([]);
  assert.equal(result.length, 12);
  assert.ok(result.every((row) => row.status === 'skip'));
});
test('성공한 부분 검사와 미실행 조건이 함께 있으면 전체 AC는 미검증이다', /** 부분 성공의 과대 집계를 방지한다. */ () => {
  const result = summarizeAcceptance([
    { ac: 'AC-003', status: 'pass' },
    { ac: 'AC-003', status: 'skip' },
  ]);
  assert.equal(result[2].status, 'skip');
});
test('실패 뒤 다른 검사가 성공해도 실패와 원래 증거를 보존한다', /** 원래 실패 증거의 보존을 확인한다. */ () => {
  const failure = {
    ac: 'AC-003',
    status: 'fail',
    error: 'candidate did not open',
  };
  const result = summarizeAcceptance([
    failure,
    { ac: 'AC-003', status: 'pass' },
    { ac: 'AC-003', status: 'skip' },
  ]);
  assert.equal(result[2].status, 'fail');
  assert.equal(result[2].checks[0], failure);
});
