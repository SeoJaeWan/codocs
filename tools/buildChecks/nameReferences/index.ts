/** 소스 없는 JS 소비자에서 공개 계산 API와 실제 로더 연결을 검사하는 프로그램이다. */
export const nameReferenceJs = String.raw`import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile, rm, rename} from 'node:fs/promises';
import path from 'node:path';
import {parseYaml, extractReferences, buildCatalog, resolveReference, planRename, referenceDiagnosticCodes, catalogDiagnosticCodes} from '@codosc/core';
import {loadWorkspace, toCatalogScan, buildWorkspaceCatalog} from '@codosc/workspace';
const term = (name, domain, id = 'same-id') => 'id: ' + id + '\nname: ' + name + '\ndefinition: 정의\ndomains: [' + domain + ']\n';
const knowledge = (title, body) => 'id: source\nname: ' + title + '\ndefinition: ' + JSON.stringify(body) + '\ndomains: [판매]\n';
const observe = (path, source) => ({path, realPath: '/same-real-path', parsed: parseYaml(source, path)});
const raw = knowledge('출처', '😀 [[주문]] [[판매:주문]] [[판매:주문]] [[없음]] [[출처]] [[]] \\[[주문]]');
const records = [observe('.codocs/a.yaml', term('주문', '판매')), observe('.codocs/b.yaml', term('주문', '지원')), observe('.codocs/s.yaml', raw), observe('.codocs/error.yaml', 'name: 오류 대상\ndefinition: 정의\ndomains: [판매]\n'), observe('.codocs/bad.yaml', 'name: 파싱 실패\ndefinition: "[[주문]]"\nx: [\n')];
const before = structuredClone(records);
const catalog = buildCatalog({status: 'complete', observations: records});
assert.equal(catalog.documents.size, 5);
assert.deepEqual([...catalog.idPaths.get('same-id')], ['.codocs/a.yaml', '.codocs/b.yaml']);
for (const p of ['.codocs/a.yaml', '.codocs/b.yaml']) assert.ok(catalog.documents.get(p).diagnostics.some(d => d.code === 'duplicate_id'));
assert.equal(resolveReference(catalog, {name: '주문'}, '.codocs/s.yaml').status, 'ambiguous');
for (const name of ['판매:주문', ' 주문', 'ORDER']) assert.equal(resolveReference(catalog, {name}).status, 'missing');
const resolved = resolveReference(catalog, {name: '주문', domain: '판매'});
assert.equal(resolved.status, 'resolved');
assert.equal(resolved.target.path, '.codocs/a.yaml');
assert.equal(resolved.target.name, '주문');
assert.equal(Object.hasOwn(resolved.target, 'type'), false);
assert.equal(resolved.target.id, 'same-id');
assert.deepEqual(resolved.target.domains, ['판매']);
assert.ok(resolved.target.errors.some(d => d.code === 'duplicate_id'));
const source = catalog.documents.get('.codocs/s.yaml');
assert.deepEqual(source.occurrences.map(x => x.resolution.status), ['ambiguous', 'resolved', 'resolved', 'missing', 'self', 'invalid']);
assert.deepEqual(source.references.map(x => x.path), ['.codocs/a.yaml']);
assert.deepEqual(catalog.documents.get('.codocs/a.yaml').referencedBy.map(x => x.path), ['.codocs/s.yaml']);
assert.deepEqual(catalog.documents.get('.codocs/b.yaml').referencedBy, []);
for (const item of source.occurrences) {
  const range = item.occurrence.offsetRange;
  assert.equal(raw.slice(range.start, range.end), item.occurrence.text);
  assert.equal(item.occurrence.range.start.line, 2);
}
assert.deepEqual(catalog.documents.get('.codocs/bad.yaml').occurrences, []);
assert.equal(catalog.documents.get('.codocs/bad.yaml').name, undefined);
const error = resolveReference(catalog, {name: '오류 대상'});
assert.equal(error.status, 'resolved');
assert.ok(error.target.errors.some(d => d.code === 'missing_required_field'));
const mixed = extractReferences(parseYaml('name: "[[메타]]"\ndefinition: 4\nexamples: ["[[정상]]", 7, "[[다른 정상]]"]\n'));
assert.deepEqual(mixed.occurrences.map(x => x.syntax === 'valid' ? x.name : undefined), ['정상', '다른 정상']);
const escaped = extractReferences(parseYaml("definition: '[[판매\\:동부:주문\\:확인]] \\[[리터럴]]'\n"));
assert.equal(escaped.occurrences.length, 1);
assert.equal(escaped.occurrences[0].name, '주문:확인');
assert.equal(escaped.occurrences[0].domain, '판매:동부');
assert.equal(referenceDiagnosticCodes.invalidReference, 'invalid_reference');
assert.deepEqual(Object.values(catalogDiagnosticCodes), ['duplicate_id', 'duplicate_name', 'missing_reference', 'ambiguous_reference', 'self_reference', 'unconfirmed_reference', 'reference_target_error']);
const partial = buildCatalog({status: 'partial', observations: [records[2]], failures: [{kind: 'folder', path: '.codocs'}]}, catalog);
assert.equal(partial.documents.get('.codocs/a.yaml').confirmation, 'unconfirmed');
assert.equal(partial.documents.get('.codocs/s.yaml').confirmation, 'confirmed');
for (const name of ['없음', '오류 대상']) assert.equal(resolveReference(partial, {name}).status, 'unconfirmed');
assert.deepEqual(partial.documents.get('.codocs/a.yaml').referencedBy, []);
assert.ok(partial.documents.get('.codocs/s.yaml').diagnostics.some(d => d.code === 'unconfirmed_reference'));
const failed = buildCatalog({status: 'failed', observations: [], failures: [{kind: 'unknown'}]}, partial);
assert.equal(failed.status, 'failed');
assert.equal(failed.documents.size, 5);
assert.ok([...failed.documents.values()].every(x => x.confirmation === 'unconfirmed'));
assert.equal(planRename(partial, {targetPath: '.codocs/a.yaml', newName: '판매주문'}).blockingReason, 'unconfirmed');
const plan = planRename(catalog, {targetPath: '.codocs/a.yaml', newName: '판매주문', selections: [{sourcePath: '.codocs/s.yaml', occurrenceIndex: 0, targetPath: '.codocs/a.yaml'}]});
assert.equal(plan.status, 'ready');
assert.equal(plan.changes.length, 4);
assert.ok(plan.changes.some(x => x.oldText === '[[판매:주문]]' && x.newText === '[[판매:판매주문]]'));
for (const change of plan.changes) {
  assert.equal(change.targetPath, '.codocs/a.yaml');
  assert.ok(change.range && change.offsetRange && change.fieldPath && change.candidates.length);
}
const unresolved = planRename(catalog, {targetPath: '.codocs/a.yaml', newName: '판매주문', updateReferences: false});
assert.equal(unresolved.status, 'unresolved');
assert.equal(unresolved.changes.length, 1);
assert.ok(unresolved.impacts.some(x => x.reason === 'references_disabled'));
const collision = buildCatalog({status: 'complete', observations: [...records, observe('.codocs/c.yaml', term('판매주문', '판매', 'other-id'))]});
const blocked = planRename(collision, {targetPath: '.codocs/a.yaml', newName: '판매주문'});
assert.equal(blocked.status, 'blocked');
assert.equal(blocked.blockingReason, 'name_conflict');
assert.deepEqual(blocked.changes, []);
const qualifiedCatalog = buildCatalog({status: 'complete', observations: [...records, observe('.codocs/c.yaml', term('판매주문', '동부', 'other-id'))]});
const qualifiedPlan = planRename(qualifiedCatalog, {targetPath: '.codocs/a.yaml', newName: '판매주문', selections: [{sourcePath: '.codocs/s.yaml', occurrenceIndex: 0, targetPath: '.codocs/a.yaml'}]});
assert.equal(qualifiedPlan.status, 'ready');
assert.ok(qualifiedPlan.changes.some(x => x.oldText === '[[주문]]' && x.newText === '[[판매:판매주문]]'));
const otherSelection = planRename(catalog, {targetPath: '.codocs/a.yaml', newName: '판매주문', selections: [{sourcePath: '.codocs/s.yaml', occurrenceIndex: 0, targetPath: '.codocs/b.yaml'}]});
assert.equal(otherSelection.status, 'ready');
assert.equal(otherSelection.changes.some(x => x.occurrenceIndex === 0), false);
const multiCatalog = buildCatalog({status: 'complete', observations: [observe('.codocs/m.yaml', 'id: multi\nname: 다중 대상\ndefinition: 본문\ndomains: [판매, 동부]\n'), observe('.codocs/u.yaml', knowledge('사용', '[[다중 대상]]')), observe('.codocs/c.yaml', term('새 이름', '지원', 'other-id'))]});
const multiPlan = planRename(multiCatalog, {targetPath: '.codocs/m.yaml', newName: '새 이름'});
assert.equal(multiPlan.status, 'unresolved');
assert.ok(multiPlan.impacts.some(x => x.reason === 'domain_required'));
const selectedDomain = planRename(multiCatalog, {targetPath: '.codocs/m.yaml', newName: '새 이름', selections: [{sourcePath: '.codocs/u.yaml', occurrenceIndex: 0, targetPath: '.codocs/m.yaml', domain: '동부'}]});
assert.equal(selectedDomain.status, 'ready');
assert.ok(selectedDomain.changes.some(x => x.newText === '[[동부:새 이름]]'));
assert.deepEqual(records, before);
const project = path.join(process.cwd(), '실제 프로젝트');
await mkdir(path.join(project, '.codocs'), {recursive: true});
try {
  const targetPath = path.join(project, '.codocs', '주문.yaml');
  const sourcePath = path.join(project, '.codocs', '처리.yaml');
  const targetRaw = '# 원문 😀\r\n' + term('주문', '판매', 'order-id').replaceAll('\n', '\r\n');
  const sourceRaw = knowledge('처리', '[[주문]]');
  await writeFile(targetPath, targetRaw);
  await writeFile(sourcePath, sourceRaw);
  await writeFile(path.join(project, '.codocs', '오류.yaml'), 'name: 이름 보존\ndefinition: "[[주문]]"\ndomains: [판매]\n');
  await writeFile(path.join(project, '.codocs', '깨진.yaml'), 'name: [\n');
  const scan = await loadWorkspace({project});
  assert.equal(scan.status, 'complete');
  assert.equal(scan.documents.length, 4);
  const converted = toCatalogScan(scan);
  for (const doc of scan.documents) {
    const observation = converted.observations.find(x => x.path === doc.source.path);
    if (doc.status === 'parseError') {
      assert.equal(observation.parsed.success, false);
      assert.equal('data' in doc, false);
      assert.equal('parsed' in doc, false);
    } else {
      assert.equal(observation.parsed, doc.parsed);
      if (doc.status === 'validationError') assert.equal('data' in doc, false);
      else assert.equal(typeof doc.data.name, 'string');
    }
  }
  const workspaceCatalog = buildWorkspaceCatalog(scan);
  const targetRelative = path.join('.codocs', '주문.yaml');
  assert.equal(resolveReference(workspaceCatalog, {name: '주문'}).target.path, targetRelative);
  assert.equal(workspaceCatalog.documents.get(targetRelative).referencedBy.length, 2);
  const preview = planRename(workspaceCatalog, {targetPath: targetRelative, newName: '새 주문'});
  assert.equal(preview.status, 'ready');
  assert.equal(preview.changes.length, 3);
  assert.equal(await readFile(targetPath, 'utf8'), targetRaw);
  assert.equal(await readFile(sourcePath, 'utf8'), sourceRaw);
  await writeFile(targetPath, term('새 주문', '판매', 'order-id'));
  const updated = buildWorkspaceCatalog(await loadWorkspace({project}), workspaceCatalog);
  assert.equal(resolveReference(updated, {name: '주문'}).status, 'missing');
  await rename(targetPath, path.join(project, '.codocs', '이동.yaml'));
  const moved = buildWorkspaceCatalog(await loadWorkspace({project}), updated);
  assert.equal(moved.documents.has(targetRelative), false);
  await rm(path.join(project, '.codocs', '이동.yaml'));
  const deleted = buildWorkspaceCatalog(await loadWorkspace({project}), moved);
  assert.equal(resolveReference(deleted, {name: '새 주문'}).status, 'missing');
  const unavailable = await loadWorkspace({project: path.join(project, '없는 루트')});
  assert.equal(unavailable.status, 'failed');
  assert.equal(buildWorkspaceCatalog(unavailable, workspaceCatalog).documents.size, 4);
} finally { await rm(project, {recursive: true, force: true}); }
for (const name of ['core', 'workspace']) {
  assert.ok(import.meta.resolve('@codosc/' + name).startsWith(new URL('./node_modules/', import.meta.url).href));
  for (const subpath of ['src/index.js', 'dist/index.js', 'dist/catalog/index.js']) await assert.rejects(import('@codosc/' + name + '/' + subpath), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
}
console.log('Name reference JS contract verified');`;

