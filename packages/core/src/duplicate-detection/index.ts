import type {
  FieldPath,
  OffsetRange,
  SourceRange,
} from '../diagnostics/index.js';
import type { YamlParseResult } from '../parser/index.js';
import { getStringRange, offsetToPosition } from '../parser/index.js';
import { codocsKey } from '../validator/index.js';
import { duplicateDetectionConfig } from './config.js';
import {
  duplicateComparisonStatuses,
  duplicateMatchKinds,
  duplicateSkipReasons,
  type DuplicateComparisonStatus,
  type DuplicateExclusionReason,
  type DuplicateMatchKind,
  type DuplicateSkipReason,
} from './domain-values.js';
import type { DuplicateExclusionCounts, PreparedSegment } from './segments.js';
import { buildSegments, emptyExclusionCounts } from './segments.js';
import { jaccard, jaccardCanReach, orderedSimilarity } from './similarity.js';
export * from './domain-values.js';
export { duplicateDetectionConfig } from './config.js';
export type { DuplicateConfigVersion } from './config.js';
export type { DuplicateExclusionCounts, PreparedSegment } from './segments.js';

/** 이미 파싱한 문서 한 건이다. 저장 문서는 catalog의 observation.parsed를, 초안은 호출자가 한 번 파싱한 결과를 넘긴다. */
export interface DuplicateDocumentInput {
  /** 결과의 경로 구분에 쓰는 문서 경로다. */
  path: string;
  /** 알고 있는 문서 ID다. 충돌 여부와 무관하게 경로·필드·위치로 구분하므로 결과 표시용이다. */
  id?: string;
  /** 이 파싱 결과가 만들어진 원문의 revision이다. */
  revision: string;
  /** core는 원문을 다시 파싱하지 않고 이 결과의 strings와 source만 읽는다. */
  parsed: YamlParseResult;
}

/** 비교 대상 필드 한 개의 준비 결과다. */
export interface PreparedDuplicateField {
  /** section 이름 하나로 구성한 필드 경로다. */
  fieldPath: FieldPath;
  /** 해석 문자열이다. 구간 범위는 이 문자열의 UTF-16 index다. */
  value: string;
  /** 문단과 1~3문장 구간을 정규화한 비교 구간이다. */
  segments: readonly PreparedSegment[];
}

/** 문서별 준비 결과다. path·revision·configVersion으로 식별하며 캐시는 호출자가 소유한다. */
export interface PreparedDuplicateDocument {
  path: string;
  id?: string;
  revision: string;
  /** 준비에 사용한 설정 버전이다. */
  configVersion: number;
  /** 비교에 쓰지 못한 이유다. 없으면 준비를 마친 문서다. */
  skipReason?: DuplicateSkipReason;
  /** 위치 계산에 쓰는 입력 파싱 결과다. 변경하지 않는다. */
  parsed: YamlParseResult;
  fields: readonly PreparedDuplicateField[];
  /** 제외한 줄·구간 수다. */
  exclusions: DuplicateExclusionCounts;
}

/** 후보 한쪽의 발생 위치다. */
export interface DuplicateLocation {
  path: string;
  id?: string;
  revision: string;
  fieldPath: FieldPath;
  /** 해석 문자열에서 잘라 낸 구절이다. 정규화하지 않았다. */
  passage: string;
  /** 해석 문자열 안의 범위다. */
  valueRange: OffsetRange;
  /** 파서 문자열 매핑으로 확인한 원문 UTF-16 범위다. 확인하지 못하면 없다. */
  offsetRange?: OffsetRange;
  /** offsetRange의 0 기반 줄 좌표다. 기존 core 좌표 규약을 따르며 확인하지 못하면 없다. */
  range?: SourceRange;
}

/** 두 구절의 링크 목적지 비교 정보다. 점수에는 반영하지 않는다. */
export interface DuplicateLinkDestinations {
  a: readonly string[];
  b: readonly string[];
  /** 목적지 목록이 다르면 true다. */
  differ: boolean;
}

