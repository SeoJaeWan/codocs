import type {
  Catalog,
  CatalogDocument,
  CatalogIdentity,
  CatalogOccurrence,
} from '../catalog/index.js';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
} from '../diagnostics/index.js';
import type {
  Diagnostic,
  DiagnosticCode,
  OffsetRange,
} from '../diagnostics/index.js';
import type { JsonValue } from '../validator/index.js';

const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const kinds = ['policy', 'procedure', 'decision', 'discussion'] as const;
const statuses = ['proposed', 'confirmed', 'deprecated'] as const;

/** 목록에서 한 문서가 만족해야 하는 AND 조건이다. */
export interface CatalogListFilters {
  domain?: string;
  kind?: (typeof kinds)[number];
  status?: (typeof statuses)[number];
}

/** 목록에 표시할 수 있는 유일 ID 문서다. */
export interface CatalogListDocumentItem {
  id: string;
  name: string;
  source: { path: string };
  confirmation: CatalogIdentity['confirmation'];
  domains?: readonly string[];
  kind?: (typeof kinds)[number];
  status?: (typeof statuses)[number];
  hasErrors: boolean;
  conflict: false;
}

/** 대표 문서를 선택하지 않는 중복 ID 목록 항목이다. */
export interface CatalogListConflictItem {
  id: string;
  paths: readonly string[];
  hasErrors: true;
  conflict: true;
}

/** 정상 문서와 중복 ID를 구분하는 목록 항목이다. */
export type CatalogListItem = CatalogListDocumentItem | CatalogListConflictItem;

/** 페이지 처리를 하기 전의 결정적인 전체 목록 투영이다. */
export interface CatalogListProjection {
  items: readonly CatalogListItem[];
  totalCount: number;
}

/** 외부 참조 ID를 만들지 못한 이유다. */
export type ReferenceIdFailureReason =
  'missing_id' | 'invalid_id' | 'duplicate_id';

/** Catalog 진단을 조회 결과에 필요한 관련 경로와 원인까지 확장한다. */
export interface CatalogQueryDiagnostic extends Diagnostic<DiagnosticCode> {
  relatedPaths?: readonly string[];
  domain?: string;
  offsetRange?: OffsetRange;
  reason?: ReferenceIdFailureReason;
}

/** 요청한 ID가 완전한 Catalog에 없는 결과다. */
export interface CatalogGetMissingResult {
  id: string;
  found: false;
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 중복 ID의 대표 내용 없이 모든 경로만 반환하는 결과다. */
export interface CatalogGetConflictResult {
  id: string;
  found: true;
  conflict: true;
  paths: readonly string[];
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 유일 ID의 내용·진단·직접 참조 ID가 공유하는 결과다. */
interface CatalogGetDocumentResultBase {
  id: string;
  found: true;
  conflict: false;
  source: { path: string };
  confirmation: CatalogIdentity['confirmation'];
  revision?: string;
  references: readonly string[];
  referencedBy: readonly string[];
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 유일 ID는 JSON 문서 또는 손실 없는 원문 중 정확히 하나를 반환한다. */
export type CatalogGetDocumentResult = CatalogGetDocumentResultBase &
  (
    | {
        document: Readonly<Record<string, JsonValue>>;
        rawYaml?: never;
      }
    | {
        document?: never;
        rawYaml: string;
      }
  );

/** 각 ID가 다른 ID의 결과에 영향을 주지 않는 상세 결과다. */
export type CatalogGetResult =
  CatalogGetMissingResult | CatalogGetConflictResult | CatalogGetDocumentResult;

/** 유효 요청과 전체 invalid_input을 구분하는 상세 투영이다. */
export type CatalogGetProjection =
  | { success: true; results: readonly CatalogGetResult[] }
  | { success: false; error: CatalogQueryDiagnostic };

/** workspace가 같은 시점의 원문 revision을 주입하는 선택 입력이다. */
export interface CatalogGetProjectionOptions {
  revisions?: ReadonlyMap<string, string>;
}

/** 객체의 own data property만 읽고 접근자나 상속 속성은 실행하지 않는다. */
function ownValue(value: unknown, key: string | number): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor
    ? (descriptor.value as unknown)
    : undefined;
}

/** 특정 최상위 속성에 오류가 없을 때만 목록 메타데이터로 사용한다. */
function validField(document: CatalogDocument, key: string): boolean {
  return !document.documentDiagnostics.some(
    /** 스키마 오류만 목록 메타데이터의 유효성을 막는다. */
    (diagnostic) =>
      diagnostic.severity === 'error' &&
      diagnostic.fieldPath?.[0] === key &&
      diagnostic.code !== catalogDiagnosticCodes.duplicateId &&
      diagnostic.code !== catalogDiagnosticCodes.duplicateName,
  );
}

/** 확인한 값이 공개 ID 규칙을 만족하고 전역에서 유일한지 판별한다. */
function idFailure(
  catalog: Catalog,
  document: CatalogDocument,
): ReferenceIdFailureReason | undefined {
  if (document.id === undefined) return 'missing_id';
  if (!validId.test(document.id) || !validField(document, 'id'))
    return 'invalid_id';
  if ((catalog.idPaths.get(document.id)?.size ?? 0) !== 1)
    return 'duplicate_id';
  return undefined;
}

/** 목록에서 사용할 수 있는 ID와 이름을 함께 확인한다. */
function listIdentity(document: CatalogDocument): boolean {
  return (
    document.id !== undefined &&
    validId.test(document.id) &&
    validField(document, 'id') &&
    document.name !== undefined &&
    validField(document, 'name')
  );
}

/** 전체 배열 속성이 유효할 때만 중복을 제거한 작성 순서로 반환한다. */
function documentDomains(
  document: CatalogDocument,
): readonly string[] | undefined {
  if (!validField(document, 'domains')) return undefined;
  const value = document.observation.parsed.success
    ? ownValue(document.observation.parsed.data, 'domains')
    : undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (domain) => typeof domain !== 'string' || domain.trim().length === 0,
    )
  )
    return undefined;
  return [...new Set(value as string[])];
}

