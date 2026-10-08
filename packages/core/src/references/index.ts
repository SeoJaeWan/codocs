import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import type {
  Diagnostic,
  FieldPath,
  OffsetRange,
  ReferenceDiagnosticCode,
  SourceRange,
} from '../diagnostics/index.js';
import {
  referenceDiagnosticCodes,
  referenceDiagnosticMessages,
} from '../diagnostics/index.js';
import type { YamlParseResult } from '../parser/index.js';
import { getStringRange, offsetToPosition } from '../parser/index.js';
import { codocsKey } from '../validator/index.js';
import { referenceSyntaxStatuses } from './domain-values.js';
export * from './domain-values.js';

/** 참조 등장에 공통인 해석 문자열과 확인된 원문 위치다. */
interface ReferenceLocation {
  fieldPath: FieldPath;
  text: string;
  decodedRange: OffsetRange;
  offsetRange: OffsetRange;
  range: SourceRange;
}
/** 유효·무효 문법을 구분하며 반복 및 무효 참조의 위치도 유지한다. */
export type ReferenceOccurrence = ReferenceLocation &
  (
    | {
        syntax: typeof referenceSyntaxStatuses.valid;
        name: string;
        section?: string;
      }
    | { syntax: typeof referenceSyntaxStatuses.invalid }
  );
/** 실제 등장 범위를 가진 참조 문법 오류다. */
export interface ReferenceDiagnostic extends Diagnostic<ReferenceDiagnosticCode> {
  severity: typeof diagnosticSeverities.error;
  fieldPath: FieldPath;
  offsetRange: OffsetRange;
  range: SourceRange;
}
/** 참조 의미를 해석하지 않은 순수 본문 추출 결과다. */
export interface ReferenceExtraction {
  occurrences: readonly ReferenceOccurrence[];
  diagnostics: readonly ReferenceDiagnostic[];
}
/**
 * 바로 앞의 연속 백슬래시가 홀수라 글자로 쓰였는지 확인한다.
 */
function escaped(value: string, index: number): boolean {
  let count = 0;
  while (index > 0 && value[--index] === '\\') count++;
  return count % 2 === 1;
}
/** 대괄호 안에서 escape되지 않은 콜론의 위치를 모두 찾는다. */
function unescapedColons(value: string): number[] {
  const colons: number[] = [];
  for (let index = 0; index < value.length; index++)
    if (value[index] === ':' && !escaped(value, index)) colons.push(index);
  return colons;
}
/**
 * 참조 표기에서 첫 번째 escape되지 않은 콜론 앞을 문서 이름, 뒤를 섹션 이름으로 나눈다.
 */
function splitSection(
  value: string,
  separator: number | undefined,
): { name: string; section?: string } {
  if (separator === undefined) return { name: value };
  return {
    name: value.slice(0, separator),
    section: value.slice(separator + 1),
  };
}
/**
 * 참조 구성 안의 콜론을 구분자와 구분되도록 `\:`로 쓴다. unescapeColon의 역변환이다.
 */
export function encodeColon(value: string): string {
  return value.replace(/:/gu, '\\:');
}
/**
 * 문서 이름과 섹션 이름에 `\:`로 쓴 콜론을 콜론 글자로 되돌린다.
 */
function unescapeColon(text: string): string {
  return text.replace(/\\:/gu, ':');
}
/**
 * 대괄호 안의 구성이 빈 이름·섹션, 남은 대괄호, 두 번째 콜론 중 하나면 문법 오류로 판정한다.
 */
function invalidComponents(
  value: string,
  colons: readonly number[],
  parts: { name: string; section?: string },
): boolean {
  return (
    /[\[\]]/u.test(value) ||
    colons.length > 1 ||
    !parts.name.length ||
    parts.section === ''
  );
}
/** 대괄호 안의 원문을 문서 이름과 섹션 이름으로 해석한다. 문법 오류이면 undefined다. */
export function parseReferenceComponents(
  value: string,
): { name: string; section?: string } | undefined {
  const colons = unescapedColons(value);
  const parts = splitSection(value, colons[0]);
  if (invalidComponents(value, colons, parts)) return undefined;
  const name = unescapeColon(parts.name);
  return parts.section === undefined
    ? { name }
    : { name, section: unescapeColon(parts.section) };
}
/** 본문에서 찾은 참조 표기 구간이다. closed가 false이면 닫히지 않은 참조다. */
interface ReferenceSpan {
  start: number;
  end: number;
  closed: boolean;
}
/**
 * 본문에서 참조 표기 구간을 찾는다. 닫히지 않은 참조는 다음 `[[` 앞이나 본문 끝에서 끝낸다.
 */
