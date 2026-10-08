import { compareText, type Catalog } from '../catalog/index.js';
import { tokenize } from './tokenize.js';

/** BM25F 포화 계수다. 출처: COD-65 프로토타입의 튜닝값(k1 4)이다. */
const bm25K1 = 4;
/** 본문 필드의 길이 정규화 정도다. 출처: COD-65 프로토타입의 튜닝값(b 0.3)이다. */
const bodyLengthNormalization = 0.3;
/** 이름 필드는 짧아 길이 정규화를 약하게 고정한다. 출처: COD-65 프로토타입(nameB 0.3)이다. */
const nameLengthNormalization = 0.3;
/** 필드 가중치다. 문서 이름 3, 섹션 이름 10, 본문 1이다. 출처: COD-65 프로토타입의 튜닝값(wDn 3, wSn 10)이다. */
const fieldWeights = [3, 10, 1] as const;
/** 필드별 길이 정규화 정도다. fieldWeights와 같은 순서다. */
const fieldLengthNormalizations = [
  nameLengthNormalization,
  nameLengthNormalization,
  bodyLengthNormalization,
] as const;
/** 결과로 고르는 상위 섹션의 최대 개수다. */
const searchSectionLimit = 10;

/** 필드 인덱스다. 0은 문서 이름, 1은 섹션 이름, 2는 본문이다. */
type FieldTermCounts = [number, number, number];

/** 색인에 담긴 섹션 하나다. */
interface SearchSection {
  /** 문서를 구분하는 카탈로그 경로다. 이름 충돌 문서도 서로 다른 문서로 취급한다. */
  documentPath: string;
  /** 문서 이름 원문이다. */
  documentName: string;
  /** 섹션 이름 원문이다. */
  sectionName: string;
}

/** 용어 하나가 한 섹션에서 필드별로 나온 횟수다. */
interface Posting {
  section: number;
  counts: FieldTermCounts;
}

/**
 * 카탈로그에서 만든 섹션 검색 색인이다. 전달받은 카탈로그에서만 파생하며 내부 구조는 공개 계약이 아니다.
 */
export interface SearchIndex {
  readonly sections: readonly SearchSection[];
  readonly postings: ReadonlyMap<string, readonly Posting[]>;
  /** 필드별로 섹션마다 용어 개수다. */
  readonly fieldLengths: readonly [
    readonly number[],
    readonly number[],
    readonly number[],
  ];
  /** 필드별 평균 용어 개수다. */
  readonly averageLengths: readonly [number, number, number];
}

/** 검색 결과 항목 하나다. */
export interface SearchItem {
  /** codocs_get 주소다. 문서 이름 또는 `이름:섹션`이며 콜론은 `\:`로 쓴다. */
  address: string;
  /** 검색어별 정규화 점수의 최댓값이다. 0 초과 1 이하다. */
  score: number;
  /** 이 항목이 걸린 검색어 원문이다. 입력 순서를 따른다. */
  queries: string[];
  /** 같은 문서의 섹션 둘 이상을 문서 주소로 묶은 경우 걸린 섹션 이름이다. 점수 순서를 따른다. */
  sections?: string[];
}

/** 검색 결과다. */
export interface SearchResult {
  items: SearchItem[];
  /** 0보다 큰 점수가 하나도 없는 검색어 원문이다. 입력 순서를 따른다. */
  emptyQueries: string[];
}

/** 참조 구성 안의 콜론을 구분자와 구분되도록 `\:`로 쓴다. 카탈로그의 참조 표기 규칙과 같다. */
function encodeColon(value: string): string {
  return value.replace(/:/gu, '\\:');
}

/** 문서 이름과 섹션 이름으로 codocs_get 주소를 만든다. 섹션이 없으면 문서 주소다. */
function formatAddress(name: string, section?: string): string {
  return section === undefined
    ? encodeColon(name)
    : `${encodeColon(name)}:${encodeColon(section)}`;
}

/** 색인에 넣을 섹션 원문 하나다. */
interface SectionSource extends SearchSection {
  body: string;
}

/**
 * 카탈로그에서 색인 대상 섹션을 모은다.
 * YAML 해석에 성공하고 이름이 있는 문서의 최상위 문자열 값 키(`_codocs` 제외)를 경로 순서로 담는다.
 */
