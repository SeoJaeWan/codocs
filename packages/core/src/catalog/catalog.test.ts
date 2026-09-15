import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
  parseYaml,
  planRename,
  resolveReference,
} from '../index.js';
import type {
  Catalog,
  CatalogObservation,
  CatalogScan,
  RenameRequest,
} from '../index.js';

/** 실제 YAML 문자열을 파싱한 중립 관측을 만든다. */
function singleDomainDocument(
  path: string,
  name = '주문',
  domain = '판매',
  definition = '설명',
  id: string | undefined = path.replace('.yaml', ''),
): CatalogObservation {
  return {
    path,
    parsed: parseYaml(
      `${id === undefined ? '' : `id: ${id}\n`}name: ${JSON.stringify(name)}\ndomains: [${JSON.stringify(domain)}]\ndefinition: ${JSON.stringify(definition)}\n`,
    ),
  };
}
/** 복수 소속을 지정한 문서 관측을 만든다. */
function multiDomainDocument(
  path: string,
  name: string,
  domains: string[],
  body = '설명',
): CatalogObservation {
  return {
    path,
    parsed: parseYaml(
      `id: ${path.replace('.yaml', '')}\nname: ${JSON.stringify(name)}\ndomains: ${JSON.stringify(domains)}\ndefinition: ${JSON.stringify(body)}\n`,
    ),
  };
}
/** complete 관측으로 구축한다. */
function complete(...observations: CatalogObservation[]): Catalog {
  return buildCatalog({ status: 'complete', observations });
}
/** 발견 경로별 문서가 존재함을 먼저 확인한다. */
function document(catalog: Catalog, path: string) {
  const result = catalog.documents.get(path);
  if (!result) throw new Error(`문서 누락: ${path}`);
  return result;
}
/** 참조 변경 계획을 이름 변경 필드와 구분한다. */
function references(catalog: Catalog, request: RenameRequest) {
  return planRename(catalog, request).changes.filter(
    (c) => c.occurrenceIndex !== undefined,
  );
}

describe('경로별 이름 색인', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
  it('출처 도메인과 같은 후보가 있어도 전체 동명 후보를 반환한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = buildCatalog({
      status: 'complete',
      observations: [
        {
          path: 'a.yaml',
          parsed: parseYaml(
            'id: a\nname: 주문\ndomains: [판매]\ndefinition: 설명\n',
          ),
        },
        {
          path: 'b.yaml',
          parsed: parseYaml(
            'id: b\nname: 주문\ndomains: [구매]\ndefinition: 설명\n',
          ),
        },
        {
          path: 'c.yaml',
          parsed: parseYaml(
            'id: c\nname: 출처\ndomains: [판매]\ndefinition: "[[주문]]"\n',
          ),
        },
      ],
    });
    expect(
      catalog.documents.get('c.yaml')?.occurrences[0]?.resolution.status,
    ).toBe('ambiguous');
    expect(catalog.documents.get('c.yaml')?.references).toEqual([]);
  });
});

