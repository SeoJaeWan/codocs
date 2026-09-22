import assert from 'node:assert/strict';
import { test } from 'node:test';
import outcome from './request-outcome.cjs';

/** 중단 표시 뒤 완료된 정상 응답의 성공 판정과 중단을 모두 보존한다. */
function preservesCompletedSuccess() {
  assert.deepEqual(
    outcome.classifyRequestOutcome({ success: true }, undefined, 'SIGINT'),
    { success: true, cancelled: false, stop: true },
  );
}

test('중단 표시 직전 정상 완료는 성공으로 보존한다', preservesCompletedSuccess);

/** 중단 표시 뒤 완료된 내용 불일치는 취소로 바꾸지 않는다. */
function preservesCompletedMismatch() {
  assert.deepEqual(
    outcome.classifyRequestOutcome({ success: false }, undefined, 'SIGTERM'),
    { success: false, cancelled: false, stop: true },
  );
}

test(
  '중단 표시 직전 내용 불일치는 실패로 보존한다',
  preservesCompletedMismatch,
);

/** 실제 취소 오류만 완료 요청의 취소로 분류한다. */
function separatesCancelledRequest() {
  assert.deepEqual(
    outcome.classifyRequestOutcome(undefined, 'Canceled', 'SIGINT'),
    { success: false, cancelled: true, stop: true },
  );
}

test('취소 오류는 기능 불일치와 구분한다', separatesCancelledRequest);