/** 반복 후보 한 쌍이다. 유사 후보는 쌍별 근거를 유지하며 전이적으로 묶지 않는다. */
export interface DuplicateCandidate {
  kind: DuplicateMatchKind;
  a: DuplicateLocation;
  b: DuplicateLocation;
  scores: {
    /** 문자 4-gram Jaccard다. */
    jaccard: number;
    /** 최장 공통 부분 수열 길이의 두 배를 두 길이의 합으로 나눈 값이다. */
    ordered: number;
  };
  linkDestinations: DuplicateLinkDestinations;
  /** 후보를 만든 설정 버전이다. */
  configVersion: number;
  /** 완전 일치 후보가 속한 exactGroups의 index다. 유사 후보에는 없다. */
  groupIndex?: number;
}

/** 같은 구절이 놓인 모든 위치의 묶음이다. 완전 일치에만 쓴다. */
export interface DuplicateExactGroup {
  /** 정규화한 비교 문자열이다. */
  text: string;
  /** 서로 다른 발생 위치 목록이다. */
  occurrences: readonly DuplicateLocation[];
}

/** 비교하지 못한 입력과 그 이유다. */
export interface DuplicateSkippedInput {
  path: string;
  id?: string;
  revision: string;
  reason: DuplicateSkipReason;
}

/** 비교 진행 상황이다. 단위는 구간 쌍 한 개다. */
export interface DuplicateComparisonProgress {
  status: DuplicateComparisonStatus;
  completedUnits: number;
  totalUnits: number;
}

/** 지금까지 비교한 결과다. status가 partial이면 이후 단계에서 후보가 늘 수 있다. */
export interface DuplicateDetectionResult extends DuplicateComparisonProgress {
  configVersion: number;
  candidates: readonly DuplicateCandidate[];
  exactGroups: readonly DuplicateExactGroup[];
  skippedInputs: readonly DuplicateSkippedInput[];
  /** 모든 문서에서 제외한 줄·구간 수의 합이다. */
  exclusions: DuplicateExclusionCounts;
}

/** 필드 문자열 안의 비교 구간 한 개와 그 소속이다. */
interface Member {
  /** 비교에 참여한 필드의 전체 순번이다. */
  fieldId: number;
  reference: FieldRef;
  segment: PreparedSegment;
}

/** 비교 문자열과 링크 목적지가 같은 구간의 묶음이다. 한 번만 비교한다. */
interface SegmentClass {
  key: string;
  text: string;
  grams: ReadonlySet<string>;
  members: Member[];
  points?: string[];
}

/** 비교 필드의 소속 문서와 준비 결과다. */
interface FieldRef {
  document: PreparedDuplicateDocument;
  field: PreparedDuplicateField;
}

/** 병합 전 일치 한 쌍이다. a는 항상 필드 순번과 시작 위치가 앞선다. */
interface RawMatch {
  a: Member;
  b: Member;
  classA: SegmentClass;
  classB: SegmentClass;
  kind: DuplicateMatchKind;
  jaccard: number;
  ordered: number;
}

/** 필드 문자열 안의 두 범위가 겹치는지 확인한다. */
function overlaps(left: OffsetRange, right: OffsetRange): boolean {
  return left.start < right.end && right.start < left.end;
}

/** 두 구간이 같은 원문 위치를 가리키는지 확인한다. 같은 필드에서 범위가 겹칠 때만 참이다. */
function sameLocation(left: Member, right: Member): boolean {
  return (
    left.fieldId === right.fieldId &&
    overlaps(left.segment.range, right.segment.range)
  );
}

/** 필드 순번과 시작 위치로 앞선 쪽을 a에 두어 같은 쌍이 한 방향으로만 나오게 한다. */
function orderMembers(left: Member, right: Member): [a: Member, b: Member] {
  const leftFirst =
    left.fieldId !== right.fieldId
      ? left.fieldId < right.fieldId
      : left.segment.range.start <= right.segment.range.start;
  return leftFirst ? [left, right] : [right, left];
}

/** 비교 필드인지 확인한다. `_codocs`를 제외한 루트 section 문자열만 대상이다. */
function isComparedField(fieldPath: FieldPath): boolean {
  return fieldPath.length === 1 && fieldPath[0] !== codocsKey;
}

/** 준비 결과를 path·revision·설정 버전으로 식별하는 캐시 키다. */
export function duplicatePreparationKey(
  document: Pick<DuplicateDocumentInput, 'path' | 'revision'>,
  configVersion: number = duplicateDetectionConfig.version,
): string {
  return JSON.stringify([document.path, document.revision, configVersion]);
}

