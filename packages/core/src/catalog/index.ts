import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import type {
  CatalogDiagnosticCode,
  Diagnostic,
  DiagnosticSeverity,
  FieldPath,
  OffsetRange,
  SourceRange,
} from '../diagnostics/index.js';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
} from '../diagnostics/index.js';
import type { YamlParseResult } from '../parser/index.js';
import {
  getKeyRange,
  getStringRange,
  offsetToPosition,
  parseYaml,
} from '../parser/index.js';
import { referenceSyntaxStatuses } from '../references/domain-values.js';
import type { ReferenceOccurrence } from '../references/index.js';
import {
  extractReferences,
  getReferencePartRanges,
} from '../references/index.js';
import {
  codocsKey,
  documentFields,
  metadataFields,
  validateDocument,
} from '../validator/index.js';
import {
  catalogConfirmations,
  catalogFailureKinds,
  referenceResolutionStatuses,
  renameBlockingReasons,
  renameChangeKinds,
  renameImpactReasons,
  renamePlanStatuses,
  scanStatuses,
  type CatalogConfirmation,
  type CatalogFailureKind,
  type ReferenceResolutionStatus,
  type RenameBlockingReason,
  type RenameChangeKind,
  type RenameImpactReason,
  type RenamePlanStatus,
  type ScanStatus,
} from './domain-values.js';
export * from './domain-values.js';

/** 로더가 확인한 발견 경로와 파싱 결과다. 실경로는 진단 정보일 뿐 키가 아니다. */
export interface CatalogObservation {
  path: string;
  realPath?: string;
  parsed: YamlParseResult;
}
/** IO 계층이 제공하는 실패 범위다. unknown은 범위를 확인하지 못한 실패다. */
export type CatalogFailure =
  | {
      kind: Exclude<CatalogFailureKind, typeof catalogFailureKinds.unknown>;
      path: string;
      diagnostics?: readonly Diagnostic<string>[];
    }
  | {
      kind: typeof catalogFailureKinds.unknown;
      diagnostics?: readonly Diagnostic<string>[];
    };
/** 전체/부분/실패 스캔의 중립 관측이다. 실패 시 observations는 채택하지 않는다. */
export interface CatalogScan {
  status: ScanStatus;
  observations: readonly CatalogObservation[];
  failures?: readonly CatalogFailure[];
}
/** 확인 가능한 문서 식별 정보다. 자료형·빈 값 오류 필드는 생략하며 ID 규칙 오류는 값과 함께 진단한다. ID는 참조 키가 아니다. */
export interface CatalogIdentity {
  path: string;
  realPath?: string;
  id?: string;
  name?: string;
  /** 모두 비어 있지 않은 문자열일 때만 작성 순서 그대로 담는다. */
  parent?: readonly string[];
  confirmation: CatalogConfirmation;
}
/** 후보마다 오류와 확인 상태를 함께 제공한다. */
export interface ReferenceCandidate extends CatalogIdentity {
  errors: readonly Diagnostic[];
}
/** 충돌의 모든 발견 경로와 확인한 원문 범위를 추가하는 의미 진단이다. */
export interface CatalogDiagnostic extends Diagnostic<CatalogDiagnosticCode> {
  relatedPaths?: readonly string[];
  offsetRange?: OffsetRange;
}
/** 문법 오류와 이름 해석을 구분하며 불확실한 검색을 부재·성공으로 확정하지 않는다. */
export interface ReferenceResolution {
  status: ReferenceResolutionStatus;
  candidates: readonly ReferenceCandidate[];
  target?: ReferenceCandidate;
  /** 참조가 섹션을 적었고 그 섹션이 대상 문서에 있다고 확인한 경우의 섹션 이름이다. */
  section?: string;
}
/** 반복 등장과 실제 YAML 위치를 유지하는 의미 해석 기록이다. */
export interface CatalogOccurrence {
  occurrence: ReferenceOccurrence;
  resolution: ReferenceResolution;
}
/** 경로별 문서, 원문 관측, 직접 연결과 별도의 문서·참조 진단이다. */
export interface CatalogDocument extends CatalogIdentity {
  observation: CatalogObservation;
  documentDiagnostics: readonly Diagnostic[];
  diagnostics: readonly Diagnostic[];
  occurrences: readonly CatalogOccurrence[];
  references: readonly CatalogIdentity[];
  referencedBy: readonly CatalogIdentity[];
  /** 이 문서를 가리키는 확정 참조를 등장 위치마다 하나씩 담은 섹션 단위 역참조다. */
  sectionReferencedBy: readonly SectionBacklink[];
}
/** 섹션 단위 역참조 한 건이다. 문서 전체를 가리키는 `[[name]]`에는 targetSection이 없다. */
export interface SectionBacklink {
  sourcePath: string;
  /** 참조를 쓴 문서의 루트 섹션 키다. */
  sourceSection: string;
  /** 참조가 가리킨 대상 문서의 섹션 이름이다. */
  targetSection?: string;
}
/** 경로를 유일 키로 사용하는 IO 없는 계산 결과다. 반환 컬렉션은 읽기 전용 계약이다. */
export interface Catalog {
  status: CatalogScan['status'];
  failures: readonly CatalogFailure[];
  documents: ReadonlyMap<string, CatalogDocument>;
  idPaths: ReadonlyMap<string, ReadonlySet<string>>;
  namePaths: ReadonlyMap<string, ReadonlySet<string>>;
}
/** 공백만인 값은 확인 가능한 이름·ID·parent로 취급하지 않으며 정규화하지 않는다. */
function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
/** 확인 가능한 메타데이터를 스키마 전체 성공과 독립적으로 추출한다. */
function identity(
  observation: CatalogObservation,
  confirmation: CatalogIdentity['confirmation'],
): CatalogIdentity {
  const parsed = observation.parsed;
  const data = parsed.success ? parsed.data : {};
  const metadata = ownValue(data, codocsKey);
  const name = ownValue(metadata, metadataFields.name);
  const metadataId = ownValue(metadata, metadataFields.id);
  const parent = ownValue(metadata, metadataFields.parent);
  return {
    path: observation.path,
    ...(observation.realPath !== undefined
      ? { realPath: observation.realPath }
      : {}),
    ...(nonblank(metadataId) ? { id: metadataId } : {}),
    ...(nonblank(name) ? { name } : {}),
    ...(Array.isArray(parent) && parent.length && parent.every(nonblank)
      ? { parent: [...parent] }
      : {}),
    confirmation,
  };
}
/** 자체 데이터 속성만 조회하며 getter와 상속 속성을 실행하지 않는다. */
function ownValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor
    ? (descriptor.value as unknown)
    : undefined;
}
/** 구분자를 연결하지 않고 값별 집합에 경로를 추가한다. */
function addPath(
  index: Map<string, Set<string>>,
  value: string,
  path: string,
): void {
  const paths = index.get(value) ?? new Set<string>();
  paths.add(path);
  index.set(value, paths);
}
/** 진단 코드 원본에 대응하는 문구와 심각도다. */
const catalogDiagnosticDefinitions = {
  [catalogDiagnosticCodes.duplicateId]: {
    message: catalogDiagnosticMessages.duplicateId,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.duplicateName]: {
    message: catalogDiagnosticMessages.duplicateName,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.parentNotFound]: {
    message: catalogDiagnosticMessages.parentNotFound,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.parentCycle]: {
    message: catalogDiagnosticMessages.parentCycle,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.missingReference]: {
    message: catalogDiagnosticMessages.missingReference,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.ambiguousReference]: {
    message: catalogDiagnosticMessages.ambiguousReference,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.missingSectionReference]: {
    message: catalogDiagnosticMessages.missingSectionReference,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.selfReference]: {
    message: catalogDiagnosticMessages.selfReference,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.unconfirmedReference]: {
    message: catalogDiagnosticMessages.unconfirmedReference,
    severity: diagnosticSeverities.warning,
  },
  [catalogDiagnosticCodes.referenceTargetError]: {
    message: catalogDiagnosticMessages.referenceTargetError,
    severity: diagnosticSeverities.warning,
  },
} satisfies Record<
  CatalogDiagnosticCode,
  { message: string; severity: DiagnosticSeverity }
