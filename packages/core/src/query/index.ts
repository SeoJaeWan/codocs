import {
  catalogConfirmations,
  referenceResolutionStatuses,
  scanStatuses,
} from '../catalog/domain-values.js';
import type {
  Catalog,
  CatalogDocument,
  CatalogIdentity,
  CatalogOccurrence,
} from '../catalog/index.js';
import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import type {
  Diagnostic,
  DiagnosticCode,
  OffsetRange,
  SourceRange,
} from '../diagnostics/index.js';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
  referenceDiagnosticCodes,
} from '../diagnostics/index.js';
import type { JsonValue } from '../validator/index.js';
import { documentFields, type DocumentField } from '../validator/index.js';
import { offsetToPosition, parseYaml } from '../parser/index.js';
import { parseReferenceComponents } from '../references/index.js';
import {
  compareText,
  getSectionNames,
  resolveLiveDocument,
} from '../catalog/index.js';
import {
  referenceIdFailureReasons,
  type ReferenceIdFailureReason,
} from './domain-values.js';
export * from './domain-values.js';

const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** 목록 항목이 문서와 충돌 항목에서 공유하는 값이다. */
interface CatalogListItemBase {
  name: string;
  id: string;
  hasErrors: boolean;
  /** 문서에 적은 순서의 섹션 이름이며 섹션 내용은 담지 않는다. */
  sections: readonly string[];
  /** 이 문서의 이름을 parent로 적은 문서의 수다. */
  childCount: number;
  source: { path: string };
  confirmation: CatalogIdentity['confirmation'];
}

/** 이름과 ID가 모두 유일한 문서의 목록 항목이다. */
export interface CatalogListDocumentItem extends CatalogListItemBase {
  conflict: false;
}

/** 같은 이름이나 같은 ID의 문서가 여럿일 때 문서마다 두는 항목이며 충돌한 모든 파일 경로를 담는다. */
export interface CatalogListConflictItem extends CatalogListItemBase {
  conflict: true;
  paths: readonly string[];
}

/** 정상 문서와 충돌 문서를 구분하는 목록 항목이다. */
export type CatalogListItem = CatalogListDocumentItem | CatalogListConflictItem;

/** 목록 조회 입력이다. parent를 생략하면 최상위 문서를 조회한다. */
export interface CatalogListInput {
  parent?: string;
}

/** parent 기준으로 정렬한 전체 목록 투영이며 페이지로 나누지 않는다. */
export interface CatalogListProjection {
  items: readonly CatalogListItem[];
  /** parent를 생략한 조회에서만 최상위 문서에서 닿을 수 없는 문서를 담는다. */
  unreachable?: readonly CatalogListItem[];
  /** parent를 준 조회에서 그 이름의 문서가 Catalog에 있는지 나타낸다. parent를 생략하면 true다. */
  parentFound: boolean;
}

/** 외부 참조 ID를 만들지 못한 이유다. */

/** Catalog 진단을 조회 결과에 필요한 관련 경로와 원인까지 확장한다. */
export interface CatalogQueryDiagnostic extends Diagnostic<DiagnosticCode> {
  relatedPaths?: readonly string[];
  offsetRange?: OffsetRange;
  reason?: ReferenceIdFailureReason;
}