function collectSections(catalog: Catalog): SectionSource[] {
  const sources: SectionSource[] = [];
  const paths = [...catalog.documents.keys()].sort(compareText);
  for (const path of paths) {
    const document = catalog.documents.get(path);
    const parsed = document?.observation.parsed;
    if (!document || document.name === undefined || !parsed?.success) continue;
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key === '_codocs' || typeof value !== 'string') continue;
      sources.push({
        documentPath: path,
        documentName: document.name,
        sectionName: key,
        body: value,
      });
    }
  }
  return sources;
}

/** 섹션 하나의 필드별 용어 목록이다. */
function fieldTerms(source: SectionSource): [string[], string[], string[]] {
  return [
    tokenize(source.documentName),
    tokenize(source.sectionName),
    tokenize(source.body),
  ];
}

/** 색인 원문에서 본문을 뺀 섹션 정보만 꺼낸다. */
function toSearchSection(source: SectionSource): SearchSection {
  const { documentPath, documentName, sectionName } = source;
  return { documentPath, documentName, sectionName };
}

/** 용어 목록의 용어별 등장 횟수를 필드 위치에 더한다. */
function countTerms(
  counts: Map<string, FieldTermCounts>,
  terms: readonly string[],
  field: 0 | 1 | 2,
): void {
  for (const term of terms) {
    const entry = counts.get(term) ?? [0, 0, 0];
    entry[field]++;
    counts.set(term, entry);
  }
}

/** 값 목록의 평균이다. 비어 있으면 0이다. */
function average(values: readonly number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

/**
 * 카탈로그에서 섹션 검색 색인을 만든다. 파일 IO와 전역 캐시 없이 전달받은 카탈로그에서만 계산한다.
 * @param catalog 색인 대상 카탈로그다.
 * @returns 같은 카탈로그에서 항상 같은 색인이다.
 */
export function buildSearchIndex(catalog: Catalog): SearchIndex {
  const sources = collectSections(catalog);
  const postings = new Map<string, Posting[]>();
  const fieldLengths: [number[], number[], number[]] = [[], [], []];
  for (const [section, source] of sources.entries()) {
    const terms = fieldTerms(source);
    const counts = new Map<string, FieldTermCounts>();
    for (const field of [0, 1, 2] as const) {
      fieldLengths[field].push(terms[field].length);
      countTerms(counts, terms[field], field);
    }
    for (const [term, termCounts] of counts) {
      const list = postings.get(term) ?? [];
      list.push({ section, counts: termCounts });
      postings.set(term, list);
    }
  }
  return {
    sections: sources.map(toSearchSection),
    postings,
    fieldLengths,
    averageLengths: [
      average(fieldLengths[0]),
      average(fieldLengths[1]),
      average(fieldLengths[2]),
    ],
  };
}

/**
 * 검색어 하나의 섹션별 BM25F 점수를 계산한다.
 * idf는 `ln(1 + (N - df + 0.5) / (df + 0.5))`이며 df는 어느 필드에든 용어가 있는 섹션 수다.
 */
function scoreQuery(index: SearchIndex, query: string): number[] {
  const total = index.sections.length;
  const scores = new Array<number>(total).fill(0);
  for (const term of new Set(tokenize(query))) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (total - list.length + 0.5) / (list.length + 0.5));
    for (const { section, counts } of list) {
      let weighted = 0;
      for (const field of [0, 1, 2] as const) {
        const count = counts[field];
        if (!count) continue;
        const length = index.fieldLengths[field][section] ?? 0;
        const average = index.averageLengths[field];
        weighted +=
          (fieldWeights[field] * count) /
          (1 + fieldLengthNormalizations[field] * (length / average - 1));
      }
      scores[section] =
        (scores[section] ?? 0) + idf * (weighted / (bm25K1 + weighted));
    }
  }
  return scores;
}

/** 섹션 하나의 검색어 종합 결과다. */
interface SectionHit {
  section: number;
  address: string;
  score: number;
  /** 0보다 큰 정규화 점수로 걸린 검색어의 입력 위치다. 오름차순이다. */
  queryIndexes: number[];
}

