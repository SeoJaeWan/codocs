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
import { documentFields } from '../validator/index.js';
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
        domain?: string;
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
/** 바로 앞 연속 백슬래시 개수가 홀수인지 검사한다. */
function escaped(value: string, index: number): boolean {
  let count = 0;
  while (index > 0 && value[--index] === '\\') count++;
  return count % 2 === 1;
}
/** 첫 비이스케이프 콜론으로 도메인을 나누고 이름 내부 콜론은 명시적 escape만 허용한다. */
export function parseReferenceComponents(
  value: string,
): { name: string; domain?: string } | undefined {
  let separator = -1;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '[' || value[index] === ']') return undefined;
    if (value[index] === ':' && !escaped(value, index)) {
      if (separator >= 0) return undefined;
      separator = index;
    }
  }
  const name = (separator < 0 ? value : value.slice(separator + 1)).replace(
    /\\:/gu,
    ':',
  );
  const domain =
    separator < 0 ? undefined : value.slice(0, separator).replace(/\\:/gu, ':');
  if (!name.length || domain === '') return undefined;
  return { name, ...(domain !== undefined ? { domain } : {}) };
}
/** 자료형이 정상인 본문과 예문 경로만 고른다. */
function bodyPaths(data: Record<string, unknown>): FieldPath[] {
  const paths: FieldPath[] = [];
  if (typeof data.definition === 'string')
    paths.push([documentFields.definition]);
  if (Array.isArray(data.examples))
    for (let index = 0; index < data.examples.length; index++)
      if (typeof data.examples[index] === 'string')
        paths.push([documentFields.examples, index]);
  return paths;
}
/** YAML 성공 결과의 정해진 본문만 추출한다. 스키마 검증·ID·파일 IO에 의존하지 않고 입력을 변경하지 않는다. @codocs [[참조 추출]] */
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
    let start: number | undefined;
    /** 실제 문자열 범위의 등장과 문법 오류를 함께 기록한다. @codocs [[참조 추출]]#L20-L32 */
    function record(end: number, closed: boolean): void {
      if (start === undefined) return;
      const decodedRange = { start, end };
      const offsetRange = getStringRange(parsed, fieldPath, decodedRange);
      if (!offsetRange) return;
      const begin = offsetToPosition(source, offsetRange.start);
      const finish = offsetToPosition(source, offsetRange.end);
      if (!begin || !finish) return;
      const range = { start: begin, end: finish };
      const parts = closed
        ? parseReferenceComponents(value.slice(start + 2, end - 2))
        : undefined;
      const location = {
        fieldPath: [...fieldPath],
        text: value.slice(start, end),
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
    for (let index = 0; index < value.length - 1; index++) {
      if (value.startsWith('[[', index) && !escaped(value, index)) {
        if (start !== undefined) record(index, false);
        start = index;
        index++;
      } else if (start !== undefined && value.startsWith(']]', index)) {
        record(index + 2, true);
        start = undefined;
        index++;
      }
    }
    if (start !== undefined) record(value.length, false);
  }
  return { occurrences, diagnostics };
}
