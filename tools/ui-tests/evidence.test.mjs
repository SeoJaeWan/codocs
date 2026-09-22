import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import path from 'node:path';
import { captureEvidence, errorRecord } from './evidence.mjs';

describe('UI 실패 증거의 보존', /** 입력 조건과 관측 결과의 계약을 검증한다. */ () => {
  test('성공하면 스크린샷을 만들지 않고 trace를 파일 없이 종료한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const calls = [];
    await captureEvidence({
      page: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ isClosed: () => false,
        /** 캡처할 창이 열려 있음을 반환한다. */ screenshot: async () => {
          calls.push('screen');
        },
      },
      tracing: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ stop: async (
          options,
        ) => {
          calls.push(options);
        },
      },
      failed: false,
      output: '/evidence',
      errors: [],
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ attach: async () => {
        calls.push('attach');
      },
    });
    assert.deepEqual(calls, [{}]);
  });
  test('실패하면 화면과 trace를 각각 저장하고 첨부한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const screenshots = [];
    const traces = [];
    const attachments = [];
    await captureEvidence({
      page: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ isClosed: () => false,
        /** 캡처할 창이 열려 있음을 반환한다. */ screenshot: async (
          options,
        ) => {
          screenshots.push(options);
        },
      },
      tracing: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ stop: async (
          options,
        ) => {
          traces.push(options);
        },
      },
      failed: true,
      output: '/evidence',
      errors: [],
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ attach: async (
        name,
        value,
      ) => {
        attachments.push({ name, value });
      },
    });
    assert.equal(screenshots[0].path, path.join('/evidence', 'screen.png'));
    assert.equal(traces[0].path, path.join('/evidence', 'trace.zip'));
    assert.deepEqual(
      attachments.map((a) => a.name),
      ['UI screen', 'UI trace'],
    );
  });
  test('화면 캡처가 실패해도 원래 오류를 보존하고 trace는 수집한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const original = errorRecord(new Error('setup failed'), 'environment');
    const errors = [original];
    const traces = [];
    await captureEvidence({
      page: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ isClosed: () => false,
        /** 캡처할 창이 열려 있음을 반환한다. */ screenshot: async () => {
          throw new Error('screen failed');
        },
      },
      tracing: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ stop: async (
          options,
        ) => {
          traces.push(options);
        },
      },
      failed: true,
      output: '/evidence',
      errors,
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ attach: async () => {},
    });
    assert.equal(errors[0], original);
    assert.equal(errors[1].stage, 'screenshot');
    assert.equal(errors[1].message, 'screen failed');
    assert.equal(traces.length, 1);
  });
  test('창 생성 전 실패하면 화면을 요구하지 않고 원래 오류를 유지한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const original = errorRecord(new Error('launch failed'), 'environment');
    const errors = [original];
    await captureEvidence({
      failed: true,
      errors,
      output: '/evidence',
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ attach: async () =>
        assert.fail('첨부할 화면 없음'),
    });
    assert.deepEqual(errors, [original]);
    assert.match(JSON.stringify(errors), /launch failed/);
  });
  test('trace 저장 실패도 별도 증거 오류로 보존한다', /** 입력 조건과 관측 결과의 계약을 검증한다. */ async () => {
    const errors = [];
    await captureEvidence({
      tracing: {
        /** 입력 조건과 관측 결과의 계약을 검증한다. */ stop: async () => {
          throw new Error('trace failed');
        },
      },
      failed: true,
      output: '/evidence',
      errors,
      /** 입력 조건과 관측 결과의 계약을 검증한다. */ attach: async () => {},
    });
    assert.equal(errors[0].stage, 'trace');
    assert.equal(errors[0].message, 'trace failed');
  });
});