describe('충돌과 확인 가능한 정보', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
  it('같은 도메인의 동명은 모든 경로를 오류로 진단한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      multiDomainDocument('b.yaml', '주문', ['판매']),
    );
    for (const path of ['a.yaml', 'b.yaml'])
      expect(document(catalog, path).diagnostics).toContainEqual(
        expect.objectContaining({
          code: catalogDiagnosticCodes.duplicateName,
          message: catalogDiagnosticMessages.duplicateName,
          path,
          severity: 'error',
          relatedPaths: ['a.yaml', 'b.yaml'],
          domain: '판매',
        }),
      );
  });
  it('다른 도메인의 동명은 중복 이름 오류 없이 공존한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      multiDomainDocument('b.yaml', '주문', ['구매']),
    );
    expect(
      [...catalog.documents.values()].flatMap((d) => d.diagnostics),
    ).toEqual([]);
  });
  it('다중 도메인 검색에서도 같은 경로는 후보 하나로 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      multiDomainDocument('a.yaml', '주문', ['판매', '구매', '판매']),
    );
    expect(
      resolveReference(catalog, { name: '주문' }).candidates.map((c) => c.path),
    ).toEqual(['a.yaml']);
    expect(
      resolveReference(catalog, { name: '주문', domain: '구매' }).target?.path,
    ).toBe('a.yaml');
  });
  it('ID와 realPath가 같아도 다른 발견 경로를 합치지 않는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const a = {
        ...singleDomainDocument('a.yaml', 'A', '판매', '설명', 'shared'),
        realPath: '/same',
      },
      b = {
        ...singleDomainDocument('b.yaml', 'B', '판매', '설명', 'shared'),
        realPath: '/same',
      };
    const catalog = complete(a, b);
    expect([...(catalog.idPaths.get('shared') ?? [])]).toEqual([
      'a.yaml',
      'b.yaml',
    ]);
    expect(catalog.documents.size).toBe(2);
    for (const path of ['a.yaml', 'b.yaml'])
      expect(
        document(catalog, path).diagnostics.some(
          (d) => d.code === catalogDiagnosticCodes.duplicateId,
        ),
      ).toBe(true);
  });
  it('ID가 없고 다른 필드 오류가 있어도 정상 본문과 확인 가능한 이름을 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const invalid = {
      path: 'a.yaml',
      parsed: parseYaml(
        'name: 주문\ndomains: [판매]\ndefinition: "[[대상]]"\nexamples: 42\n',
      ),
    };
    const catalog = complete(
      invalid,
      singleDomainDocument('b.yaml', '대상'),
      singleDomainDocument('c.yaml', '출처', '판매', '[[주문]]'),
    );
    expect(document(catalog, 'a.yaml').id).toBeUndefined();
    expect(document(catalog, 'a.yaml').references.map((r) => r.path)).toEqual([
      'b.yaml',
    ]);
    expect(document(catalog, 'c.yaml').references.map((r) => r.path)).toEqual([
      'a.yaml',
    ]);
    expect(
      document(catalog, 'c.yaml').occurrences[0]?.resolution.target?.errors
        .length,
    ).toBeGreaterThan(0);
    expect(
      document(catalog, 'c.yaml').diagnostics.some(
        (d) => d.code === catalogDiagnosticCodes.referenceTargetError,
      ),
    ).toBe(true);
  });
  it('ID 충돌 오류가 있어도 확정 경로 연결을 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml', 'A', '판매', '설명', 'shared'),
      singleDomainDocument('b.yaml', 'B', '판매', '설명', 'shared'),
      singleDomainDocument('c.yaml', 'C', '판매', '[[A]]'),
    );
    expect(document(catalog, 'c.yaml').references.map((r) => r.path)).toEqual([
      'a.yaml',
    ]);
  });
  it('파싱 실패 원문에서 이름이나 참조를 추측하지 않는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete({
      path: 'bad.yaml',
      parsed: parseYaml('name: A\ndefinition: "[[B]]\n'),
    });
    expect(document(catalog, 'bad.yaml').name).toBeUndefined();
    expect(document(catalog, 'bad.yaml').occurrences).toEqual([]);
    expect(catalog.namePaths.size).toBe(0);
  });
  it('이름과 도메인의 콜론을 문자열 연결 키로 합치지 않는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml', 'c', 'a:b'),
      singleDomainDocument('b.yaml', 'b:c', 'a'),
    );
    expect(
      resolveReference(catalog, { name: 'c', domain: 'a:b' }).target?.path,
    ).toBe('a.yaml');
    expect(
      resolveReference(catalog, { name: 'b:c', domain: 'a' }).target?.path,
    ).toBe('b.yaml');
  });
  it('trim과 대소문자 보정 및 ID 패턴 제한 없이 정확 비교한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml', ' 주문A! ', ' 판매 '),
    );
    expect(
      resolveReference(catalog, { name: ' 주문A! ', domain: ' 판매 ' }).status,
    ).toBe('resolved');
    expect(resolveReference(catalog, { name: '주문A!' }).status).toBe(
      'missing',
    );
    expect(resolveReference(catalog, { name: ' 주문a! ' }).status).toBe(
      'missing',
    );
  });
  it('공개 색인 진단 코드의 문자열 호환성을 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    expect(catalogDiagnosticCodes).toEqual({
      duplicateId: 'duplicate_id',
      duplicateName: 'duplicate_name',
      missingReference: 'missing_reference',
      ambiguousReference: 'ambiguous_reference',
      selfReference: 'self_reference',
      unconfirmedReference: 'unconfirmed_reference',
      referenceTargetError: 'reference_target_error',
    });
  });
});

