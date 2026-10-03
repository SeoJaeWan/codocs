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
  getStringRange,
  offsetToPosition,
  parseYaml,
} from '../parser/index.js';
import { referenceSyntaxStatuses } from '../references/domain-values.js';
import type { ReferenceOccurrence } from '../references/index.js';
import { extractReferences } from '../references/index.js';
import { documentStatuses } from '../validator/domain-values.js';
import { documentFields, validateDocument } from '../validator/index.js';
import {
  catalogConfirmations,
  catalogFailureKinds,
  referenceResolutionStatuses,
  renameBlockingReasons,
  renameImpactReasons,
  renamePlanStatuses,
  scanStatuses,
  type CatalogConfirmation,
  type CatalogFailureKind,
  type ReferenceResolutionStatus,
  type RenameBlockingReason,
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
  domains: readonly string[];
  confirmation: CatalogConfirmation;
}
/** 후보마다 오류와 확인 상태를 함께 제공한다. */
export interface ReferenceCandidate extends CatalogIdentity {
  errors: readonly Diagnostic[];
}
/** 충돌의 모든 발견 경로와 해당 도메인 및 확인한 원문 범위를 추가하는 의미 진단이다. */
export interface CatalogDiagnostic extends Diagnostic<CatalogDiagnosticCode> {
  relatedPaths?: readonly string[];
  domain?: string;
  offsetRange?: OffsetRange;
}
/** 문법 오류와 이름 해석을 구분하며 불확실한 검색을 부재·성공으로 확정하지 않는다. */
export interface ReferenceResolution {
  status: ReferenceResolutionStatus;
  candidates: readonly ReferenceCandidate[];
  target?: ReferenceCandidate;
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
}
/** 경로를 유일 키로 사용하는 IO 없는 계산 결과다. 반환 컬렉션은 읽기 전용 계약이다. */
export interface Catalog {
  status: CatalogScan['status'];
  failures: readonly CatalogFailure[];
  documents: ReadonlyMap<string, CatalogDocument>;
  idPaths: ReadonlyMap<string, ReadonlySet<string>>;
  namePaths: ReadonlyMap<string, ReadonlySet<string>>;
  domainNamePaths: ReadonlyMap<
    string,
    ReadonlyMap<string, ReadonlySet<string>>
  >;
}
/** 공백만인 값은 확인 가능한 이름·ID·도메인으로 취급하지 않으며 정규화하지 않는다. */
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
  const name = data.name;
  const domains = Array.isArray(data.domains)
    ? data.domains.filter(nonblank)
    : [];
  return {
    path: observation.path,
    ...(observation.realPath !== undefined
      ? { realPath: observation.realPath }
      : {}),
    ...(nonblank(data.id) ? { id: data.id } : {}),
    ...(nonblank(name) ? { name } : {}),
    domains: [...new Set(domains)],
    confirmation,
  };
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
  [catalogDiagnosticCodes.missingReference]: {
    message: catalogDiagnosticMessages.missingReference,
    severity: diagnosticSeverities.error,
  },
  [catalogDiagnosticCodes.ambiguousReference]: {
    message: catalogDiagnosticMessages.ambiguousReference,
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
  [catalogDiagnosticCodes.deprecatedReference]: {
    message: catalogDiagnosticMessages.deprecatedReference,
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
  context?: { relatedPaths: readonly string[]; domain?: string },
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
    ...(context
      ? {
          relatedPaths: [...context.relatedPaths],
          ...(context.domain !== undefined ? { domain: context.domain } : {}),
        }
      : {}),
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
    domains: [...document.domains],
    confirmation: document.confirmation,
  };
}
/**
 * 도메인을 적은 참조의 후보를 그 도메인에 속한 문서에서만 찾는다.
 */
function findInDomain(
  catalog: Catalog,
  domain: string,
  name: string,
): ReadonlySet<string> | undefined {
  return catalog.domainNamePaths.get(domain)?.get(name);
}
/**
 * 도메인을 생략한 참조의 후보를 모든 도메인에서 찾는다.
 */
function findInAllDomains(
  catalog: Catalog,
  name: string,
): ReadonlySet<string> | undefined {
  return catalog.namePaths.get(name);
}
/**
 * 참조의 name과 도메인으로 후보 문서를 찾아 경로순으로 돌려준다.
 */
