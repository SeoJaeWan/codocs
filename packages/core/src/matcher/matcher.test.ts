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

  it('현재 ID를 이전 ID보다 우선하고 같은 문서의 근거를 합친다', /** 현재·이전 근거의 순위와 메시지 보존을 확인한다. */ () => {
    const result = matchCode(
      catalog(
        observation(
          'zone.yaml',
          'zone',
          'deprecatedAliases:\n  - id: zones\n    message: 이전 이름\n',
        ),
        observation('long.yaml', 'return-zone'),
      ),
      'Zones ReturnZone',
    );
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      'return-zone',
      'zone',
    ]);
    expect(result.candidates[1]?.evidence).toHaveLength(4);
    expect(result.candidates[1]?.evidence).toContainEqual(
      expect.objectContaining({
        message: '이전 이름',
        kind: matcherEvidenceKinds.previous,
      }),
    );
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