/** 작성된 선택 열거 속성이 유효할 때만 반환한다. */
function documentEnum<const Values extends readonly string[]>(
  document: CatalogDocument,
  key: 'kind' | 'status',
  values: Values,
): Values[number] | undefined {
  if (!validField(document, key) || !document.observation.parsed.success)
    return undefined;
  const value = ownValue(document.observation.parsed.data, key);
  return typeof value === 'string' && values.includes(value)
    ? value
    : undefined;
}

/** 한 파일이 생략하지 않은 모든 목록 조건을 동시에 만족하는지 판별한다. */
function matchesFilters(
  document: CatalogDocument,
  filters: CatalogListFilters,
): boolean {
  const domains = documentDomains(document);
  const kind = documentEnum(document, 'kind', kinds);
  const status = documentEnum(document, 'status', statuses);
  return (
    (filters.domain === undefined ||
      domains?.includes(filters.domain) === true) &&
    (filters.kind === undefined || kind === filters.kind) &&
    (filters.status === undefined || status === filters.status)
  );
}

/** Catalog를 ID 오름차순의 전체 목록 snapshot으로 투영한다.
 * @param catalog IO 계층에서 이미 구축한 읽기 전용 Catalog다.
 * @param filters 한 파일이 모두 만족해야 하는 선택 조건이다.
 */
export function projectCatalogList(
  catalog: Catalog,
  filters: CatalogListFilters = {},
): CatalogListProjection {
  const items: CatalogListItem[] = [];
  for (const [id, indexedPaths] of catalog.idPaths) {
    const paths = [...indexedPaths].sort();
    const matching = paths.flatMap(
      /** 충돌 경로마다 필터 포함 가능성을 독립적으로 확인한다. */ (path) => {
        const document = catalog.documents.get(path);
        return document &&
          listIdentity(document) &&
          matchesFilters(document, filters)
          ? [document]
          : [];
      },
    );
    if (!matching.length) continue;
    if (paths.length > 1) {
      items.push({ id, paths, hasErrors: true, conflict: true });
      continue;
    }
    const document = matching[0];
    if (!document?.name) continue;
    const domains = documentDomains(document);
    const kind = documentEnum(document, 'kind', kinds);
    const status = documentEnum(document, 'status', statuses);
    items.push({
      id,
      name: document.name,
      source: { path: document.path },
      confirmation: document.confirmation,
      ...(domains ? { domains } : {}),
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      hasErrors: document.diagnostics.some(
        (diagnostic) => diagnostic.severity === 'error',
      ),
      conflict: false,
    });
  }
  items.sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return { items, totalCount: items.length };
}