function findCandidates(
  catalog: Catalog,
  reference: { name: string; domain?: string },
): ReferenceCandidate[] {
  const paths =
    reference.domain === undefined
      ? findInAllDomains(catalog, reference.name)
      : findInDomain(catalog, reference.domain, reference.name);
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
 * 참조 하나가 가리키는 대상을 후보를 찾아 판단한다.
 */
export function resolveReference(
  catalog: Catalog,
  reference: { name: string; domain?: string },
  sourcePath?: string,
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
  if (target.path === sourcePath)
    return { status: referenceResolutionStatuses.self, candidates, target };
  return { status: referenceResolutionStatuses.resolved, candidates, target };
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
  const domainNamePaths = new Map<string, Map<string, Set<string>>>();
  for (const record of records) {
    const doc: CatalogDocument = {
      ...record,
      documentDiagnostics: record.documentDiagnostics.filter(
        (d) =>
          d.code !== catalogDiagnosticCodes.duplicateId &&
          d.code !== catalogDiagnosticCodes.duplicateName,
      ),
      diagnostics: [],
      occurrences: [],
      references: [],
      referencedBy: [],
    };
    documents.set(doc.path, doc);
    if (doc.id !== undefined) addPath(idPaths, doc.id, doc.path);
    if (doc.name !== undefined) {
      addPath(namePaths, doc.name, doc.path);
      for (const domain of doc.domains) {
        const names =
          domainNamePaths.get(domain) ?? new Map<string, Set<string>>();
        addPath(names, doc.name, doc.path);
        domainNamePaths.set(domain, names);
      }
    }
  }
  const catalog: Catalog = {
    status,
    failures: [...failures],
    documents,
    idPaths,
    namePaths,
    domainNamePaths,
  };
  /** 충돌의 모든 경로를 개별 진단한다. */
  function conflicts(
    paths: Set<string>,
    code:
      | typeof catalogDiagnosticCodes.duplicateId
      | typeof catalogDiagnosticCodes.duplicateName,
    domain?: string,
  ): void {
    if (paths.size < 2) return;
    for (const path of paths) {
      const doc = documents.get(path);
      if (doc) {
        const field = [
          code === catalogDiagnosticCodes.duplicateId
            ? documentFields.id
            : documentFields.name,
        ];
        documents.set(path, {
          ...doc,
          documentDiagnostics: [
            ...doc.documentDiagnostics,
            catalogDiagnostic(doc, code, field, undefined, {
              relatedPaths: [...paths].sort(),
              ...(domain !== undefined ? { domain } : {}),
            }),
          ],
        });
      }
    }
  }
  for (const paths of idPaths.values())
    conflicts(paths, catalogDiagnosticCodes.duplicateId);
  for (const [domain, names] of domainNamePaths)
    for (const paths of names.values())
      conflicts(paths, catalogDiagnosticCodes.duplicateName, domain);
  const backlinks = new Map<string, Set<string>>();
  for (const [path, doc] of documents) {
    const resolved = resolveDocumentReferences(catalog, doc);
    for (const target of resolved.references)
      addPath(backlinks, target.path, path);
    documents.set(path, resolved);
  }
  for (const [path, doc] of documents)
    documents.set(path, {
      ...doc,
      referencedBy: [...(backlinks.get(path) ?? [])].sort().flatMap((p) => {
        const d = documents.get(p);
        return d ? [linkIdentity(d)] : [];
      }),
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
): ReferenceResolution {
  return occurrence.syntax === referenceSyntaxStatuses.invalid
    ? { status: referenceResolutionStatuses.invalid, candidates: [] }
    : resolveReference(catalog, occurrence, sourcePath);
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
      const resolution = resolveOccurrence(catalog, occurrence, path);
      const key =
        resolution.status === referenceResolutionStatuses.missing
          ? catalogDiagnosticCodes.missingReference
          : resolution.status === referenceResolutionStatuses.ambiguous
            ? catalogDiagnosticCodes.ambiguousReference
            : resolution.status === referenceResolutionStatuses.self
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
        const target = catalog.documents.get(resolution.target.path);
        if (
          target?.observation.parsed.success &&
          target.observation.parsed.data.status === documentStatuses.deprecated
        )
          diagnostics.push(
            catalogDiagnostic(
              doc,
              catalogDiagnosticCodes.deprecatedReference,
              occurrence.fieldPath,
              occurrence,
            ),
          );
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
        [documentFields.id],
        undefined,
        {
          relatedPaths: [observation.path, ...conflicts].sort(),
        },
      ),
    );
  if (document.name !== undefined)
    for (const domain of document.domains) {
      const nameConflicts = [
        ...(catalog.domainNamePaths.get(domain)?.get(document.name) ?? []),
      ].filter((path) => path !== observation.path);
      if (nameConflicts.length)
        documentDiagnostics.push(
          catalogDiagnostic(
            document,
            catalogDiagnosticCodes.duplicateName,
            [documentFields.name],
            undefined,
            {
              relatedPaths: [observation.path, ...nameConflicts].sort(),
              domain,
            },
          ),
        );
    }
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
      });
    }
  return calculate(scan.status, scan.failures ?? [], [...records.values()]);
}

