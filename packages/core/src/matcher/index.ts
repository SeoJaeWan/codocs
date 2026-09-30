import pluralize from 'pluralize';
import type { Catalog, CatalogDocument } from '../catalog/index.js';
import { scanStatuses } from '../catalog/domain-values.js';
import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import {
  catalogDiagnosticCodes,
  type Diagnostic,
  type OffsetRange,
} from '../diagnostics/index.js';
import {
  matcherComparisonKinds,
  matcherEvidenceKinds,
  type MatcherComparisonKind,
  type MatcherEvidenceKind,
} from './domain-values.js';
export * from './domain-values.js';

/** 코드 매칭에 전달할 수 있는 단일 입력이다. code·text·identifier 중 하나를 사용한다. */
export interface CodeMatchRequest {
  catalog: Catalog;
  code?: string;
  text?: string;
  identifier?: string;
  source?: string;
}

/** 카탈로그와 분리해 전달할 수 있는 코드 원문 선택 입력이다. */
export type CodeMatchQuery = Omit<CodeMatchRequest, 'catalog'>;

/** 토큰화한 원문의 한 토큰이다. 위치는 원문 기준 UTF-16 offset이다. */
export interface CodeToken {
  token: string;
  range: OffsetRange;
}

/** 연속 토큰 묶음이다. 공백·구두점·비영어 문자는 묶음을 끊는다. */
export interface CodeTokenGroup {
  tokens: readonly CodeToken[];
  range: OffsetRange;
}

/** 문서 ID가 코드와 일치한 개별 근거다. */
export interface CodeMatchEvidence {
  kind: MatcherEvidenceKind;
  comparison: MatcherComparisonKind;
  token: string;
  range: OffsetRange;
  sourceId: string;
  message?: string;
  consecutiveTokens: number;
}

/** 코드에서 발견한 문서 후보다. 후보 하나에 모든 위치·ID 근거를 보존한다. */
export interface CodeMatchCandidate {
  id?: string;
  documentId?: string;
  path: string;
  name?: string;
  domains: readonly string[];
  confirmation: CatalogDocument['confirmation'];
  evidence: readonly CodeMatchEvidence[];
  diagnostics: readonly Diagnostic<string>[];
  errors: readonly Diagnostic<string>[];
}

/** 코드 매칭 결과다. partial은 색인 일부만 확인된 경우에도 후보를 함께 보존한다. */
export interface CodeMatchResult {
  candidates: readonly CodeMatchCandidate[];
  evidence: readonly CodeMatchEvidence[];
  diagnostics: readonly Diagnostic<string>[];
  partial: boolean;
  status: Catalog['status'];
  failures: readonly Catalog['failures'][number][];
}

interface InternalToken {
  token: string;
  start: number;
  end: number;
}

interface InternalGroup {
  tokens: readonly InternalToken[];
  start: number;
  end: number;
}

interface IndexedId {
  id: string;
  kind: MatcherEvidenceKind;
  message?: string;
}

interface InternalMatch {
  document: CatalogDocument;
  evidence: CodeMatchEvidence;
}

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** ASCII 영문자인지 확인한다. 코드 식별자에서 비영어 문자를 별도 토큰으로 만들지 않는다. */
function asciiLetter(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z]$/u.test(value);
}

/** ASCII 숫자인지 확인한다. */
function asciiDigit(value: string | undefined): boolean {
  return value !== undefined && /^[0-9]$/u.test(value);
}

