/** 소스 없는 JS 소비자가 실제 MCP 조회 handler와 exports 경계를 검사한다. */
export const queryContractJs = String.raw`import assert from 'node:assert/strict';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {createCodocsQueryHandlers} from '@codocs/mcp';
import {queryDiagnosticCodes} from '@codocs/core';
const project = path.join(process.cwd(), 'mcp project');
await mkdir(path.join(project, '.codocs'), {recursive: true});
try {
  await writeFile(path.join(project, '.codocs', 'b.yaml'), 'id: b\nname: B\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: "[[A]]"\n');
  await writeFile(path.join(project, '.codocs', 'a.yaml'), 'id: a\nname: A\ndomains: [업무]\nkind: policy\nstatus: confirmed\ndefinition: 본문\n');
  const handlers = createCodocsQueryHandlers({cwd: project});
  const list = await handlers.codocsList({domain: '업무', kind: 'policy', status: 'confirmed'});
  assert.equal(list.success, true);
  assert.equal(list.scanStatus, 'complete');
  assert.deepEqual(list.items.map(item => item.id), ['a', 'b']);
  assert.equal(list.totalCount, 2);
  assert.equal(list.returnedCount, 2);
  assert.equal(list.nextCursor, null);
  const get = await handlers.codocsGet({ids: ['b', 'missing', 'b']});
  assert.equal(get.success, true);
  assert.equal(get.scanStatus, 'complete');
  assert.equal(get.results.length, 2);
  assert.deepEqual(get.results[0].references, ['a']);
  assert.equal(get.results[0].document.definition, '[[A]]');
  assert.equal(typeof get.results[0].revision, 'string');
  assert.equal(get.results[1].found, false);
  assert.equal(get.results[1].diagnostics[0].code, queryDiagnosticCodes.notFound);
  const invalid = await handlers.codocsGet({ids: [], extra: true});
  assert.deepEqual(invalid, {success: false, scanStatus: 'failed', error: {code: queryDiagnosticCodes.invalidInput, severity: 'error', message: '조회 입력이 올바르지 않습니다.'}});
  assert.ok(import.meta.resolve('@codocs/mcp').startsWith(new URL('./node_modules/', import.meta.url).href));
  for (const subpath of ['src/index.js', 'dist/index.js', 'dist/query/index.js']) await assert.rejects(import('@codocs/mcp/' + subpath), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  console.log('MCP query JS contract verified');
} finally { await rm(project, {recursive: true, force: true}); }
// The public query handlers keep a file watcher alive after this contract finishes.
process.exit(0);`;

/** Node 전역 타입 없는 strict d.ts 소비자 설정이다. */
export const queryContractConfig = {
  compilerOptions: {
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedSideEffectImports: true,
    noEmit: true,
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    target: 'ES2022',
    lib: ['ES2022', 'DOM'],
    types: [],
    skipLibCheck: false,
  },
  files: ['query-contract.ts'],
};

/** strict NodeNext가 scanStatus와 ID별 결과 union을 완전하게 좁히는지 검사한다. */
export const queryContractTs = String.raw`import {createCodocsQueryHandlers} from '@codocs/mcp';
import {queryDiagnosticCodes} from '@codocs/core';
import {workspaceQueryDiagnosticCodes} from '@codocs/workspace';
import type {CodocsGetInput, CodocsGetResponse, CodocsListInput, CodocsListResponse} from '@codocs/mcp';
const handlers = createCodocsQueryHandlers({cwd: '.'});
const listInput: CodocsListInput = {domain: '업무', kind: 'policy', status: 'confirmed'};
const getInput: CodocsGetInput = {ids: ['a', 'b']};
const list: CodocsListResponse = await handlers.codocsList(listInput);
if (list.success) {
  const status: 'complete' | 'partial' = list.scanStatus;
  console.log(status, list.items, list.totalCount, list.returnedCount, list.nextCursor);
  // @ts-expect-error 성공 목록에는 전체 요청 error가 없다.
  console.log(list.error);
} else {
  const status: 'complete' | 'partial' | 'failed' = list.scanStatus;
  console.log(status, list.error);
  // @ts-expect-error 실패 목록에는 부분 items가 없다.
  console.log(list.items);
}
const get: CodocsGetResponse = await handlers.codocsGet(getInput);
if (get.success) {
  const status: 'complete' | 'partial' = get.scanStatus;
  console.log(status);
  for (const result of get.results) {
    if (!result.found) {
      if ('confirmation' in result) { const confirmation: 'unconfirmed' = result.confirmation; console.log(confirmation); }
      else { const code: string = result.diagnostics[0]!.code; console.log(code); }
      // @ts-expect-error 없는 결과에는 문서 내용이 없다.
      console.log(result.document);
    } else if (result.conflict) {
      console.log(result.paths);
      // @ts-expect-error 충돌 결과에는 대표 revision이 없다.
      console.log(result.revision);
    } else if ('document' in result) {
      console.log(result.document, result.revision, result.references, result.referencedBy);
      // @ts-expect-error JSON 문서 분기에는 rawYaml이 없다.
      const raw: string = result.rawYaml; console.log(raw);
    } else {
      const raw: string = result.rawYaml;
      console.log(raw, result.revision, result.references, result.referencedBy);
    }
  }
} else {
  console.log(get.scanStatus, get.error);
  // @ts-expect-error 실패 상세에는 부분 results가 없다.
  console.log(get.results);
}
const invalidCode: 'invalid_input' = queryDiagnosticCodes.invalidInput;
const cursorCode: 'cursor_expired' = workspaceQueryDiagnosticCodes.cursorExpired;
console.log(invalidCode, cursorCode);
// @ts-expect-error 공개 exports에서 내부 구현 접근은 거부한다.
import '@codocs/mcp/src/query/index.js';
// @ts-expect-error dist 내부 subpath도 공개하지 않는다.
import '@codocs/mcp/dist/query/index.js';`;