describe('확정 직접 연결과 등장', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
  it('반복 위치는 모두 유지하고 목록과 역참조는 경로별 한 번 정렬한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('z.yaml', 'Z'),
      singleDomainDocument('a.yaml', 'A'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[Z]] [[A]] [[Z]]'),
    );
    const source = document(catalog, 's.yaml');
    expect(source.occurrences).toHaveLength(3);
    expect(
      source.occurrences.map((i) => i.occurrence.offsetRange.start),
    ).toEqual(
      [...source.occurrences.map((i) => i.occurrence.offsetRange.start)].sort(
        (a, b) => a - b,
      ),
    );
    expect(source.references.map((r) => r.path)).toEqual(['a.yaml', 'z.yaml']);
    expect(document(catalog, 'z.yaml').referencedBy.map((r) => r.path)).toEqual(
      ['s.yaml'],
    );
  });
  it('모호함과 부재 및 무효 등장에 역참조를 만들지 않는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('b.yaml', '주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]] [[없음]] [[]]'),
    );
    expect(
      document(catalog, 's.yaml').occurrences.map((o) => o.resolution.status),
    ).toEqual(['ambiguous', 'missing', 'invalid']);
    expect(document(catalog, 'a.yaml').referencedBy).toEqual([]);
    expect(document(catalog, 'b.yaml').referencedBy).toEqual([]);
  });
  it('지정 도메인 참조는 해당 도메인의 정확 후보만 반환한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('b.yaml', '주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[구매:주문]]'),
    );
    expect(
      document(catalog, 's.yaml').occurrences[0]?.resolution.target,
    ).toMatchObject({
      path: 'b.yaml',
      name: '주문',
      id: 'b',

      domains: ['구매'],
    });
  });
  it('다른 소속 도메인으로 쓴 같은 발견 문서의 자기 참조도 제외한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      multiDomainDocument('a.yaml', 'A', ['판매', '구매'], '[[구매:A]]'),
    );
    expect(document(catalog, 'a.yaml').occurrences[0]?.resolution.status).toBe(
      'self',
    );
    expect(document(catalog, 'a.yaml').references).toEqual([]);
    expect(
      document(catalog, 'a.yaml').diagnostics.some(
        (d) => d.code === catalogDiagnosticCodes.selfReference,
      ),
    ).toBe(true);
  });
  it('다른 문서의 순환은 전이 확장 없이 직접 연결로 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml', 'A', '판매', '[[B]]'),
      singleDomainDocument('b.yaml', 'B', '판매', '[[A]] [[C]]'),
      singleDomainDocument('c.yaml', 'C'),
    );
    expect(document(catalog, 'a.yaml').references.map((r) => r.path)).toEqual([
      'b.yaml',
    ]);
    expect(document(catalog, 'b.yaml').references.map((r) => r.path)).toEqual([
      'a.yaml',
      'c.yaml',
    ]);
  });
  it('Unicode escape와 CRLF의 실제 YAML UTF16 위치를 의미 진단에도 보존한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const source =
      'id: s\r\nname: S\r\ndomains: [판매]\r\ndefinition: "\\u005B\\u005B없음]] [[없음]]"\r\n';
    const catalog = complete({ path: 's.yaml', parsed: parseYaml(source) }),
      doc = document(catalog, 's.yaml');
    expect(doc.occurrences).toHaveLength(2);
    expect(
      source.slice(
        doc.occurrences[0]!.occurrence.offsetRange.start,
        doc.occurrences[0]!.occurrence.offsetRange.end,
      ),
    ).toBe('\\u005B\\u005B없음]]');
    expect(
      doc.diagnostics
        .filter((d) => d.code === catalogDiagnosticCodes.missingReference)
        .map((d) => d.range),
    ).toEqual(doc.occurrences.map((o) => o.occurrence.range));
  });
});