/** ASCII 식별자 문자 run을 camel·Pascal·약어·숫자 경계로 나눈다. */
function splitRun(source: string, start: number, end: number): InternalToken[] {
  const tokens: InternalToken[] = [];
  let tokenStart = start;
  for (let index = start + 1; index < end; index++) {
    const previous = source[index - 1];
    const current = source[index];
    const next = source[index + 1];
    const previousLetter = asciiLetter(previous);
    const currentLetter = asciiLetter(current);
    const previousDigit = asciiDigit(previous);
    const currentDigit = asciiDigit(current);
    const boundary =
      previousLetter !== currentLetter ||
      previousDigit !== currentDigit ||
      (previousLetter &&
        currentLetter &&
        previous === previous?.toLowerCase() &&
        current === current?.toUpperCase()) ||
      (previousLetter &&
        currentLetter &&
        previous === previous?.toUpperCase() &&
        current === current?.toUpperCase() &&
        next !== undefined &&
        next === next.toLowerCase() &&
        asciiLetter(next));
    if (!boundary) continue;
    tokens.push({
      token: source.slice(tokenStart, index),
      start: tokenStart,
      end: index,
    });
    tokenStart = index;
  }
  if (tokenStart < end)
    tokens.push({
      token: source.slice(tokenStart, end),
      start: tokenStart,
      end,
    });
  return tokens;
}

/** 하나의 원문을 순회하며 연속 토큰과 UTF-16 범위를 만든다. @codocs [[코드 식별자 매칭]]#L21-L29 */
export function tokenizeCode(source: string): readonly CodeTokenGroup[] {
  const groups: InternalGroup[] = [];
  let index = 0;
  while (index < source.length) {
    if (!asciiLetter(source[index]) && !asciiDigit(source[index])) {
      index++;
      continue;
    }
    const firstStart = index;
    while (
      index < source.length &&
      (asciiLetter(source[index]) || asciiDigit(source[index]))
    )
      index++;
    const tokens = splitRun(source, firstStart, index);
    let end = index;
    let cursor = index;
    while (
      cursor < source.length &&
      (source[cursor] === '_' || source[cursor] === '-')
    ) {
      cursor++;
    }
    if (
      cursor > index &&
      cursor < source.length &&
      (asciiLetter(source[cursor]) || asciiDigit(source[cursor]))
    ) {
      index = cursor;
      while (
        index < source.length &&
        (asciiLetter(source[index]) || asciiDigit(source[index]))
      )
        index++;
      tokens.push(...splitRun(source, cursor, index));
      end = index;
      while (index < source.length) {
        cursor = index;
        while (
          cursor < source.length &&
          (source[cursor] === '_' || source[cursor] === '-')
        )
          cursor++;
        if (
          cursor === index ||
          cursor >= source.length ||
          (!asciiLetter(source[cursor]) && !asciiDigit(source[cursor]))
        )
          break;
        index = cursor;
        while (
          index < source.length &&
          (asciiLetter(source[index]) || asciiDigit(source[index]))
        )
          index++;
        tokens.push(...splitRun(source, cursor, index));
        end = index;
      }
    }
    groups.push({ tokens, start: firstStart, end });
  }
  return groups.map(
    /** 내부 토큰을 공개 범위 타입으로 복사한다. */ (group) => ({
      tokens: group.tokens.map((token) => ({
        token: token.token,
        range: { start: token.start, end: token.end },
      })),
      range: { start: group.start, end: group.end },
    }),
  );
}

/** 비교용 토큰을 대소문자 없이 만든다. */
function normalized(value: string): string {
  return value.toLocaleLowerCase('en-US');
}

/** 문서 객체의 own data property만 읽어 잘못된 문서에서 getter를 실행하지 않는다. */
function ownValue(value: unknown, key: string | number): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** 특정 필드의 형식 오류를 확인한다. 중복 ID는 모든 충돌 후보를 보존한다. */
function fieldHasBlockingError(
  document: CatalogDocument,
  path: readonly (string | number)[],
): boolean {
  return document.documentDiagnostics.some(
    /** 중복 ID 외의 오류가 해당 필드에 있는지 확인한다. */
    (diagnostic) =>
      diagnostic.severity === diagnosticSeverities.error &&
      diagnostic.code !== catalogDiagnosticCodes.duplicateId &&
      diagnostic.fieldPath?.length === path.length &&
      diagnostic.fieldPath.every((part, index) => part === path[index]),
  );
}

