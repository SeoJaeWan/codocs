/** 소스 없는 JS 소비자에서 core 후보와 workspace 바이트 revision 공개 계약을 검사한다. */
export const changePlanContractJs = String.raw`import assert from 'node:assert/strict';
import {buildCatalog, changePlanStatuses, parseYaml, planDocumentChange, scanStatuses} from '@codocs/core';
import {calculateRevision, decodeWorkspaceBytes} from '@codocs/workspace';

const raw = '# keep comment\r\nid: zone\r\nname: 구역\r\ndefinition: 설명\r\ndomains: [운영]\r\ndeprecatedAliases:\r\n  - id: return-zone\r\n    message: 이전 안내\r\n';
const bytes = new TextEncoder().encode(raw);
const decoded = decodeWorkspaceBytes(bytes);
assert.equal(decoded.raw, raw);
assert.equal(decoded.revision, calculateRevision(bytes));
assert.equal(decoded.utf8Lossless, true);
assert.notEqual(calculateRevision(new TextEncoder().encode(raw.replaceAll('\r\n', '\n'))), decoded.revision);

const path = '.codocs/zone.yaml';
const observe = (path, source) => ({path, parsed: parseYaml(source, path)});
const catalog = buildCatalog({status: scanStatuses.complete, observations: [
  observe(path, raw),
  observe('.codocs/unrelated.yaml', 'id: unrelated\nname: 오류 문서\ndomains: [운영]\n'),
  observe('.codocs/taken.yaml', 'id: taken\nname: 다른 문서\ndefinition: 설명\ndomains: [운영]\n'),
]});
const context = {catalog, source: {path, raw: decoded.raw, revision: decoded.revision, utf8Lossless: decoded.utf8Lossless}};
const input = {mode: 'update', id: 'zone', revision: decoded.revision, set: {id: 'next-zone'}};
const inputBefore = structuredClone(input);
const candidate = planDocumentChange(input, context);
assert.equal(candidate.status, changePlanStatuses.candidate, JSON.stringify(candidate));
assert.equal(candidate.baseRevision, decoded.revision);
assert.equal(candidate.id, 'next-zone');
assert.ok(candidate.raw.startsWith('# keep comment\r\n'));
assert.deepEqual(candidate.data.deprecatedAliases, [
  {id: 'return-zone', message: '이전 안내'},
  {id: 'zone'},
]);
assert.equal(parseYaml(candidate.raw, path).data.id, 'next-zone');
assert.ok(!candidate.diagnostics.some(issue => issue.path === '.codocs/unrelated.yaml'));
assert.equal(raw, decoded.raw);
assert.deepEqual(input, inputBefore);
assert.equal(catalog.documents.get(path).id, 'zone');
assert.equal(Object.hasOwn(candidate, 'saved'), false);

const sameId = planDocumentChange({...input, set: {id: 'zone'}}, context);
assert.equal(sameId.status, changePlanStatuses.unchanged);
assert.equal(sameId.revision, decoded.revision);
assert.equal(Object.hasOwn(sameId, 'raw'), false);
const protectedList = planDocumentChange({...input, set: {deprecatedAliases: []}}, context);
assert.equal(protectedList.status, changePlanStatuses.failed);
const collision = planDocumentChange({...input, set: {id: 'taken'}}, context);
assert.equal(collision.status, changePlanStatuses.failed);
assert.ok(collision.diagnostics.some(issue => issue.code === 'duplicate_id'));
assert.ok(!collision.diagnostics.some(issue => issue.path === '.codocs/unrelated.yaml'));
console.log('Change plan JS contract verified');`;

/** Node 전역 타입 없이 배포 선언만 해석하는 strict 소비자 설정이다. */
export const changePlanContractConfig = {
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
  files: ['change-plan-contract.ts'],
};

/** 공개 입력과 상태별 결과를 소스 경로 없이 타입 검사한다. */
export const changePlanContractTs = String.raw`import {buildCatalog, changePlanStatuses, parseYaml, planDocumentChange, scanStatuses} from '@codocs/core';
import {calculateRevision, decodeWorkspaceBytes, planWorkspaceChange} from '@codocs/workspace';
import type {ChangePlanContext, ChangePlanResult} from '@codocs/core';
import type {WorkspaceChangePlanResult, WorkspaceScanResult} from '@codocs/workspace';

const bytes = new TextEncoder().encode('id: zone\nname: 구역\ndefinition: 설명\ndomains: [운영]\n');
const decoded: {raw: string; revision: string; utf8Lossless: boolean} = decodeWorkspaceBytes(bytes);
const digest: string = calculateRevision(bytes);
const path = '.codocs/zone.yaml';
const catalog = buildCatalog({status: scanStatuses.complete, observations: [{path, parsed: parseYaml(decoded.raw, path)}]});
const context: ChangePlanContext = {catalog, source: {path, ...decoded}};
const result: ChangePlanResult = planDocumentChange({mode: 'update', id: 'zone', revision: digest, set: {id: 'next-zone'}}, context);
if (result.status === changePlanStatuses.candidate) {
  const raw: string = result.raw;
  const base: string | undefined = result.baseRevision;
  const id: string = result.data.id;
  void raw; void base; void id;
} else if (result.status === changePlanStatuses.unchanged) {
  const revision: string = result.revision;
  // @ts-expect-error unchanged has no candidate YAML
  const raw = result.raw;
  void revision; void raw;
} else {
  // @ts-expect-error failure has no revision
  const revision = result.revision;
  void revision;
}
declare const scan: WorkspaceScanResult;
const workspaceResult: WorkspaceChangePlanResult = planWorkspaceChange({mode: 'create', path, document: {}}, scan);
if (workspaceResult.status === changePlanStatuses.candidate) {
  const revision: string = workspaceResult.revision;
  void revision;
}
// @ts-expect-error revision requires original bytes
calculateRevision('source');
void workspaceResult;`;
