import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const processCursorSecret = randomBytes(32);

/** payload를 URL-safe 토큰으로 인코딩하고 process 비밀로 HMAC 서명한다. 목록과 중복 검사 커서가 공유한다. */
export function encodeSignedCursor(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', processCursorSecret)
    .update(encoded, 'utf8')
    .digest('base64url');
  return `${encoded}.${signature}`;
}

/** 서명을 검증한 JSON payload를 반환한다. 서명·형식 실패의 이유는 외부에 구분해 노출하지 않는다. */
export function decodeSignedCursor(token: string): unknown {
  const parts = token.split('.');
  if (parts.length !== 2) return undefined;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return undefined;
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return undefined;
  }
  if (actual.toString('base64url') !== signature) return undefined;
  const expected = createHmac('sha256', processCursorSecret)
    .update(encoded, 'utf8')
    .digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return undefined;
  try {
    return JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as unknown;
  } catch {
    return undefined;
  }
}
