import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  catalogFailureKinds,
  matchCode,
  matcherComparisonKinds,
  matcherEvidenceKinds,
  parseYaml,
  scanStatuses,
  type Catalog,
  type CatalogObservation,
} from '../index.js';

/** 간단한 문서 관측을 만든다. */
function observation(path: string, id: string, extra = ''): CatalogObservation {
  return {
    path,
    parsed: parseYaml(
      `id: ${id}\nname: ${path}\ndomains: [test]\ndefinition: 설명\n${extra}`,
    ),
  };
}

/** 관측 배열로 완전한 카탈로그를 만든다. */
function catalog(...items: CatalogObservation[]): Catalog {
  return buildCatalog({ status: scanStatuses.complete, observations: items });
}

describe('코드 ID 매칭', /** 토큰·순위·오류 계약을 검증한다. */ () => {
  it('camelCase의 연속 토큰과 UTF-16 범위를 유지한다', /** astral 문자 뒤의 UTF-16 위치를 확인한다. */ () => {
    const result = matchCode(
      catalog(observation('return.yaml', 'return-zone')),
      '😀selectedReturnZones',
    );
    expect(result.candidates[0]?.evidence).toEqual([
      expect.objectContaining({
        token: 'ReturnZones',
        range: { start: 10, end: 21 },
        consecutiveTokens: 2,
      }),
    ]);
  });

  it('약어·숫자·snake·kebab 경계를 토큰화한다', /** 약어와 숫자 경계에서 연속 토큰을 확인한다. */ () => {
    const result = matchCode(
      catalog(
        observation('http.yaml', 'http-server'),
        observation('count.yaml', 'zone-2-count'),
      ),
      'HTTPServer zone_2_count',
    );
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'zone-2-count',
      'http-server',
    ]);
    expect(result.candidates[0]?.evidence[0]?.consecutiveTokens).toBe(3);
  });

  it('공백·개행·비영어·구두점은 복합 묶음을 끊는다', /** 허용되지 않은 경계에서 독립 토큰만 반환하는지 확인한다. */ () => {
    const terms = catalog(
      observation('return.yaml', 'return-zone'),
      observation('return-only.yaml', 'return'),
      observation('zone.yaml', 'zone'),
    );
    expect(matchCode(terms, 'return zone').candidates.map((x) => x.id)).toEqual(
      ['return', 'zone'],
    );
    expect(
      matchCode(terms, 'return\nZone').candidates.map((x) => x.id),
    ).toEqual(['return', 'zone']);
    expect(
      matchCode(terms, 'return한글Zone').candidates.map((x) => x.id),
    ).toEqual(['return', 'zone']);
    expect(matchCode(terms, 'return.zone').candidates.map((x) => x.id)).toEqual(
      ['return', 'zone'],
    );
  });

  it('현재 ID 간에는 연속 토큰 수가 많은 후보를 우선한다', /** 같은 현재 근거의 길이 순위를 독립적으로 확인한다. */ () => {
    const result = matchCode(
      catalog(
        observation('zone.yaml', 'zone'),
        observation('long.yaml', 'return-zone'),
      ),
      'returnZone',
    );
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'return-zone',
      'zone',
    ]);
    expect(
      result.candidates.map((candidate) => candidate.evidence[0]?.kind),
    ).toEqual([matcherEvidenceKinds.current, matcherEvidenceKinds.current]);
  });

  it('짧은 현재 ID를 긴 이전 ID보다 우선한다', /** 시기 순위가 길이 순위보다 앞서는지 확인한다. */ () => {
    const result = matchCode(
      catalog(
        observation('current.yaml', 'zone'),
        observation(
          'previous.yaml',
          'legacy-holder',
          'deprecatedAliases:\n  - id: return-zone\n',
        ),
      ),
      'returnZone',
    );
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'zone',
      'legacy-holder',
    ]);
    expect(
      result.candidates.map((candidate) => candidate.evidence[0]?.kind),
    ).toEqual([matcherEvidenceKinds.current, matcherEvidenceKinds.previous]);
  });

  it('이전 ID 간에는 연속 토큰 수가 많은 후보를 우선한다', /** 같은 이전 근거의 길이 순위를 독립적으로 확인한다. */ () => {
    const result = matchCode(
      catalog(
        observation(
          'short.yaml',
          'short-holder',
          'deprecatedAliases:\n  - id: zone\n',
        ),
        observation(
          'long.yaml',
          'long-holder',
          'deprecatedAliases:\n  - id: return-zone\n',
        ),
      ),
      'returnZone',
    );
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'long-holder',
      'short-holder',
    ]);
  });

  it.each([
    [
      '현재 ID',
      observation('singular.yaml', 'return-zone'),
      observation('exact.yaml', 'return-zones'),
    ],
    [
      '이전 ID',
      observation(
        'singular.yaml',
        'singular-holder',
        'deprecatedAliases:\n  - id: return-zone\n',
      ),
      observation(
        'exact.yaml',
        'exact-holder',
        'deprecatedAliases:\n  - id: return-zones\n',
      ),
    ],
  ])(
    '%s의 토큰 수가 같으면 표기 일치를 단수화 일치보다 우선한다',
    /** exact 순위가 현재·이전 근거에 같이 적용되는지 확인한다. */ (
      _label,
      singular,
      exact,
    ) => {
      const result = matchCode(catalog(singular, exact), 'returnZones');
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        'exact.yaml',
        'singular.yaml',
      ]);
      expect(
        result.candidates.map((candidate) => candidate.evidence[0]?.comparison),
      ).toEqual([
        matcherComparisonKinds.exact,
        matcherComparisonKinds.singular,
      ]);
    },
  );

  it('의미 순위가 같으면 원문 등장 순서로 결과를 고정한다', /** 위치는 결과 정렬에만 쓰고 Hover 본문 선택을 대신하지 않는다. */ () => {
    const result = matchCode(
      catalog(
        observation('alpha.yaml', 'alpha-zone'),
        observation('zebra.yaml', 'zebra-item'),
      ),
      'zebraItemAlphaZone',
    );
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'zebra-item',
      'alpha-zone',
    ]);
  });

  it('위치까지 같은 이전 ID 충돌은 문서 ID와 경로로 정렬하고 모두 보존한다', /** 카탈로그 입력 순서가 동률 결과를 바꾸지 않는지 확인한다. */ () => {
    const alpha = observation(
      'z-path.yaml',
      'alpha-doc',
      'deprecatedAliases:\n  - id: return-zone\n',
    );
    const beta = observation(
      'a-path.yaml',
      'beta-doc',
      'deprecatedAliases:\n  - id: return-zone\n',
    );
    for (const result of [
      matchCode(catalog(alpha, beta), 'returnZone'),
      matchCode(catalog(beta, alpha), 'returnZone'),
    ])
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        'alpha-doc',
        'beta-doc',
      ]);
  });

  it('중복된 현재 ID는 경로로 정렬하고 모든 문서를 보존한다', /** 현재/현재 충돌에서 대표 문서를 선택하지 않는다. */ () => {
    const result = matchCode(
      catalog(
        observation('b.yaml', 'return-zone'),
        observation('a.yaml', 'return-zone'),
      ),
      'returnZone',
    );
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([
      'a.yaml',
      'b.yaml',
    ]);
  });

  it('같은 문서·범위의 현재·이전 ID 근거를 모두 보존한다', /** 현재 근거가 이전 ID 안내를 숨길 수 있도록 근거를 합친다. */ () => {
    const result = matchCode(
      catalog(
        observation(
          'same.yaml',
          'return-zone',
          'deprecatedAliases:\n  - id: return-zone\n    message: 이전 ID\n',
        ),
      ),
      'returnZone',
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.evidence.map((item) => item.kind)).toEqual([
      matcherEvidenceKinds.current,
      matcherEvidenceKinds.previous,
    ]);
  });

  it('반복해 등장한 ID의 모든 원문 범위를 보존한다', /** Hover가 커서가 걸린 근거를 선택할 수 있게 한다. */ () => {
    const result = matchCode(
      catalog(observation('zone.yaml', 'zone')),
      'zoneToZone',
    );
    expect(result.candidates[0]?.evidence.map((item) => item.range)).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
  });

  it('이름은 코드 매칭에 사용하지 않으며 단수화는 보조 근거다', /** 이름 필드 제외와 pluralize 비교 종류를 확인한다. */ () => {
    const result = matchCode(
      catalog(observation('return.yaml', 'return-zone')),
      'returnZones',
    );
    expect(result.candidates[0]?.evidence[0]?.comparison).toBe(
      matcherComparisonKinds.singular,
    );
    expect(
      matchCode(catalog(observation('return.yaml', 'return-zone')), 'return')
        .candidates,
    ).toEqual([]);
  });

  it('문서별 오류와 부분 스캔을 유효한 후보와 함께 반환한다', /** 한 문서 오류와 부분 색인의 후보 보존을 확인한다. */ () => {
    const result = matchCode(
      buildCatalog({
        status: scanStatuses.partial,
        observations: [
          {
            path: 'bad.yaml',
            parsed: parseYaml(
              'id: bad\nname: bad.yaml\ndomains: [test]\ndefinition: 42\n',
            ),
          },
          observation('good.yaml', 'good'),
        ],
        failures: [{ kind: catalogFailureKinds.file, path: 'missing.yaml' }],
      }),
      'bad good',
    );
    expect(result.partial).toBe(true);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'bad',
      'good',
    ]);
    expect(result.candidates[0]?.errors.length).toBeGreaterThan(0);
  });
});
