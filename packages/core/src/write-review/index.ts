import { compareText, type Catalog } from '../catalog/index.js';
import {
  changePlanModes,
  type ChangePlanMode,
} from '../change-plan/domain-values.js';
import { encodeColon } from '../references/index.js';
import { tokenize } from '../search/tokenize.js';
import { codocsKey } from '../validator/index.js';
import {
  reviewCopiedBy,
  reviewDecisions,
  type ReviewCopiedBy,
  type ReviewDecision,
} from './domain-values.js';

export * from './domain-values.js';

/** 조금 고친 문장으로 보는 닮은 정도의 하한이다. 출처: 2026-11-11 프로토타입(작은 수정 0.96 이상, 다시 쓴 문장 0.23 이하)이다. */
const editedSimilarity = 0.8;
/** 인용이 든 문장을 포함 관계로 찾지 못했을 때 가장 닮은 문장으로 인정하는 하한이다. 출처: 2026-11-11 프로토타입이다. */
const quoteSimilarity = 0.6;
/** 포함 관계로 인용을 찾을 때 공백·구두점을 지운 글자 수의 하한이다. 목록 기호만 있는 줄이 모든 인용에 들어맞지 않게 한다. */
const quoteMinimumLength = 6;
/** 후보로 고르는 섹션의 최대 개수다. 출처: 2026-11-11 프로토타입(재서술 한 건의 원본이 6위여서 10개로 정함)이다. */
export const reviewCandidateLimit = 10;
/** 후보 점수 BM25의 포화 계수다. 출처: 2026-11-11 프로토타입이다. */
const bm25K1 = 1.2;
/** 후보 점수 BM25의 길이 정규화 정도다. 출처: 2026-11-11 프로토타입이다. */
const bm25B = 0.75;

/** 탐지에 쓰는 섹션 하나다. 문서 이름·섹션 이름·본문과 codocs_get 주소를 담는다. */
export interface ReviewSection {
  /** 프로젝트 기준 문서 경로다. */
  documentPath: string;
  documentName: string;
  sectionName: string;
  /** codocs_get 주소(`이름:섹션`, 콜론은 `\:`)다. */
  address: string;
  body: string;
}

/** 저장 계획의 항목 하나에서 탐지에 필요한 값이다. */
export interface ReviewChange {
  /** 입력 배열에서의 위치다. 단일 요청은 0이다. */
  index: number;
  mode: ChangePlanMode;
  /** 반영 뒤 경로다. delete는 지워지는 경로, move는 새 경로다. */
  path: string;
  /** move의 원래 경로다. */
  previousPath?: string;
  /** create·update·replace가 반영된 뒤의 문서 데이터다. 바뀌지 않은 항목은 생략한다. */
  data?: Readonly<Record<string, unknown>>;
}

/** 새로 쓴 문장이 있는 섹션 하나와 그 섹션의 후보다. 모델 호출 하나의 단위다. */
export interface ReviewTarget {
  /** 이 섹션을 바꾼 요청 항목의 위치다. */
  index: number;
  documentPath: string;
  documentName: string;
  sectionName: string;
  /** 새 글이 들어갈 섹션의 주소다. */
  address: string;
  /** 이번 요청으로 새로 쓴 문장이다. 반영 뒤 섹션에서의 순서를 따른다. */
  sentences: readonly string[];
  /** 가까운 순서의 후보 섹션이다. 자기 문서와 제외 경로의 문서는 없다. */
  candidates: readonly ReviewSection[];
}

/** 모델이 낸 겹침 하나다. 인용은 모델이 쓴 그대로이며 코드가 걸러서 버리지 않는다. */
export interface ReviewFinding {
  /** 겹치는 후보 섹션의 주소다. */
  candidate: string;
  /** 새로 쓴 글에서 인용한 문장이다. */
  newQuote: string;
  /** 후보 섹션에서 인용한 문장이다. */
  candidateQuote: string;
}