/**
 * 문서 한 건의 section 본문을 비교 구간으로 준비한다. 다른 문서와 무관하므로 결과를 캐시해 재사용할 수 있다.
 * 파싱에 실패한 입력에서는 본문을 추측하지 않고 skipReason만 남긴다. 입력은 변경하지 않는다.
 * @param input 이미 파싱한 문서다.
 * @returns 정규화한 구간을 가진 준비 결과다.
 */
export function prepareDuplicateDocument(
  input: DuplicateDocumentInput,
): PreparedDuplicateDocument {
  const exclusions = emptyExclusionCounts();
  const base = {
    path: input.path,
    ...(input.id !== undefined ? { id: input.id } : {}),
    revision: input.revision,
    configVersion: duplicateDetectionConfig.version,
    parsed: input.parsed,
    exclusions,
  };
  if (!input.parsed.success)
    return {
      ...base,
      skipReason: duplicateSkipReasons.parseFailed,
      fields: [],
    };
  const fields: PreparedDuplicateField[] = [];
  for (const mapping of input.parsed.strings)
    if (isComparedField(mapping.fieldPath))
      fields.push({
        fieldPath: mapping.fieldPath,
        value: mapping.value,
        segments: buildSegments(mapping.value, exclusions),
      });
  return { ...base, fields };
}

/** 구간의 비교 문자열과 링크 목적지로 같은 묶음 키를 만든다. */
function classKey(segment: PreparedSegment): string {
  return `${segment.text}\u0000${segment.destinations.join('\u0001')}`;
}

/** 두 목적지 목록이 같은 순서로 같은지 확인한다. */
function sameDestinations(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((destination, index) => destination === right[index])
  );
}

/** 완전 일치를 먼저 채택하도록 종류의 순위를 정한다. */
function kindRank(match: RawMatch): number {
  return match.kind === duplicateMatchKinds.exact ? 0 : 1;
}

/** 일치가 덮는 해석 문자열 길이의 합이다. */
function coverage(match: RawMatch): number {
  return (
    match.a.segment.range.end -
    match.a.segment.range.start +
    (match.b.segment.range.end - match.b.segment.range.start)
  );
}

/** 병합 우선순위다. 완전 일치, 넓은 범위, 높은 점수, 앞선 위치 순으로 먼저 채택한다. */
function comparePriority(left: RawMatch, right: RawMatch): number {
  return (
    kindRank(left) - kindRank(right) ||
    coverage(right) - coverage(left) ||
    right.jaccard - left.jaccard ||
    right.ordered - left.ordered ||
    left.a.segment.range.start - right.a.segment.range.start ||
    left.b.segment.range.start - right.b.segment.range.start
  );
}

/** 구간 쌍을 예산 단위로 나눠 비교하는 작업이다. 시간 측정·양보·취소는 호출자가 step 호출 사이에서 정한다. */
export class DuplicateComparison {
  private readonly fields: FieldRef[] = [];
  private readonly classes: SegmentClass[] = [];
  private readonly skipped: DuplicateSkippedInput[] = [];
  private readonly matches: RawMatch[] = [];
  private readonly exclusions = emptyExclusionCounts();
  private readonly exactClasses: number[] = [];
  private readonly totalUnits: number;
  private completedUnits = 0;
  private exactCursor = { classIndex: 0, left: 0, right: 1 };
  /** 각 묶음의 접두 4-gram이다. 전역 희귀도 순으로 앞쪽만 남긴다. */
  private readonly prefixes: string[][] = [];
  /** 접두 4-gram에서 그 gram을 접두로 가진 묶음 순번(오름차순)으로의 역색인이다. */
  private readonly postings = new Map<string, number[]>();
  /** 같은 탐색에서 후보 묶음을 한 번만 평가하기 위한 표식이다. */
  private readonly seen: Int32Array;
  private similarCursor = 0;

