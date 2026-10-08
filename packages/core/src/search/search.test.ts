import { describe, expect, it } from 'vitest';
import { buildCatalog, scanStatuses, type Catalog } from '../catalog/index.js';
import { parseYaml } from '../parser/index.js';
import { buildSearchIndex, searchCatalog } from './index.js';
import { tokenize } from './tokenize.js';

/** 문서 하나의 YAML 원문을 만든다. 본문은 `섹션: 내용` 줄들이다. */
function documentSource(
  id: string,
  name: string,
  sections: Record<string, string>,
): string {
  const body = Object.entries(sections)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`)
    .join('');
  return `_codocs:\n  id: ${id}\n  name: ${JSON.stringify(name)}\n${body}`;
}

/** 실제 파서로 관측한 원문들에서 Catalog를 만든다. */
function catalogFromSources(sources: Record<string, string>): Catalog {
  return buildCatalog({
    status: scanStatuses.complete,
    observations: Object.entries(sources).map(([path, source]) => ({
      path,
      parsed: parseYaml(source, path),
    })),
  });
}

/** 문서 이름과 섹션 맵 목록에서 Catalog를 만든다. 경로와 ID는 순번으로 정한다. */
function catalogOf(
  documents: readonly [string, Record<string, string>][],
): Catalog {
  return catalogFromSources(
    Object.fromEntries(
      documents.map(([name, sections], index) => [
        `d${index}.yaml`,
        documentSource(`d${index}`, name, sections),
      ]),
    ),
  );
}

/** 카탈로그에서 색인을 만들어 한 번에 검색한다. */
function search(
  catalog: Catalog,
  queries: string[],
): ReturnType<typeof searchCatalog> {
  return searchCatalog(buildSearchIndex(catalog), queries);
}

describe('tokenize: 검색 용어 분리', () => {
  it.each([
    [
      '한글 연속 구간은 글자 2·3-gram',
      '세션이 준비됩니다',
      [
        '세션',
        '션이',
        '세션이',
        '준비',
        '비됩',
        '됩니',
        '니다',
        '준비됩',
        '비됩니',
        '됩니다',
      ],
    ],
    ['한 글자 구간은 그대로', '한', ['한']],
    [
      '요청 어미 불용어는 어절 통째 일치일 때만 제외',
      '도구 목록을 알려줘',
      ['도구', '목록', '록을', '목록을'],
    ],
    [
      '불용어 어절을 포함한 더 긴 구간은 제외하지 않음',
      '알려줘요',
      ['알려', '려줘', '줘요', '알려줘', '려줘요'],
    ],
    [
      '영문은 소문자와 가벼운 어간',
      'Searching queries documented',
      ['search', 'query', 'document'],
    ],
    [
      'snake 식별자는 조각과 전체',
      'codocs_get',
      ['codoc', 'get', 'codocs_get'],
    ],
    [
      'kebab 식별자는 조각과 전체',
      'user-name_id',
      ['user', 'name', 'id', 'user-name_id'],
    ],
    [
      'camel 식별자는 조각과 전체',
      'getSectionNames',
      ['get', 'section', 'name', 'getsectionnames'],
    ],
    ['약어가 이어진 camel 식별자', 'MCPServer', ['mcp', 'server', 'mcpserver']],
    ['영문 불용어와 한 글자 영문은 제외', 'a b the', []],
    ['숫자 한 글자는 유지', 'a1 b', ['a1']],
  ])('%s', (_label, text, expected) => {
    expect(tokenize(text)).toEqual(expected);
  });
});

describe('searchCatalog: 점수와 상위 섹션 선택', () => {
  const catalog = catalogOf([
    [
      '인증',
      { 개요: '로그인 토큰을 발급한다.', 만료: '토큰 만료 시간을 정한다.' },
    ],
    ['배포', { 개요: '릴리스를 배포한다.' }],
    ['캐시', { 개요: '응답을 캐시에 저장한다.' }],
  ]);

  it('검색어의 1위 섹션을 점수 1로 정규화하고 걸린 검색어를 담는다', () => {
    const result = search(catalog, ['릴리스']);
    expect(result.items).toEqual([
      { address: '배포:개요', score: 1, queries: ['릴리스'] },
    ]);
    expect(result.emptyQueries).toEqual([]);
  });

  it('섹션 이름이 본문보다 높은 가중으로 점수에 반영된다', () => {
    const named = catalogOf([
      ['가', { 만료: '다른 설명이다.' }],
      ['나', { 개요: '만료 설명이다.' }],
    ]);
    expect(search(named, ['만료']).items.map((item) => item.address)).toEqual([
      '가:만료',
      '나:개요',
    ]);
  });

  it('섹션 점수는 검색어별 정규화 점수의 최댓값이고 걸린 검색어는 입력 순서다', () => {
    const result = search(catalog, ['릴리스', '토큰 만료', '릴리스']);
    const deploy = result.items.find((item) => item.address === '배포:개요');
    expect(deploy).toEqual({
      address: '배포:개요',
      score: 1,
      queries: ['릴리스', '릴리스'],
    });
    expect(
      result.items.every((item) => item.score > 0 && item.score <= 1),
    ).toBe(true);
  });

  it('같은 점수이면 걸린 검색어 수가 많은 섹션이 앞이다', () => {
    // '알파'만 있는 가는 알파 1위(1.0), '알파 베타'가 있는 나는 알파·베타 모두 1위(1.0)라 점수가 같다.
    const tie = catalogOf([
      ['가', { 개요: '알파' }],
      ['나', { 개요: '알파 베타' }],
    ]);
    const result = search(tie, ['알파', '베타']);
    expect(result.items.map((item) => item.address)).toEqual([
      '나:개요',
      '가:개요',
    ]);
    expect(result.items.map((item) => item.score)).toEqual([1, 1]);
    expect(result.items[0]?.queries).toEqual(['알파', '베타']);
  });

  it('점수가 같으면 주소 문자열 순서로 결정한다', () => {
    const same = catalogOf([
      ['나', { 개요: '감마' }],
      ['가', { 개요: '감마' }],
    ]);
    expect(search(same, ['감마']).items.map((item) => item.address)).toEqual([
      '가:개요',
      '나:개요',
    ]);
  });

  it('상위 섹션은 10개까지만 고르고 묶인 뒤 빈 자리는 채우지 않는다', () => {
    const many = catalogOf(
      Array.from({ length: 14 }, (_, index) => [
        `문서${String.fromCharCode(0x61 + index)}`,
        { 개요: '공통어' },
      ]),
    );
    expect(search(many, ['공통어']).items).toHaveLength(10);
  });

  it('같은 입력은 같은 결과를 낸다', () => {
    const first = search(catalog, ['토큰', '배포', '없는말']);
    const second = search(catalog, ['토큰', '배포', '없는말']);
    expect(second).toEqual(first);
  });
});

describe('searchCatalog: 같은 문서 섹션 묶기', () => {
  const catalog = catalogOf([
    ['인증', { 개요: '토큰 발급', 만료: '토큰 만료', 기타: '관계없음' }],
    ['배포', { 개요: '토큰 배포' }],
  ]);

  it('같은 문서 섹션이 둘 이상이면 문서 주소로 묶고 걸린 섹션 이름을 담는다', () => {
    const result = search(catalog, ['토큰']);
    const grouped = result.items.find((item) => item.address === '인증');
    expect(grouped?.sections?.slice().sort()).toEqual(['개요', '만료']);
    expect(grouped?.queries).toEqual(['토큰']);
  });

  it('섹션이 하나뿐인 문서는 섹션 주소로 남고 sections가 없다', () => {
    const result = search(catalog, ['토큰']);
    const single = result.items.find((item) => item.address === '배포:개요');
    expect(single).toBeDefined();
    expect(single).not.toHaveProperty('sections');
  });

  it('묶인 항목의 점수는 섹션 점수의 최댓값이고 순서는 가장 높은 섹션 순위를 따른다', () => {
    const result = search(catalog, ['토큰']);
    const scores = result.items.map((item) => item.score);
    expect(Math.max(...scores)).toBe(1);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
  });

  it('문서 크기와 관계없이 두 섹션만 있는 문서도 묶는다', () => {
    const small = catalogOf([['작은', { 하나: '고유어', 둘: '고유어' }]]);
    expect(search(small, ['고유어']).items).toEqual([
      {
        address: '작은',
        score: 1,
        queries: ['고유어'],
        sections: ['둘', '하나'],
      },
    ]);
  });

  it('여러 검색어가 서로 다른 섹션에 걸리면 묶인 항목의 queries는 입력 순서의 합집합이다', () => {
    const split = catalogOf([['문서', { 가: '알파', 나: '베타' }]]);
    const result = search(split, ['베타', '알파']);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.address).toBe('문서');
    expect(result.items[0]?.queries).toEqual(['베타', '알파']);
  });
});

describe('searchCatalog: 걸린 것이 없는 검색어', () => {
  const catalog = catalogOf([['인증', { 개요: '토큰 발급' }]]);

  it('걸린 것이 없으면 빈 결과와 검색어별 결과 없음을 낸다', () => {
    expect(search(catalog, ['없는말', '존재안함'])).toEqual({
      items: [],
      emptyQueries: ['없는말', '존재안함'],
    });
  });

  it('일부 검색어만 걸리면 걸린 검색어는 결과에, 아닌 검색어는 emptyQueries에 담는다', () => {
    const result = search(catalog, ['토큰', '없는말']);
    expect(result.items.map((item) => item.address)).toEqual(['인증:개요']);
    expect(result.emptyQueries).toEqual(['없는말']);
  });

  it('용어가 하나도 남지 않는 검색어는 결과 없음이다', () => {
    expect(search(catalog, ['알려줘', '  ']).emptyQueries).toEqual([
      '알려줘',
      '  ',
    ]);
  });

  it('문서가 없는 카탈로그는 모든 검색어가 결과 없음이다', () => {
    expect(search(catalogOf([]), ['토큰'])).toEqual({
      items: [],
      emptyQueries: ['토큰'],
    });
  });
});

describe('buildSearchIndex: 색인 대상 문서와 섹션', () => {
  it('콜론이 든 이름과 섹션은 \\:로 escape한 주소를 낸다', () => {
    const colon = catalogOf([['a:b', { 'x:y': '콜론시험' }]]);
    expect(search(colon, ['콜론시험']).items[0]?.address).toBe('a\\:b:x\\:y');
  });

  it('해석에 성공한 문서는 규칙 위반이 있어도 대상이다', () => {
    const invalid = catalogFromSources({
      'bad.yaml': '_codocs:\n  id: BAD ID\n  name: 위반\n개요: 위반어\n',
    });
    expect(
      search(invalid, ['위반어']).items.map((item) => item.address),
    ).toEqual(['위반:개요']);
  });

  it('이름이 충돌하는 문서도 모두 대상이다', () => {
    const conflict = catalogFromSources({
      'a.yaml': documentSource('a', '같은이름', { 개요: '충돌어' }),
      'b.yaml': documentSource('b', '같은이름', { 개요: '충돌어' }),
    });
    expect(
      search(conflict, ['충돌어']).items.map((item) => item.address),
    ).toEqual(['같은이름:개요', '같은이름:개요']);
  });

  it('YAML 해석에 실패한 문서는 제외한다', () => {
    const broken = catalogFromSources({
      'broken.yaml': '_codocs: [\n개요: 깨짐어\n',
      'ok.yaml': documentSource('ok', '정상', { 개요: '정상어' }),
    });
    const result = search(broken, ['깨짐어']);
    expect(result.items).toEqual([]);
    expect(result.emptyQueries).toEqual(['깨짐어']);
  });

  it('문자열이 아닌 값과 _codocs는 섹션이 아니다', () => {
    const mixed = catalogFromSources({
      'm.yaml':
        '_codocs:\n  id: m\n  name: 혼합\n목록:\n  - 목록어\n개요: 문자열어\n',
    });
    expect(search(mixed, ['목록어']).items).toEqual([]);
    expect(search(mixed, ['문자열어']).items[0]?.address).toBe('혼합:개요');
  });

  it('이름이 없는 문서는 주소를 만들 수 없어 제외한다', () => {
    const nameless = catalogFromSources({
      'n.yaml': '_codocs:\n  id: n\n개요: 이름없음어\n',
    });
    expect(search(nameless, ['이름없음어']).items).toEqual([]);
  });
});