>;

/** 원문에서 확인한 필드 또는 등장 위치만 진단에 붙인다. */
function catalogDiagnostic(
  document: CatalogDocument,
  code: CatalogDiagnosticCode,
  fieldPath?: FieldPath,
  occurrence?: ReferenceOccurrence,
  context?: { relatedPaths: readonly string[] },
): CatalogDiagnostic {
  const parsed = document.observation.parsed;
  const offsets =
    occurrence?.offsetRange ??
    (parsed.success && fieldPath
      ? getStringRange(parsed, fieldPath, {
          start: 0,
          end:
            parsed.strings.find(
              (s) =>
                s.fieldPath.length === fieldPath.length &&
                s.fieldPath.every((p, i) => p === fieldPath[i]),
            )?.value.length ?? 0,
        })
      : undefined);
  const start =
    offsets && parsed.source !== undefined
      ? offsetToPosition(parsed.source, offsets.start)
      : undefined;
  const end =
    offsets && parsed.source !== undefined
      ? offsetToPosition(parsed.source, offsets.end)
      : undefined;
  return {
    code,
    ...catalogDiagnosticDefinitions[code],
    path: document.path,
    ...(context ? { relatedPaths: [...context.relatedPaths] } : {}),
    ...(fieldPath ? { fieldPath: [...fieldPath] } : {}),
    ...(offsets ? { offsetRange: { ...offsets } } : {}),
    ...(start && end ? { range: { start, end } } : {}),
  };
}
/** 문서에서 후보 정보를 만든다. 참조 진단은 대상 문서 오류와 혼동하지 않는다. */
function candidate(document: CatalogDocument): ReferenceCandidate {
  return {
    ...linkIdentity(document),
    errors: document.documentDiagnostics.filter(
      (d) => d.severity === diagnosticSeverities.error,
    ),
  };
}
/** 직접 연결에 필요한 확인 가능한 메타데이터만 복사한다. */
function linkIdentity(document: CatalogIdentity): CatalogIdentity {
  return {
    path: document.path,
    ...(document.realPath !== undefined ? { realPath: document.realPath } : {}),
    ...(document.id !== undefined ? { id: document.id } : {}),
    ...(document.name !== undefined ? { name: document.name } : {}),
    ...(document.parent !== undefined ? { parent: [...document.parent] } : {}),
    confirmation: document.confirmation,
  };
}
/**
 * 참조의 name으로 후보 문서를 찾아 경로순으로 돌려준다.
 * 섹션은 문서를 확정한 뒤에 확인하므로 후보 찾기에는 쓰지 않는다.
 */
function findCandidates(
  catalog: Catalog,
  reference: { name: string },
): ReferenceCandidate[] {
  const paths = catalog.namePaths.get(reference.name);
  return [...(paths ?? [])].sort().flatMap((path) => {
    const doc = catalog.documents.get(path);
    return doc ? [candidate(doc)] : [];
  });
}
/**
 * 탐색이 끝난 색인인지 확인한다. 끝나지 않았으면 참조를 후보 수와 관계없이 미확인으로 둔다.
 */
function isScanComplete(catalog: Catalog): boolean {
  return catalog.status === scanStatuses.complete;
}
/**
 * 후보 수에 따라 참조 대상을 확정·부재·모호함 중 하나로 판단한다.
 */
function statusByCandidateCount(
  candidates: readonly ReferenceCandidate[],
): ReferenceResolutionStatus {
  if (!candidates.length) return referenceResolutionStatuses.missing;
  if (candidates.length > 1) return referenceResolutionStatuses.ambiguous;
  return referenceResolutionStatuses.resolved;
}
/**
 * 문서의 루트 섹션 이름을 작성 순서대로 돌려준다. `_codocs`와 파싱에 실패한 문서는 제외한다.
 */
export function getSectionNames(parsed: YamlParseResult): string[] {
  return parsed.success
    ? Object.keys(parsed.data).filter((key) => key !== codocsKey)
    : [];
}
/** 섹션 키의 원문 위치다. offsetRange는 원문 offset, range는 줄 좌표다. */
export interface SectionKeyRange {
  offsetRange: OffsetRange;
  range: SourceRange;
}
/**
 * 카탈로그 문서의 루트 섹션 키가 원문에서 차지하는 범위를 계산한다.
 * 따옴표를 쓴 키는 따옴표를 포함한 범위다.
 * @param document 섹션 키를 찾을 카탈로그 문서다. 저장된 색인 문서와 편집 중인 문서 모두 쓸 수 있다.
 * @param section 루트 섹션 이름이다.
 * @returns 섹션이 없거나 위치를 확인하지 못하면 undefined다.
 */
export function getSectionKeyRange(
  document: Pick<CatalogDocument, 'observation'>,
  section: string,
): SectionKeyRange | undefined {
  const parsed = document.observation.parsed;
  if (!getSectionNames(parsed).includes(section)) return undefined;
  const offsetRange = getKeyRange(parsed, [section]);
  if (!offsetRange || !parsed.success) return undefined;
  const start = offsetToPosition(parsed.source, offsetRange.start);
  const end = offsetToPosition(parsed.source, offsetRange.end);
  return start && end
    ? { offsetRange: { ...offsetRange }, range: { start, end } }
    : undefined;
}
/**
 * 참조 하나가 가리키는 대상을 후보를 찾아 판단한다.
 * 문서가 하나로 확정되면 섹션을 대상 문서의 저장된 색인에서 확인한다.
 * 같은 문서의 섹션은 sourceParsed(편집 중인 내용)가 있으면 그것으로 확인한다.
 */