  /** 준비 결과에서 필드와 같은 구간의 묶음을 만든다. 구간 쌍 비교는 하지 않는다. */
  constructor(documents: readonly PreparedDuplicateDocument[]) {
    const byKey = new Map<string, SegmentClass>();
    for (const document of documents) {
      const reason =
        document.skipReason ??
        (document.configVersion !== duplicateDetectionConfig.version
          ? duplicateSkipReasons.configVersionMismatch
          : undefined);
      if (reason !== undefined) {
        this.skipped.push({
          path: document.path,
          ...(document.id !== undefined ? { id: document.id } : {}),
          revision: document.revision,
          reason,
        });
        continue;
      }
      for (const key of Object.keys(
        document.exclusions,
      ) as DuplicateExclusionReason[])
        this.exclusions[key] += document.exclusions[key];
      for (const field of document.fields) {
        const fieldId = this.fields.length;
        const reference = { document, field };
        this.fields.push(reference);
        for (const segment of field.segments) {
          const key = classKey(segment);
          let segmentClass = byKey.get(key);
          if (!segmentClass) {
            segmentClass = {
              key,
              text: segment.text,
              grams: segment.grams,
              members: [],
            };
            byKey.set(key, segmentClass);
            this.classes.push(segmentClass);
          }
          segmentClass.members.push({ fieldId, reference, segment });
        }
      }
    }
    let total = 0;
    this.classes.forEach(
      /** 두 구간 이상인 묶음의 완전 일치 비교 수를 센다. */ (
        segmentClass,
        index,
      ) => {
        const count = segmentClass.members.length;
        if (count < 2) return;
        this.exactClasses.push(index);
        total += (count * (count - 1)) / 2;
      },
    );
    this.buildPrefixIndex();
    this.seen = new Int32Array(this.classes.length).fill(-1);
    // 유사 비교의 단위는 묶음 하나의 탐색이다. 전체 묶음 쌍을 세지 않는다.
    this.totalUnits = total + this.classes.length;
  }

  /**
   * 접두 필터용 역색인을 만든다. Jaccard가 t 이상이면 두 집합의 접두(길이 n-ceil(t*n)+1, 같은 전역 순서)는
   * 반드시 하나 이상 공유하므로 접두를 공유하지 않는 쌍은 기준을 넘을 수 없다. 부동소수점 오차에는 접두를 늘리는 쪽으로 대비한다.
   */
  private buildPrefixIndex(): void {
    const frequency = new Map<string, number>();
    for (const segmentClass of this.classes)
      for (const gram of segmentClass.grams)
        frequency.set(gram, (frequency.get(gram) ?? 0) + 1);
    this.classes.forEach(
      /** 묶음의 4-gram을 희귀한 순으로 정렬해 접두를 색인한다. */ (
        segmentClass,
        index,
      ) => {
        const ordered = [...segmentClass.grams].sort(
          (left, right) =>
            (frequency.get(left) ?? 0) - (frequency.get(right) ?? 0) ||
            (left < right ? -1 : left > right ? 1 : 0),
        );
        const size = ordered.length;
        const length = Math.min(
          size,
          size -
            Math.ceil(duplicateDetectionConfig.minJaccard * size - 1e-9) +
            1,
        );
        const prefix = ordered.slice(0, Math.max(1, length));
        this.prefixes.push(prefix);
        for (const gram of prefix) {
          const list = this.postings.get(gram);
          if (list) list.push(index);
          else this.postings.set(gram, [index]);
        }
      },
    );
  }

  /** 현재 진행 상황이다. */
  getProgress(): DuplicateComparisonProgress {
    return {
      status:
        this.completedUnits >= this.totalUnits
          ? duplicateComparisonStatuses.complete
          : duplicateComparisonStatuses.partial,
      completedUnits: this.completedUnits,
      totalUnits: this.totalUnits,
    };
  }

  /**
   * 구간 쌍 최대 budget개를 비교하고 진행 상황을 반환한다. 완료 뒤에는 아무것도 하지 않는다.
   * @param budget 이번 호출에서 비교할 구간 쌍의 수다. 1보다 작거나 숫자가 아니면 1로 본다. Infinity면 끝까지 진행한다.
   * @returns 진행 후의 상태다.
   */
  step(budget: number): DuplicateComparisonProgress {
    let remaining = Number.isNaN(budget) ? 1 : Math.max(1, Math.floor(budget));
    while (remaining > 0 && this.completedUnits < this.totalUnits) {
      if (this.exactCursor.classIndex < this.exactClasses.length)
        this.compareExactPair();
      else this.compareSimilarPair();
      this.completedUnits++;
      remaining--;
    }
    return this.getProgress();
  }

