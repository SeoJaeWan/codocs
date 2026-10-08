import { describe, expect, it } from 'vitest';
import { buildCatalog, scanStatuses, type Catalog } from '../catalog/index.js';
import { parseYaml } from '../parser/index.js';
import { buildSearchIndex, searchCatalog, type SearchItem } from './index.js';
import {
  benchmarkCases,
  type BenchmarkCase,
  type BenchmarkLanguage,
} from './test-support/benchmark-cases.js';
import { shopCorpus } from './test-support/shop-corpus.js';

/**
 * 첫 측정(2026-10-08, TASK-001 커밋 9fed405 기준)에서 필요한 섹션에 모두 닿은 케이스 수의 하한이다.
 * 첫 측정 값은 38개 중 36개(94.7%)이며 바로 있음 27, 묶음 안 1, 링크 8, 닿지 못함 2였다.
 */
const minimumReachedCases = 36;
/** 첫 측정(2026-10-08)에서 닿은 필요 섹션 수의 하한이다. 필요 섹션 77개 중 75개였다. */
const minimumReachedSections = 75;

/** 필요한 섹션이 도달한 방식이다. */
type Reach = 'direct' | 'group' | 'link' | 'unreachable';
const reachOrder: readonly Reach[] = ['direct', 'group', 'link', 'unreachable'];

/** fixture 코퍼스의 YAML 원문을 core 순수 함수로 해석해 카탈로그를 만든다. */
function loadFixtureCatalog(): Catalog {
  return buildCatalog({
    status: scanStatuses.complete,
    observations: Object.entries(shopCorpus).map(([path, source]) => ({
      path,
      parsed: parseYaml(source, path),
    })),
  });
}

/** 링크가 가리키는 대상이다. section이 없으면 문서 전체다. */
interface LinkTarget {
  document: string;
  section?: string;
}

/** `문서 이름:섹션 이름` 형식의 주소를 나눈다. fixture의 이름에는 콜론이 없다. */
function splitAddress(address: string): LinkTarget {
  const separator = address.indexOf(':');
  return separator < 0
    ? { document: address }
    : {
        document: address.slice(0, separator),
        section: address.slice(separator + 1),
      };
}

/** 문서 이름과 섹션 이름으로 만든 맵 키다. */
function key(document: string, section: string): string {
  return `${document}:${section}`;
}

/** 확정된 참조를 `출발 섹션 → 대상 목록`으로 모은다. */
function collectLinks(catalog: Catalog): Map<string, LinkTarget[]> {
  const names = new Map<string, string>();
  for (const [path, document] of catalog.documents)
    if (document.name !== undefined) names.set(path, document.name);
  const links = new Map<string, LinkTarget[]>();
  for (const [targetPath, target] of catalog.documents) {
    const targetName = names.get(targetPath);
    if (targetName === undefined) continue;
    for (const backlink of target.sectionReferencedBy) {
      const sourceName = names.get(backlink.sourcePath);
      if (sourceName === undefined) continue;
      const entry = key(sourceName, backlink.sourceSection);
      const list = links.get(entry) ?? [];
      list.push(
        backlink.targetSection === undefined
          ? { document: targetName }
          : { document: targetName, section: backlink.targetSection },
      );
      links.set(entry, list);
    }
  }
  return links;
}

/** 문서 이름별 섹션 이름 목록이다. */
function collectSectionNames(catalog: Catalog): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  for (const document of catalog.documents.values()) {
    const parsed = document.observation.parsed;
    if (document.name === undefined || !parsed.success) continue;
    sections.set(
      document.name,
      Object.entries(parsed.data)
        .filter(
          ([name, value]) => name !== '_codocs' && typeof value === 'string',
        )
        .map(([name]) => name),
    );
  }
  return sections;
}

const catalog = loadFixtureCatalog();
const index = buildSearchIndex(catalog);
const links = collectLinks(catalog);
const sectionNames = collectSectionNames(catalog);

/** 상위 결과 항목이 가리키는 섹션 주소 목록이다. 묶인 문서는 걸린 섹션을 푼다. */
function directSections(items: readonly SearchItem[]): Set<string> {
  const direct = new Set<string>();
  for (const item of items) {
    const { document, section } = splitAddress(
      item.address.replace(/\\:/gu, ':'),
    );
    if (item.sections)
      for (const name of item.sections) direct.add(key(document, name));
    else if (section !== undefined) direct.add(key(document, section));
  }
  return direct;
}

/** 필요한 섹션 하나가 상위 결과에 어떻게 닿는지 판정한다. */
function classify(needed: string, items: readonly SearchItem[]): Reach {
  const direct = directSections(items);
  if (direct.has(needed)) return 'direct';
  const target = splitAddress(needed);
  const groupedDocuments = new Set(
    items
      .filter((item) => item.sections)
      .map((item) => splitAddress(item.address.replace(/\\:/gu, ':')).document),
  );
  if (groupedDocuments.has(target.document)) return 'group';
  const sources = new Set<string>(direct);
  for (const document of groupedDocuments)
    for (const name of sectionNames.get(document) ?? [])
      sources.add(key(document, name));
  for (const source of sources)
    for (const link of links.get(source) ?? [])
      if (
        link.document === target.document &&
        (link.section === undefined || link.section === target.section)
      )
        return 'link';
  return 'unreachable';
}