export function resolveReference(
  catalog: Catalog,
  reference: { name: string; section?: string },
  sourcePath?: string,
  sourceParsed?: YamlParseResult,
): ReferenceResolution {
  const candidates = findCandidates(catalog, reference);
  if (!isScanComplete(catalog))
    return { status: referenceResolutionStatuses.unconfirmed, candidates };
  const status = statusByCandidateCount(candidates);
  if (status !== referenceResolutionStatuses.resolved)
    return { status, candidates };
  const target = candidates[0];
  if (!target)
    return { status: referenceResolutionStatuses.missing, candidates };
  const isSelf = target.path === sourcePath;
  const confirmed = isSelf
    ? referenceResolutionStatuses.self
    : referenceResolutionStatuses.resolved;
  if (reference.section === undefined)
    return { status: confirmed, candidates, target };
  const parsed =
    isSelf && sourceParsed
      ? sourceParsed
      : catalog.documents.get(target.path)?.observation.parsed;
  if (!parsed || !getSectionNames(parsed).includes(reference.section))
    return {
      status: referenceResolutionStatuses.missingSection,
      candidates,
      target,
    };
  return { status: confirmed, candidates, target, section: reference.section };
}
/** 계산할 때마다 다시 만드는 프로젝트 수준 진단 코드다. */
const projectDiagnosticCodes: ReadonlySet<string> = new Set([
  catalogDiagnosticCodes.duplicateId,
  catalogDiagnosticCodes.duplicateName,
  catalogDiagnosticCodes.parentNotFound,
  catalogDiagnosticCodes.parentCycle,
]);
/** parent 이름이 가리키는 후보 경로를 찾는다. 이름에 해당하는 문서가 여러 개여도 모두 후보다. */
function parentPaths(catalog: Catalog, name: string): readonly string[] {
  return [...(catalog.namePaths.get(name) ?? [])].sort();
}
/**
 * 문서 관계 그래프에서 순환에 속한 경로 집합을 Tarjan 알고리즘으로 구한다.
 * @param edges 경로별 상위 문서 경로다. 자기 자신으로의 간선도 순환이다.
 * @returns 순환에 속한 경로마다 그 순환 구성원 전체를 돌려준다.
 */
function cycleGroups(
  edges: ReadonlyMap<string, readonly string[]>,
): Map<string, ReadonlySet<string>> {
  const index = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    onStack = new Set<string>();
  const groups = new Map<string, ReadonlySet<string>>();
  let counter = 0;
  /** 한 경로에서 시작해 강연결 요소를 찾는다. */
  function visit(node: string): void {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next))
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
    }
    if (low.get(node) !== index.get(node)) return;
    const members = new Set<string>();
    for (;;) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      members.add(member);
      if (member === node) break;
    }
    if (members.size > 1 || (edges.get(node) ?? []).includes(node))
      for (const member of members) groups.set(member, members);
  }
  for (const node of edges.keys()) if (!index.has(node)) visit(node);
  return groups;
}
/**
 * 각 문서의 parent 이름을 해석해 존재·순환 오류를 추가한다. 상위 문서 연결은 참조와 별개이며 저장하지 않는다.
 * 불완전한 탐색에서는 없는 이름을 오류로 확정하지 않는다.
 */
function resolveParents(
  catalog: Catalog,
  documents: Map<string, CatalogDocument>,
): void {
  const edges = new Map<string, readonly string[]>();
  for (const [path, doc] of documents)
    edges.set(
      path,
      (doc.parent ?? []).flatMap((name) => parentPaths(catalog, name)),
    );
  const groups = cycleGroups(edges);
  for (const [path, doc] of documents) {
    const names = doc.parent ?? [];
    const diagnostics: CatalogDiagnostic[] = [];
    names.forEach(
      /** 항목별로 존재 여부를 확인한다. */ (name, position) => {
        const paths = parentPaths(catalog, name);
        const fieldPath = [...documentFields.parent, position];
        if (!paths.length && isScanComplete(catalog))
          diagnostics.push(
            catalogDiagnostic(
              doc,
              catalogDiagnosticCodes.parentNotFound,
              fieldPath,
            ),
          );
      },
    );
    const group = groups.get(path);
    if (group) {
      const position = names.findIndex((name) =>
        parentPaths(catalog, name).some((target) => group.has(target)),
      );
      diagnostics.push(
        catalogDiagnostic(
          doc,
          catalogDiagnosticCodes.parentCycle,
          [...documentFields.parent, position],
          undefined,
          { relatedPaths: [...group].sort() },
        ),
      );
    }
    documents.set(path, {
      ...doc,
      documentDiagnostics: [...doc.documentDiagnostics, ...diagnostics],
    });
  }
}
/** 섹션 단위 역참조를 출처 경로, 출처 섹션, 대상 섹션 순으로 정렬한다. */
function compareSectionBacklinks(
  left: SectionBacklink,
  right: SectionBacklink,
): number {
  return (
    compareText(left.sourcePath, right.sourcePath) ||
    compareText(left.sourceSection, right.sourceSection) ||
    compareText(left.targetSection ?? '', right.targetSection ?? '')
  );
}
/** 로케일과 무관하게 UTF-16 코드 단위 순서로 문자열을 비교한다. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
/** 보관 기록에서 색인·충돌·직접 연결을 매번 재계산한다. */
function calculate(
  status: Catalog['status'],
  failures: readonly CatalogFailure[],
  records: readonly CatalogDocument[],
): Catalog {
  const documents = new Map<string, CatalogDocument>();
  const idPaths = new Map<string, Set<string>>(),
    namePaths = new Map<string, Set<string>>();
  for (const record of records) {
    const doc: CatalogDocument = {
      ...record,
      documentDiagnostics: record.documentDiagnostics.filter(
        (d) => !projectDiagnosticCodes.has(d.code),
      ),
      diagnostics: [],
      occurrences: [],
      references: [],
      referencedBy: [],
      sectionReferencedBy: [],
    };
    documents.set(doc.path, doc);
    if (doc.id !== undefined) addPath(idPaths, doc.id, doc.path);
    if (doc.name !== undefined) addPath(namePaths, doc.name, doc.path);
  }
  const catalog: Catalog = {
    status,
    failures: [...failures],
    documents,
    idPaths,
    namePaths,
  };
  /** 충돌의 모든 경로를 개별 진단한다. */
  function conflicts(
    paths: Set<string>,
    code:
      | typeof catalogDiagnosticCodes.duplicateId
      | typeof catalogDiagnosticCodes.duplicateName,
  ): void {
    if (paths.size < 2) return;
    for (const path of paths) {
      const doc = documents.get(path);
      if (doc) {
        const field =
          code === catalogDiagnosticCodes.duplicateId
            ? documentFields.id
            : documentFields.name;
        documents.set(path, {
          ...doc,
          documentDiagnostics: [
            ...doc.documentDiagnostics,
            catalogDiagnostic(doc, code, field, undefined, {
              relatedPaths: [...paths].sort(),
            }),
          ],
        });
      }
    }
  }
  for (const paths of idPaths.values())
    conflicts(paths, catalogDiagnosticCodes.duplicateId);
  for (const paths of namePaths.values())
    conflicts(paths, catalogDiagnosticCodes.duplicateName);
  resolveParents(catalog, documents);
  const backlinks = new Map<string, Set<string>>();
  const sectionBacklinks = new Map<string, SectionBacklink[]>();
  for (const [path, doc] of documents) {
    const resolved = resolveDocumentReferences(catalog, doc);
    for (const target of resolved.references)
      addPath(backlinks, target.path, path);
    for (const item of resolved.occurrences) {
      const sourceSection = item.occurrence.fieldPath[0];
      if (
        !isLinkable(item.resolution, resolved) ||
        item.occurrence.syntax !== referenceSyntaxStatuses.valid ||
        typeof sourceSection !== 'string'
      )
        continue;
      const list = sectionBacklinks.get(item.resolution.target.path) ?? [];
      list.push({
        sourcePath: path,
        sourceSection,
        ...(item.occurrence.section !== undefined
          ? { targetSection: item.occurrence.section }
          : {}),
      });
      sectionBacklinks.set(item.resolution.target.path, list);
    }
    documents.set(path, resolved);
  }
  for (const [path, doc] of documents)
    documents.set(path, {
      ...doc,
      referencedBy: [...(backlinks.get(path) ?? [])].sort().flatMap((p) => {
        const d = documents.get(p);
        return d ? [linkIdentity(d)] : [];
      }),
      sectionReferencedBy: (sectionBacklinks.get(path) ?? []).sort(
        compareSectionBacklinks,
      ),
    });
  return catalog;
}
/**
 * 본문에 나온 참조 하나를 해석한다. 문법 오류인 참조는 후보를 찾지 않는다.
 */