describe('관측 갱신과 불확실성', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
  it('complete의 삭제와 이동은 이전 색인·역참조를 제거한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const old = complete(
      singleDomainDocument('a.yaml', 'A'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[A]]'),
    );
    const moved = buildCatalog(
      {
        status: 'complete',
        observations: [
          singleDomainDocument('b.yaml', 'A'),
          singleDomainDocument('s.yaml', 'S', '판매', '[[A]]'),
        ],
      },
      old,
    );
    expect(moved.documents.has('a.yaml')).toBe(false);
    expect(document(moved, 's.yaml').references.map((r) => r.path)).toEqual([
      'b.yaml',
    ]);
    const deleted = buildCatalog(
      {
        status: 'complete',
        observations: [singleDomainDocument('s.yaml', 'S', '판매', '[[A]]')],
      },
      moved,
    );
    expect(document(deleted, 's.yaml').occurrences[0]?.resolution.status).toBe(
      'missing',
    );
  });
  it('ID·이름·도메인·본문 변경과 충돌 해소를 모두 다시 계산한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const old = complete(
      singleDomainDocument('a.yaml', 'A', '판매', '[[S]]', 'same'),
      singleDomainDocument('b.yaml', 'A', '판매', '설명', 'same'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[A]]'),
    );
    const next = buildCatalog(
      {
        status: 'complete',
        observations: [
          singleDomainDocument('a.yaml', '새A', '구매', '설명', 'new'),
          singleDomainDocument('b.yaml', 'B'),
          singleDomainDocument('s.yaml', 'S', '판매', '[[구매:새A]]'),
        ],
      },
      old,
    );
    expect(next.idPaths.has('same')).toBe(false);
    expect(next.domainNamePaths.get('판매')?.has('A')).toBe(false);
    expect([...next.documents.values()].flatMap((d) => d.diagnostics)).toEqual(
      [],
    );
    expect(document(next, 's.yaml').references.map((r) => r.path)).toEqual([
      'a.yaml',
    ]);
    expect(document(next, 's.yaml').referencedBy).toEqual([]);
  });
  it.each<{ failures: NonNullable<CatalogScan['failures']> }>([
    { failures: [{ kind: 'file', path: 'a.yaml' }] },
    { failures: [{ kind: 'folder', path: 'sub' }] },
    { failures: [{ kind: 'unknown' }] },
  ])(
    'partial 실패 범위 %j에서 이전 기록은 미확인으로 보존한다',
    /** 각 실패 범위의 보존 상태와 불확실한 검색을 검증한다. */ ({
      failures,
    }) => {
      const old = complete(
        singleDomainDocument('a.yaml', 'A'),
        singleDomainDocument('sub/b.yaml', 'B'),
      );
      const next = buildCatalog(
        {
          status: 'partial',
          observations: [
            singleDomainDocument('s.yaml', 'S', '판매', '[[A]] [[없음]]'),
          ],
          failures,
        },
        old,
      );
      expect(next.documents.size).toBe(3);
      expect(document(next, 'a.yaml').confirmation).toBe('unconfirmed');
      expect(document(next, 'sub/b.yaml').confirmation).toBe('unconfirmed');
      expect(
        document(next, 's.yaml').occurrences.map((o) => o.resolution.status),
      ).toEqual(['unconfirmed', 'unconfirmed']);
      expect(document(next, 'a.yaml').referencedBy).toEqual([]);
      expect(next.failures).toEqual(failures);
    },
  );
  it('partial에서 확인한 단일 후보도 미탐색 신규 후보 가능성 때문에 확정하지 않는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const next = buildCatalog({
      status: 'partial',
      observations: [
        singleDomainDocument('a.yaml', 'A'),
        singleDomainDocument('s.yaml', 'S', '판매', '[[A]]'),
      ],
      failures: [{ kind: 'folder', path: 'unknown' }],
    });
    expect(document(next, 'a.yaml').confirmation).toBe('confirmed');
    expect(document(next, 's.yaml').occurrences[0]?.resolution).toMatchObject({
      status: 'unconfirmed',
      candidates: [{ path: 'a.yaml' }],
    });
    expect(document(next, 's.yaml').references).toEqual([]);
  });
  it('failed는 새 관측을 채택하지 않고 이전 색인과 실패 상태를 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const old = complete(
      singleDomainDocument('a.yaml', 'A'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[A]]'),
    );
    const next = buildCatalog(
      {
        status: 'failed',
        observations: [singleDomainDocument('a.yaml', '변경')],
        failures: [{ kind: 'unknown' }],
      },
      old,
    );
    expect(next.status).toBe('failed');
    expect(document(next, 'a.yaml').name).toBe('A');
    expect([...(next.namePaths.get('A') ?? [])]).toEqual(['a.yaml']);
    expect(document(next, 's.yaml').references).toEqual([]);
    expect(document(old, 's.yaml').references.map((r) => r.path)).toEqual([
      'a.yaml',
    ]);
  });
  it('complete 회복은 미확인 기록을 재확인하고 확정 연결을 다시 만든다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const old = complete(
      singleDomainDocument('a.yaml', 'A'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[A]]'),
    );
    const failed = buildCatalog({ status: 'failed', observations: [] }, old);
    const recovered = buildCatalog(
      {
        status: 'complete',
        observations: [
          singleDomainDocument('a.yaml', 'A'),
          singleDomainDocument('s.yaml', 'S', '판매', '[[A]]'),
        ],
      },
      failed,
    );
    expect(document(recovered, 'a.yaml').confirmation).toBe('confirmed');
    expect(
      document(recovered, 'a.yaml').referencedBy.map((r) => r.path),
    ).toEqual(['s.yaml']);
    expect(recovered.failures).toEqual([]);
  });
  it('계산이 이전 입력 관측과 원문을 변경하지 않는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const obs = singleDomainDocument('a.yaml', 'A'),
      before = JSON.stringify(obs);
    const old = complete(obs);
    buildCatalog({ status: 'partial', observations: [] }, old);
    expect(JSON.stringify(obs)).toBe(before);
    expect(document(old, 'a.yaml').confirmation).toBe('confirmed');
  });
});