/** 요청한 주소의 문서나 섹션이 없거나 주소 형식이 틀린 결과다. */
export interface CatalogGetMissingResult {
  address: string;
  found: false;
  /** 문서는 있으나 섹션이 없을 때만 담으며 그 문서의 확인 상태다. */
  confirmation?: CatalogIdentity['confirmation'];
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 중복 이름이나 중복 ID의 대표 내용 없이 모든 경로만 반환하는 결과다. */
export interface CatalogGetConflictResult {
  address: string;
  found: true;
  conflict: true;
  paths: readonly string[];
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 문서 결과와 섹션 결과가 공유하는 값이다. references는 대상 문서 이름이다. */
interface CatalogGetFoundResultBase {
  address: string;
  id?: string;
  found: true;
  conflict: false;
  source: { path: string };
  confirmation: CatalogIdentity['confirmation'];
  revision?: string;
  references: readonly string[];
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 문서 결과는 JSON 문서 또는 손실 없는 원문 중 정확히 하나를 반환한다. */
export type CatalogGetDocumentResult = CatalogGetFoundResultBase & {
  referencedBy: readonly string[];
  section?: never;
} & (
    | {
        document: Readonly<Record<string, JsonValue>>;
        rawYaml?: never;
      }
    | {
        document?: never;
        rawYaml: string;
      }
  );

/** 섹션 결과는 문서 이름과 그 섹션 하나의 내용만 반환하며 referencedBy를 담지 않는다. */
export type CatalogGetSectionResult = CatalogGetFoundResultBase & {
  name: string;
  referencedBy?: never;
  document?: never;
  rawYaml?: never;
  section: { name: string } & (
    | { content: JsonValue; rawYaml?: never }
    | { content?: never; rawYaml: string }
  );
};

/** 각 주소가 다른 주소의 결과에 영향을 주지 않는 상세 결과다. */
export type CatalogGetResult =
  | CatalogGetMissingResult
  | CatalogGetConflictResult
  | CatalogGetDocumentResult
  | CatalogGetSectionResult;

/** 유효 요청과 전체 invalid_input을 구분하는 상세 투영이다. */
export type CatalogGetProjection =
  | { success: true; results: readonly CatalogGetResult[] }
  | { success: false; error: CatalogQueryDiagnostic };

/** workspace가 같은 시점의 원문 revision을 주입하는 선택 입력이다. */
export interface CatalogGetProjectionOptions {
  revisions?: ReadonlyMap<string, string>;
}

/** 같은 Catalog가 확정한 문서 간 경로 연결이다. */
export interface CatalogPathLink {
  path: string;
  realPath?: string;
  id?: string;
}

/** 요청한 발견 경로가 현재 관측에 없는 결과다. */
export interface CatalogPathMissingResult {
  path: string;
  found: false;
  confirmation: CatalogIdentity['confirmation'];
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 발견 경로 문서의 내용과 같은 관측에서 계산한 관계를 공유하는 결과다. */
interface CatalogPathDocumentResultBase {
  path: string;
  found: true;
  source: {
    path: string;
    realPath?: string;
    offsetRange?: OffsetRange;
    range?: SourceRange;
  };
  confirmation: CatalogIdentity['confirmation'];
  id?: string;
  conflictPaths?: readonly string[];
  revision?: string;
  references?: readonly CatalogPathLink[];
  referencedBy?: readonly CatalogPathLink[];
  diagnostics: readonly CatalogQueryDiagnostic[];
}

/** 경로로 찾은 문서는 JSON 값 또는 손실 없는 원문 중 정확히 하나를 반환한다. */
export type CatalogPathDocumentResult = CatalogPathDocumentResultBase &
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

/** 발견 경로 하나의 현재 관측 결과다. */
export type CatalogPathResult =
  CatalogPathMissingResult | CatalogPathDocumentResult;

/** 유효한 경로 요청과 전체 입력 오류를 구분하는 투영이다. */
export type CatalogPathProjection =
  | { success: true; results: readonly CatalogPathResult[] }
  | { success: false; error: CatalogQueryDiagnostic };

/** workspace가 같은 관측의 원문 revision을 주입하는 경로 조회 선택 입력이다. */
export interface CatalogPathProjectionOptions {
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

/** 두 경로 중 짧은 쪽이 다른 경로의 앞부분이면 같은 필드에 대한 오류로 본다. */
function overlapsField(
  fieldPath: readonly (string | number)[],
  key: DocumentField,
): boolean {
  const length = Math.min(fieldPath.length, key.length);
  return (
    length > 0 &&
    key.slice(0, length).every((part, index) => part === fieldPath[index])
  );
}

/** 특정 메타데이터 필드에 스키마 오류가 없을 때만 목록 메타데이터로 사용한다. */
function validField(document: CatalogDocument, key: DocumentField): boolean {
  return !document.documentDiagnostics.some(
    /** 스키마 오류만 목록 메타데이터의 유효성을 막는다. */
    (diagnostic) =>
      diagnostic.severity === diagnosticSeverities.error &&
      diagnostic.fieldPath !== undefined &&
      overlapsField(diagnostic.fieldPath, key) &&
      diagnostic.code !== catalogDiagnosticCodes.duplicateId &&
      diagnostic.code !== catalogDiagnosticCodes.duplicateName &&
      diagnostic.code !== catalogDiagnosticCodes.parentNotFound &&
      diagnostic.code !== catalogDiagnosticCodes.parentCycle,
  );
}

/** 확인한 값이 공개 ID 규칙을 만족하고 전역에서 유일한지 판별한다. */
function idFailure(
  catalog: Catalog,
  document: CatalogDocument,
): ReferenceIdFailureReason | undefined {
  if (document.id === undefined) return referenceIdFailureReasons.missingId;
  if (!validId.test(document.id) || !validField(document, documentFields.id))
    return referenceIdFailureReasons.invalidId;
  if ((catalog.idPaths.get(document.id)?.size ?? 0) !== 1)
    return referenceIdFailureReasons.duplicateId;
  return undefined;
}

/** 목록에서 사용할 수 있는 ID와 이름을 함께 확인한다. */
function listIdentity(document: CatalogDocument): boolean {
  return (
    document.id !== undefined &&
    validId.test(document.id) &&
    validField(document, documentFields.id) &&
    document.name !== undefined &&
    validField(document, documentFields.name)
  );
}

/** 이름 순서, 같은 이름은 경로 순서로 비교한다. */
function compareListed(left: CatalogDocument, right: CatalogDocument): number {
  return (
    compareText(left.name ?? '', right.name ?? '') ||
    compareText(left.path, right.path)
  );
}

/** 문서 하나를 목록 항목으로 만든다. 이름이나 ID가 겹치면 충돌한 모든 경로를 담는다. */
function listItem(
  catalog: Catalog,
  document: CatalogDocument,
  childCount: number,
): CatalogListItem {
  const sameName = catalog.namePaths.get(document.name ?? '') ?? new Set();
  const sameId = catalog.idPaths.get(document.id ?? '') ?? new Set();
  const conflictPaths = [
    ...new Set([
      ...(sameName.size > 1 ? sameName : []),
      ...(sameId.size > 1 ? sameId : []),
    ]),
  ].sort(compareText);
  const base = {
    name: document.name ?? '',
    id: document.id ?? '',
    hasErrors: document.diagnostics.some(
      (diagnostic) => diagnostic.severity === diagnosticSeverities.error,
    ),
    sections: getSectionNames(document.observation.parsed),
    childCount,
    source: { path: document.path },
    confirmation: document.confirmation,
  };
  return conflictPaths.length
    ? { ...base, conflict: true, paths: conflictPaths }
    : { ...base, conflict: false };
}

/** 최상위 문서에서 닿지 못한 문서가 parent 오류(형식 오류, 순환, 모든 parent 부재) 때문인지 판별한다. */
function parentBroken(catalog: Catalog, document: CatalogDocument): boolean {
  return (
    document.parentInvalid === true ||
    document.documentDiagnostics.some(
      (diagnostic) => diagnostic.code === catalogDiagnosticCodes.parentCycle,
    ) ||
    (document.parent ?? []).every((name) => !catalog.namePaths.has(name))
  );
}

/** Catalog를 parent 기준의 목록으로 투영한다. 호출당 문서와 parent 항목 수에 비례해 계산한다.
 * @param catalog IO 계층에서 이미 구축한 읽기 전용 Catalog다.
 * @param input parent를 주면 그 이름을 parent로 적은 직속 자식, 생략하면 최상위 문서와 unreachable이다.
 */
export function projectCatalogList(
  catalog: Catalog,
  input: CatalogListInput = {},
): CatalogListProjection {
  const listed = [...catalog.documents.values()].filter(listIdentity);
  const children = new Map<string, CatalogDocument[]>();
  for (const document of listed)
    for (const name of new Set(document.parent ?? [])) {
      const list = children.get(name) ?? [];
      list.push(document);
      children.set(name, list);
    }
  /** 자식 수와 함께 문서 목록을 정렬된 항목으로 바꾼다. */
  const toItems = (documents: readonly CatalogDocument[]): CatalogListItem[] =>
    [...documents]
      .sort(compareListed)
      .map(
        /** 문서 하나를 자식 수와 함께 목록 항목으로 만든다. */ (document) =>
          listItem(
            catalog,
            document,
            (document.name ? children.get(document.name) : undefined)?.length ??
              0,
          ),
      );
  if (input.parent !== undefined)
    return {
      items: toItems(children.get(input.parent) ?? []),
      parentFound: catalog.namePaths.has(input.parent),
    };
  const roots = listed.filter(
    (document) => document.parent === undefined && !document.parentInvalid,
  );
  const reached = new Set(roots.map((document) => document.path));
  const pending = [...roots];
  for (let document = pending.pop(); document; document = pending.pop())
    for (const child of children.get(document.name ?? '') ?? [])
      if (!reached.has(child.path)) {
        reached.add(child.path);
        pending.push(child);
      }
  return {
    items: toItems(roots),
    unreachable: toItems(
      listed.filter(
        (document) =>
          !reached.has(document.path) && parentBroken(catalog, document),
      ),
    ),
    parentFound: true,
  };
}

/** 목록에 나올 수 있는 항목 수이며 ID가 충돌한 문서는 하나로 센다. */
export function countCatalogListItems(catalog: Catalog): number {
  let count = 0;
  for (const paths of catalog.idPaths.values())
    if (
      [...paths].some((path) => {
        const document = catalog.documents.get(path);
        return document !== undefined && listIdentity(document);
      })
    )
      count++;
  return count;
}

/** 진단 입력을 새 읽기 전용 값으로 복사한다. */
function copyDiagnostic(diagnostic: Diagnostic): CatalogQueryDiagnostic {
  const relatedPaths = ownValue(diagnostic, 'relatedPaths');
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
  const messages = {
    [referenceIdFailureReasons.missingId]:
      queryDiagnosticMessages.referenceTargetMissingId,
    [referenceIdFailureReasons.invalidId]:
      queryDiagnosticMessages.referenceTargetInvalidId,
    [referenceIdFailureReasons.duplicateId]:
      queryDiagnosticMessages.referenceTargetDuplicateId,
  } satisfies Record<ReferenceIdFailureReason, string>;
  return {
    code: catalogDiagnosticCodes.referenceTargetError,
    severity: diagnosticSeverities.warning,
    message: messages[reason],
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
    catalogDiagnosticCodes.missingSectionReference,
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
    if (resolution.status === referenceResolutionStatuses.missing)
      diagnostics.push({
        code: queryDiagnosticCodes.referenceNotFound,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.referenceNotFound,
        ...metadata,
      });
    else if (resolution.status === referenceResolutionStatuses.ambiguous)
      diagnostics.push({
        code: queryDiagnosticCodes.referenceAmbiguous,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.referenceAmbiguous,
        relatedPaths: resolution.candidates
          .map((candidate) => candidate.path)
          .sort(),
        ...metadata,
      });
    else if (resolution.status === referenceResolutionStatuses.missingSection)
      diagnostics.push({
        code: queryDiagnosticCodes.sectionReferenceNotFound,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.sectionReferenceNotFound,
        ...metadata,
      });
    else if (
      resolution.status === referenceResolutionStatuses.self &&
      resolution.section === undefined
    )
      diagnostics.push({
        code: referenceDiagnosticCodes.invalidReference,
        severity: diagnosticSeverities.error,
        message: catalogDiagnosticMessages.selfReference,
        ...metadata,
      });
    else if (resolution.status === referenceResolutionStatuses.unconfirmed)
      diagnostics.push({
        code: catalogDiagnosticCodes.unconfirmedReference,
        severity: diagnosticSeverities.warning,
        message: catalogDiagnosticMessages.unconfirmedReference,
        relatedPaths: resolution.candidates
          .map((candidate) => candidate.path)
          .sort(),
        ...metadata,
      });
    else if (
      resolution.status === referenceResolutionStatuses.resolved &&
      resolution.target
    ) {
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
          severity: diagnosticSeverities.warning,
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

/** 현재 색인의 전체 또는 한 발견 경로에 속한 진단을 조회와 같은 규칙으로 투영한다. */
export function projectCatalogDiagnostics(
  catalog: Catalog,
  documentPath?: string,
): CatalogQueryDiagnostic[] {
  const documents =
    documentPath === undefined
      ? [...catalog.documents.values()]
      : [catalog.documents.get(documentPath)].filter(
          (document) => document !== undefined,
        );
  return documents
    .flatMap((document) => queryDiagnostics(catalog, document))
    .sort(compareDiagnostics);
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

/** 확정 관계의 발견 경로와 사용할 수 있는 현재 ID만 복사한다. */
function pathLinks(
  catalog: Catalog,
  identities: readonly CatalogIdentity[],
): CatalogPathLink[] {
  const links = new Map<string, CatalogPathLink>();
  for (const identity of identities) {
    const document = catalog.documents.get(identity.path);
    if (!document) continue;
    const id =
      idFailure(catalog, document) === undefined ? document.id : undefined;
    links.set(document.path, {
      path: document.path,
      ...(document.realPath === undefined
        ? {}
        : { realPath: document.realPath }),
      ...(id === undefined ? {} : { id }),
    });
  }
  return [...links.values()].sort((left, right) =>
    left.path.localeCompare(right.path, 'en'),
  );
}

/** 실제 파서 관측에서 확인한 발견 경로와 최상위 YAML 범위만 반환한다. */
function documentSource(
  document: CatalogDocument,
): CatalogPathDocumentResultBase['source'] {
  const parsed = document.observation.parsed;
  const offsets = parsed.success ? parsed.rootRange : undefined;
  const start =
    parsed.success && offsets
      ? offsetToPosition(parsed.source, offsets.start)
      : undefined;
  const end =
    parsed.success && offsets
      ? offsetToPosition(parsed.source, offsets.end)
      : undefined;
  return {
    path: document.path,
    ...(document.realPath === undefined ? {} : { realPath: document.realPath }),
    ...(offsets && start && end && offsets.start <= offsets.end
      ? {
          offsetRange: { ...offsets },
          range: { start, end },
        }
      : {}),
  };
}

/** 연결된 문서 이름을 중복 없이 이름 순서로 정렬한다. */
function sortedNames(names: Iterable<string | undefined>): string[] {
  return [...new Set([...names].filter((name) => name !== undefined))].sort(
    compareText,
  );
}

/** 주소 하나의 입력 형식이 틀린 결과다. */
function invalidAddress(address: string): CatalogGetMissingResult {
  return {
    address,
    found: false,
    diagnostics: [
      {
        code: queryDiagnosticCodes.invalidInput,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.invalidInput,
      },
    ],
  };
}

/** 요청한 이름의 문서가 없는 결과다. */
function missingAddress(address: string): CatalogGetMissingResult {
  return {
    address,
    found: false,
    diagnostics: [
      {
        code: queryDiagnosticCodes.notFound,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.notFound,
      },
    ],
  };
}

/** 문서는 있지만 요청한 섹션이 없는 결과다. */
function missingSection(
  address: string,
  document: CatalogDocument,
): CatalogGetMissingResult {
  return {
    address,
    found: false,
    confirmation: document.confirmation,
    diagnostics: [
      {
        code: queryDiagnosticCodes.sectionNotFound,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.sectionNotFound,
      },
    ],
  };
}

/** 이름이나 ID가 겹쳐 하나로 정할 수 없는 주소의 충돌 결과다. */
function conflictAddress(
  address: string,
  paths: readonly string[],
  code:
    | typeof catalogDiagnosticCodes.duplicateName
    | typeof catalogDiagnosticCodes.duplicateId,
): CatalogGetConflictResult {
  return {
    address,
    found: true,
    conflict: true,
    paths,
    diagnostics: [
      {
        code,
        severity: diagnosticSeverities.error,
        message:
          code === catalogDiagnosticCodes.duplicateName
            ? catalogDiagnosticMessages.duplicateName
            : catalogDiagnosticMessages.duplicateId,
        relatedPaths: paths,
      },
    ],
  };
}

/** 문서 결과와 섹션 결과가 공유하는 위치·확인 상태·revision을 만든다. */
function foundBase(
  address: string,
  document: CatalogDocument,
  revisions?: ReadonlyMap<string, string>,
): Omit<CatalogGetFoundResultBase, 'references' | 'diagnostics'> {
  const revision = revisions?.get(document.path);
  return {
    address,
    ...(document.id === undefined ? {} : { id: document.id }),
    found: true,
    conflict: false,
    source: { path: document.path },
    confirmation: document.confirmation,
    ...(typeof revision === 'string' ? { revision } : {}),
  };
}

/** 오류 문서도 원문을 손실하지 않고 문서 결과 하나로 투영한다. */
function documentResult(
  catalog: Catalog,
  address: string,
  document: CatalogDocument,
  revisions?: ReadonlyMap<string, string>,
): CatalogGetDocumentResult {
  const parsed = document.observation.parsed;
  const cloned = parsed.success
    ? cloneJson(parsed.data)
    : { success: false as const };
  return {
    ...foundBase(address, document, revisions),
    ...(cloned.success
      ? { document: cloned.value as Readonly<Record<string, JsonValue>> }
      : { rawYaml: parsed.source ?? '' }),
    references: sortedNames(document.references.map((link) => link.name)),
    referencedBy: sortedNames(document.referencedBy.map((link) => link.name)),
    diagnostics: queryDiagnostics(catalog, document),
  };
}

/** 문서의 섹션 하나와 그 섹션 안의 확정 참조 대상 이름만 섹션 결과로 투영한다. */
function sectionResult(
  catalog: Catalog,
  address: string,
  document: CatalogDocument,
  section: string,
  revisions?: ReadonlyMap<string, string>,
): CatalogGetSectionResult {
  const parsed = document.observation.parsed;
  const cloned = cloneJson(
    parsed.success ? ownValue(parsed.data, section) : undefined,
  );
  const linkable = document.confirmation === catalogConfirmations.confirmed;
  return {
    ...foundBase(address, document, revisions),
    name: document.name ?? '',
    section: {
      name: section,
      ...(cloned.success
        ? { content: cloned.value }
        : { rawYaml: parsed.source ?? '' }),
    },
    references: sortedNames(
      document.occurrences.flatMap(
        /** 이 섹션 안에서 확정된 참조의 대상 이름만 고른다. */ (item) =>
          linkable &&
          item.occurrence.fieldPath[0] === section &&
          item.resolution.status === referenceResolutionStatuses.resolved
            ? [item.resolution.target?.name]
            : [],
      ),
    ),
    diagnostics: queryDiagnostics(catalog, document).filter(
      (diagnostic) => diagnostic.fieldPath?.[0] === section,
    ),
  };
}

/** 한 이름 주소의 부재·충돌·문서·섹션 결과를 다른 주소와 독립적으로 계산한다. */
function addressResult(
  catalog: Catalog,
  address: string,
  revisions?: ReadonlyMap<string, string>,
): CatalogGetResult {
  const components = parseReferenceComponents(address);
  if (!components) return invalidAddress(address);
  const paths = [...(catalog.namePaths.get(components.name) ?? [])].sort(
    compareText,
  );
  if (!paths.length) return missingAddress(address);
  if (paths.length > 1)
    return conflictAddress(
      address,
      paths,
      catalogDiagnosticCodes.duplicateName,
    );
  const document = catalog.documents.get(paths[0] ?? '');
  if (!document) return missingAddress(address);
  const idPaths = [...(catalog.idPaths.get(document.id ?? '') ?? [])].sort(
    compareText,
  );
  if (idPaths.length > 1)
    return conflictAddress(
      address,
      idPaths,
      catalogDiagnosticCodes.duplicateId,
    );
  if (components.section === undefined)
    return documentResult(catalog, address, document, revisions);
  return getSectionNames(document.observation.parsed).includes(
    components.section,
  )
    ? sectionResult(catalog, address, document, components.section, revisions)
    : missingSection(address, document);
}

/** 첫 등장 순서로 중복 제거한 1~20개 이름 주소를 독립 결과로 투영한다.
 * @param catalog IO 계층에서 이미 구축한 읽기 전용 Catalog다.
 * @param addresses `이름` 또는 `이름:섹션` 주소 목록이다.
 * @param options 같은 원문 시점의 선택적인 경로별 revision이다.
 */
export function projectCatalogGet(
  catalog: Catalog,
  addresses: readonly string[],
  options: CatalogGetProjectionOptions = {},
): CatalogGetProjection {
  const uniqueAddresses = [...new Set(addresses)];
  if (
    uniqueAddresses.length === 0 ||
    uniqueAddresses.length > 20 ||
    uniqueAddresses.some((address) => typeof address !== 'string')
  )
    return {
      success: false,
      error: {
        code: queryDiagnosticCodes.invalidInput,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.invalidInput,
      },
    };
  return {
    success: true,
    results: uniqueAddresses.map((address) =>
      addressResult(catalog, address, options.revisions),
    ),
  };
}

/** 발견 경로를 같은 Catalog 관측의 내용·진단·직접/역참조로 투영한다.
 * @param catalog IO 계층에서 이미 구축한 읽기 전용 Catalog다.
 * @param paths 코드 매칭이 반환한 발견 경로 목록이다.
 * @param options 같은 원문 시점의 선택적인 경로별 revision이다.
 */
export function projectCatalogPaths(
  catalog: Catalog,
  paths: readonly string[],
  options: CatalogPathProjectionOptions = {},
): CatalogPathProjection {
  const uniquePaths = [...new Set(paths)];
  if (
    uniquePaths.length === 0 ||
    uniquePaths.some(
      (documentPath) =>
        typeof documentPath !== 'string' || documentPath.length === 0,
    )
  )
    return {
      success: false,
      error: {
        code: queryDiagnosticCodes.invalidInput,
        severity: diagnosticSeverities.error,
        message: queryDiagnosticMessages.invalidInput,
      },
    };
  const results = uniquePaths.map(
    /** 각 경로의 부재·내용·ID 오류를 다른 경로와 독립적으로 계산한다. */ (
      documentPath,
    ): CatalogPathResult => {
      const document = catalog.documents.get(documentPath);
      if (!document) {
        const confirmed = catalog.status === scanStatuses.complete;
        return {
          path: documentPath,
          found: false,
          confirmation: confirmed
            ? catalogConfirmations.confirmed
            : catalogConfirmations.unconfirmed,
          diagnostics: confirmed
            ? [
                {
                  code: queryDiagnosticCodes.notFound,
                  severity: diagnosticSeverities.error,
                  message: queryDiagnosticMessages.notFound,
                  path: documentPath,
                },
              ]
            : [
                {
                  code: catalogDiagnosticCodes.unconfirmedReference,
                  severity: diagnosticSeverities.warning,
                  message: catalogDiagnosticMessages.unconfirmedReference,
                  path: documentPath,
                },
              ],
        };
      }
      const parsed = document.observation.parsed;
      const cloned = parsed.success
        ? cloneJson(parsed.data)
        : { success: false as const };
      const failure = idFailure(catalog, document);
      const revision = options.revisions?.get(document.path);
      const references = pathLinks(catalog, document.references);
      const referencedBy = pathLinks(catalog, document.referencedBy);
      const conflictPaths =
        failure === referenceIdFailureReasons.duplicateId && document.id
          ? [...(catalog.idPaths.get(document.id) ?? [])].sort()
          : undefined;
      return {
        path: document.path,
        found: true,
        source: documentSource(document),
        confirmation: document.confirmation,
        ...(failure === undefined && document.id !== undefined
          ? { id: document.id }
          : {}),
        ...(conflictPaths?.length ? { conflictPaths } : {}),
        ...(cloned.success
          ? { document: cloned.value as Readonly<Record<string, JsonValue>> }
          : { rawYaml: parsed.source ?? '' }),
        ...(typeof revision === 'string' ? { revision } : {}),
        ...(references.length ? { references } : {}),
        ...(referencedBy.length ? { referencedBy } : {}),
        diagnostics: queryDiagnostics(catalog, document),
      };
    },
  );
  return { success: true, results };
}

/** live 출처의 등장과 디스크 대상 내용을 같은 색인에서 계산한 결과다. */
export interface CatalogLiveReferenceResult {
  sourcePath: string;
  occurrences: readonly CatalogOccurrence[];
  diagnostics: readonly CatalogQueryDiagnostic[];
  targets: readonly CatalogPathResult[];
}

/** 열린 YAML 하나만 파싱하고 기존 디스크 색인으로 이름 참조를 투영한다. */
export function projectLiveReferences(
  catalog: Catalog,
  sourcePath: string,
  text: string,
  options: CatalogPathProjectionOptions = {},
): CatalogLiveReferenceResult {
  const document = resolveLiveDocument(catalog, {
    path: sourcePath,
    parsed: parseYaml(text),
  });
  const paths = [
    ...new Set(
      document.occurrences.flatMap((item) =>
        item.resolution.candidates.map((candidate) => candidate.path),
      ),
    ),
  ];
  const projection = paths.length
    ? projectCatalogPaths(catalog, paths, options)
    : undefined;
  return {
    sourcePath,
    occurrences: document.occurrences,
    diagnostics: queryDiagnostics(catalog, document),
    targets: projection?.success ? projection.results : [],
  };
}