function resolveOccurrence(
  catalog: Catalog,
  occurrence: ReferenceOccurrence,
  sourcePath: string,
  sourceParsed: YamlParseResult,
): ReferenceResolution {
  return occurrence.syntax === referenceSyntaxStatuses.invalid
    ? { status: referenceResolutionStatuses.invalid, candidates: [] }
    : resolveReference(catalog, occurrence, sourcePath, sourceParsed);
}
/**
 * 확정된 참조인지 확인해 연결과 역참조를 만들지 정한다.
 * 참조를 쓴 문서도 이번 탐색에서 확인한 문서여야 한다.
 */
function isLinkable(
  resolution: ReferenceResolution,
  source: CatalogDocument,
): resolution is ReferenceResolution & { target: ReferenceCandidate } {
  return (
    resolution.status === referenceResolutionStatuses.resolved &&
    resolution.target !== undefined &&
    source.confirmation === catalogConfirmations.confirmed
  );
}
/**
 * 확정한 대상 문서에 오류가 있으면 참조 위치에 경고를 만든다.
 */
function targetErrorWarning(
  doc: CatalogDocument,
  occurrence: ReferenceOccurrence,
  target: ReferenceCandidate,
): CatalogDiagnostic | undefined {
  return target.errors.length
    ? catalogDiagnostic(
        doc,
        catalogDiagnosticCodes.referenceTargetError,
        occurrence.fieldPath,
        occurrence,
      )
    : undefined;
}
/**
 * 문서 하나의 본문에서 참조를 찾아 대상을 판단하고 진단과 연결을 만든다.
 * 저장된 문서와 편집 중인 문서에 같은 규칙을 쓴다.
 */
function resolveDocumentReferences(
  catalog: Catalog,
  doc: CatalogDocument,
): CatalogDocument {
  const path = doc.path;
  const extracted = extractReferences(doc.observation.parsed, path);
  const diagnostics: Diagnostic[] = [
    ...doc.documentDiagnostics,
    ...extracted.diagnostics,
  ];
  const links = new Set<string>();
  const occurrences = extracted.occurrences.map(
    /** 원문 등장을 해석하며 확정 연결만 별도 집계한다. */ (
      occurrence,
    ): CatalogOccurrence => {
      const resolution = resolveOccurrence(
        catalog,
        occurrence,
        path,
        doc.observation.parsed,
      );
      const key =
        resolution.status === referenceResolutionStatuses.missing
          ? catalogDiagnosticCodes.missingReference
          : resolution.status === referenceResolutionStatuses.ambiguous
            ? catalogDiagnosticCodes.ambiguousReference
            : resolution.status === referenceResolutionStatuses.missingSection
              ? catalogDiagnosticCodes.missingSectionReference
              : resolution.status === referenceResolutionStatuses.self &&
                  resolution.section === undefined
                ? catalogDiagnosticCodes.selfReference
                : resolution.status === referenceResolutionStatuses.unconfirmed
                  ? catalogDiagnosticCodes.unconfirmedReference
                  : undefined;
      if (key)
        diagnostics.push(
          catalogDiagnostic(doc, key, occurrence.fieldPath, occurrence),
        );
      if (isLinkable(resolution, doc)) {
        links.add(resolution.target.path);
        const warning = targetErrorWarning(doc, occurrence, resolution.target);
        if (warning) diagnostics.push(warning);
      }
      return { occurrence, resolution };
    },
  );
  return {
    ...doc,
    diagnostics,
    occurrences,
    references: [...links].sort().flatMap((p) => {
      const target = catalog.documents.get(p);
      return target ? [linkIdentity(target)] : [];
    }),
  };
}

/**
 * 편집 중인 문서의 parent가 저장된 색인에서 존재하고 순환하지 않는지 확인한다.
 * 저장된 다른 문서의 상위 관계는 바꾸지 않고 읽기만 한다.
 */
function liveParentDiagnostics(
  catalog: Catalog,
  document: CatalogDocument,
): CatalogDiagnostic[] {
  const diagnostics: CatalogDiagnostic[] = [];
  (document.parent ?? []).forEach(
    /** 항목별로 존재와 순환을 확인한다. */ (name, position) => {
      const fieldPath = [...documentFields.parent, position];
      const paths = parentPaths(catalog, name);
      if (!paths.length && name !== document.name) {
        if (isScanComplete(catalog))
          diagnostics.push(
            catalogDiagnostic(
              document,
              catalogDiagnosticCodes.parentNotFound,
              fieldPath,
            ),
          );
        return;
      }
      const seen = new Set<string>();
      const pending = paths.filter((path) => path !== document.path);
      let cyclic = name === document.name;
      while (!cyclic && pending.length) {
        const path = pending.pop();
        if (path === undefined || seen.has(path)) continue;
        seen.add(path);
        for (const parentName of catalog.documents.get(path)?.parent ?? []) {
          if (parentName === document.name) cyclic = true;
          for (const parent of parentPaths(catalog, parentName))
            if (parent === document.path) cyclic = true;
            else pending.push(parent);
        }
      }
      if (cyclic)
        diagnostics.push(
          catalogDiagnostic(
            document,
            catalogDiagnosticCodes.parentCycle,
            fieldPath,
            undefined,
            { relatedPaths: [document.path] },
          ),
        );
    },
  );
  return diagnostics;
}