  /** 같은 묶음 안의 구간 쌍 하나를 완전 일치로 기록하고 커서를 옮긴다. */
  private compareExactPair(): void {
    const cursor = this.exactCursor;
    const segmentClass =
      this.classes[this.exactClasses[cursor.classIndex] ?? 0];
    const left = segmentClass?.members[cursor.left];
    const right = segmentClass?.members[cursor.right];
    if (segmentClass && left && right && !sameLocation(left, right)) {
      const [a, b] = orderMembers(left, right);
      this.matches.push({
        a,
        b,
        classA: segmentClass,
        classB: segmentClass,
        kind: duplicateMatchKinds.exact,
        jaccard: 1,
        ordered: 1,
      });
    }
    cursor.right++;
    if (cursor.right >= (segmentClass?.members.length ?? 0)) {
      cursor.left++;
      cursor.right = cursor.left + 1;
      if (cursor.left + 1 >= (segmentClass?.members.length ?? 0)) {
        cursor.classIndex++;
        cursor.left = 0;
        cursor.right = 1;
      }
    }
  }

  /** 묶음 하나의 접두를 공유하는 뒤쪽 묶음만 골라 유사도를 계산한다. 접두를 공유하지 않는 쌍은 기준을 넘을 수 없어 건너뛴다. */
  private compareSimilarPair(): void {
    const index = this.similarCursor++;
    const left = this.classes[index];
    if (!left) return;
    for (const gram of this.prefixes[index] ?? []) {
      for (const other of this.postings.get(gram) ?? []) {
        if (other <= index || this.seen[other] === index) continue;
        this.seen[other] = index;
        const right = this.classes[other];
        if (right) this.recordSimilar(left, right);
      }
    }
  }

  /** 두 묶음이 유사 기준을 넘으면 구간 조합별 후보를 기록한다. */
  private recordSimilar(left: SegmentClass, right: SegmentClass): void {
    const { minJaccard, minOrdered } = duplicateDetectionConfig;
    if (!jaccardCanReach(left.grams.size, right.grams.size, minJaccard)) return;
    const jaccardScore = jaccard(left.grams, right.grams);
    if (jaccardScore < minJaccard) return;
    left.points ??= Array.from(left.text);
    right.points ??= Array.from(right.text);
    const ordered = orderedSimilarity(left.points, right.points);
    if (ordered < minOrdered) return;
    for (const x of left.members)
      for (const y of right.members) {
        if (sameLocation(x, y)) continue;
        const [a, b] = orderMembers(x, y);
        const [classA, classB] = a === x ? [left, right] : [right, left];
        this.matches.push({
          a,
          b,
          classA,
          classB,
          kind: duplicateMatchKinds.similar,
          jaccard: jaccardScore,
          ordered,
        });
      }
  }

  /** 같은 필드 쌍에서 양쪽 범위가 모두 겹치는 일치는 넓은 쪽 하나만 남긴다. */
  private mergeMatches(): RawMatch[] {
    const groups = new Map<string, RawMatch[]>();
    for (const match of this.matches) {
      const key = `${match.a.fieldId}:${match.b.fieldId}`;
      const group = groups.get(key);
      if (group) group.push(match);
      else groups.set(key, [match]);
    }
    const selected: RawMatch[] = [];
    for (const group of groups.values()) {
      const accepted: RawMatch[] = [];
      for (const match of [...group].sort(comparePriority))
        if (
          !accepted.some(
            (other) =>
              overlaps(match.a.segment.range, other.a.segment.range) &&
              overlaps(match.b.segment.range, other.b.segment.range),
          )
        )
          accepted.push(match);
      selected.push(...accepted);
    }
    return selected.sort(
      /** 필드 순번과 위치 순서로 결과를 안정적으로 정렬한다. */ (
        left,
        right,
      ) =>
        left.a.fieldId - right.a.fieldId ||
        left.a.segment.range.start - right.a.segment.range.start ||
        left.b.fieldId - right.b.fieldId ||
        left.b.segment.range.start - right.b.segment.range.start,
    );
  }