/** 케이스 하나의 측정 결과다. */
interface CaseOutcome {
  testCase: BenchmarkCase;
  sections: { needed: string; reach: Reach }[];
  /** 가장 먼 도달 방식이다. 하나라도 닿지 못하면 unreachable이다. */
  reach: Reach;
}

/** 케이스 하나를 검색해 필요한 섹션별 도달 방식을 계산한다. */
function measure(testCase: BenchmarkCase): CaseOutcome {
  const { items } = searchCatalog(index, testCase.queries);
  const sections = testCase.needed.map((needed) => ({
    needed,
    reach: classify(needed, items),
  }));
  const farthest = Math.max(
    ...sections.map((entry) => reachOrder.indexOf(entry.reach)),
  );
  return { testCase, sections, reach: reachOrder[farthest] ?? 'unreachable' };
}

const outcomes = benchmarkCases.map(measure);

/** 측정 대상 언어 목록이다. */
const languages: readonly (BenchmarkLanguage | 'all')[] = [
  'all',
  'ko',
  'en',
  'mixed',
];

/** 언어별로 케이스 단위 도달 방식 개수를 센다. */
function tally(language: BenchmarkLanguage | 'all'): Record<Reach, number> & {
  total: number;
  reached: number;
} {
  const selected = outcomes.filter(
    (outcome) => language === 'all' || outcome.testCase.language === language,
  );
  const counts = { direct: 0, group: 0, link: 0, unreachable: 0 };
  for (const outcome of selected) counts[outcome.reach]++;
  return {
    ...counts,
    total: selected.length,
    reached: selected.length - counts.unreachable,
  };
}

/** 측정 요약 표 문자열이다. 케이스는 가장 먼 도달 방식 기준이다. */
function summaryTable(): string {
  const rows = languages.map((language) => {
    const t = tally(language);
    const rate = t.total ? ((t.reached / t.total) * 100).toFixed(1) : '0.0';
    return `| ${language} | ${t.total} | ${t.direct} | ${t.group} | ${t.link} | ${t.unreachable} | ${rate}% |`;
  });
  const sectionTotals = { direct: 0, group: 0, link: 0, unreachable: 0 };
  for (const outcome of outcomes)
    for (const entry of outcome.sections) sectionTotals[entry.reach]++;
  const sectionCount = outcomes.reduce((sum, o) => sum + o.sections.length, 0);
  const unreachable = outcomes.flatMap((outcome) =>
    outcome.sections
      .filter((entry) => entry.reach === 'unreachable')
      .map((entry) => `- ${outcome.testCase.id}: ${entry.needed}`),
  );
  return [
    '| 언어 | 케이스 | 바로 있음 | 묶음 안 | 링크로 이어짐 | 닿지 못함 | 도달률 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `섹션 단위(${sectionCount}개): direct ${sectionTotals.direct}, group ${sectionTotals.group}, link ${sectionTotals.link}, unreachable ${sectionTotals.unreachable}`,
    ...(unreachable.length ? ['닿지 못한 섹션:', ...unreachable] : []),
  ].join('\n');
}

describe('codocs_search 도달 효과 측정', () => {
  it('케이스를 모으면 30개 이상이고 한국어·영어·혼합을 모두 포함한다', () => {
    expect(benchmarkCases.length).toBeGreaterThanOrEqual(30);
    for (const language of ['ko', 'en', 'mixed'] as const)
      expect(
        benchmarkCases.some((testCase) => testCase.language === language),
      ).toBe(true);
  });

  it('케이스를 검사하면 검색어는 2~6개이고 필요한 섹션은 fixture에 실제로 있다', () => {
    for (const testCase of benchmarkCases) {
      expect(testCase.queries.length).toBeGreaterThanOrEqual(2);
      expect(testCase.queries.length).toBeLessThanOrEqual(6);
      for (const needed of testCase.needed) {
        const { document, section } = splitAddress(needed);
        expect(sectionNames.get(document), needed).toContain(section);
      }
    }
  });

  it('fixture를 읽으면 문서 41개와 섹션 165개를 모두 색인한다', () => {
    expect(catalog.documents.size).toBe(41);
    expect(index.sections).toHaveLength(165);
  });

  it('케이스를 검색하면 전체 도달 수가 첫 측정 하한 이상이다', () => {
    const table = summaryTable();
    const overall = tally('all');
    expect(overall.reached, table).toBeGreaterThanOrEqual(minimumReachedCases);
    const reachedSections = outcomes
      .flatMap((outcome) => outcome.sections)
      .filter((entry) => entry.reach !== 'unreachable').length;
    expect(reachedSections, table).toBeGreaterThanOrEqual(
      minimumReachedSections,
    );
  });
});