/**
 * 편집 중인 문서의 저장하지 않은 내용으로 참조를 해석한다.
 * 대상은 저장된 색인으로 판단하며 색인과 역참조는 바꾸지 않는다.
 */
export function resolveLiveDocument(
  catalog: Catalog,
  observation: CatalogObservation,
): CatalogDocument {
  const parsed = observation.parsed;
  const validation = parsed.success
    ? validateDocument({
        data: parsed.data,
        path: observation.path,
        source: parsed.source,
        fields: parsed.fields,
        ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
      })
    : undefined;
  const documentDiagnostics: Diagnostic[] = validation
    ? [...validation.errors, ...validation.warnings]
    : [...parsed.diagnostics];
  const document: CatalogDocument = {
    ...identity(observation, catalogConfirmations.confirmed),
    observation,
    documentDiagnostics,
    diagnostics: [],
    occurrences: [],
    references: [],
    referencedBy: [],
    sectionReferencedBy: [],
  };
  const conflicts =
    document.id === undefined
      ? []
      : [...(catalog.idPaths.get(document.id) ?? [])].filter(
          (path) => path !== observation.path,
        );
  if (conflicts.length)
    documentDiagnostics.push(
      catalogDiagnostic(
        document,
        catalogDiagnosticCodes.duplicateId,
        documentFields.id,
        undefined,
        {
          relatedPaths: [observation.path, ...conflicts].sort(),
        },
      ),
    );
  if (document.name !== undefined) {
    const nameConflicts = [
      ...(catalog.namePaths.get(document.name) ?? []),
    ].filter((path) => path !== observation.path);
    if (nameConflicts.length)
      documentDiagnostics.push(
        catalogDiagnostic(
          document,
          catalogDiagnosticCodes.duplicateName,
          documentFields.name,
          undefined,
          { relatedPaths: [observation.path, ...nameConflicts].sort() },
        ),
      );
  }
  documentDiagnostics.push(...liveParentDiagnostics(catalog, document));
  return resolveDocumentReferences(catalog, document);
}

/**
 * 다시 탐색하는 동안 이전에 확인한 문서를 미확인 후보로 보존한다.
 * 완전한 탐색이면 보존하지 않는다.
 */
function preserveUnconfirmed(
  scan: CatalogScan,
  previous?: Catalog,
): Map<string, CatalogDocument> {
  const records = new Map<string, CatalogDocument>();
  if (scan.status === scanStatuses.complete) return records;
  for (const [path, doc] of previous?.documents ?? [])
    records.set(path, {
      ...doc,
      confirmation: catalogConfirmations.unconfirmed,
    });
  return records;
}
/** complete만 삭제 근거로 삼아 구축·갱신한다. partial/failed의 미관측 이전 기록은 미확인으로 보존한다. */
export function buildCatalog(scan: CatalogScan, previous?: Catalog): Catalog {
  const records = preserveUnconfirmed(scan, previous);
  if (scan.status !== scanStatuses.failed)
    for (const observation of scan.observations) {
      const parsed = observation.parsed;
      const validation = parsed.success
        ? validateDocument({
            data: parsed.data,
            path: observation.path,
            source: parsed.source,
            fields: parsed.fields,
            ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
          })
        : undefined;
      const documentDiagnostics = validation
        ? [...validation.errors, ...validation.warnings]
        : [...parsed.diagnostics];
      records.set(observation.path, {
        ...identity(observation, catalogConfirmations.confirmed),
        observation,
        documentDiagnostics,
        diagnostics: [],
        occurrences: [],
        references: [],
        referencedBy: [],
        sectionReferencedBy: [],
      });
    }
  return calculate(scan.status, scan.failures ?? [], [...records.values()]);
}

/** 모호한 후보 중 하나를 사용자가 선택한 등장별 결정이다. */
export interface RenameSelection {
  sourcePath: string;
  occurrenceIndex: number;
  targetPath: string;
}
/** 계산만 수행하는 이름 변경 요청이다. 참조 동시 변경은 기본으로 활성화된다. */
export interface RenameRequest {
  targetPath: string;
  newName: string;
  updateReferences?: boolean;
  selections?: readonly RenameSelection[];
}
/** 실제 원문 위치와 변경 전후 해석값을 가진 계획이다. 원문 저장용 patch가 아니다. */
export interface RenameChange {
  path: string;
  fieldPath: FieldPath;
  offsetRange: OffsetRange;
  range: SourceRange;
  oldText: string;
  newText: string;
  targetPath: string;
  candidates: readonly ReferenceCandidate[];
  /** 본문 참조 등장의 순번이다. 이름 필드와 parent 항목 수정에는 없다. */
  occurrenceIndex?: number;
  /** 값이 아니라 섹션 키 이름을 바꾸는 수정이면 key다. 이때 offsetRange는 따옴표를 포함한 키 범위다. */
  kind?: RenameChangeKind;
}
/** 자동 확정하지 않은 영향 및 변경 후 다른 후보가 되는 영향도 보고한다. */
export interface RenameImpact {
  path: string;
  occurrenceIndex: number;
  occurrence: ReferenceOccurrence;
  before: ReferenceResolution;
  after: ReferenceResolution;
  reason: RenameImpactReason;
}
/** 프로젝트에서 새 이름을 이미 쓰는 문서가 있으면 변경을 차단한다. */
export interface RenameConflict {
  candidates: readonly ReferenceCandidate[];
}
/** 순수 수정안이며 blocked/unresolved를 저장 허용으로 해석하지 않는다. */
export interface RenamePlan {
  targetPath: string;
  oldName?: string;
  newName: string;
  status: RenamePlanStatus;
  changes: readonly RenameChange[];
  conflicts: readonly RenameConflict[];
  impacts: readonly RenameImpact[];
  invalidSelections: readonly RenameSelection[];
  blockingReason?: RenameBlockingReason;
  /** 섹션 이름 변경 계획이면 바꾸기 전 섹션 이름이다. 이때 oldName·newName도 섹션 이름이다. */
  targetSection?: string;
}
/** 문서 하나의 최상위 섹션 이름을 바꾸는 계산 요청이다. */
export interface SectionRenameRequest {
  targetPath: string;
  /** 바꾸기 전 섹션 이름이다. */
  section: string;
  /** 새 섹션 이름이다. */
  newName: string;
  selections?: readonly RenameSelection[];
}
/** 새 표기를 공개 문법 추출로 round trip 검증한다. 표현 불가능한 구성은 추측하지 않는다. */
function referenceText(name: string, section?: string): string | undefined {
  /** 구성 내부 콜론을 구분자와 구분한다. */
  const encode = (value: string): string => value.replace(/:/gu, '\\:');
  const text =
    section === undefined
      ? `[[${encode(name)}]]`
      : `[[${encode(name)}:${encode(section)}]]`;
  if (/[\[\]]/u.test(name) || /[\[\]]/u.test(section ?? '')) return undefined;
  const extracted = extractReferences(
    parseYaml(`body: ${JSON.stringify(text)}\n`),
  );
  const occurrence = extracted.occurrences[0];
  return extracted.occurrences.length === 1 &&
    occurrence?.syntax === referenceSyntaxStatuses.valid &&
    occurrence.name === name &&
    occurrence.section === section
    ? text
    : undefined;
}
/**
 * 문서 부분의 해석 상태를 돌려준다. 섹션 확인 결과(섹션 없음)는 문서 확정으로 본다.
 */
