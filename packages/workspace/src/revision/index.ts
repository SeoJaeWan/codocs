import { createHash } from 'node:crypto';

/**
 * 한 번 읽은 파일의 원본 바이트에서 안정적인 revision을 계산한다.
 */
export function calculateRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 읽은 바이트의 UTF-8 원문과 revision을 함께 만들고 문자 해석 손실을 표시한다.
 */
export function decodeWorkspaceBytes(bytes: Uint8Array): {
  raw: string;
  revision: string;
  utf8Lossless: boolean;
} {
  const snapshot = Buffer.from(bytes);
  const raw = snapshot.toString('utf8');
  return {
    raw,
    revision: calculateRevision(snapshot),
    utf8Lossless: Buffer.from(raw, 'utf8').equals(snapshot),
  };
}
