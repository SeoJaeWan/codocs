import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { bundleIde } from './build.mjs';

const fixture = mkdtempSync(path.join(tmpdir(), 'codocs-bundle-'));
afterAll(
  /** 실행별 번들 fixture를 정리한다. */ () => {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  },
);

it('IDE 번들은 로컬 ESM을 포함하고 vscode 호스트 모듈을 외부로 유지한다', async () => {
  writeFileSync(
    path.join(fixture, 'value.mjs'),
    'export const value = "한글 😀";\n',
  );
  const source = path.join(fixture, 'index.ts');
  const destination = path.join(fixture, 'index.cjs');
  writeFileSync(
    source,
    "export {value} from './value.mjs';\nexport * as host from 'vscode';\n",
  );
  const result = await bundleIde([source], destination, ['vscode']);
  expect(
    Object.values(result.metafile.outputs).flatMap((file) => file.imports),
  ).toEqual([expect.objectContaining({ path: 'vscode', external: true })]);
  const bundled = readFileSync(destination, 'utf8');
  expect(bundled).toContain('require("vscode")');
  expect(bundled).not.toContain('require("./value.mjs")');
  expect(existsSourceMap(destination)).toBe(true);
});

/** 자체 번들 설정이 지정한 source map 출력 존재를 확인한다. */
function existsSourceMap(destination: string): boolean {
  return readFileSync(destination + '.map', 'utf8').includes('value.mjs');
}