function scanReferenceSpans(value: string): ReferenceSpan[] {
  const spans: ReferenceSpan[] = [];
  let start: number | undefined;
  for (let index = 0; index < value.length - 1; index++) {
    if (value.startsWith('[[', index) && !escaped(value, index)) {
      if (start !== undefined) spans.push({ start, end: index, closed: false });
      start = index;
      index++;
    } else if (start !== undefined && value.startsWith(']]', index)) {
      spans.push({ start, end: index + 2, closed: true });
      start = undefined;
      index++;
    }
  }
  if (start !== undefined)
    spans.push({ start, end: value.length, closed: false });
  return spans;
}
/** `_codocs`를 제외한 모든 루트 키 중 문자열 section의 경로만 고른다. */
function bodyPaths(data: Record<string, unknown>): FieldPath[] {
  return Object.keys(data)
    .filter((key) => key !== codocsKey && typeof data[key] === 'string')
    .map((key) => [key]);
}
/**
 * 문서 본문에서 참조 표기를 찾아 문서 이름과 섹션 이름으로 해석하고, 문법 오류인 표기는 그 위치에 진단한다.
 */
export function extractReferences(
  parsed: YamlParseResult,
  path?: string,
): ReferenceExtraction {
  const occurrences: ReferenceOccurrence[] = [];
  const diagnostics: ReferenceDiagnostic[] = [];
  if (!parsed.success) return { occurrences, diagnostics };
  const source = parsed.source;
  for (const fieldPath of bodyPaths(parsed.data)) {
    const mapping = parsed.strings.find(
      (candidate) =>
        candidate.fieldPath.length === fieldPath.length &&
        candidate.fieldPath.every((part, index) => part === fieldPath[index]),
    );
    if (!mapping) continue;
    const value = mapping.value;
    for (const span of scanReferenceSpans(value)) {
      const decodedRange = { start: span.start, end: span.end };
      const offsetRange = getStringRange(parsed, fieldPath, decodedRange);
      if (!offsetRange) continue;
      const begin = offsetToPosition(source, offsetRange.start);
      const finish = offsetToPosition(source, offsetRange.end);
      if (!begin || !finish) continue;
      const range = { start: begin, end: finish };
      const parts = span.closed
        ? parseReferenceComponents(value.slice(span.start + 2, span.end - 2))
        : undefined;
      const location = {
        fieldPath: [...fieldPath],
        text: value.slice(span.start, span.end),
        decodedRange,
        offsetRange,
        range,
      };
      occurrences.push(
        parts
          ? { ...location, syntax: referenceSyntaxStatuses.valid, ...parts }
          : { ...location, syntax: referenceSyntaxStatuses.invalid },
      );
      if (!parts)
        diagnostics.push({
          code: referenceDiagnosticCodes.invalidReference,
          severity: diagnosticSeverities.error,
          message: referenceDiagnosticMessages.invalidReference,
          fieldPath: [...fieldPath],
          offsetRange: { ...offsetRange },
          range: { start: { ...begin }, end: { ...finish } },
          ...(path !== undefined ? { path } : {}),
        });
    }
  }
  return { occurrences, diagnostics };
}
/** 유효한 참조 등장에서 문서 이름 부분과 섹션 이름 부분이 차지하는 원문 offset 범위다. */
export interface ReferencePartRanges {
  /** 문서 이름 부분의 원문 범위다. `:` escape를 포함하고 대괄호는 제외한다. */
  name: OffsetRange;
  /** 섹션 이름 부분의 원문 범위다. 섹션을 적지 않은 참조에는 없다. */
  section?: OffsetRange;
}
/**
 * 유효한 참조 등장의 문서 이름 부분과 섹션 이름 부분의 원문 범위를 계산한다.
 * 해석 문자열 위치를 getStringRange로 원문 offset으로 바꾸므로 YAML escape와 `:`를 따른다.
 * @param parsed 참조가 속한 문서의 파싱 결과다.
 * @param occurrence 범위를 나눌 참조 등장이다.
 * @returns 문법 오류인 등장이거나 원문 범위를 확인하지 못하면 undefined다.
 */
export function getReferencePartRanges(
  parsed: YamlParseResult,
  occurrence: ReferenceOccurrence,
): ReferencePartRanges | undefined {
  if (occurrence.syntax !== referenceSyntaxStatuses.valid) return undefined;
  const innerStart = occurrence.decodedRange.start + 2;
  const innerEnd = occurrence.decodedRange.end - 2;
  const separator = unescapedColons(
    occurrence.text.slice(2, occurrence.text.length - 2),
  )[0];
  const nameEnd = separator === undefined ? innerEnd : innerStart + separator;
  const name = getStringRange(parsed, occurrence.fieldPath, {
    start: innerStart,
    end: nameEnd,
  });
  if (!name) return undefined;
  if (separator === undefined) return { name };
  const section = getStringRange(parsed, occurrence.fieldPath, {
    start: nameEnd + 1,
    end: innerEnd,
  });
  return section ? { name, section } : undefined;
}