/** 모호한 후보 또는 명시 도메인을 사용자가 선택한 등장별 결정이다. */
export interface RenameSelection {
  sourcePath: string;
  occurrenceIndex: number;
  targetPath: string;
  domain?: string;
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
  occurrenceIndex?: number;
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
/** 같은 도메인의 새 이름 충돌은 종류를 가리지 않고 변경을 차단한다. */
export interface RenameConflict {
  domain: string;
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
}
/** 새 표기를 공개 문법 추출로 round trip 검증한다. 표현 불가능한 구성은 추측하지 않는다. */
function referenceText(name: string, domain?: string): string | undefined {
  /** 구성 내부 콜론을 구분자와 구분한다. */
  const encode = (value: string): string => value.replace(/:/gu, '\\:');
  const text = `[[${domain === undefined ? '' : `${encode(domain)}:`}${encode(name)}]]`;
  if (
    name.includes('[') ||
    name.includes(']') ||
    domain?.includes('[') ||
    domain?.includes(']')
  )
    return undefined;
  const extracted = extractReferences(
    parseYaml(`definition: ${JSON.stringify(text)}\n`),
  );
  const occurrence = extracted.occurrences[0];
  return extracted.occurrences.length === 1 &&
    occurrence?.syntax === referenceSyntaxStatuses.valid &&
    occurrence.name === name &&
    occurrence.domain === domain
    ? text
    : undefined;
}
/** 전체 후보가 같은지 판별하여 무선택 모호 참조의 의미 변화도 보고한다. */
function sameResolution(
  before: ReferenceResolution,
  after: ReferenceResolution,
): boolean {
  return (
    before.status === after.status &&
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
  const conflicts: RenameConflict[] = target.domains.flatMap(
    /** 모든 소속 도메인의 cross-kind 새 이름 충돌을 계산한다. */ (domain) => {
      const resolution = resolveReference(catalog, {
        name: request.newName,
        domain,
      });
      const candidates = resolution.candidates.filter(
        (c) => c.path !== target.path,
      );
      return candidates.length ? [{ domain, candidates }] : [];
    },
  );
  if (conflicts.length)
    return {
      ...initial,
      conflicts,
      blockingReason: renameBlockingReasons.nameConflict,
    };
  const simulated = calculate(
    catalog.status,
    catalog.failures,
    [...catalog.documents.values()].map((doc) =>
      doc.path === target.path ? { ...doc, name: request.newName } : doc,
    ),
  );
  const changes: RenameChange[] = [],
    impacts: RenameImpact[] = [];
  const fieldPath = [documentFields.name];
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
      const after = resolveReference(simulated, occurrence, doc.path);
      const selection = request.selections?.find(
        (s) =>
          s.sourcePath === doc.path && s.occurrenceIndex === occurrenceIndex,
      );
      const selected = selection
        ? before.candidates.find((c) => c.path === selection.targetPath)
        : before.status === referenceResolutionStatuses.resolved
          ? before.target
          : undefined;
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
      if (selection && !selected) {
        impact(renameImpactReasons.invalidSelection);
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
      if (selected.path === doc.path) {
        if (affected) impact(renameImpactReasons.invalidSelection);
        continue;
      }
      const name =
        selected.path === target.path ? request.newName : selected.name;
      if (name === undefined) {
        impact(renameImpactReasons.invalidSelection);
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
      let domain = occurrence.domain;
      if (selection?.domain !== undefined) {
        if (
          !selected.domains.includes(selection.domain) ||
          (domain !== undefined && domain !== selection.domain)
        ) {
          impact(renameImpactReasons.invalidSelection);
          continue;
        }
        if (domain === undefined) domain = selection.domain;
      }
      const proposed = resolveReference(
        simulated,
        { name, ...(domain !== undefined ? { domain } : {}) },
        doc.path,
      );
      if (
        proposed.status !== referenceResolutionStatuses.resolved ||
        proposed.target?.path !== selected.path
      ) {
        if (domain !== undefined) {
          impact(renameImpactReasons.invalidSelection);
          continue;
        }
        if (selected.domains.length !== 1) {
          impact(renameImpactReasons.domainRequired);
          continue;
        }
        domain = selected.domains[0];
        const qualified = resolveReference(
          simulated,
          { name, ...(domain !== undefined ? { domain } : {}) },
          doc.path,
        );
        if (
          qualified.status !== referenceResolutionStatuses.resolved ||
          qualified.target?.path !== selected.path
        ) {
          impact(renameImpactReasons.invalidSelection);
          continue;
        }
      }
      const newText = referenceText(name, domain);
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
