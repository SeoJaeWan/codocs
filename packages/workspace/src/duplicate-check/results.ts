import { createHash, randomBytes } from 'node:crypto';
import {
  duplicateDetectionConfig,
  scanStatuses,
  type DuplicateCandidate,
  type DuplicateDetectionResult,
  type DuplicateExactGroup,
  type DuplicateExclusionCounts,
  type DuplicateLocation,
  type ScanStatus,
} from '@codocs/core';
import {
  decodeSignedCursor,
  encodeSignedCursor,
} from '../query/signed-cursor.js';
import { workspaceDuplicateCheckDefaults } from './config.js';
import {
  workspaceDuplicateLocationOrigins,
  workspaceDuplicateStatuses,
  type WorkspaceDuplicateDraftCoverage,
  type WorkspaceDuplicateIncompleteReason,
  type WorkspaceDuplicateLocationOrigin,
  type WorkspaceDuplicateScope,
  type WorkspaceDuplicateStopReason,
} from './domain-values.js';
import type { WorkspaceDuplicateUncheckedItem } from './runner.js';

const cursorVersion = 1;
const cursorKind = 'duplicate-page';

/** 후보 위치와 그 위치가 기준으로 삼는 원문 출처다. 초안 위치는 파일 위치가 아니다. */
export interface WorkspaceDuplicateLocation extends DuplicateLocation {
  origin: WorkspaceDuplicateLocationOrigin;
}

/** core 후보에 위치 출처를 더한 후보다. */
export interface WorkspaceDuplicateCandidate extends Omit<
  DuplicateCandidate,
  'a' | 'b'
> {
  a: WorkspaceDuplicateLocation;
  b: WorkspaceDuplicateLocation;
}

/** 페이지에 담긴 후보가 속한 완전 일치 묶음이다. groupIndex는 후보의 groupIndex와 같다. */
export interface WorkspaceDuplicateExactGroup {
  groupIndex: number;
  text: string;
  occurrences: readonly WorkspaceDuplicateLocation[];
}

/** 초안 검사의 대상 설명이다. 초안 원문 기준의 위치이며 새로 생긴 반복만 찾지 않는다. */
export interface WorkspaceDuplicateDraftInfo {
  path: string;
  id: string;
  revision: string;
  coverage: WorkspaceDuplicateDraftCoverage;
}

/** 검사 한 번의 완료 상태와 범위다. 후보 페이지와 분리해 보관한다. */
export interface WorkspaceDuplicateReport {
  status:
    | typeof workspaceDuplicateStatuses.complete
    | typeof workspaceDuplicateStatuses.partial;
  scope: WorkspaceDuplicateScope;
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
  /** 검사가 고정한 색인 게시 버전이다. */
  catalogVersion: number;
  configVersion: number;
  incompleteReasons: readonly WorkspaceDuplicateIncompleteReason[];
  stopReason?: WorkspaceDuplicateStopReason;
  /** 비교 진행 단위다. 비교를 시작하지 못했으면 totalUnits는 null이다. */
  progress: { completedUnits: number; totalUnits: number | null };
  comparedDocumentCount: number;
  unchecked: readonly WorkspaceDuplicateUncheckedItem[];
  /** 정책상 비교에서 제외한 줄·구간 수다. */
  exclusions: DuplicateExclusionCounts;
  totalCandidates: number;
  /** 이 검사에서 새로 준비한 문서와 캐시를 재사용한 문서의 수다. */
  preparation: { preparedCount: number; reusedCount: number };
  draft?: WorkspaceDuplicateDraftInfo;
}

/** 세션이 다음 페이지를 위해 보관하는 최근 검사 결과 한 건이다. */
export interface RetainedDuplicateResult {
  id: string;
  fingerprint: string;
  report: WorkspaceDuplicateReport;
  candidates: readonly WorkspaceDuplicateCandidate[];
  exactGroups: readonly WorkspaceDuplicateExactGroup[];
  /** 커서 검증 때 현재 색인에서 같은 기준의 지문을 다시 계산하기 위한 범위다. */
  basis: DuplicateSourceBasis;
}

/** 원문 버전 지문을 계산하는 기준이다. */
export interface DuplicateSourceBasis {
  scope: WorkspaceDuplicateScope;
  /** 비교 집합에서 뺀 저장 문서 경로다. 수정·변경 없음 초안의 원래 경로다. */
  excludedPath?: string;
  /** 초안의 경로와 원문 버전이다. */
  draft?: { path: string; revision: string };
}

/** 지문에 넣는 색인 문서 한 건이다. */
export interface DuplicateSourceEntry {
  path: string;
  revision: string | undefined;
  confirmed: boolean;
}

/** 비교 대상 문서들의 경로·원문 버전 목록과 비교 설정 버전을 묶은 지문이다. */
export function duplicateSourceFingerprint(
  basis: DuplicateSourceBasis,
  entries: readonly DuplicateSourceEntry[],
): string {
  const documents = entries
    .filter((entry) => entry.path !== basis.excludedPath)
    .map((entry) => [entry.path, entry.revision ?? null, entry.confirmed])
    .sort((left, right) => (String(left[0]) < String(right[0]) ? -1 : 1));
  return createHash('sha256')
    .update(
      JSON.stringify([
        duplicateDetectionConfig.version,
        basis.scope,
        documents,
        basis.draft ? [basis.draft.path, basis.draft.revision] : null,
      ]),
      'utf8',
    )
    .digest('hex');
}

