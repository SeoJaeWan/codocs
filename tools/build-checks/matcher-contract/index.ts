/** 소스 없는 JS 소비자에서 공개 코드 매칭 API와 배포 의존성을 검사하는 프로그램이다. */
export const matcherContractJs = String.raw`import assert from 'node:assert/strict';
import {buildCatalog, matchCode, matchIdentifier, matcherComparisonKinds, matcherEvidenceKinds, parseYaml, scanStatuses} from '@codocs/core';

const observe = (path, source) => ({path, parsed: parseYaml(source, path)});
const catalog = buildCatalog({status: scanStatuses.complete, observations: [
  observe('current.yaml', 'id: order-item\nname: 주문 항목\ndefinition: 설명\ndomains: [판매]\ndeprecatedAliases:\n  - id: legacy-order\n    message: 이전 주문 ID입니다.\n'),
  observe('broken.yaml', 'id: broken\nname: 진단 문서\ndefinition: 설명\ndomains: [판매]\ndeprecatedAliases:\n  - message: ID 누락\n'),
]});

const source = '😀 legacyOrders and orderItem';
const result = matchCode(catalog, source);
assert.equal(result.partial, false);
assert.equal(result.status, 'complete');
assert.deepEqual(result.failures, []);
assert.ok(result.diagnostics.every(issue => issue.path));
const current = result.candidates.find(candidate => candidate.path === 'current.yaml');
assert.ok(current);
assert.equal(current.id, 'order-item');
assert.equal(current.name, '주문 항목');
assert.deepEqual(current.domains, ['판매']);
assert.equal(current.confirmation, 'confirmed');
assert.equal(current.evidence.length, 2);
assert.deepEqual(current.evidence.map(item => item.kind), ['previous', 'current']);
const previous = current.evidence.find(item => item.kind === matcherEvidenceKinds.previous);
assert.ok(previous);
assert.equal(previous.sourceId, 'legacy-order');
assert.equal(previous.message, '이전 주문 ID입니다.');
assert.equal(previous.comparison, matcherComparisonKinds.singular);
assert.equal(source.slice(previous.range.start, previous.range.end), 'legacyOrders');
assert.equal(previous.range.start, 3);
assert.equal(source.slice(current.evidence.find(item => item.kind === 'current').range.start, current.evidence.find(item => item.kind === 'current').range.end), 'orderItem');
assert.equal(current.evidence.find(item => item.kind === 'current').comparison, 'exact');
assert.equal(current.evidence.find(item => item.kind === 'current').consecutiveTokens, 2);
assert.equal(result.evidence.length, 2);

const byIdentifier = matchIdentifier('orderItem', catalog);
assert.equal(byIdentifier.candidates[0].id, 'order-item');
const nameOnly = matchCode(catalog, '주문 항목');
assert.deepEqual(nameOnly.candidates, []);
const query = matchCode(catalog, {identifier: 'orderItem'});
assert.equal(query.candidates.length, 1);
const diagnosed = matchCode(catalog, 'broken');
assert.equal(diagnosed.candidates.length, 1);
assert.ok(diagnosed.candidates[0].diagnostics.length > 0);
assert.ok(diagnosed.candidates[0].errors.length > 0);
assert.ok(diagnosed.diagnostics.some(issue => issue.code === 'missing_required_field'));

const previousCatalog = buildCatalog({status: scanStatuses.complete, observations: [observe('old.yaml', 'id: retained\nname: 보존\ndefinition: 설명\ndomains: [판매]\n')]});
const partial = buildCatalog({status: scanStatuses.partial, observations: [], failures: [{kind: 'folder', path: '.codocs'}]}, previousCatalog);
const partialResult = matchCode(partial, 'retained');
assert.equal(partialResult.partial, true);
assert.equal(partialResult.status, 'partial');
assert.equal(partialResult.candidates[0].confirmation, 'unconfirmed');
assert.equal(partialResult.candidates[0].evidence[0].sourceId, 'retained');
assert.equal(partialResult.failures.length, 1);
assert.equal(partialResult.failures[0].path, '.codocs');
console.log('Matcher JS contract verified');`;

/** Node 전역 타입 없는 strict d.ts 소비자 설정이다. */
export const matcherContractConfig = {
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
  files: ['matcher-contract.ts'],
};

/** strict NodeNext에서 매처 요청·후보·근거·부분 결과의 공개 선언을 확인한다. */
export const matcherContractTs = String.raw`import {buildCatalog, matchCode, matchIdentifier, matcherComparisonKinds, matcherEvidenceKinds, parseYaml, scanStatuses} from '@codocs/core';
import type {Catalog, CodeMatchCandidate, CodeMatchEvidence, CodeMatchRequest, CodeMatchResult, MatcherComparisonKind, MatcherEvidenceKind} from '@codocs/core';

const catalog: Catalog = buildCatalog({status: scanStatuses.complete, observations: [{path: 'term.yaml', parsed: parseYaml('id: term\nname: 이름\ndefinition: 본문\ndomains: [영역]\n')}]});
const request: CodeMatchRequest = {catalog, identifier: 'term'};
const result: CodeMatchResult = matchCode(request);
const second: CodeMatchResult = matchIdentifier(catalog, {text: 'term'});
const candidate: CodeMatchCandidate | undefined = result.candidates[0];
if (candidate) {
  const id: string = candidate.id;
  const path: string = candidate.path;
  const domains: readonly string[] = candidate.domains;
  const confirmation: 'confirmed' | 'unconfirmed' = candidate.confirmation;
  const diagnostics = candidate.diagnostics;
  const errors = candidate.errors;
  void id; void path; void domains; void confirmation; void diagnostics; void errors;
  for (const evidence of candidate.evidence) {
    const kind: MatcherEvidenceKind = evidence.kind;
    const comparison: MatcherComparisonKind = evidence.comparison;
    const range: {start: number; end: number} = evidence.range;
    const count: number = evidence.consecutiveTokens;
    if (evidence.kind === matcherEvidenceKinds.previous) {
      const sourceId: string = evidence.sourceId;
      const message: string | undefined = evidence.message;
      void sourceId; void message;
    }
    if (evidence.comparison === matcherComparisonKinds.singular) console.log(count, range);
    void kind; void comparison;
  }
}
const allEvidence: readonly CodeMatchEvidence[] = result.evidence;
const partial: boolean = result.partial;
const status: 'complete' | 'partial' | 'failed' = result.status;
const failures = result.failures;
void second; void allEvidence; void partial; void status; void failures;
const sourceFirst: CodeMatchResult = matchCode('term', catalog);
const queryObject: CodeMatchResult = matchCode(catalog, {code: 'term'});
void sourceFirst; void queryObject;
// @ts-expect-error matcher evidence kinds are a closed public union
const invalidKind: MatcherEvidenceKind = 'alias';
// @ts-expect-error names are document links and are not a matcher query field
const invalidRequest: CodeMatchRequest = {catalog, name: '이름'};
void invalidKind; void invalidRequest;`;