function documentStatus(
  resolution: ReferenceResolution,
): ReferenceResolutionStatus {
  return resolution.status === referenceResolutionStatuses.missingSection
    ? referenceResolutionStatuses.resolved
    : resolution.status;
}
/**
 * 이름 변경 계획에서 참조의 문서 부분이 확정한 대상을 돌려준다.
 * 섹션이 없어도 문서가 확정되었으면 대상이며, 같은 문서의 섹션 참조도 대상이다.
 */
function confirmedDocumentTarget(
  resolution: ReferenceResolution,
  occurrence: ReferenceOccurrence,
): ReferenceCandidate | undefined {
  if (
    resolution.status === referenceResolutionStatuses.resolved ||
    resolution.status === referenceResolutionStatuses.missingSection
  )
    return resolution.target;
  return resolution.status === referenceResolutionStatuses.self &&
    occurrence.syntax === referenceSyntaxStatuses.valid &&
    occurrence.section !== undefined
    ? resolution.target
    : undefined;
}
/** 전체 후보가 같은지 판별하여 무선택 모호 참조의 의미 변화도 보고한다. 섹션은 비교하지 않는다. */
function sameResolution(
  before: ReferenceResolution,
  after: ReferenceResolution,
): boolean {
  return (
    documentStatus(before) === documentStatus(after) &&
    before.target?.path === after.target?.path &&
    before.candidates.length === after.candidates.length &&
    before.candidates.every((c, i) => c.path === after.candidates[i]?.path)
  );
}
/** 대상 경로·필드·실제 위치·후보와 미해결 영향을 계산한다. 파일·입력·원문은 변경하지 않는다. */
export function planRename(
  catalog: Catalog,
  request: RenameRequest,
): RenamePlan {
  const target = catalog.documents.get(request.targetPath);
  const initial: RenamePlan = {
    targetPath: request.targetPath,
    newName: request.newName,
    status: renamePlanStatuses.blocked,
    changes: [],
    conflicts: [],
    impacts: [],
    invalidSelections: [],
    ...(target?.name !== undefined ? { oldName: target.name } : {}),
  };
  if (
    !target ||
    target.name === undefined ||
    !target.observation.parsed.success
  )
    return {
      ...initial,
      blockingReason: renameBlockingReasons.targetUnavailable,
    };
  if (!nonblank(request.newName))
    return { ...initial, blockingReason: renameBlockingReasons.invalidName };
  if (
    catalog.status !== scanStatuses.complete ||
    target.confirmation !== catalogConfirmations.confirmed
  )
    return { ...initial, blockingReason: renameBlockingReasons.unconfirmed };
  const selections = request.selections ?? [];
  const invalidSelections = selections.filter(
    /** 존재하지 않는 등장·리터럴·중복 선택을 임의로 무시하지 않는다. */ (
      selection,
      index,
    ) => {
      const item = catalog.documents.get(selection.sourcePath)?.occurrences[
        selection.occurrenceIndex
      ];
      return (
        !Number.isInteger(selection.occurrenceIndex) ||
        selection.occurrenceIndex < 0 ||
        !item ||
        item.occurrence.syntax !== referenceSyntaxStatuses.valid ||
        selections.some(
          (other, otherIndex) =>
            index !== otherIndex &&
            other.sourcePath === selection.sourcePath &&
            other.occurrenceIndex === selection.occurrenceIndex,
        )
      );
    },
  );
  if (invalidSelections.length)
    return {
      ...initial,
      invalidSelections,
      blockingReason: renameBlockingReasons.invalidSelection,
    };
  const newNameCandidates = resolveReference(catalog, {
    name: request.newName,
  }).candidates.filter((c) => c.path !== target.path);
  const conflicts: RenameConflict[] = newNameCandidates.length
    ? [{ candidates: newNameCandidates }]
    : [];
  if (conflicts.length)
    return {
      ...initial,
      conflicts,
      blockingReason: renameBlockingReasons.nameConflict,
    };
  /** 이름이 유일할 때만 다른 문서의 parent 항목이 이 문서를 가리킨다고 본다. */
  const parentOwners =
    target.name !== request.newName &&
    (catalog.namePaths.get(target.name)?.size ?? 0) === 1
      ? [...catalog.documents.values()].filter(
          (doc) =>
            doc.path !== target.path && doc.parent?.includes(target.name ?? ''),
        )
      : [];
  const simulated = calculate(
    catalog.status,
    catalog.failures,
    [...catalog.documents.values()].map(
      /** 이름 변경을 반영한 시뮬레이션 기록을 만든다. */ (doc) =>
        doc.path === target.path
          ? { ...doc, name: request.newName }
          : parentOwners.includes(doc)
            ? {
                ...doc,
                parent: (doc.parent ?? []).map((name) =>
                  name === target.name ? request.newName : name,
                ),
              }
            : doc,
    ),
  );
  const brokenParents = [...simulated.documents.values()].filter(
    /** 이름 변경으로 새로 생기는 parent 오류만 찾는다. */ (doc) =>
      doc.documentDiagnostics.some(
        /** 같은 위치의 parent 오류가 이미 있었는지 비교한다. */ (d) =>
          (d.code === catalogDiagnosticCodes.parentNotFound ||
            d.code === catalogDiagnosticCodes.parentCycle) &&
          !catalog.documents
            .get(doc.path)
            ?.documentDiagnostics.some(
              (before) =>
                before.code === d.code &&
                JSON.stringify(before.fieldPath) ===
                  JSON.stringify(d.fieldPath),
            ),
      ),
  );
  if (brokenParents.length)
    return {
      ...initial,
      conflicts: [{ candidates: brokenParents.map(candidate) }],
      blockingReason: renameBlockingReasons.nameConflict,
    };
  const changes: RenameChange[] = [],
    impacts: RenameImpact[] = [],
    rejectedSelections: RenameSelection[] = [];
  const fieldPath = documentFields.name;
  const parsed = target.observation.parsed;
  const offsetRange = getStringRange(parsed, fieldPath, {
    start: 0,
    end: target.name.length,
  });
  const start = offsetRange
    ? offsetToPosition(parsed.source, offsetRange.start)
    : undefined;
  const end = offsetRange
    ? offsetToPosition(parsed.source, offsetRange.end)
    : undefined;
  if (!offsetRange || !start || !end)
    return {
      ...initial,
      blockingReason: renameBlockingReasons.targetUnavailable,
    };
  if (target.name !== request.newName)
    changes.push({
      path: target.path,
      fieldPath,
      offsetRange,
      range: { start, end },
      oldText: target.name,
      newText: request.newName,
      targetPath: target.path,
      candidates: [candidate(target)],
    });
  for (const doc of catalog.documents.values())
    for (
      let occurrenceIndex = 0;
      occurrenceIndex < doc.occurrences.length;
      occurrenceIndex++
    ) {
      const item = doc.occurrences[occurrenceIndex];
      if (!item || item.occurrence.syntax !== referenceSyntaxStatuses.valid)
        continue;
      const occurrence = item.occurrence,
        before = item.resolution;
      const after = resolveReference(
        simulated,
        { name: occurrence.name },
        doc.path,
      );
      const selection = request.selections?.find(
        (s) =>
          s.sourcePath === doc.path && s.occurrenceIndex === occurrenceIndex,
      );
      const selected = selection
        ? before.candidates.find((c) => c.path === selection.targetPath)
        : confirmedDocumentTarget(before, occurrence);
      /** 미해결 등장도 원문 위치와 전후 후보를 유지한다. */
      function impact(reason: RenameImpact['reason']): void {
        impacts.push({
          path: doc.path,
          occurrenceIndex,
          occurrence,
          before,
          after,
          reason,
        });
      }
      /** 사용자가 고른 선택이 잘못된 경우 선택 목록에 기록해 이름 변경을 차단한다. */
      function reject(): void {
        impact(renameImpactReasons.invalidSelection);
        if (selection) rejectedSelections.push(selection);
      }
      if (selection && !selected) {
        reject();
        continue;
      }
      const affected =
        before.candidates.some((c) => c.path === target.path) ||
        after.candidates.some((c) => c.path === target.path);
      if (!affected && !selection) continue;
      if (!selected) {
        if (affected)
          impact(
            before.status === referenceResolutionStatuses.unconfirmed
              ? renameImpactReasons.unconfirmed
              : sameResolution(before, after)
                ? renameImpactReasons.selectionRequired
                : renameImpactReasons.changedResolution,
          );
        continue;
      }
      if (selection && selected.path === doc.path) {
        if (affected) reject();
        continue;
      }
      const name =
        selected.path === target.path ? request.newName : selected.name;
      if (name === undefined) {
        reject();
        continue;
      }
      if (request.updateReferences === false) {
        if (
          !sameResolution(before, after) ||
          (selected.path === target.path && target.name !== request.newName)
        )
          impact(renameImpactReasons.referencesDisabled);
        continue;
      }
      const proposed = resolveReference(simulated, { name }, doc.path);
      if (
        proposed.status !==
          (selected.path === doc.path
            ? referenceResolutionStatuses.self
            : referenceResolutionStatuses.resolved) ||
        proposed.target?.path !== selected.path
      ) {
        impact(renameImpactReasons.unrepresentable);
        continue;
      }
      const newText = referenceText(name, occurrence.section);
      if (newText === undefined) {
        if (affected) impact(renameImpactReasons.unrepresentable);
        continue;
      }
      if (newText !== occurrence.text)
        changes.push({
          path: doc.path,
          fieldPath: [...occurrence.fieldPath],
          offsetRange: { ...occurrence.offsetRange },
          range: occurrence.range,
          oldText: occurrence.text,
          newText,
          targetPath: selected.path,
          candidates: before.candidates,
          occurrenceIndex,
        });
    }
  for (const owner of parentOwners) {
    const ownerParsed = owner.observation.parsed;
    if (!ownerParsed.success)
      return {
        ...initial,
        blockingReason: renameBlockingReasons.targetUnavailable,
      };
    for (const [position, name] of (owner.parent ?? []).entries()) {
      if (name !== target.name) continue;
      const parentPath = [...documentFields.parent, position];
      const parentRange = getStringRange(ownerParsed, parentPath, {
        start: 0,
        end: name.length,
      });
      const parentStart = parentRange
        ? offsetToPosition(ownerParsed.source, parentRange.start)
        : undefined;
      const parentEnd = parentRange
        ? offsetToPosition(ownerParsed.source, parentRange.end)
        : undefined;
      if (!parentRange || !parentStart || !parentEnd)
        return {
          ...initial,
          blockingReason: renameBlockingReasons.targetUnavailable,
        };
      changes.push({
        path: owner.path,
        fieldPath: parentPath,
        offsetRange: parentRange,
        range: { start: parentStart, end: parentEnd },
        oldText: name,
        newText: request.newName,
        targetPath: target.path,
        candidates: [candidate(target)],
      });
    }
  }
  if (rejectedSelections.length)
    return {
      ...initial,
      impacts,
      invalidSelections: rejectedSelections,
      blockingReason: renameBlockingReasons.invalidSelection,
    };
  changes.sort(
    /** 경로와 실제 원문 offset 순서로 수정안을 정렬한다. */ (a, b) =>
      a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : a.offsetRange.start - b.offsetRange.start,
  );
  return {
    ...initial,
    status: impacts.length
      ? renamePlanStatuses.unresolved
      : renamePlanStatuses.ready,
    changes,
    impacts,
  };
}