/** 필드 경로를 문자열·숫자 성분 순서대로 비교한다. */
function compareFieldPath(
  left: DuplicateLocation['fieldPath'],
  right: DuplicateLocation['fieldPath'],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a) < String(b) ? -1 : 1;
  }
  return left.length - right.length;
}

/** 위치를 경로·필드 경로·시작 위치 순으로 비교한다. */
function compareLocation(
  left: DuplicateLocation,
  right: DuplicateLocation,
): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  return (
    compareFieldPath(left.fieldPath, right.fieldPath) ||
    left.valueRange.start - right.valueRange.start ||
    left.valueRange.end - right.valueRange.end
  );
}

/** 후보를 a 위치, b 위치 순으로 정렬하는 비교 함수다. */
function compareCandidate(
  left: DuplicateCandidate,
  right: DuplicateCandidate,
): number {
  return compareLocation(left.a, right.a) || compareLocation(left.b, right.b);
}

/** 위치에 기준 원문 출처를 붙인다. 초안 경로의 위치만 초안 기준이다. */
function withOrigin(
  location: DuplicateLocation,
  draftPath: string | undefined,
): WorkspaceDuplicateLocation {
  return {
    ...location,
    origin:
      location.path === draftPath
        ? workspaceDuplicateLocationOrigins.draft
        : workspaceDuplicateLocationOrigins.saved,
  };
}

/** core 결과를 결정적으로 정렬한 후보와 묶음으로 바꾼다. 묶음 index는 정렬 후에도 원래 값을 유지한다. */
export function projectDuplicateResult(
  result: DuplicateDetectionResult,
  draftPath: string | undefined,
): {
  candidates: WorkspaceDuplicateCandidate[];
  exactGroups: WorkspaceDuplicateExactGroup[];
} {
  const candidates = [...result.candidates].sort(compareCandidate).map(
    /** 두 위치에 출처를 붙인다. */ (candidate) => ({
      ...candidate,
      a: withOrigin(candidate.a, draftPath),
      b: withOrigin(candidate.b, draftPath),
    }),
  );
  const exactGroups = result.exactGroups.map(
    /** 묶음의 모든 발생 위치에 출처를 붙인다. */ (
      group: DuplicateExactGroup,
      groupIndex,
    ) => ({
      groupIndex,
      text: group.text,
      occurrences: [...group.occurrences]
        .sort(compareLocation)
        .map((location) => withOrigin(location, draftPath)),
    }),
  );
  return { candidates, exactGroups };
}

/** 보관할 결과에 식별자를 붙인다. */
export function retainDuplicateResult(input: {
  fingerprint: string;
  report: WorkspaceDuplicateReport;
  candidates: readonly WorkspaceDuplicateCandidate[];
  exactGroups: readonly WorkspaceDuplicateExactGroup[];
  basis: DuplicateSourceBasis;
}): RetainedDuplicateResult {
  return { id: randomBytes(12).toString('base64url'), ...input };
}

/** 페이지 커서가 담는 값이다. 목록 커서의 generation은 쓰지 않는다. */
export interface DuplicateCursorPayload {
  offset: number;
  fingerprint: string;
  configVersion: number;
  resultId: string;
}

/** 다음 페이지 위치와 결과 식별 정보를 서명 토큰으로 만든다. */
export function encodeDuplicateCursor(payload: DuplicateCursorPayload): string {
  return encodeSignedCursor({
    version: cursorVersion,
    kind: cursorKind,
    ...payload,
  });
}

/** 서명과 구조를 확인한 페이지 커서만 반환한다. 목록 커서와 손상된 값은 undefined다. */
export function decodeDuplicateCursor(
  token: string,
): DuplicateCursorPayload | undefined {
  const value = decodeSignedCursor(token);
  if (typeof value !== 'object' || value === null) return undefined;
  /** own data property만 읽는다. */
  const read = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor
      ? (descriptor.value as unknown)
      : undefined;
  };
  const offset = read('offset');
  const fingerprint = read('fingerprint');
  const configVersion = read('configVersion');
  const resultId = read('resultId');
  if (
    read('version') !== cursorVersion ||
    read('kind') !== cursorKind ||
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof fingerprint !== 'string' ||
    typeof configVersion !== 'number' ||
    typeof resultId !== 'string'
  )
    return undefined;
  return { offset, fingerprint, configVersion, resultId };
}

/** 보관한 결과에서 한 페이지를 자른다. 남은 후보가 있으면 nextOffset을 준다. */
export function sliceDuplicatePage(
  retained: RetainedDuplicateResult,
  offset: number,
): {
  candidates: readonly WorkspaceDuplicateCandidate[];
  exactGroups: readonly WorkspaceDuplicateExactGroup[];
  remainingCount: number;
  nextOffset: number | null;
} {
  const candidates = retained.candidates.slice(
    offset,
    offset + workspaceDuplicateCheckDefaults.pageSize,
  );
  const indexes = new Set(
    candidates.flatMap((candidate) =>
      candidate.groupIndex === undefined ? [] : [candidate.groupIndex],
    ),
  );
  const nextOffset = offset + candidates.length;
  const remainingCount = retained.candidates.length - nextOffset;
  return {
    candidates,
    exactGroups: retained.exactGroups.filter((group) =>
      indexes.has(group.groupIndex),
    ),
    remainingCount,
    nextOffset: remainingCount > 0 ? nextOffset : null,
  };
}