describe('순수 이름 변경 수정안', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
  it('발견 경로가 다른 같은 실경로 문서는 자기 참조로 합치지 않는다', /** 발견 경로 기준으로 자기 참조와 다른 문서를 구분한다. */ () => {
    const catalog = complete(
      {
        ...singleDomainDocument('a.yaml', 'A', '판매', '[[B]]'),
        realPath: '/same',
      },
      { ...singleDomainDocument('b.yaml', 'B'), realPath: '/same' },
    );
    expect(document(catalog, 'a.yaml').references.map((r) => r.path)).toEqual([
      'b.yaml',
    ]);
  });
  it('새 이름과 같던 다른 확정 참조도 도메인을 명시해 원래 대상을 유지한다', /** 이름 변경 후 새 모호함이 원래 다른 대상을 가로채지 않는다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml', 'A'),
      singleDomainDocument('b.yaml', 'B', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[A]] [[B]]'),
    );
    const plan = planRename(catalog, { targetPath: 'a.yaml', newName: 'B' });
    expect(plan.status).toBe('ready');
    expect(
      plan.changes
        .filter((c) => c.path === 's.yaml')
        .map((c) => [c.targetPath, c.newText]),
    ).toEqual([
      ['a.yaml', '[[판매:B]]'],
      ['b.yaml', '[[구매:B]]'],
    ]);
  });
  it('기존 명시 도메인을 다른 도메인 선택으로 덮어쓰지 않는다', /** 사용자의 선택도 기존 명시 도메인 보존 계약을 따른다. */ () => {
    const catalog = complete(
      multiDomainDocument('a.yaml', 'A', ['판매', '구매']),
      singleDomainDocument('s.yaml', 'S', '판매', '[[판매:A]]'),
    );
    const plan = planRename(catalog, {
      targetPath: 'a.yaml',
      newName: 'B',
      selections: [
        {
          sourcePath: 's.yaml',
          occurrenceIndex: 0,
          targetPath: 'a.yaml',
          domain: '구매',
        },
      ],
    });
    expect(plan.impacts[0]?.reason).toBe('invalid_selection');
  });
  it('일반 백슬래시와 마지막 백슬래시의 새 이름도 문법 round trip이 되면 허용한다', /** ID 패턴이나 별도 백슬래시 제한을 만들지 않는다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    for (const name of ['새\\이름', '새이름\\']) {
      const plan = planRename(catalog, { targetPath: 'a.yaml', newName: name });
      expect(plan.status).toBe('ready');
      expect(plan.changes.find((c) => c.path === 's.yaml')?.newText).toBe(
        `[[${name}]]`,
      );
    }
  });
  it('존재하지 않는 등장 및 리터럴에 대한 선택을 무시하지 않고 차단한다', /** 위치 없는 선택을 확정 수정안으로 처리하지 않는다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('s.yaml', 'S', '판매', '\\[[주문]]'),
    );
    const selection = {
      sourcePath: 's.yaml',
      occurrenceIndex: 0,
      targetPath: 'a.yaml',
    };
    expect(
      planRename(catalog, {
        targetPath: 'a.yaml',
        newName: '새주문',
        selections: [selection],
      }),
    ).toMatchObject({
      status: 'blocked',
      blockingReason: 'invalid_selection',
      invalidSelections: [selection],
      changes: [],
    });
  });
  it('같은 등장에 중복 선택이 있으면 첫 선택을 임의 채택하지 않는다', /** 서로 충돌하는 사용자 결정을 미해결 상태로 남긴다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('b.yaml', '주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    const selections = [
      { sourcePath: 's.yaml', occurrenceIndex: 0, targetPath: 'a.yaml' },
      { sourcePath: 's.yaml', occurrenceIndex: 0, targetPath: 'b.yaml' },
    ];
    expect(
      planRename(catalog, {
        targetPath: 'a.yaml',
        newName: '새주문',
        selections,
      }),
    ).toMatchObject({
      status: 'blocked',
      blockingReason: 'invalid_selection',
      invalidSelections: selections,
      changes: [],
    });
  });
  it('미확인 실패 진단과 문서 오류는 별도 컬렉션에 유지한다', /** IO 계층의 고유 코드를 core 문서 코드로 바꾸지 않는다. */ () => {
    const failure = {
      kind: 'file' as const,
      path: 'a.yaml',
      diagnostics: [
        {
          code: 'read_failed',
          severity: 'error' as const,
          message: '읽기 실패',
        },
      ],
    };
    const old = complete(singleDomainDocument('a.yaml'));
    const next = buildCatalog(
      { status: 'partial', observations: [], failures: [failure] },
      old,
    );
    expect(next.failures[0]?.diagnostics).toEqual(failure.diagnostics);
    expect(document(next, 'a.yaml').documentDiagnostics).toEqual([]);
  });
  it('같은 발견 경로의 새 파싱 실패는 이전 이름을 정상 최신 정보로 남기지 않는다', /** 확인한 내용 실패와 IO 미관측을 구분한다. */ () => {
    const old = complete(singleDomainDocument('a.yaml', 'A'));
    const next = buildCatalog(
      {
        status: 'partial',
        observations: [{ path: 'a.yaml', parsed: parseYaml('name: "잘림') }],
        failures: [{ kind: 'folder', path: 'sub' }],
      },
      old,
    );
    expect(document(next, 'a.yaml').confirmation).toBe('confirmed');
    expect(document(next, 'a.yaml').name).toBeUndefined();
    expect(next.namePaths.has('A')).toBe(false);
    expect(document(next, 'a.yaml').documentDiagnostics[0]?.code).toBe(
      'invalid_yaml',
    );
  });
  it('확정 반복 참조를 실제 위치별 변경하고 원문을 보존한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const source = singleDomainDocument(
      's.yaml',
      'S',
      '판매',
      '[[주문]] [[주문]] \\[[주문]]',
    );
    const catalog = complete(singleDomainDocument('a.yaml'), source),
      before = JSON.stringify(source);
    const plan = planRename(catalog, {
      targetPath: 'a.yaml',
      newName: '새주문',
    });
    expect(plan.status).toBe('ready');
    expect(plan.changes).toHaveLength(3);
    expect(
      plan.changes.filter((c) => c.path === 's.yaml').map((c) => c.newText),
    ).toEqual(['[[새주문]]', '[[새주문]]']);
    expect(plan.changes[0]).toMatchObject({
      path: 'a.yaml',
      fieldPath: ['name'],
      oldText: '주문',
      newText: '새주문',
    });
    expect(JSON.stringify(source)).toBe(before);
    expect(document(catalog, 'a.yaml').name).toBe('주문');
  });
  it('이미 지정한 도메인 표기는 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[판매:주문]]'),
    );
    expect(
      references(catalog, { targetPath: 'a.yaml', newName: '새주문' })[0]
        ?.newText,
    ).toBe('[[판매:새주문]]');
  });
  it('새 무도메인 표기가 모호해지면 단일 소속 도메인을 명시한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('b.yaml', '새주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    expect(
      references(catalog, { targetPath: 'a.yaml', newName: '새주문' })[0]
        ?.newText,
    ).toBe('[[판매:새주문]]');
  });
  it('다중 도메인의 새 모호 표기는 미선택 도메인을 미해결로 남긴다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      multiDomainDocument('a.yaml', '주문', ['판매', '물류']),
      singleDomainDocument('b.yaml', '새주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    const plan = planRename(catalog, {
      targetPath: 'a.yaml',
      newName: '새주문',
    });
    expect(plan.status).toBe('unresolved');
    expect(plan.impacts[0]?.reason).toBe('domain_required');
    expect(
      references(catalog, {
        targetPath: 'a.yaml',
        newName: '새주문',
        selections: [
          {
            sourcePath: 's.yaml',
            occurrenceIndex: 0,
            targetPath: 'a.yaml',
            domain: '물류',
          },
        ],
      })[0]?.newText,
    ).toBe('[[물류:새주문]]');
  });
  it('사용자가 선택한 모호 후보를 유지한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('b.yaml', '주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    expect(
      references(catalog, {
        targetPath: 'a.yaml',
        newName: '새주문',
        selections: [
          { sourcePath: 's.yaml', occurrenceIndex: 0, targetPath: 'a.yaml' },
        ],
      })[0]?.newText,
    ).toBe('[[새주문]]');
  });
  it('사용자가 다른 후보를 선택하면 그 후보를 존중한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('b.yaml', '주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    const plan = planRename(catalog, {
      targetPath: 'a.yaml',
      newName: '새주문',
      selections: [
        { sourcePath: 's.yaml', occurrenceIndex: 0, targetPath: 'b.yaml' },
      ],
    });
    expect(plan.status).toBe('ready');
    expect(plan.changes.filter((c) => c.path === 's.yaml')).toEqual([]);
  });
  it('미선택 모호 참조가 다른 후보 하나로 바뀌는 영향도 보고한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('b.yaml', '주문', '구매'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    const plan = planRename(catalog, {
      targetPath: 'a.yaml',
      newName: '새주문',
    });
    expect(plan.status).toBe('unresolved');
    expect(plan.impacts[0]).toMatchObject({
      reason: 'changed_resolution',
      before: { status: 'ambiguous' },
      after: { status: 'resolved', target: { path: 'b.yaml' } },
    });
  });
  it('서로 다른 소속 수의 문서도 같은 도메인의 새 이름 충돌을 차단한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      multiDomainDocument('b.yaml', '새주문', ['판매']),
    );
    const plan = planRename(catalog, {
      targetPath: 'a.yaml',
      newName: '새주문',
    });
    expect(plan.status).toBe('blocked');
    expect(plan.changes).toEqual([]);
    expect(plan.conflicts[0]).toMatchObject({
      domain: '판매',
      candidates: [{ path: 'b.yaml' }],
    });
  });
  it('참조 동시 변경을 끄면 이름 필드만 계획하고 미해결 영향을 반환한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    const plan = planRename(catalog, {
      targetPath: 'a.yaml',
      newName: '새주문',
      updateReferences: false,
    });
    expect(plan.changes).toHaveLength(1);
    expect(plan.impacts[0]?.reason).toBe('references_disabled');
  });
  it('존재하지 않는 후보 및 소속하지 않는 도메인 선택은 미해결이다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    for (const selection of [
      { sourcePath: 's.yaml', occurrenceIndex: 0, targetPath: 'none' },
      {
        sourcePath: 's.yaml',
        occurrenceIndex: 0,
        targetPath: 'a.yaml',
        domain: '구매',
      },
    ])
      expect(
        planRename(catalog, {
          targetPath: 'a.yaml',
          newName: '새주문',
          selections: [selection],
        }).impacts[0]?.reason,
      ).toBe('invalid_selection');
  });
  it('콜론이 포함된 새 이름은 참조 구성에서 escape한다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    expect(
      references(catalog, { targetPath: 'a.yaml', newName: '새:주문' })[0]
        ?.newText,
    ).toBe('[[새\\:주문]]');
  });
  it('새 이름을 문법으로 표현할 수 없으면 추측하지 않고 미해결이다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = complete(
      singleDomainDocument('a.yaml'),
      singleDomainDocument('s.yaml', 'S', '판매', '[[주문]]'),
    );
    expect(
      planRename(catalog, { targetPath: 'a.yaml', newName: '새[주문' })
        .impacts[0]?.reason,
    ).toBe('unrepresentable');
  });
  it('미확인 색인에서는 새 이름 충돌의 부재를 확정하지 않는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const catalog = buildCatalog({
      status: 'partial',
      observations: [singleDomainDocument('a.yaml')],
    });
    expect(
      planRename(catalog, { targetPath: 'a.yaml', newName: '새주문' }),
    ).toMatchObject({
      status: 'blocked',
      blockingReason: 'unconfirmed',
      changes: [],
    });
  });
  it('Unicode escape 이름과 folded 본문의 수정안은 실제 원문 위치를 갖는다', /** 조건별 공개 상태와 관찰 결과를 검증한다. */ () => {
    const a = {
      path: 'a.yaml',
      parsed: parseYaml(
        'id: a\nname: "\\uC8FC문"\ndomains: [판매]\ndefinition: 설명\n',
      ),
    };
    const s = {
      path: 's.yaml',
      parsed: parseYaml(
        'id: s\nname: S\ndomains: [판매]\ndefinition: >-\n  [[주문]]\n  [[주문]]\n',
      ),
    };
    const plan = planRename(complete(a, s), {
      targetPath: 'a.yaml',
      newName: '새주문',
    });
    expect(plan.changes).toHaveLength(3);
    const name = plan.changes.find((c) => c.path === 'a.yaml')!;
    expect(
      a.parsed.source?.slice(name.offsetRange.start, name.offsetRange.end),
    ).toBe('\\uC8FC문');
    for (const change of plan.changes.filter((c) => c.path === 's.yaml'))
      expect(
        s.parsed.source?.slice(
          change.offsetRange.start,
          change.offsetRange.end,
        ),
      ).toBe('[[주문]]');
  });
});
