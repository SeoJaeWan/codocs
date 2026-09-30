import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calculateRevision, decodeWorkspaceBytes } from './index.js';

describe('decodeWorkspaceBytes: 원본 바이트 해석과 버전 계산', () => {
  /** @codocs [[작업 공간:원문 버전]]#L6-L9 */
  it('유효한 UTF-8 바이트를 해석하면 원문과 원본 바이트의 SHA-256을 반환한다', () => {
    const bytes = Buffer.from('id: alpha\n', 'utf8');
    const result = decodeWorkspaceBytes(bytes);

    expect(result).toEqual({
      raw: 'id: alpha\n',
      revision: createHash('sha256').update(bytes).digest('hex'),
      utf8Lossless: true,
    });
  });

  it.each([
    ['LF와 CRLF', 'id: alpha\n', 'id: alpha\r\n'],
    ['끝 공백', 'id: alpha\n', 'id: alpha \n'],
    ['앞 주석', 'id: alpha\n', '# 설명\nid: alpha\n'],
  ])(
    '%s가 다른 원문을 해석하면 서로 다른 버전을 반환한다',
    (_condition, first, second) => {
      const firstBytes = Buffer.from(first, 'utf8');
      const secondBytes = Buffer.from(second, 'utf8');

      expect(decodeWorkspaceBytes(firstBytes).revision).not.toBe(
        decodeWorkspaceBytes(secondBytes).revision,
      );
    },
  );

  /** @codocs [[작업 공간:원문 버전]]#L9 */
  it('잘못된 UTF-8 바이트 둘이 같은 대체 문자열로 해석되어도 서로 다른 원본 버전을 반환한다', () => {
    const first = Buffer.from([0x80]);
    const second = Buffer.from([0x81]);
    const firstResult = decodeWorkspaceBytes(first);
    const secondResult = decodeWorkspaceBytes(second);

    expect(firstResult.raw).toBe(secondResult.raw);
    expect(firstResult.utf8Lossless).toBe(false);
    expect(secondResult.utf8Lossless).toBe(false);
    expect(firstResult.revision).toBe(
      createHash('sha256').update(first).digest('hex'),
    );
    expect(secondResult.revision).toBe(
      createHash('sha256').update(second).digest('hex'),
    );
    expect(firstResult.revision).not.toBe(secondResult.revision);
  });
});

describe('calculateRevision: 원본 바이트 버전 계산', () => {
  it('잘못된 UTF-8 바이트의 버전을 계산하면 원본 바이트의 SHA-256을 반환한다', () => {
    const bytes = Buffer.from([0x80]);

    expect(calculateRevision(bytes)).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
  });
});