/** 진단 입력을 새 읽기 전용 값으로 복사한다. */
function copyDiagnostic(diagnostic: Diagnostic): CatalogQueryDiagnostic {
  const relatedPaths = ownValue(diagnostic, 'relatedPaths');
  const domain = ownValue(diagnostic, 'domain');
  const offsetRange = ownValue(diagnostic, 'offsetRange');
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
    ...(diagnostic.fieldPath !== undefined
      ? { fieldPath: [...diagnostic.fieldPath] }
      : {}),
    ...(diagnostic.range !== undefined
      ? {
          range: {
            start: { ...diagnostic.range.start },
            end: { ...diagnostic.range.end },
          },
        }
      : {}),
    ...(Array.isArray(relatedPaths) &&
    relatedPaths.every((path) => typeof path === 'string')
      ? { relatedPaths: [...relatedPaths].sort() }
      : {}),
    ...(typeof domain === 'string' ? { domain } : {}),
    ...(isOffsetRange(offsetRange)
      ? { offsetRange: { start: offsetRange.start, end: offsetRange.end } }
      : {}),
  };
}

/** 확인한 own 숫자 속성만 offset 범위로 좁힌다. */
function isOffsetRange(value: unknown): value is OffsetRange {
  return (
    typeof ownValue(value, 'start') === 'number' &&
    typeof ownValue(value, 'end') === 'number'
  );
}

/** 참조 등장 위치를 외부 진단 메타데이터로 복사한다. */
function occurrenceMetadata(
  path: string,
  item: CatalogOccurrence,
): Pick<
  CatalogQueryDiagnostic,
  'path' | 'fieldPath' | 'range' | 'offsetRange'
> {
  return {
    path,
    fieldPath: [...item.occurrence.fieldPath],
    offsetRange: { ...item.occurrence.offsetRange },
    range: {
      start: { ...item.occurrence.range.start },
      end: { ...item.occurrence.range.end },
    },
  };
}

/** 확정 경로를 외부 ID로 바꾸지 못한 이유 진단을 만든다. */
function referenceIdDiagnostic(
  path: string,
  relatedPath: string,
  reason: ReferenceIdFailureReason,
  metadata?: Pick<
    CatalogQueryDiagnostic,
    'fieldPath' | 'range' | 'offsetRange'
  >,
): CatalogQueryDiagnostic {
  const message =
    reason === 'missing_id'
      ? queryDiagnosticMessages.referenceTargetMissingId
      : reason === 'invalid_id'
        ? queryDiagnosticMessages.referenceTargetInvalidId
        : queryDiagnosticMessages.referenceTargetDuplicateId;
  return {
    code: catalogDiagnosticCodes.referenceTargetError,
    severity: 'warning',
    message,
    path,
    relatedPaths: [relatedPath],
    reason,
    ...(metadata?.fieldPath ? { fieldPath: [...metadata.fieldPath] } : {}),
    ...(metadata?.range
      ? {
          range: {
            start: { ...metadata.range.start },
            end: { ...metadata.range.end },
          },
        }
      : {}),
    ...(metadata?.offsetRange
      ? { offsetRange: { ...metadata.offsetRange } }
      : {}),
  };
}