/** 문서에서 형식이 확인된 현재·이전 ID를 순서와 메시지와 함께 추출한다. @codocs [[이전 ID]]#L6-L13 @codocs [[코드 식별자 매칭]]#L55-L58 */
function indexedIds(document: CatalogDocument): readonly IndexedId[] {
  const parsed = document.observation.parsed;
  if (!parsed.success) return [];
  const values: IndexedId[] = [];
  const current = ownValue(parsed.data, 'id');
  if (
    typeof current === 'string' &&
    idPattern.test(current) &&
    !fieldHasBlockingError(document, ['id'])
  )
    values.push({ id: current, kind: matcherEvidenceKinds.current });
  const aliases = ownValue(parsed.data, 'deprecatedAliases');
  if (!Array.isArray(aliases)) return values;
  for (let index = 0; index < aliases.length; index++) {
    const alias = ownValue(aliases, index);
    const id = ownValue(alias, 'id');
    if (
      typeof id !== 'string' ||
      !idPattern.test(id) ||
      fieldHasBlockingError(document, ['deprecatedAliases', index, 'id'])
    )
      continue;
    const message = ownValue(alias, 'message');
    values.push({
      id,
      kind: matcherEvidenceKinds.previous,
      ...(typeof message === 'string' && message.trim().length > 0
        ? { message }
        : {}),
    });
  }
  return values;
}

/** 토큰 배열이 ID와 exact 또는 마지막 토큰 singular 비교인지 판별한다. */
function compareTokens(
  idTokens: readonly InternalToken[],
  sourceTokens: readonly InternalToken[],
  sourceStart: number,
): MatcherComparisonKind | undefined {
  if (idTokens.length > sourceTokens.length - sourceStart) return undefined;
  for (let index = 0; index < idTokens.length; index++) {
    if (
      normalized(idTokens[index]?.token ?? '') !==
      normalized(sourceTokens[sourceStart + index]?.token ?? '')
    ) {
      if (index !== idTokens.length - 1) return undefined;
      const wanted = normalized(idTokens[index]?.token ?? '');
      const found = normalized(sourceTokens[sourceStart + index]?.token ?? '');
      if (pluralize.singular(wanted) !== pluralize.singular(found))
        return undefined;
      return matcherComparisonKinds.singular;
    }
  }
  return matcherComparisonKinds.exact;
}

/** ID가 코드 묶음의 각 연속 위치와 일치한 근거를 모두 만든다. */
function findMatches(
  source: string,
  document: CatalogDocument,
  indexed: IndexedId,
): InternalMatch[] {
  const idGroups = tokenizeCode(indexed.id);
  const idTokens = idGroups
    .flatMap(
      /** ID의 모든 묶음을 비교 토큰 하나로 합친다. */ (group) => group.tokens,
    )
    .map(
      /** 공개 토큰 범위를 내부 토큰으로 변환한다. */ (token) => ({
        token: token.token,
        start: token.range.start,
        end: token.range.end,
      }),
    );
  if (!idTokens.length) return [];
  const matches: InternalMatch[] = [];
  for (const group of tokenizeCode(source)) {
    const sourceTokens = group.tokens.map(
      /** 공개 토큰 범위를 내부 토큰으로 변환한다. */ (token) => ({
        token: token.token,
        start: token.range.start,
        end: token.range.end,
      }),
    );
    for (
      let start = 0;
      start <= sourceTokens.length - idTokens.length;
      start++
    ) {
      const comparison = compareTokens(idTokens, sourceTokens, start);
      if (!comparison) continue;
      const first = sourceTokens[start];
      const last = sourceTokens[start + idTokens.length - 1];
      if (!first || !last) continue;
      const range = { start: first.start, end: last.end };
      matches.push({
        document,
        evidence: {
          kind: indexed.kind,
          comparison,
          token: source.slice(range.start, range.end),
          range,
          sourceId: indexed.id,
          ...(indexed.message !== undefined
            ? { message: indexed.message }
            : {}),
          consecutiveTokens: idTokens.length,
        },
      });
    }
  }
  return matches;
}

