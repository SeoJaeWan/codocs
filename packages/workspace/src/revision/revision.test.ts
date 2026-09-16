import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calculateRevision, decodeWorkspaceBytes } from './index.js';

describe('원본 바이트 revision', /** 텍스트 해석과 해시 계산의 경계를 확인한다. */ () => {
  it('주석·공백·LF/CRLF가 다른 바이트이면 각각의 SHA-256을 반환한다', /** 원문 정규화를 막는다. */ () => {
    const sources = [
      'id: alpha\n',
      'id: alpha\r\n',
      'id: alpha \n',
      '# 설명\nid: alpha\n',
    ];
    const revisions = sources.map(
      /** 각 원문을 바이트로 바꿔 정규화 없는 digest를 비교한다. */ (
        source,
      ) => {
        const bytes = Buffer.from(source, 'utf8');
        const decoded = decodeWorkspaceBytes(bytes);
        expect(decoded).toEqual({
          raw: source,
          revision: createHash('sha256').update(bytes).digest('hex'),
          utf8Lossless: true,
        });
        return decoded.revision;
      },
    );
    expect(new Set(revisions).size).toBe(sources.length);
  });

  it('서로 다른 잘못된 UTF-8 바이트는 같은 대체 문자열이어도 원본별 digest와 손실 표시를 제공한다', /** 문자열 재인코딩으로 충돌시키지 않는다. */ () => {
    const first = Buffer.from([0x80]);
    const second = Buffer.from([0x81]);
    const a = decodeWorkspaceBytes(first);
    const b = decodeWorkspaceBytes(second);
    expect(a.raw).toBe(b.raw);
    expect(a.utf8Lossless).toBe(false);
    expect(b.utf8Lossless).toBe(false);
    expect(a.revision).toBe(createHash('sha256').update(first).digest('hex'));
    expect(b.revision).toBe(createHash('sha256').update(second).digest('hex'));
    expect(a.revision).not.toBe(b.revision);
    expect(calculateRevision(first)).toBe(a.revision);
  });
});