/** Catalog 의미 진단을 외부 코드와 후보 경로를 보존해 투영한다. */
function queryDiagnostics(
  catalog: Catalog,
  document: CatalogDocument,
): CatalogQueryDiagnostic[] {
  const replaced = new Set<string>([
    catalogDiagnosticCodes.missingReference,
    catalogDiagnosticCodes.ambiguousReference,
    catalogDiagnosticCodes.selfReference,
    catalogDiagnosticCodes.unconfirmedReference,
    catalogDiagnosticCodes.referenceTargetError,
  ]);
  const diagnostics = document.diagnostics
    .filter((diagnostic) => !replaced.has(diagnostic.code))
    .map(copyDiagnostic);
  for (const item of document.occurrences) {
    const metadata = occurrenceMetadata(document.path, item);
    const resolution = item.resolution;
    if (resolution.status === 'missing')
      diagnostics.push({
        code: queryDiagnosticCodes.referenceNotFound,
        severity: 'error',
        message: queryDiagnosticMessages.referenceNotFound,
        ...metadata,
      });
    else if (resolution.status === 'ambiguous')
      diagnostics.push({
        code: queryDiagnosticCodes.referenceAmbiguous,
        severity: 'error',
        message: queryDiagnosticMessages.referenceAmbiguous,
        relatedPaths: resolution.candidates
          .map((candidate) => candidate.path)
          .sort(),
        ...metadata,
      });
    else if (resolution.status === 'self')
      diagnostics.push({
        code: 'invalid_reference',
        severity: 'error',
        message: catalogDiagnosticMessages.selfReference,
        ...metadata,
      });
    else if (resolution.status === 'unconfirmed')
      diagnostics.push({
        code: catalogDiagnosticCodes.unconfirmedReference,
        severity: 'warning',
        message: catalogDiagnosticMessages.unconfirmedReference,
        relatedPaths: resolution.candidates
          .map((candidate) => candidate.path)
          .sort(),
        ...metadata,
      });
    else if (resolution.status === 'resolved' && resolution.target) {
      const target = catalog.documents.get(resolution.target.path);
      if (!target) continue;
      const reason = idFailure(catalog, target);
      if (reason)
        diagnostics.push(
          referenceIdDiagnostic(document.path, target.path, reason, metadata),
        );
      else if (resolution.target.errors.length)
        diagnostics.push({
          code: catalogDiagnosticCodes.referenceTargetError,
          severity: 'warning',
          message: catalogDiagnosticMessages.referenceTargetError,
          relatedPaths: [target.path],
          ...metadata,
        });
    }
  }
  for (const identity of document.referencedBy) {
    const source = catalog.documents.get(identity.path);
    if (!source) continue;
    const reason = idFailure(catalog, source);
    if (reason)
      diagnostics.push(
        referenceIdDiagnostic(document.path, source.path, reason),
      );
  }
  return diagnostics.sort(compareDiagnostics);
}

/** 경로·위치·코드·부가 정보 순으로 같은 Catalog에서 항상 같은 순서를 만든다. */
function compareDiagnostics(
  left: CatalogQueryDiagnostic,
  right: CatalogQueryDiagnostic,
): number {
  /** 선택 속성을 빈 값으로 정규화해 완전한 정렬 키를 만든다. */
  const key = (diagnostic: CatalogQueryDiagnostic): string =>
    JSON.stringify([
      diagnostic.path ?? '',
      diagnostic.range?.start.line ?? -1,
      diagnostic.range?.start.character ?? -1,
      diagnostic.range?.end.line ?? -1,
      diagnostic.range?.end.character ?? -1,
      diagnostic.code,
      diagnostic.severity,
      diagnostic.fieldPath ?? [],
      diagnostic.relatedPaths ?? [],
      diagnostic.reason ?? '',
      diagnostic.message,
    ]);
  return key(left).localeCompare(key(right), 'en');
}

/** JSON 값이면 동일 데이터를 새 컬렉션으로 복사하고 아니면 실패한다. */
function cloneJson(
  value: unknown,
  ancestors = new Set<object>(),
): { success: true; value: JsonValue } | { success: false } {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return { success: true, value };
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? { success: true, value }
      : { success: false };
  if (typeof value !== 'object' || ancestors.has(value))
    return { success: false };
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    return { success: false };
  ancestors.add(value);
  if (array) {
    const result: JsonValue[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        ancestors.delete(value);
        return { success: false };
      }
      const child = cloneJson(descriptor.value, ancestors);
      if (!child.success) {
        ancestors.delete(value);
        return child;
      }
      result.push(child.value);
    }
    if (
      Reflect.ownKeys(value).some(
        /** 배열 인덱스와 length 이외의 속성은 JSON 배열에 포함할 수 없다. */
        (key) => {
          if (key === 'length') return false;
          const index = typeof key === 'string' ? Number(key) : NaN;
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          return (
            typeof key !== 'string' ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= value.length ||
            String(index) !== key ||
            !descriptor?.enumerable ||
            !('value' in descriptor)
          );
        },
      )
    ) {
      ancestors.delete(value);
      return { success: false };
    }
    ancestors.delete(value);
    return { success: true, value: result };
  }
  const result: Record<string, JsonValue> = Object.create(null) as Record<
    string,
    JsonValue
  >;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    ) {
      ancestors.delete(value);
      return { success: false };
    }
    const child = cloneJson(descriptor.value, ancestors);
    if (!child.success) {
      ancestors.delete(value);
      return child;
    }
    result[key] = child.value;
  }
  ancestors.delete(value);
  return { success: true, value: result };
}

