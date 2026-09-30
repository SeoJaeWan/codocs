import {
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

/** 행 번호는 저장 YAML의 1부터 시작하며 끝 행을 포함한다. */
export type CodeReferenceDestination =
  | { kind: typeof codeReferenceDestinationKinds.document }
  | {
      kind: typeof codeReferenceDestinationKinds.rows;
      startLine: number;
      endLine: number;
    };
/** 무효 표기도 IDE에서 전체 span을 가로채도록 보존한다. */
export interface CodeReferenceMarker {
  text: string;
  offsetRange: OffsetRange;
  range: SourceRange;
  syntax: (typeof codeReferenceSyntaxes)[keyof typeof codeReferenceSyntaxes];
  name?: string;
  domain?: string;
  destination?: CodeReferenceDestination;
  rowError?:
    | typeof codeReferenceStatuses.invalidRows
    | typeof codeReferenceStatuses.reversedRows;
}
/** 이름 후보와 범위 오류를 분리한 순수 해석 결과다. */
export interface CodeReferenceResolution {
  marker: CodeReferenceMarker;
  status: (typeof codeReferenceStatuses)[keyof typeof codeReferenceStatuses];
  candidates: readonly ReferenceCandidate[];
  target?: ReferenceCandidate;
  destination?: CodeReferenceDestination;
}
/** 저장 원문의 실제 행 수다. 마지막 줄바꿈 뒤 빈 실제 행도 유지한다. */
export function codeReferenceLineCount(text: string): number {
  return text.split(/\r\n|\r|\n/u).length;
}
/** 언어·YAML 필드·자기 참조 제한 없이 전체 텍스트의 명시 표기를 추출한다. @codocs [[명시적 코드 참조]]#L12-L28 */
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
    let end = closed ? closing + 2 : lineEnd;
    const parts = closed
      ? parseReferenceComponents(text.slice(bodyStart, closing))
      : undefined;
    let destination: CodeReferenceDestination = {
      kind: codeReferenceDestinationKinds.document,
    };
    let rowError: CodeReferenceMarker['rowError'];
    if (closed && text[end] === '#') {
      const suffix =
        /^#[^\s"'`<>(){}\[\],;]*/u.exec(text.slice(end))?.[0] ?? '#';
      end += suffix.length;
      const rows = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/u.exec(suffix);
      const startLine = Number(rows?.[1]);
      const endLine = Number(rows?.[2] ?? rows?.[1]);
      if (
        !rows ||
        !Number.isSafeInteger(startLine) ||
        !Number.isSafeInteger(endLine)
      )
        rowError = codeReferenceStatuses.invalidRows;
      else if (endLine < startLine)
        rowError = codeReferenceStatuses.reversedRows;
      else
        destination = {
          kind: codeReferenceDestinationKinds.rows,
          startLine,
          endLine,
        };
    }
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
      ...(rowError ? { rowError } : { destination }),
    });
  }
  return markers;
}
/** 저장 catalog만 사용하며 코드 출처를 YAML 자기 참조로 판단하지 않는다. @codocs [[명시적 코드 참조]]#L30-L40 */
export function resolveCodeReference(
  catalog: Catalog,
  marker: CodeReferenceMarker,
): CodeReferenceResolution {
  if (
    marker.syntax === codeReferenceSyntaxes.invalid ||
    marker.name === undefined
  )
    return { marker, status: codeReferenceStatuses.invalid, candidates: [] };
  if (marker.rowError)
    return { marker, status: marker.rowError, candidates: [] };
  const resolution = resolveReference(catalog, {
    name: marker.name,
    ...(marker.domain !== undefined ? { domain: marker.domain } : {}),
  });
  if (
    resolution.status !== referenceResolutionStatuses.resolved ||
    !resolution.target
  )
    return {
      marker,
      status:
        resolution.status === referenceResolutionStatuses.ambiguous
          ? codeReferenceStatuses.ambiguous
          : resolution.status === referenceResolutionStatuses.missing
            ? codeReferenceStatuses.missing
            : codeReferenceStatuses.unconfirmed,
      candidates: resolution.candidates,
    };
  const destination = marker.destination!;
  const source = catalog.documents.get(resolution.target.path)?.observation
    .parsed.source;
  if (source === undefined)
    return {
      marker,
      status: codeReferenceStatuses.unconfirmed,
      candidates: resolution.candidates,
    };
  if (
    destination.kind === codeReferenceDestinationKinds.rows &&
    destination.endLine > codeReferenceLineCount(source)
  )
    return {
      marker,
      status: codeReferenceStatuses.outOfBounds,
      candidates: resolution.candidates,
    };
  return {
    marker,
    status: codeReferenceStatuses.resolved,
    candidates: resolution.candidates,
    target: resolution.target,
    destination,
  };
}
