import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 제품 식별과 manifest 및 공개 파일명의 단일 원본이다. */
export const products = Object.freeze({
  npm: Object.freeze({
    name: 'co-documentation',
    changeset: '@codocs/mcp',
    manifest: 'packages/mcp/package.json',
    suffix: 'tgz',
  }),
  vscode: Object.freeze({
    name: 'codocs',
    changeset: 'codocs',
    manifest: 'packages/vscode/package.json',
    suffix: 'vsix',
  }),
});
/** 정확한 버전과 안전한 파일명에 쓰는 semver 문자열을 검사한다. */
export function assertVersion(version) {
  assert.equal(typeof version, 'string', 'version must be a string');
  assert.match(
    version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u,
    'invalid product version',
  );
  return version;
}
/** 제품과 버전으로 경로가 없는 공개 산출물 이름을 만든다. */
export function artifactName(product, version) {
  assert.ok(Object.hasOwn(products, product), 'unknown product');
  assertVersion(version);
  return `${products[product].name}-${version}.${products[product].suffix}`;
}
/** 제품 manifest를 읽으며 제품 간 버전 일치를 요구하지 않는다. */
export async function readProductVersions(root) {
  const result = {};
  for (const [product, definition] of Object.entries(products)) {
    const manifest = JSON.parse(
      await readFile(path.join(root, definition.manifest), 'utf8'),
    );
    assert.equal(
      manifest.name,
      definition.changeset,
      'manifest product mismatch',
    );
    result[product] = assertVersion(manifest.version);
  }
  return result;
}