/** 연결 경로에서 유효하고 전역 유일한 ID만 중복 제거해 정렬한다. */
function externalIds(
  catalog: Catalog,
  identities: readonly CatalogIdentity[],
): string[] {
  const ids = new Set<string>();
  for (const identity of identities) {
    const document = catalog.documents.get(identity.path);
    if (
      document?.id !== undefined &&
      idFailure(catalog, document) === undefined
    )
      ids.add(document.id);
  }
  return [...ids].sort((left, right) => left.localeCompare(right, 'en'));
}

/** 오류 문서도 원문을 손실하지 않고 한 유일 ID 결과로 투영한다. */
function documentResult(
  catalog: Catalog,
  id: string,
  document: CatalogDocument,
  revisions?: ReadonlyMap<string, string>,
): CatalogGetDocumentResult {
  const parsed = document.observation.parsed;
  const cloned = parsed.success
    ? cloneJson(parsed.data)
    : { success: false as const };
  const revision = revisions?.get(document.path);
  return {
    id,
    found: true,
    conflict: false,
    source: { path: document.path },
    confirmation: document.confirmation,
    ...(cloned.success
      ? { document: cloned.value as Readonly<Record<string, JsonValue>> }
      : { rawYaml: parsed.source ?? '' }),
    ...(typeof revision === 'string' ? { revision } : {}),
    references: externalIds(catalog, document.references),
    referencedBy: externalIds(catalog, document.referencedBy),
    diagnostics: queryDiagnostics(catalog, document),
  };
}

/** 첫 등장 순서로 중복 제거한 1~20개 ID를 독립 결과로 투영한다.
 * @param catalog IO 계층에서 이미 구축한 읽기 전용 Catalog다.
 * @param ids 조회할 ID 목록이다.
 * @param options 같은 원문 시점의 선택적인 경로별 revision이다.
 */
export function projectCatalogGet(
  catalog: Catalog,
  ids: readonly string[],
  options: CatalogGetProjectionOptions = {},
): CatalogGetProjection {
  const uniqueIds = [...new Set(ids)];
  if (
    uniqueIds.length === 0 ||
    uniqueIds.length > 20 ||
    uniqueIds.some((id) => typeof id !== 'string' || id.length === 0)
  )
    return {
      success: false,
      error: {
        code: queryDiagnosticCodes.invalidInput,
        severity: 'error',
        message: queryDiagnosticMessages.invalidInput,
      },
    };
  const results = uniqueIds.map(
    /** 한 ID의 없음·충돌·문서 오류를 다른 ID와 독립적으로 계산한다. */
    (id): CatalogGetResult => {
      const paths = [...(catalog.idPaths.get(id) ?? [])].sort();
      if (!paths.length)
        return {
          id,
          found: false,
          diagnostics: [
            {
              code: queryDiagnosticCodes.notFound,
              severity: 'error',
              message: queryDiagnosticMessages.notFound,
            },
          ],
        };
      if (paths.length > 1)
        return {
          id,
          found: true,
          conflict: true,
          paths,
          diagnostics: [
            {
              code: catalogDiagnosticCodes.duplicateId,
              severity: 'error',
              message: catalogDiagnosticMessages.duplicateId,
              relatedPaths: paths,
            },
          ],
        };
      const path = paths[0];
      const document = path ? catalog.documents.get(path) : undefined;
      return document
        ? documentResult(catalog, id, document, options.revisions)
        : {
            id,
            found: false,
            diagnostics: [
              {
                code: queryDiagnosticCodes.notFound,
                severity: 'error',
                message: queryDiagnosticMessages.notFound,
              },
            ],
          };
    },
  );
  return { success: true, results };
}