/** 의미 우선순위 뒤에 원문 위치와 근거 값으로 결정적인 순서를 부여한다. */
function compareEvidence(
  left: CodeMatchEvidence,
  right: CodeMatchEvidence,
): number {
  const priority = compareEvidencePriority(left, right);
  return (
    priority ||
    left.range.start - right.range.start ||
    left.range.end - right.range.end ||
    left.sourceId.localeCompare(right.sourceId) ||
    (left.message ?? '').localeCompare(right.message ?? '')
  );
}

/** 현재·이전, 연속 토큰 수, 표기 일치만 매칭의 의미 우선순위로 비교한다. 동률이면 0을 반환한다. @codocs [[코드 식별자 매칭]]#L42-L50 */
export function compareEvidencePriority(
  left: CodeMatchEvidence,
  right: CodeMatchEvidence,
): number {
  const kind =
    (left.kind === matcherEvidenceKinds.current ? 1 : 0) -
    (right.kind === matcherEvidenceKinds.current ? 1 : 0);
  if (kind) return -kind;
  if (left.consecutiveTokens !== right.consecutiveTokens)
    return right.consecutiveTokens - left.consecutiveTokens;
  const exact =
    (left.comparison === matcherComparisonKinds.exact ? 1 : 0) -
    (right.comparison === matcherComparisonKinds.exact ? 1 : 0);
  if (exact) return -exact;
  return 0;
}

/** 근거를 동일 문서·범위 기준으로 합치고 안정적인 순서를 부여한다. */
function mergeEvidence(
  matches: readonly InternalMatch[],
): readonly CodeMatchEvidence[] {
  const unique = new Map<string, CodeMatchEvidence>();
  for (const match of matches) {
    const evidence = match.evidence;
    const key = [
      evidence.kind,
      evidence.comparison,
      evidence.sourceId,
      evidence.message,
      evidence.range.start,
      evidence.range.end,
    ].join('|');
    if (!unique.has(key))
      unique.set(key, { ...evidence, range: { ...evidence.range } });
  }
  return [...unique.values()].sort(
    /** 범위와 우선순위로 동일 문서 근거 순서를 고정한다. */ (left, right) => {
      if (left.range.start !== right.range.start)
        return left.range.start - right.range.start;
      if (left.range.end !== right.range.end)
        return left.range.end - right.range.end;
      return compareEvidence(left, right);
    },
  );
}

/** 요청 형태를 받아 매칭 원문을 결정한다. */
function requestValues(
  first: Catalog | CodeMatchRequest | string,
  second?: Catalog | CodeMatchQuery | string,
): { catalog: Catalog; source: string } {
  if (
    typeof first === 'string' &&
    second &&
    typeof second !== 'string' &&
    'documents' in second
  )
    return { catalog: second, source: first };
  if (typeof first !== 'string' && 'catalog' in first) {
    const source = first.code ?? first.text ?? first.identifier ?? first.source;
    return { catalog: first.catalog, source: source ?? '' };
  }
  if (
    typeof first !== 'string' &&
    typeof second === 'object' &&
    second !== null
  ) {
    const query = second as CodeMatchQuery;
    const source = query.code ?? query.text ?? query.identifier ?? query.source;
    return { catalog: first, source: source ?? '' };
  }
  if (typeof first !== 'string' && typeof second === 'string')
    return { catalog: first, source: second };
  if (typeof first !== 'string') return { catalog: first, source: '' };
  throw new TypeError('코드 매칭 입력이 올바르지 않습니다.');
}

/** 카탈로그의 문서별 오류를 중복 없이 안정적인 순서로 반환한다. */
function diagnosticsFor(
  documents: readonly CatalogDocument[],
  failures: readonly Catalog['failures'][number][],
): readonly Diagnostic<string>[] {
  const diagnostics: Diagnostic<string>[] = [];
  for (const document of documents) diagnostics.push(...document.diagnostics);
  for (const failure of failures)
    diagnostics.push(...(failure.diagnostics ?? []));
  const unique = new Map<string, Diagnostic<string>>();
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.path,
      diagnostic.fieldPath,
      diagnostic.range,
    ]);
    if (!unique.has(key)) unique.set(key, diagnostic);
  }
  return [...unique.values()];
}

