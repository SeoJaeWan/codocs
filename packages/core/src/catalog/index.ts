import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
} from '../diagnostics/index.js';
import type {
  CatalogDiagnosticCode,
  Diagnostic,
  FieldPath,
  OffsetRange,
  SourceRange,
} from '../diagnostics/index.js';
import {
  getStringRange,
  offsetToPosition,
  parseYaml,
} from '../parser/index.js';
import type { YamlParseResult } from '../parser/index.js';
import { extractReferences } from '../references/index.js';
import type { ReferenceOccurrence } from '../references/index.js';
import { validateDocument } from '../validator/index.js';

/** 로더가 확인한 발견 경로와 파싱 결과다. 실경로는 진단 정보일 뿐 키가 아니다. */
export interface CatalogObservation {
  path: string;
  realPath?: string;
  parsed: YamlParseResult;
}
/** IO 계층이 제공하는 실패 범위다. unknown은 범위를 확인하지 못한 실패다. */
export type CatalogFailure =
  | {
      kind: 'file' | 'folder';
      path: string;
      diagnostics?: readonly Diagnostic<string>[];
    }
  | { kind: 'unknown'; diagnostics?: readonly Diagnostic<string>[] };
/** 전체/부분/실패 스캔의 중립 관측이다. 실패 시 observations는 채택하지 않는다. */
export interface CatalogScan {
  status: 'complete' | 'partial' | 'failed';
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
  confirmation: 'confirmed' | 'unconfirmed';
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
  status:
    'invalid' | 'missing' | 'ambiguous' | 'self' | 'unconfirmed' | 'resolved';
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
/** 원문에서 확인한 필드 또는 등장 위치만 진단에 붙인다. */
function catalogDiagnostic(
  document: CatalogDocument,
  key: keyof typeof catalogDiagnosticCodes,
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
    code: catalogDiagnosticCodes[key],
    severity:
      key === 'unconfirmedReference' || key === 'referenceTargetError'
        ? 'warning'
        : 'error',
    message: catalogDiagnosticMessages[key],
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
    errors: document.documentDiagnostics.filter((d) => d.severity === 'error'),
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
/** 전체 또는 지정 도메인에서 정확 비교한다. 출처 도메인을 우선하지 않는다. */
export function resolveReference(
  catalog: Catalog,
  reference: { name: string; domain?: string },
  sourcePath?: string,
): ReferenceResolution {
  const paths =
    reference.domain === undefined
      ? catalog.namePaths.get(reference.name)
      : catalog.domainNamePaths.get(reference.domain)?.get(reference.name);
  const candidates = [...(paths ?? [])].sort().flatMap((path) => {
    const doc = catalog.documents.get(path);
    return doc ? [candidate(doc)] : [];
  });
  if (
    catalog.status !== 'complete' ||
    candidates.some((c) => c.confirmation === 'unconfirmed')
  )
    return { status: 'unconfirmed', candidates };
  if (!candidates.length) return { status: 'missing', candidates };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  const target = candidates[0];
  if (!target) return { status: 'missing', candidates };
  if (target.path === sourcePath) return { status: 'self', candidates, target };
  return { status: 'resolved', candidates, target };
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
    key: 'duplicateId' | 'duplicateName',
    domain?: string,
  ): void {
    if (paths.size < 2) return;
    for (const path of paths) {
      const doc = documents.get(path);
      if (doc) {
        const field = [key === 'duplicateId' ? 'id' : 'name'];
        documents.set(path, {
          ...doc,
          documentDiagnostics: [
            ...doc.documentDiagnostics,
            catalogDiagnostic(doc, key, field, undefined, {
              relatedPaths: [...paths].sort(),
              ...(domain !== undefined ? { domain } : {}),
            }),
          ],
        });
      }
    }
  }
  for (const paths of idPaths.values()) conflicts(paths, 'duplicateId');
  for (const [domain, names] of domainNamePaths)
    for (const paths of names.values())
      conflicts(paths, 'duplicateName', domain);
  const backlinks = new Map<string, Set<string>>();
  for (const [path, doc] of documents) {
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
        const resolution: ReferenceResolution =
          occurrence.syntax === 'invalid'
            ? { status: 'invalid', candidates: [] }
            : resolveReference(catalog, occurrence, path);
        const key =
          resolution.status === 'missing'
            ? 'missingReference'
            : resolution.status === 'ambiguous'
              ? 'ambiguousReference'
              : resolution.status === 'self'
                ? 'selfReference'
                : resolution.status === 'unconfirmed'
                  ? 'unconfirmedReference'
                  : undefined;
        if (key)
          diagnostics.push(
            catalogDiagnostic(doc, key, occurrence.fieldPath, occurrence),
          );
        if (
          resolution.status === 'resolved' &&
          resolution.target &&
          doc.confirmation === 'confirmed'
        ) {
          links.add(resolution.target.path);
          addPath(backlinks, resolution.target.path, path);
          if (resolution.target.errors.length)
            diagnostics.push(
              catalogDiagnostic(
                doc,
                'referenceTargetError',
                occurrence.fieldPath,
                occurrence,
              ),
            );
        }
        return { occurrence, resolution };
      },
    );
    documents.set(path, {
      ...doc,
      diagnostics,
      occurrences,
      references: [...links].sort().flatMap((p) => {
        const d = documents.get(p);
        return d ? [linkIdentity(d)] : [];
      }),
    });
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
/** complete만 삭제 근거로 삼아 구축·갱신한다. partial/failed의 미관측 이전 기록은 미확인으로 보존한다. */
export function buildCatalog(scan: CatalogScan, previous?: Catalog): Catalog {
  const records = new Map<string, CatalogDocument>();
  if (scan.status !== 'complete')
    for (const [path, doc] of previous?.documents ?? [])
      records.set(path, { ...doc, confirmation: 'unconfirmed' });
  if (scan.status !== 'failed')
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
        ...identity(observation, 'confirmed'),
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
  reason:
    | 'selection_required'
    | 'domain_required'
    | 'invalid_selection'
    | 'references_disabled'
    | 'unconfirmed'
    | 'unrepresentable'
    | 'changed_resolution';
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
  status: 'ready' | 'unresolved' | 'blocked';
  changes: readonly RenameChange[];
  conflicts: readonly RenameConflict[];
  impacts: readonly RenameImpact[];
  invalidSelections: readonly RenameSelection[];
  blockingReason?:
    | 'target_unavailable'
    | 'invalid_name'
    | 'name_conflict'
    | 'unconfirmed'
    | 'invalid_selection';
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
    occurrence?.syntax === 'valid' &&
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
    status: 'blocked',
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
    return { ...initial, blockingReason: 'target_unavailable' };
  if (!nonblank(request.newName))
    return { ...initial, blockingReason: 'invalid_name' };
  if (catalog.status !== 'complete' || target.confirmation !== 'confirmed')
    return { ...initial, blockingReason: 'unconfirmed' };
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
        item.occurrence.syntax !== 'valid' ||
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
      blockingReason: 'invalid_selection',
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
    return { ...initial, conflicts, blockingReason: 'name_conflict' };
  const simulated = calculate(
    catalog.status,
    catalog.failures,
    [...catalog.documents.values()].map((doc) =>
      doc.path === target.path ? { ...doc, name: request.newName } : doc,
    ),
  );
  const changes: RenameChange[] = [],
    impacts: RenameImpact[] = [];
  const fieldPath = ['name'];
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
    return { ...initial, blockingReason: 'target_unavailable' };
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
      if (!item || item.occurrence.syntax !== 'valid') continue;
      const occurrence = item.occurrence,
        before = item.resolution;
      const after = resolveReference(simulated, occurrence, doc.path);
      const selection = request.selections?.find(
        (s) =>
          s.sourcePath === doc.path && s.occurrenceIndex === occurrenceIndex,
      );
      const selected = selection
        ? before.candidates.find((c) => c.path === selection.targetPath)
        : before.status === 'resolved'
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
        impact('invalid_selection');
        continue;
      }
      const affected =
        before.candidates.some((c) => c.path === target.path) ||
        after.candidates.some((c) => c.path === target.path);
      if (!affected && !selection) continue;
      if (!selected) {
        if (affected)
          impact(
            before.status === 'unconfirmed'
              ? 'unconfirmed'
              : sameResolution(before, after)
                ? 'selection_required'
                : 'changed_resolution',
          );
        continue;
      }
      if (selected.path === doc.path) {
        if (affected) impact('invalid_selection');
        continue;
      }
      const name =
        selected.path === target.path ? request.newName : selected.name;
      if (name === undefined) {
        impact('invalid_selection');
        continue;
      }
      if (request.updateReferences === false) {
        if (
          !sameResolution(before, after) ||
          (selected.path === target.path && target.name !== request.newName)
        )
          impact('references_disabled');
        continue;
      }
      let domain = occurrence.domain;
      if (selection?.domain !== undefined) {
        if (
          !selected.domains.includes(selection.domain) ||
          (domain !== undefined && domain !== selection.domain)
        ) {
          impact('invalid_selection');
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
        proposed.status !== 'resolved' ||
        proposed.target?.path !== selected.path
      ) {
        if (domain !== undefined) {
          impact('invalid_selection');
          continue;
        }
        if (selected.domains.length !== 1) {
          impact('domain_required');
          continue;
        }
        domain = selected.domains[0];
        const qualified = resolveReference(
          simulated,
          { name, ...(domain !== undefined ? { domain } : {}) },
          doc.path,
        );
        if (
          qualified.status !== 'resolved' ||
          qualified.target?.path !== selected.path
        ) {
          impact('invalid_selection');
          continue;
        }
      }
      const newText = referenceText(name, domain);
      if (newText === undefined) {
        if (affected) impact('unrepresentable');
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
    status: impacts.length ? 'unresolved' : 'ready',
    changes,
    impacts,
  };
}