/** 참조 구성 안의 콜론을 구분자와 구분되도록 `\:`로 쓴다. */
function encodeColon(value: string): string {
  return value.replace(/:/gu, '\\:');
}
/**
 * 섹션 이름 변경의 새 이름이 쓸 수 없는 이름인지 확인한다.
 * 비어 있거나 `_`로 시작하거나 대괄호를 포함하면 쓸 수 없다.
 */
function invalidSectionName(name: string): boolean {
  return !nonblank(name) || name.startsWith('_') || /[\[\]]/u.test(name);
}
/**
 * 섹션 이름 변경 선택이 가리키는 등장이 있고 그 후보 안의 대상인지 검사해 잘못된 선택을 모은다.
 */
function invalidSectionSelections(
  catalog: Catalog,
  selections: readonly RenameSelection[],
): RenameSelection[] {
  return selections.filter(
    /** 존재하지 않는 등장·리터럴·후보 밖 대상·중복 선택을 임의로 무시하지 않는다. */ (
      selection,
      index,
    ) => {
      const item = catalog.documents.get(selection.sourcePath)?.occurrences[
        selection.occurrenceIndex
      ];
      return (
        !Number.isInteger(selection.occurrenceIndex) ||
        selection.occurrenceIndex < 0 ||
        !item ||
        item.occurrence.syntax !== referenceSyntaxStatuses.valid ||
        !item.resolution.candidates.some(
          (c) => c.path === selection.targetPath,
        ) ||
        selections.some(
          (other, otherIndex) =>
            index !== otherIndex &&
            other.sourcePath === selection.sourcePath &&
            other.occurrenceIndex === selection.occurrenceIndex,
        )
      );
    },
  );
}
/**
 * 문서 하나의 최상위 섹션 이름을 바꾸는 수정안을 계산한다. 파일·입력·원문은 변경하지 않는다.
 * 섹션 키를 새 이름으로 바꾸고 그 문서의 그 섹션으로 확정된 모든 `[[문서:섹션]]`의 섹션 부분을 함께 고친다.
 * 섹션 부분만 고치므로 문서 이름 부분과 `:`는 원문 그대로다. 후보가 여럿이라 모호했던 참조는 선택을 따른다.
 * @param catalog 같은 스캔에서 만든 색인이다.
 * @param request 대상 문서 경로·바꿀 섹션·새 섹션 이름·선택이다.
 * @returns 문서 이름 변경과 같은 형태의 계획이다. oldName·newName은 섹션 이름이고 targetSection에 현재 섹션 이름이 담긴다.
 */