/** 현재·이전 ID 색인으로 코드 원문을 순수하게 매칭한다. 입력 카탈로그와 원문은 변경하지 않는다. @codocs [[코드 식별자 매칭]] */
export function matchCode(catalog: Catalog, code: string): CodeMatchResult;
/** 카탈로그와 코드 원문 선택 입력을 분리해 받는 오버로드다. */
export function matchCode(
  catalog: Catalog,
  query: CodeMatchQuery,
): CodeMatchResult;
/** 코드 원문을 먼저 받는 편의 오버로드다. */
export function matchCode(code: string, catalog: Catalog): CodeMatchResult;
/** code·text·identifier 중 하나를 사용하는 요청 오버로드다. */
export function matchCode(request: CodeMatchRequest): CodeMatchResult;
/** ID 색인과 일반 코드 토큰화를 결합해 결정적인 후보를 반환한다. */
export function matchCode(
  first: Catalog | CodeMatchRequest | string,
  second?: Catalog | CodeMatchQuery | string,
): CodeMatchResult {
  const { catalog, source } = requestValues(first, second);
  const allMatches: InternalMatch[] = [];
  for (const document of catalog.documents.values())
    for (const indexed of indexedIds(document))
      allMatches.push(...findMatches(source, document, indexed));
  const byPath = new Map<string, InternalMatch[]>();
  for (const match of allMatches) {
    const matches = byPath.get(match.document.path) ?? [];
    matches.push(match);
    byPath.set(match.document.path, matches);
  }
  const candidates: CodeMatchCandidate[] = [];
  for (const matches of byPath.values()) {
    const document = matches[0]?.document;
    if (!document) continue;
    const evidence = mergeEvidence(matches);
    const documentId = indexedIds(document).find(
      /** 유효한 현재 ID만 후보의 문서 ID로 제공한다. */ (indexed) =>
        indexed.kind === matcherEvidenceKinds.current,
    )?.id;
    candidates.push({
      ...(documentId !== undefined ? { id: documentId, documentId } : {}),
      path: document.path,
      ...(document.name !== undefined ? { name: document.name } : {}),
      domains: [...document.domains],
      confirmation: document.confirmation,
      evidence,
      diagnostics: [...document.diagnostics],
      errors: document.documentDiagnostics.filter(
        (diagnostic) => diagnostic.severity === diagnosticSeverities.error,
      ),
    });
  }
  candidates.sort(
    /** 후보의 최상위 근거와 문서 ID로 결과 순서를 고정한다. */ (
      left,
      right,
    ) => {
      const leftEvidence = [...left.evidence].sort(compareEvidence)[0];
      const rightEvidence = [...right.evidence].sort(compareEvidence)[0];
      if (leftEvidence && rightEvidence) {
        const compared = compareEvidencePriority(leftEvidence, rightEvidence);
        if (compared) return compared;
        if (leftEvidence.range.start !== rightEvidence.range.start)
          return leftEvidence.range.start - rightEvidence.range.start;
      }
      return (
        (left.id ?? '').localeCompare(right.id ?? '') ||
        left.path.localeCompare(right.path)
      );
    },
  );
  const matchedDocuments = candidates.flatMap((candidate) => {
    const document = catalog.documents.get(candidate.path);
    return document ? [document] : [];
  });
  const failures = [...catalog.failures];
  return {
    candidates,
    evidence: candidates.flatMap((candidate) => candidate.evidence),
    diagnostics: diagnosticsFor(matchedDocuments, failures),
    partial: catalog.status !== scanStatuses.complete || failures.length > 0,
    status: catalog.status,
    failures,
  };
}

/** 단일 식별자와 코드 원문을 같은 매칭 규칙으로 처리하는 이름 있는 별칭이다. */
export const matchIdentifier = matchCode;
/** 코드 텍스트 매칭의 명시적 별칭이다. */
export const matchCodeText = matchCode;
/** 여러 언어 어댑터가 공통으로 사용할 수 있는 코드 매칭 별칭이다. */
export const matchIdentifiers = matchCode;