/** 방향을 정한 겹침 하나다. */
export interface ReviewOverlap extends ReviewFinding {
  copiedBy: ReviewCopiedBy;
}

/** 응답에 담는 겹치는 문장 쌍 하나다. */
export interface WriteOverlap {
  /** changes 요청에서 이 문장을 쓴 항목의 위치다. 단일 요청에는 없다. */
  index?: number;
  /** 새 글이 들어갈 섹션의 주소다. */
  section: string;
  /** 새로 쓴 문장의 인용이다. */
  sentence: string;
  /** 겹치는 다른 섹션의 주소다. */
  address: string;
  /** 그 섹션의 문장 인용이다. */
  matchedSentence: string;
  /** 링크로 방향을 정했으면 어느 쪽이 옮겨 적었는지다. 모르면 없다. */
  copiedBy?: Exclude<ReviewCopiedBy, typeof reviewCopiedBy.unknown>;
}

/**
 * 방향을 정한 겹침을 응답 항목으로 바꾼다.
 * @param target 새 글이 들어갈 섹션이다.
 * @param overlap 방향을 정한 겹침이다.
 * @param withIndex changes 요청이면 true이며 항목 위치를 담는다.
 */
export function toWriteOverlap(
  target: ReviewTarget,
  overlap: ReviewOverlap,
  withIndex: boolean,
): WriteOverlap {
  return {
    ...(withIndex ? { index: target.index } : {}),
    section: target.address,
    sentence: overlap.newQuote,
    address: overlap.candidate,
    matchedSentence: overlap.candidateQuote,
    ...(overlap.copiedBy === reviewCopiedBy.unknown
      ? {}
      : { copiedBy: overlap.copiedBy }),
  };
}

/** 확인 값 계산에 넣는 저장 계획 항목 하나다. */
export interface ReviewTokenItem {
  index: number;
  mode: ChangePlanMode;
  path: string;
  previousPath?: string;
  /** 반영할 원문이다. delete에는 없다. */
  raw?: string;
}

/** 문서 이름과 섹션 이름으로 codocs_get 주소를 만든다. */
function sectionAddress(name: string, section: string): string {
  return `${encodeColon(name)}:${encodeColon(section)}`;
}

/** 문서 데이터의 최상위 문자열 값 키(`_codocs` 제외)를 섹션 이름과 본문으로 꺼낸다. */
function documentSections(
  data: Readonly<Record<string, unknown>> | undefined,
): [string, string][] {
  if (!data) return [];
  return Object.entries(data).filter(
    (entry): entry is [string, string] =>
      entry[0] !== codocsKey && typeof entry[1] === 'string',
  );
}

/** 문서 데이터의 `_codocs.name`이다. 없으면 undefined다. */
function documentName(
  data: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const metadata = data?.[codocsKey];
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const name = (metadata as Record<string, unknown>).name;
  return typeof name === 'string' ? name : undefined;
}

/** 카탈로그 문서의 해석된 데이터다. 해석에 실패했으면 undefined다. */
function catalogData(
  catalog: Catalog,
  path: string,
): Readonly<Record<string, unknown>> | undefined {
  const parsed = catalog.documents.get(path)?.observation.parsed;
  return parsed?.success ? parsed.data : undefined;
}

/**
 * 본문을 문장으로 나눈다. 줄로 나눈 뒤 숫자가 아닌 글자 다음의 마침표 뒤 공백에서 끊고, 빈 줄과 앞뒤 공백은 뺀다.
 * @param body 섹션 본문이다.
 */
export function splitSentences(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/(?<=[^0-9]\.)\s+/u))
    .map((text) => text.trim())
    .filter(Boolean);
}

