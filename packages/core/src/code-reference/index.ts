import {
  getSectionKeyRange,
  resolveReference,
  type Catalog,
  type ReferenceCandidate,
} from '../catalog/index.js';
import { referenceResolutionStatuses } from '../catalog/domain-values.js';
import { offsetToPosition } from '../parser/index.js';
import { parseReferenceComponents } from '../references/index.js';
import type { OffsetRange, SourceRange } from '../diagnostics/index.js';
import {
  codeReferenceDestinationKinds,
  codeReferenceStatuses,
  codeReferenceSyntaxes,
} from './domain-values.js';
export * from './domain-values.js';

/** 표기가 가리키는 저장 문서의 위치다. 섹션은 저장 색인의 섹션 키 위치를 그대로 담는다. */
export type CodeReferenceDestination =
  | { kind: typeof codeReferenceDestinationKinds.document }
  | {
      kind: typeof codeReferenceDestinationKinds.section;
      section: string;
      range: SourceRange;
      markerText: string;
    };
/** 무효 표기도 IDE에서 전체 span을 가로채도록 보존한다. */
export interface CodeReferenceMarker {
  text: string;
  offsetRange: OffsetRange;
  range: SourceRange;
  syntax: (typeof codeReferenceSyntaxes)[keyof typeof codeReferenceSyntaxes];
  name?: string;
  /** 표기에 적은 섹션 이름이다. 섹션이 없으면 문서 전체를 가리킨다. */
  section?: string;
}
/** 이름 후보와 섹션 확인을 분리한 순수 해석 결과다. */
export interface CodeReferenceResolution {
  marker: CodeReferenceMarker;
  status: (typeof codeReferenceStatuses)[keyof typeof codeReferenceStatuses];
  candidates: readonly ReferenceCandidate[];
  target?: ReferenceCandidate;
  /** 섹션 표기가 확인됐을 때만 있는 섹션 이름이다. */
  section?: string;
  destination?: CodeReferenceDestination;
}
/** 언어·YAML 필드·자기 참조 제한 없이 전체 텍스트의 명시 표기를 추출한다. */
export function extractCodeReferences(
  text: string,
): readonly CodeReferenceMarker[] {
  const markers: CodeReferenceMarker[] = [];
  const prefix = /@codocs[ \t]+\[\[/gu;
  for (const match of text.matchAll(prefix)) {
    const start = match.index;
    const bodyStart = start + match[0].length;
    const lineEndMatch = /[\r\n]/u.exec(text.slice(bodyStart));
    const lineEnd = lineEndMatch ? bodyStart + lineEndMatch.index : text.length;
    const closing = text.indexOf(']]', bodyStart);
    const closed = closing >= 0 && closing < lineEnd;
    const end = closed ? closing + 2 : lineEnd;
    const parts = closed
      ? parseReferenceComponents(text.slice(bodyStart, closing))
      : undefined;
    markers.push({
      text: text.slice(start, end),
      offsetRange: { start, end },
      range: {
        start: offsetToPosition(text, start)!,
        end: offsetToPosition(text, end)!,
      },
      syntax: parts
        ? codeReferenceSyntaxes.valid
        : codeReferenceSyntaxes.invalid,
      ...(parts ?? {}),
    });
  }
  return markers;
}
/** 유효한 코드 표기에서 이름 부분과 섹션 부분이 차지하는 파일 원문 offset 범위다. */
export interface CodeReferencePartRanges {
  /** 이름 부분의 범위다. `\:` escape를 포함하고 `[[`와 구분 콜론은 제외한다. */
  name: OffsetRange;
  /** 섹션 부분의 범위다. 섹션을 적지 않은 표기에는 없다. */
  section?: OffsetRange;
}
/** 코드 표기의 이름 또는 섹션 부분 하나를 바꾸는 원문 수정이다. */
export interface CodeReferencePartEdit {
  /** 파일 원문에서 바꿀 부분의 범위다. */
  offsetRange: OffsetRange;
  /** 바꾸기 전 그 부분의 원문(escape 포함)이다. */
  oldText: string;
  /** 바꾼 뒤 그 부분의 원문이며 콜론은 `\:`로 적는다. */
  newText: string;
}
/** 바로 앞의 연속 백슬래시가 홀수라 글자로 쓰였는지 확인한다. */
function escapedAt(value: string, index: number): boolean {
  let count = 0;
  while (index > 0 && value[--index] === '\\') count++;
  return count % 2 === 1;
}
/** 대괄호 안에서 첫 번째 escape되지 않은 콜론의 위치를 찾는다. */
function firstUnescapedColon(body: string): number | undefined {
  for (let index = 0; index < body.length; index++)
    if (body[index] === ':' && !escapedAt(body, index)) return index;
  return undefined;
}
/**
 * 유효한 코드 표기의 이름 부분과 섹션 부분의 파일 원문 범위를 계산한다.
 * 범위는 marker.text 안의 위치를 marker.offsetRange 기준으로 옮긴 값이라 `\:` escape를 포함한다.
 * @param marker extractCodeReferences가 돌려준 표기다.
 * @returns 문법 오류인 표기이거나 닫힌 형태를 확인하지 못하면 undefined다.
 */
export function getCodeReferencePartRanges(
  marker: CodeReferenceMarker,
): CodeReferencePartRanges | undefined {
  if (marker.syntax !== codeReferenceSyntaxes.valid) return undefined;
  const opening = /^@codocs[ \t]+\[\[/u.exec(marker.text);
  if (!opening || !marker.text.endsWith(']]')) return undefined;
  const bodyStart = opening[0].length;
  const bodyEnd = marker.text.length - 2;
  if (bodyEnd < bodyStart) return undefined;
  const colon = firstUnescapedColon(marker.text.slice(bodyStart, bodyEnd));
  const base = marker.offsetRange.start;
  const nameEnd = colon === undefined ? bodyEnd : bodyStart + colon;
  return {
    name: { start: base + bodyStart, end: base + nameEnd },
    ...(colon === undefined
      ? {}
      : { section: { start: base + nameEnd + 1, end: base + bodyEnd } }),
  };
}
/**
 * 코드 표기의 이름 또는 섹션 부분만 새 값으로 바꾸는 원문 수정을 만든다.
 * 다른 부분과 `#…` 같은 표기 뒤의 글자는 그대로 두고, 값의 콜론은 `\:`로 적는다.
 * 새 표기를 다시 추출해 같은 이름·섹션으로 읽히는지 확인하므로 안전하게 적을 수 없는 값은 거부한다.
 * @param marker 고칠 유효 표기다.
 * @param part 바꿀 부분이다. section은 섹션이 있는 표기에만 쓸 수 있다.
 * @param value 새 이름 또는 새 섹션 이름이다.
 * @returns 안전하게 적을 수 없으면 undefined다.
 */
export function replaceCodeReferencePart(
  marker: CodeReferenceMarker,
  part: 'name' | 'section',
  value: string,
): CodeReferencePartEdit | undefined {
  const ranges = getCodeReferencePartRanges(marker);
  const target = part === 'name' ? ranges?.name : ranges?.section;
  if (!ranges || !target || marker.name === undefined) return undefined;
  const newText = value.replace(/:/gu, '\\:');
  const local = {
    start: target.start - marker.offsetRange.start,
    end: target.end - marker.offsetRange.start,
  };
  const expected = {
    name: part === 'name' ? value : marker.name,
    section: part === 'section' ? value : marker.section,
  };
  const markerText =
    marker.text.slice(0, local.start) + newText + marker.text.slice(local.end);
  const [extracted, ...rest] = extractCodeReferences(markerText);
  if (
    rest.length ||
    !value.length ||
    extracted?.syntax !== codeReferenceSyntaxes.valid ||
    extracted.text !== markerText ||
    extracted.name !== expected.name ||
    extracted.section !== expected.section
  )
    return undefined;
  return {
    offsetRange: { ...target },
    oldText: marker.text.slice(local.start, local.end),
    newText,
  };
}
/** 저장 catalog만 사용하며 코드 출처를 YAML 자기 참조로 판단하지 않는다. */
export function resolveCodeReference(
  catalog: Catalog,
  marker: CodeReferenceMarker,
): CodeReferenceResolution {
  if (
    marker.syntax === codeReferenceSyntaxes.invalid ||
    marker.name === undefined
  )
    return { marker, status: codeReferenceStatuses.invalid, candidates: [] };
  const resolution = resolveReference(catalog, {
    name: marker.name,
    ...(marker.section !== undefined ? { section: marker.section } : {}),
  });
  if (
    resolution.status !== referenceResolutionStatuses.resolved ||
    !resolution.target
  )
    return {
      marker,
      status: unresolvedStatus(resolution.status),
      candidates: resolution.candidates,
    };
  const document = catalog.documents.get(resolution.target.path);
  if (!document)
    return {
      marker,
      status: codeReferenceStatuses.unconfirmed,
      candidates: resolution.candidates,
    };
  if (marker.section === undefined)
    return {
      marker,
      status: codeReferenceStatuses.resolved,
      candidates: resolution.candidates,
      target: resolution.target,
      destination: { kind: codeReferenceDestinationKinds.document },
    };
  const key = getSectionKeyRange(document, marker.section);
  const parsed = document.observation.parsed;
  if (!key || !parsed.success)
    return {
      marker,
      status: codeReferenceStatuses.unconfirmed,
      candidates: resolution.candidates,
    };
  return {
    marker,
    status: codeReferenceStatuses.resolved,
    candidates: resolution.candidates,
    target: resolution.target,
    section: marker.section,
    destination: {
      kind: codeReferenceDestinationKinds.section,
      section: marker.section,
      range: key.range,
      markerText: parsed.source.slice(
        key.offsetRange.start,
        key.offsetRange.end,
      ),
    },
  };
}
/** 문서 해석 결과 중 확정되지 않은 상태를 코드 참조 상태로 옮긴다. */
function unresolvedStatus(
  status: (typeof referenceResolutionStatuses)[keyof typeof referenceResolutionStatuses],
): CodeReferenceResolution['status'] {
  switch (status) {
    case referenceResolutionStatuses.ambiguous:
      return codeReferenceStatuses.ambiguous;
    case referenceResolutionStatuses.missing:
      return codeReferenceStatuses.missing;
    case referenceResolutionStatuses.missingSection:
      return codeReferenceStatuses.missingSection;
    default:
      return codeReferenceStatuses.unconfirmed;
  }
}
