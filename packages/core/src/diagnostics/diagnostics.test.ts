import { describe, expect, it } from 'vitest';
import {
  renameDiagnosticCodes,
  storageDiagnosticCodes,
  storageDiagnosticMessages,
} from './index.js';

describe('저장 진단 코드', () => {
  it('여러 파일 저장의 복구 실패를 write_restore_failed 코드와 고정 문구로 구분한다', () => {
    expect(storageDiagnosticCodes.writeRestoreFailed).toBe(
      'write_restore_failed',
    );
    expect(storageDiagnosticMessages.writeRestoreFailed).not.toBe('');
  });

  it('이름 변경의 rename_restore_failed 코드는 그대로 유지한다', () => {
    expect(renameDiagnosticCodes.restoreFailed).toBe('rename_restore_failed');
  });

  it('저장 진단 코드는 서로 겹치지 않는다', () => {
    const codes = Object.values(storageDiagnosticCodes);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