export function planSectionRename(
  catalog: Catalog,
  request: SectionRenameRequest,
): RenamePlan {
  const target = catalog.documents.get(request.targetPath);
  const initial: RenamePlan = {
    targetPath: request.targetPath,
    oldName: request.section,
    targetSection: request.section,
    newName: request.newName,
    status: renamePlanStatuses.blocked,
    changes: [],
    conflicts: [],
    impacts: [],
    invalidSelections: [],
  };
  const parsed = target?.observation.parsed;
  if (!target || target.name === undefined || !parsed?.success)
    return {
      ...initial,
      blockingReason: renameBlockingReasons.targetUnavailable,
    };
  if (invalidSectionName(request.newName))
    return { ...initial, blockingReason: renameBlockingReasons.invalidName };
  if (
    catalog.status !== scanStatuses.complete ||
    target.confirmation !== catalogConfirmations.confirmed
  )
    return { ...initial, blockingReason: renameBlockingReasons.unconfirmed };
  const sections = getSectionNames(parsed);
  if (!sections.includes(request.section))
    return {
      ...initial,
      blockingReason: renameBlockingReasons.sectionNotFound,
    };
  if (request.newName === request.section)
    return { ...initial, blockingReason: renameBlockingReasons.invalidName };
  if (sections.includes(request.newName))
    return {
      ...initial,
      conflicts: [{ candidates: [candidate(target)] }],
      blockingReason: renameBlockingReasons.sectionConflict,
    };
  const selections = request.selections ?? [];
  const invalidSelections = invalidSectionSelections(catalog, selections);
  if (invalidSelections.length)
    return {
      ...initial,
      invalidSelections,
      blockingReason: renameBlockingReasons.invalidSelection,
    };
  const keyRange = getSectionKeyRange(target, request.section);
  if (!keyRange)
    return {
      ...initial,
      blockingReason: renameBlockingReasons.targetUnavailable,
    };
  const unrepresentable: RenamePlan = {
    ...initial,
    blockingReason: renameBlockingReasons.unrepresentable,
  };
  if (referenceText(target.name, request.newName) === undefined)
    return unrepresentable;
  const changes: RenameChange[] = [
    {
      path: target.path,
      fieldPath: [request.section],
      offsetRange: keyRange.offsetRange,
      range: keyRange.range,
      oldText: request.section,
      newText: request.newName,
      targetPath: target.path,
      candidates: [candidate(target)],
      kind: renameChangeKinds.key,
    },
  ];
  const impacts: RenameImpact[] = [];
  const oldText = encodeColon(request.section);
  const newText = encodeColon(request.newName);
  for (const doc of catalog.documents.values())
    for (
      let occurrenceIndex = 0;
      occurrenceIndex < doc.occurrences.length;
      occurrenceIndex++
    ) {
      const item = doc.occurrences[occurrenceIndex];
      if (
        !item ||
        item.occurrence.syntax !== referenceSyntaxStatuses.valid ||
        item.occurrence.section !== request.section
      )
        continue;
      const occurrence = item.occurrence,
        before = item.resolution;
      const ambiguous = before.status === referenceResolutionStatuses.ambiguous;
      const confirmed =
        (before.status === referenceResolutionStatuses.resolved ||
          before.status === referenceResolutionStatuses.self) &&
        before.target?.path === target.path &&
        before.section === request.section;
      if (
        !confirmed &&
        !(ambiguous && before.candidates.some((c) => c.path === target.path))
      )
        continue;
      if (ambiguous) {
        const selection = selections.find(
          (s) =>
            s.sourcePath === doc.path && s.occurrenceIndex === occurrenceIndex,
        );
        if (!selection) {
          impacts.push({
            path: doc.path,
            occurrenceIndex,
            occurrence,
            before,
            after: before,
            reason: renameImpactReasons.selectionRequired,
          });
          continue;
        }
        if (selection.targetPath !== target.path) continue;
      }
      const docParsed = doc.observation.parsed;
      if (!docParsed.success) return unrepresentable;
      const part = getReferencePartRanges(docParsed, occurrence)?.section;
      const start = part
        ? offsetToPosition(docParsed.source, part.start)
        : undefined;
      const end = part
        ? offsetToPosition(docParsed.source, part.end)
        : undefined;
      if (!part || !start || !end || !occurrence.text.endsWith(`:${oldText}]]`))
        return unrepresentable;
      changes.push({
        path: doc.path,
        fieldPath: [...occurrence.fieldPath],
        offsetRange: part,
        range: { start, end },
        oldText,
        newText,
        targetPath: target.path,
        candidates: before.candidates,
        occurrenceIndex,
      });
    }
  changes.sort(
    /** 경로와 실제 원문 offset 순서로 수정안을 정렬한다. */ (a, b) =>
      a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : a.offsetRange.start - b.offsetRange.start,
  );
  return {
    ...initial,
    status: impacts.length
      ? renamePlanStatuses.unresolved
      : renamePlanStatuses.ready,
    changes,
    impacts,
  };
}