  /** 구간의 발생 위치를 만든다. 원문 범위와 줄 좌표는 파서 문자열 매핑으로 확인될 때만 담는다. */
  private locate(
    member: Member,
    cache: Map<string, DuplicateLocation>,
  ): DuplicateLocation {
    const { range } = member.segment;
    const cacheKey = `${member.fieldId}:${range.start}:${range.end}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const { document, field } = member.reference;
    const offsetRange = getStringRange(document.parsed, field.fieldPath, range);
    const source = document.parsed.success ? document.parsed.source : undefined;
    const start =
      source !== undefined && offsetRange
        ? offsetToPosition(source, offsetRange.start)
        : undefined;
    const end =
      source !== undefined && offsetRange
        ? offsetToPosition(source, offsetRange.end)
        : undefined;
    const location: DuplicateLocation = {
      path: document.path,
      ...(document.id !== undefined ? { id: document.id } : {}),
      revision: document.revision,
      fieldPath: field.fieldPath,
      passage: field.value.slice(range.start, range.end),
      valueRange: { start: range.start, end: range.end },
      ...(offsetRange && start && end
        ? { offsetRange, range: { start, end } }
        : {}),
    };
    cache.set(cacheKey, location);
    return location;
  }

  /**
   * 지금까지 비교한 결과를 만든다. 겹친 구간은 병합하고 완전 일치는 발생 위치 목록으로 묶는다.
   * 결과 객체는 호출마다 새로 만들며 이후 step이 이전 결과를 바꾸지 않는다.
   * @returns 부분 또는 완료된 결과다.
   */
  snapshot(): DuplicateDetectionResult {
    const cache = new Map<string, DuplicateLocation>();
    const groupByClass = new Map<
      SegmentClass,
      { text: string; occurrences: Map<string, DuplicateLocation> }
    >();
    const groupOrder: SegmentClass[] = [];
    const candidates: DuplicateCandidate[] = [];
    for (const match of this.mergeMatches()) {
      const a = this.locate(match.a, cache);
      const b = this.locate(match.b, cache);
      const candidate: DuplicateCandidate = {
        kind: match.kind,
        a,
        b,
        scores: { jaccard: match.jaccard, ordered: match.ordered },
        linkDestinations: {
          a: match.a.segment.destinations,
          b: match.b.segment.destinations,
          differ: !sameDestinations(
            match.a.segment.destinations,
            match.b.segment.destinations,
          ),
        },
        configVersion: duplicateDetectionConfig.version,
      };
      if (match.kind === duplicateMatchKinds.exact) {
        let group = groupByClass.get(match.classA);
        if (!group) {
          group = { text: match.classA.text, occurrences: new Map() };
          groupByClass.set(match.classA, group);
          groupOrder.push(match.classA);
        }
        for (const member of [match.a, match.b])
          group.occurrences.set(
            `${member.fieldId}:${member.segment.range.start}:${member.segment.range.end}`,
            this.locate(member, cache),
          );
        candidate.groupIndex = groupOrder.indexOf(match.classA);
      }
      candidates.push(candidate);
    }
    return {
      ...this.getProgress(),
      configVersion: duplicateDetectionConfig.version,
      candidates,
      exactGroups: groupOrder.map(
        /** 묶음을 결과 형태로 바꾼다. */ (segmentClass) => {
          const group = groupByClass.get(segmentClass);
          return {
            text: group?.text ?? segmentClass.text,
            occurrences: [...(group?.occurrences.values() ?? [])],
          };
        },
      ),
      skippedInputs: [...this.skipped],
      exclusions: { ...this.exclusions },
    };
  }
}

/**
 * 준비한 문서들의 비교 작업을 만든다. 이 호출은 구간 쌍을 비교하지 않으며 step으로 진행한다.
 * @param documents prepareDuplicateDocument 결과 목록이다. 문서 간·문서 내부 반복을 모두 비교한다.
 * @returns 진행할 수 있는 비교 작업이다.
 */
export function createDuplicateComparison(
  documents: readonly PreparedDuplicateDocument[],
): DuplicateComparison {
  return new DuplicateComparison(documents);
}

/**
 * 문서 준비와 전체 비교를 한 번에 끝까지 실행한다. 대형 입력에서는 예산을 나눠 진행하는 createDuplicateComparison을 쓴다.
 * @param inputs 이미 파싱한 문서 목록이다.
 * @returns 완료된 결과다.
 */
export function detectDuplicates(
  inputs: readonly DuplicateDocumentInput[],
): DuplicateDetectionResult {
  const comparison = createDuplicateComparison(
    inputs.map(prepareDuplicateDocument),
  );
  comparison.step(Number.POSITIVE_INFINITY);
  return comparison.snapshot();
}
