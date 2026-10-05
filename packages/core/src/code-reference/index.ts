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
