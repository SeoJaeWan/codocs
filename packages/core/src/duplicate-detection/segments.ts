import type { OffsetRange } from '../diagnostics/index.js';
import { duplicateDetectionConfig } from './config.js';
import {
  duplicateExclusionReasons,
  type DuplicateExclusionReason,
} from './domain-values.js';
import { buildGrams } from './similarity.js';

/** 제외 사유별 개수다. 줄 단위 제외와 구간 단위 제외를 같은 표에 센다. */
export type DuplicateExclusionCounts = Record<DuplicateExclusionReason, number>;

/** 정규화를 마친 비교 구간이다. 범위는 해석 문자열 기준이며 원문 범위는 보고할 때 계산한다. */
export interface PreparedSegment {
  /** 해석 문자열 안의 시작 포함·끝 제외 UTF-16 범위다. 앞뒤 공백은 포함하지 않는다. */
  range: OffsetRange;
  /** NFC와 공백 정규화를 마치고 링크 목적지를 뺀 비교 문자열이다. */
  text: string;
  /** 비교 문자열의 코드 포인트 수다. */
  codePointCount: number;
  /** 비교 문자열의 4-gram 집합이다. */
  grams: ReadonlySet<string>;
  /** Markdown 링크 목적지를 나타난 순서대로 보존한 목록이다. 점수에는 쓰지 않는다. */
  destinations: readonly string[];
}

/** 구간으로 나누기 전의 해석 문자열 범위다. */
interface Span {
  start: number;
  end: number;
}

/** 제외 사유별 개수를 0으로 채운 표를 만든다. */
export function emptyExclusionCounts(): DuplicateExclusionCounts {
  return {
    [duplicateExclusionReasons.heading]: 0,
    [duplicateExclusionReasons.codeFence]: 0,
    [duplicateExclusionReasons.tableSeparator]: 0,
    [duplicateExclusionReasons.tooShort]: 0,
    [duplicateExclusionReasons.tooLong]: 0,
  };
}