/** 점수 내림차순, 걸린 검색어 수 내림차순, 주소, 문서 경로 순으로 비교한다. */
function compareHits(
  left: SectionHit,
  right: SectionHit,
  index: SearchIndex,
): number {
  return (
    right.score - left.score ||
    right.queryIndexes.length - left.queryIndexes.length ||
    compareText(left.address, right.address) ||
    compareText(
      index.sections[left.section]?.documentPath ?? '',
      index.sections[right.section]?.documentPath ?? '',
    )
  );
}

/** 상위 섹션을 문서 경로별로 모은다. 순서는 각 문서의 가장 높은 섹션 순위를 따른다. */
function groupByDocument(
  hits: readonly SectionHit[],
  index: SearchIndex,
): SectionHit[][] {
  const groups = new Map<string, SectionHit[]>();
  for (const hit of hits) {
    const path = index.sections[hit.section]?.documentPath ?? '';
    groups.set(path, [...(groups.get(path) ?? []), hit]);
  }
  return [...groups.values()];
}

/** 문서 하나의 상위 섹션들을 결과 항목으로 바꾼다. 둘 이상이면 문서 주소 하나로 묶는다. */
function toItem(
  group: readonly SectionHit[],
  index: SearchIndex,
  queries: readonly string[],
): SearchItem {
  const queryIndexes = [
    ...new Set(group.flatMap((hit) => hit.queryIndexes)),
  ].sort((left, right) => left - right);
  const item: SearchItem = {
    address: group[0]?.address ?? '',
    score: Math.max(...group.map((hit) => hit.score)),
    queries: queryIndexes.map((position) => queries[position] ?? ''),
  };
  if (group.length < 2) return item;
  const documentName = index.sections[group[0]?.section ?? 0]?.documentName;
  return {
    ...item,
    address: formatAddress(documentName ?? ''),
    sections: group.map(
      (hit) => index.sections[hit.section]?.sectionName ?? '',
    ),
  };
}

/** 점수가 아직 없는 섹션별 종합 결과를 색인 순서대로 만든다. */
function createSectionHits(index: SearchIndex): SectionHit[] {
  const hits: SectionHit[] = [];
  for (const [position, section] of index.sections.entries())
    hits.push({
      section: position,
      address: formatAddress(section.documentName, section.sectionName),
      score: 0,
      queryIndexes: [],
    });
  return hits;
}

/**
 * 검색어 하나의 섹션별 점수를 1위 기준으로 정규화해 종합 결과에 반영한다.
 * @returns 0보다 큰 점수가 하나라도 있으면 true, 걸린 것이 없으면 false다.
 */
function applyQuery(
  hits: readonly SectionHit[],
  scores: readonly number[],
  queryIndex: number,
): boolean {
  const top = Math.max(0, ...scores);
  if (top <= 0) return false;
  for (const [position, raw] of scores.entries()) {
    const hit = hits[position];
    if (!hit || raw <= 0) continue;
    hit.score = Math.max(hit.score, raw / top);
    hit.queryIndexes.push(queryIndex);
  }
  return true;
}

/**
 * 검색어 여러 개로 색인을 검색한다. 입력 개수·길이 검증은 호출하는 쪽이 맡는다.
 * 검색어마다 1위를 1.0으로 정규화하고 섹션 점수는 그 최댓값으로 정해 상위 10개 섹션을 고른다.
 * 상위 안에서 같은 문서의 섹션이 둘 이상이면 문서 주소 하나로 묶고 빈 자리는 채우지 않는다.
 * @param index buildSearchIndex로 만든 색인이다.
 * @param queries 검색어 원문 목록이다.
 * @returns 결과 항목과 걸린 것이 없는 검색어다. 같은 입력은 같은 결과를 낸다.
 */
export function searchCatalog(
  index: SearchIndex,
  queries: readonly string[],
): SearchResult {
  const hits = createSectionHits(index);
  const emptyQueries: string[] = [];
  for (const [queryIndex, query] of queries.entries())
    if (!applyQuery(hits, scoreQuery(index, query), queryIndex))
      emptyQueries.push(query);
  const ranked = hits
    .filter((hit) => hit.score > 0)
    .sort((left, right) => compareHits(left, right, index))
    .slice(0, searchSectionLimit);
  return {
    items: groupByDocument(ranked, index).map((group) =>
      toItem(group, index, queries),
    ),
    emptyQueries,
  };
}