/** Node 전역 타입 없는 소비자가 외부 선언까지 확인하는 공통 strict 설정이다. */
export const nameReferenceConfig = {
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
  files: ['nameReferences.ts'],
};

/** strict NodeNext에서 d.ts의 공개 타입·상태 분기·진단 코드 합집합을 확인한다. */
export const nameReferenceTs = String.raw`import {parseYaml, extractReferences, buildCatalog, resolveReference, planRename, referenceDiagnosticCodes, catalogDiagnosticCodes} from '@codosc/core';
import type {Catalog, CatalogScan, CatalogObservation, CatalogFailure, CatalogDocument, ReferenceResolution, RenamePlan, RenameSelection, DiagnosticCode, CatalogDiagnosticCode, ReferenceDiagnosticCode, Diagnostic} from '@codosc/core';
import {loadWorkspace, toCatalogScan, buildWorkspaceCatalog} from '@codosc/workspace';
import type {WorkspaceDocumentResult, WorkspaceScanResult} from '@codosc/workspace';
const parsed = parseYaml('name: 주문\n');
const observation: CatalogObservation = {path: '.codocs/a.yaml', parsed};
const failure: CatalogFailure = {kind: 'folder', path: '.codocs'};
const scan: CatalogScan = {status: 'complete', observations: [observation], failures: [failure]};
const catalog: Catalog = buildCatalog(scan);
const document: CatalogDocument | undefined = catalog.documents.get(observation.path);
if (document?.confirmation === 'unconfirmed') { const name: string | undefined = document.name; console.log(name); }
// @ts-expect-error 공개 경로 컬렉션은 쓰기 API가 없다.
catalog.documents.set('x', document);
const occurrence = extractReferences(parsed).occurrences[0];
if (occurrence?.syntax === 'valid') { const name: string = occurrence.name; const domain: string | undefined = occurrence.domain; console.log(name, domain); }
if (occurrence?.syntax === 'invalid') {
  // @ts-expect-error 무효 문법에서 이름을 추측하지 않는다.
  console.log(occurrence.name);
}
const resolution: ReferenceResolution = resolveReference(catalog, {name: '주문', domain: '판매'});
switch (resolution.status) {
  case 'resolved': case 'self': if (resolution.target) { const path: string = resolution.target.path; const errors: readonly Diagnostic[] = resolution.target.errors; console.log(path, errors); } break;
  case 'invalid': case 'missing': case 'ambiguous': case 'unconfirmed': console.log(resolution.candidates); break;
  default: { const exhaustive: never = resolution.status; console.log(exhaustive); }
}
const selection: RenameSelection = {sourcePath: '.codocs/s.yaml', occurrenceIndex: 0, targetPath: observation.path, domain: '판매'};
const plan: RenamePlan = planRename(catalog, {targetPath: observation.path, newName: '새 주문', selections: [selection], updateReferences: false});
switch (plan.status) {
  case 'ready': console.log(plan.changes.map(x => [x.path, x.fieldPath, x.offsetRange, x.range, x.oldText, x.newText, x.targetPath, x.candidates])); break;
  case 'unresolved': console.log(plan.impacts.map(x => [x.reason, x.before, x.after])); break;
  case 'blocked': console.log(plan.blockingReason, plan.conflicts, plan.invalidSelections); break;
  default: { const exhaustive: never = plan.status; console.log(exhaustive); }
}
const referenceCode: ReferenceDiagnosticCode = 'invalid_reference';
const catalogCodes: CatalogDiagnosticCode[] = ['duplicate_id', 'duplicate_name', 'missing_reference', 'ambiguous_reference', 'self_reference', 'unconfirmed_reference', 'reference_target_error'];
const codes: DiagnosticCode[] = [referenceCode, ...catalogCodes, referenceDiagnosticCodes.invalidReference, catalogDiagnosticCodes.duplicateId];
const diagnostic: Diagnostic = {code: codes[0]!, severity: 'error', message: '진단'};
if (diagnostic.code === 'unconfirmed_reference') { const narrowed: 'unconfirmed_reference' = diagnostic.code; console.log(narrowed); }
// @ts-expect-error workspace IO 코드는 core 코드가 아니다.
const wrongCode: DiagnosticCode = 'workspace_read_failed';
console.log(wrongCode);
const workspaceScan: WorkspaceScanResult = await loadWorkspace({project: '.'});
const converted: CatalogScan = toCatalogScan(workspaceScan);
const workspaceCatalog: Catalog = buildWorkspaceCatalog(workspaceScan, catalog);
console.log(converted, workspaceCatalog);
function inspect(document: WorkspaceDocumentResult): void {
  switch (document.status) {
    case 'valid': console.log(document.data.id, document.parsed.strings); break;
    case 'validationError': {
      const input: Record<string, unknown> = document.parsed.data;
      console.log(input);
      // @ts-expect-error 검증 오류 문서에 검증 성공 data는 없다.
      console.log(document.data);
      break;
    }
    case 'parseError': {
      // @ts-expect-error 파싱 오류 문서에 parsed는 없다.
      console.log(document.parsed);
      const yamlCode: 'invalid_yaml' | 'unsupported_yaml_feature' = document.diagnostics[0]!.code;
      console.log(yamlCode);
      break;
    }
    default: { const exhaustive: never = document; console.log(exhaustive); }
  }
}
workspaceScan.documents.forEach(inspect);
// @ts-expect-error 공개 exports에서 내부 구현 접근은 거부한다.
import '@codosc/core/dist/catalog/index.js';
// @ts-expect-error 공개 exports에서 내부 구현 접근은 거부한다.
import '@codosc/workspace/src/indexing/index.js';`;