/** 비교를 위해 공백과 구두점을 지운다. */
function plain(text: string): string {
  return text.replace(/[\s`.,:;()[\]'"·|*-]/gu, '');
}

/** 공백·구두점을 지운 글자 2-gram의 횟수다. */
function bigrams(text: string): Map<string, number> {
  const clean = plain(text);
  const counts = new Map<string, number>();
  for (let at = 0; at < clean.length - 1; at++) {
    const gram = clean.slice(at, at + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * 두 문장의 닮은 정도다. 공백과 구두점을 지운 글자 2-gram의 Dice 계수(0~1)다. 2-gram이 없으면 0이다.
 */
export function sentenceSimilarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  let shared = 0;
  let total = 0;
  for (const [gram, count] of a) {
    shared += Math.min(count, b.get(gram) ?? 0);
    total += count;
  }
  for (const count of b.values()) total += count;
  return total ? (2 * shared) / total : 0;
}

/**
 * 이전 본문과 비교해 반영 뒤 본문에서 새로 쓴 문장을 뽑는다.
 * 이전에 없던 문장 가운데 이전에만 있던 문장 하나와 닮은 정도 0.8 이상인 것은 기존 글을 고친 것으로 보고 뺀다.
 * @param before 이전 섹션 본문이다. 새 섹션이면 undefined이고 모든 문장이 새 문장이다.
 * @param after 반영 뒤 섹션 본문이다.
 */
export function extractNewSentences(
  before: string | undefined,
  after: string,
): string[] {
  const next = splitSentences(after);
  if (before === undefined) return next;
  const old = splitSentences(before);
  const removed = old.filter((text) => !next.includes(text));
  return next.filter(
    /** 이전에 없고 지운 문장을 고친 것도 아닌 문장만 남긴다. */ (text) =>
      !old.includes(text) &&
      !removed.some(
        (other) => sentenceSimilarity(text, other) >= editedSimilarity,
      ),
  );
}

/**
 * 인용이 든 문장을 본문에서 찾는다. 공백·구두점을 지운 포함 관계로 먼저 찾고, 없으면 닮은 정도 0.6 이상인 가장 닮은 문장을 고른다.
 * 공백·구두점을 지운 글자가 6자 미만인 문장은 포함 관계 비교에서 뺀다.
 * @returns 찾지 못하면 undefined다.
 */
export function findQuotedSentence(
  body: string,
  quote: string,
): string | undefined {
  const list = splitSentences(body);
  const key = plain(quote);
  const contained = list.find(
    /** 글자가 충분한 두 문장의 포함 관계를 본다. */ (text) => {
      const clean = plain(text);
      return (
        key.length >= quoteMinimumLength &&
        clean.length >= quoteMinimumLength &&
        (clean.includes(key) || key.includes(clean))
      );
    },
  );
  if (contained !== undefined) return contained;
  let best: { score: number; text: string } | undefined;
  for (const text of list) {
    const score = sentenceSimilarity(text, quote);
    if (!best || score > best.score) best = { score, text };
  }
  return best && best.score >= quoteSimilarity ? best.text : undefined;
}

/** 문장에 그 문서로 가는 `[[문서]]` 또는 `[[문서:…]]` 링크가 있는지 확인한다. 이름의 콜론은 `\:`로 쓴 표기를 찾는다. */
export function linksToDocument(text: string, name: string): boolean {
  const encoded = encodeColon(name);
  return text.includes(`[[${encoded}]]`) || text.includes(`[[${encoded}:`);
}

/**
 * 카탈로그의 섹션을 경로 순서로 모은다. YAML 해석에 성공하고 이름이 있는 문서의 최상위 문자열 값 키(`_codocs` 제외)다.
 */
export function collectReviewSections(catalog: Catalog): ReviewSection[] {
  const sections: ReviewSection[] = [];
  for (const path of [...catalog.documents.keys()].sort(compareText)) {
    const name = catalog.documents.get(path)?.name;
    if (name === undefined) continue;
    for (const [sectionName, body] of documentSections(
      catalogData(catalog, path),
    ))
      sections.push({
        documentPath: path,
        documentName: name,
        sectionName,
        address: sectionAddress(name, sectionName),
        body,
      });
  }
  return sections;
}

/** 후보 점수 계산용 색인이다. 섹션마다 `문서 이름 + 섹션 이름 + 본문`을 한 필드로 토큰화한다. */
export interface ReviewIndex {
  readonly sections: readonly ReviewSection[];
  readonly postings: ReadonlyMap<string, readonly [number, number][]>;
  readonly lengths: readonly number[];
  readonly averageLength: number;
}

/** 섹션 목록으로 후보 점수 색인을 만든다. */
export function buildReviewIndex(
  sections: readonly ReviewSection[],
): ReviewIndex {
  const postings = new Map<string, [number, number][]>();
  const lengths: number[] = [];
  sections.forEach(
    /** 섹션 하나의 용어 횟수를 색인에 더한다. */ (section, at) => {
      const terms = tokenize(
        `${section.documentName} ${section.sectionName} ${section.body}`,
      );
      lengths.push(terms.length);
      const counts = new Map<string, number>();
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const [term, count] of counts) {
        const list = postings.get(term) ?? [];
        list.push([at, count]);
        postings.set(term, list);
      }
    },
  );
  const averageLength = lengths.length
    ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length
    : 0;
  return { sections, postings, lengths, averageLength };
}

/**
 * 새 글로 가까운 섹션을 고른다. 새 글의 용어 집합을 검색어로 BM25(k1 1.2, b 0.75) 점수를 내 0보다 큰 섹션을 높은 순서로 돌려준다.
 * 같은 점수는 주소 순서다. 새 글이 들어가는 문서 자신의 섹션은 고르지 않는다.
 * @param documentPath 새 글이 들어가는 문서의 경로다.
 * @param text 새로 쓴 문장 전체다.
 * @param limit 최대 개수다.
 */
export function pickReviewCandidates(
  index: ReviewIndex,
  documentPath: string,
  text: string,
  limit: number = reviewCandidateLimit,
): ReviewSection[] {
  const total = index.sections.length;
  const scores = new Array<number>(total).fill(0);
  for (const term of new Set(tokenize(text))) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (total - list.length + 0.5) / (list.length + 0.5));
    for (const [at, count] of list) {
      const length = index.lengths[at] ?? 0;
      scores[at] =
        (scores[at] ?? 0) +
        (idf * count * (bm25K1 + 1)) /
          (count +
            bm25K1 *
              (1 - bm25B + (bm25B * length) / (index.averageLength || 1)));
    }
  }
  return index.sections
    .map((section, at) => ({ section, score: scores[at] ?? 0 }))
    .filter(
      (entry) => entry.score > 0 && entry.section.documentPath !== documentPath,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareText(left.section.address, right.section.address),
    )
    .slice(0, limit)
    .map((entry) => entry.section);
}

/**
 * 저장 계획에서 새로 쓴 문장이 있는 섹션과 그 후보를 고른다.
 * 후보는 요청을 반영한 뒤의 문서 상태에서 고르므로, 같은 요청에서 함께 만들거나 고친 다른 문서도 후보가 된다.
 * create는 모든 섹션의 모든 문장, update·replace는 반영 뒤 섹션에서 이전 섹션에 없던 문장이 새 문장이고 delete·move에는 없다.
 * @param catalog 요청을 반영하기 전의 카탈로그다.
 * @param changes 바뀌는 계획 항목이다. 바뀌지 않은 항목은 넣지 않는다.
 * @param excluded 탐지에서 뺄 문서 경로인지 판단한다. 제외된 문서는 후보가 아니고 그 문서에 쓴 글도 탐지하지 않는다.
 */
export function planReviewTargets(
  catalog: Catalog,
  changes: readonly ReviewChange[],
  excluded: (path: string) => boolean = () => false,
): ReviewTarget[] {
  const removed = new Set<string>();
  const added: ReviewSection[] = [];
  for (const change of changes) {
    const fromPath = change.previousPath ?? change.path;
    if (catalog.documents.has(fromPath)) removed.add(fromPath);
    if (change.mode === changePlanModes.delete) continue;
    const data = change.data ?? catalogData(catalog, fromPath);
    const name = documentName(data) ?? catalog.documents.get(fromPath)?.name;
    if (name === undefined) continue;
    for (const [sectionName, body] of documentSections(data))
      added.push({
        documentPath: change.path,
        documentName: name,
        sectionName,
        address: sectionAddress(name, sectionName),
        body,
      });
  }
  const after = [
    ...collectReviewSections(catalog).filter(
      (section) => !removed.has(section.documentPath),
    ),
    ...added,
  ].filter((section) => !excluded(section.documentPath));
  const index = buildReviewIndex(after);
  const targets: ReviewTarget[] = [];
  for (const change of changes) {
    if (
      (change.mode !== changePlanModes.create &&
        change.mode !== changePlanModes.update &&
        change.mode !== changePlanModes.replace) ||
      !change.data ||
      excluded(change.path)
    )
      continue;
    const name = documentName(change.data);
    if (name === undefined) continue;
    const before =
      change.mode === changePlanModes.create
        ? undefined
        : catalogData(catalog, change.path);
    const previous = new Map(documentSections(before));
    for (const [sectionName, body] of documentSections(change.data)) {
      const sentences = extractNewSentences(previous.get(sectionName), body);
      if (!sentences.length) continue;
      targets.push({
        index: change.index,
        documentPath: change.path,
        documentName: name,
        sectionName,
        address: sectionAddress(name, sectionName),
        sentences,
        candidates: pickReviewCandidates(
          index,
          change.path,
          sentences.join('\n'),
        ),
      });
    }
  }
  return targets;
}

/**
 * 겹침 하나의 방향을 겹치는 문장의 링크로만 정한다.
 * 새 문장에만 후보 문서로 가는 링크가 있으면 new, 후보 문장에만 이 문서로 가는 링크가 있으면 existing이다.
 * 인용이 든 문장을 어느 한쪽에서 찾지 못했거나 링크가 없거나 양쪽 모두 있으면 unknown이다.
 */
export function judgeOverlap(
  target: ReviewTarget,
  finding: ReviewFinding,
): ReviewOverlap {
  const candidate = target.candidates.find(
    (section) => section.address === finding.candidate,
  );
  const mine = findQuotedSentence(
    target.sentences.join('\n'),
    finding.newQuote,
  );
  const theirs = candidate
    ? findQuotedSentence(candidate.body, finding.candidateQuote)
    : undefined;
  let copiedBy: ReviewCopiedBy = reviewCopiedBy.unknown;
  if (candidate && mine !== undefined && theirs !== undefined) {
    const out = linksToDocument(mine, candidate.documentName);
    const back = linksToDocument(theirs, target.documentName);
    if (out && !back) copiedBy = reviewCopiedBy.new;
    else if (back && !out) copiedBy = reviewCopiedBy.existing;
  }
  return { ...finding, copiedBy };
}

/** 겹침 목록으로 요청 처리를 정한다. 하나라도 existing이 아니면 막고, 모두 existing이면 저장하고 알린다. */
export function decideReview(
  overlaps: readonly Pick<ReviewOverlap, 'copiedBy'>[],
): ReviewDecision {
  if (!overlaps.length) return reviewDecisions.save;
  return overlaps.every(
    (overlap) => overlap.copiedBy === reviewCopiedBy.existing,
  )
    ? reviewDecisions.saveWithOverlaps
    : reviewDecisions.block;
}

/**
 * 확인 값의 원문을 만든다. 저장하려던 항목의 위치·종류·경로·원문을 입력 순서로 담은 JSON이며, 내용이 하나라도 다르면 결과도 다르다.
 * 서버만 아는 값과 섞어 해시하는 것은 호출자가 한다.
 */
export function reviewTokenPayload(items: readonly ReviewTokenItem[]): string {
  return JSON.stringify(
    [...items]
      .sort((left, right) => left.index - right.index)
      .map(
        /** 항목 하나를 순서가 고정된 배열로 바꾼다. */ (item) => [
          item.index,
          item.mode,
          item.path,
          item.previousPath ?? null,
          item.raw ?? null,
        ],
      ),
  );
}
