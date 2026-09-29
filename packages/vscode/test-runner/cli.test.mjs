import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStableVersion } from './cli.mjs';

test('공식 stable 응답이 정확한 버전 목록이면 한 버전만 반환한다', /** 공식 응답 형식을 대조한다. */ async () => {
  const version = await resolveStableVersion(
    /** 응답 순서와 선택 결과를 확인한다. */
    async (url) => {
      assert.match(url, /released=true/u);
      /** 공식 목록을 제공한다. */
      async function json() {
        return ['1.139.0', '1.138.1'];
      }
      return { ok: true, json };
    },
  );
  assert.equal(version, '1.139.0');
});