const codeFencePattern = /^\s*(?:`{3,}|~{3,})/u;
const headingPattern = /^\s{0,3}#{1,6}(?:\s|$)/u;
const horizontalRulePattern = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/u;
const listMarkerPattern = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/u;
const linkPattern = /\[(?!\[)([^[\]\n]*)\]\(([^()\s]*)(?:\s+"[^"]*")?\)/gu;
const sentenceTerminators = new Set(['.', '!', '?', '。', '！', '？']);
const closingMarks = new Set(['"', "'", ')', ']', '」', '』', '”', '’']);

/** 공백 문자인지 확인한다. */
function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

/** 표의 열 구분선 줄인지 확인한다. 파이프가 있고 하이픈·콜론·공백만 남아야 한다. */
function isTableSeparator(line: string): boolean {
  return line.includes('|') && line.includes('-') && /^[\s|:-]+$/u.test(line);
}

/** 문단 한 개의 줄 범위에서 문장 범위를 나눈다. 줄바꿈은 문장 경계가 아니다. */
function splitSentences(value: string, lines: readonly Span[]): Span[] {
  const sentences: Span[] = [];
  let start = -1;
  let lastEnd = -1;
  for (const line of lines) {
    for (let index = line.start; index < line.end; index++) {
      const character = value[index];
      if (start < 0) {
        if (isWhitespace(character)) continue;
        start = index;
      }
      if (character === undefined || !sentenceTerminators.has(character))
        continue;
      let end = index + 1;
      while (end < line.end && closingMarks.has(value[end] ?? '')) end++;
      if (end >= line.end || isWhitespace(value[end])) {
        sentences.push({ start, end });
        start = -1;
        index = end - 1;
      }
    }
    lastEnd = line.end;
  }
  if (start >= 0 && lastEnd > start) sentences.push({ start, end: lastEnd });
  return sentences;
}

/** 문단과 그 안의 1~3문장 연속 구간 범위를 중복 없이 만든다. */
function windowsOf(sentences: readonly Span[]): Span[] {
  const first = sentences[0];
  const last = sentences[sentences.length - 1];
  if (!first || !last) return [];
  const windows = new Map<string, Span>();
  /** 같은 범위를 한 번만 담는다. */
  const add = (start: number, end: number): void => {
    windows.set(`${start}:${end}`, { start, end });
  };
  for (let size = 1; size <= duplicateDetectionConfig.maxSentenceWindow; size++)
    for (let index = 0; index + size <= sentences.length; index++) {
      const from = sentences[index];
      const to = sentences[index + size - 1];
      if (from && to) add(from.start, to.end);
    }
  add(first.start, last.end);
  return [...windows.values()];
}

/** 해석 문자열을 문단·표 행·1~3문장 구간의 범위로 나눈다. 제목·코드 펜스·표 구분선은 제외하고 개수만 센다. */
function splitWindows(
  value: string,
  exclusions: DuplicateExclusionCounts,
): Span[] {
  const windows: Span[] = [];
  let paragraph: Span[] = [];
  let inFence = false;
  /** 모인 줄을 문단으로 닫아 구간을 만든다. */
  const flush = (): void => {
    if (paragraph.length > 0)
      windows.push(...windowsOf(splitSentences(value, paragraph)));
    paragraph = [];
  };
  let lineStart = 0;
  while (lineStart <= value.length) {
    const newline = value.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? value.length : newline;
    const line = value.slice(lineStart, lineEnd);
    const trimmed = line.trim();
    const contentStart = lineStart + (line.length - line.trimStart().length);
    const contentEnd = lineStart + line.trimEnd().length;
    if (codeFencePattern.test(line)) {
      flush();
      inFence = !inFence;
      exclusions[duplicateExclusionReasons.codeFence]++;
    } else if (inFence) {
      if (trimmed) exclusions[duplicateExclusionReasons.codeFence]++;
    } else if (!trimmed) {
      flush();
    } else if (headingPattern.test(line)) {
      flush();
      exclusions[duplicateExclusionReasons.heading]++;
    } else if (isTableSeparator(line)) {
      flush();
      exclusions[duplicateExclusionReasons.tableSeparator]++;
    } else if (horizontalRulePattern.test(line)) {
      flush();
    } else if (trimmed.startsWith('|')) {
      // 표 행은 문장으로 더 나누지 않고 한 줄을 한 구간으로 본다.
      flush();
      windows.push({ start: contentStart, end: contentEnd });
    } else {
      const marker = listMarkerPattern.exec(line);
      if (marker) {
        flush();
        paragraph.push({
          start: lineStart + marker[0].length,
          end: contentEnd,
        });
      } else paragraph.push({ start: contentStart, end: contentEnd });
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  flush();
  return windows;
}

/** 구간 문자열을 비교용으로 정규화한다. 링크는 표시 문구만 남기고 목적지를 따로 모으며 숫자·부정 표현은 지우지 않는다. @codocs [[본문 중복 탐지]]#L25-L27 */
function normalize(text: string): { text: string; destinations: string[] } {
  const destinations: string[] = [];
  const labelOnly = text.replace(
    linkPattern,
    /** 링크를 표시 문구로 바꾸고 목적지를 모은다. */ (
      _match: string,
      label: string,
      destination: string,
    ) => {
      destinations.push(destination);
      return label;
    },
  );
  return {
    text: labelOnly.normalize('NFC').replace(/\s+/gu, ' ').trim(),
    destinations,
  };
}

/** 필드 문자열 하나를 정규화한 비교 구간 목록으로 만든다. 최소·최대 길이를 벗어난 구간은 제외하고 개수만 센다. */
export function buildSegments(
  value: string,
  exclusions: DuplicateExclusionCounts,
): PreparedSegment[] {
  const segments: PreparedSegment[] = [];
  for (const window of splitWindows(value, exclusions)) {
    const normalized = normalize(value.slice(window.start, window.end));
    const points = Array.from(normalized.text);
    if (points.length < duplicateDetectionConfig.minCodePoints) {
      exclusions[duplicateExclusionReasons.tooShort]++;
      continue;
    }
    if (points.length > duplicateDetectionConfig.maxCodePoints) {
      exclusions[duplicateExclusionReasons.tooLong]++;
      continue;
    }
    segments.push({
      range: { start: window.start, end: window.end },
      text: normalized.text,
      codePointCount: points.length,
      grams: buildGrams(points),
      destinations: normalized.destinations,
    });
  }
  return segments;
}
