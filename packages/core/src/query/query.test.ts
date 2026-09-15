import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  parseYaml,
  projectCatalogGet,
  projectCatalogList,
  queryDiagnosticCodes,
} from '../index.js';
import type { Catalog, CatalogObservation } from '../index.js';

interface DocumentOptions {
  definition?: string;
  domains?: readonly string[];
  kind?: string;
  status?: string;
}

/** 테스트가 확인할 공개 문서 원문을 만든다. */
function observation(
  path: string,
  id: string | undefined,
  name: string | undefined,
  options: DocumentOptions = {},
): CatalogObservation {
  const lines = [
    ...(id === undefined ? [] : [`id: ${JSON.stringify(id)}`]),
    ...(name === undefined ? [] : [`name: ${JSON.stringify(name)}`]),
    `definition: ${JSON.stringify(options.definition ?? '설명')}`,
    `domains: ${JSON.stringify(options.domains ?? ['도메인'])}`,
    ...(options.kind === undefined
      ? []
      : [`kind: ${JSON.stringify(options.kind)}`]),
    ...(options.status === undefined
      ? []
      : [`status: ${JSON.stringify(options.status)}`]),
  ];
  return { path, parsed: parseYaml(`${lines.join('\n')}\n`) };
}

/** 완전한 관측을 Catalog로 계산한다. */
function complete(...observations: CatalogObservation[]): Catalog {
  return buildCatalog({ status: 'complete', observations });
}

/** 성공한 상세 결과를 좁힌다. */
function successful(catalog: Catalog, ids: readonly string[]) {
  const projection = projectCatalogGet(catalog, ids);
  if (!projection.success) throw new Error('상세 조회가 성공해야 한다');
  return projection.results;
}

describe('Catalog 목록 투영', /** 목록의 포함·정렬·충돌 계약을 검증한다. */ () => {
  it.each([0, 1, 49, 50, 51, 100])(
    '문서 %i개를 페이지 크기와 무관하게 모두 정렬한다',
    /** 페이지 경계 주변에서도 core 전체 snapshot은 잘리지 않는다. */ (
      size,
    ) => {
      const catalog = complete(
        ...Array.from(
          { length: size },
          /** 역순 관측으로 목록 자체의 정렬을 확인한다. */ (_, index) =>
            observation(
              `${String(size - index).padStart(3, '0')}.yaml`,
              `doc-${String(size - index).padStart(3, '0')}`,
              `문서 ${index}`,
            ),
        ),
      );
      const result = projectCatalogList(catalog);
      expect(result.totalCount).toBe(size);
      expect(result.items).toHaveLength(size);
      expect(result.items.map((item) => item.id)).toEqual(
        [...result.items.map((item) => item.id)].sort(),
      );
    },
  );

  it('domain·kind·status를 한 파일이 모두 만족할 때만 포함한다', /** 파일별 AND 조건을 검증한다. */ () => {
    const catalog = complete(
      observation('match.yaml', 'match', '일치', {
        domains: ['판매', '공통'],
        kind: 'policy',
        status: 'confirmed',
      }),
      observation('domain-only.yaml', 'domain-only', '도메인만', {
        domains: ['판매'],
        kind: 'decision',
        status: 'confirmed',
      }),
      observation('kind-only.yaml', 'kind-only', '종류만', {
        domains: ['구매'],
        kind: 'policy',
        status: 'confirmed',
      }),
    );
    expect(
      projectCatalogList(catalog, {
        domain: '판매',
        kind: 'policy',
        status: 'confirmed',
      }).items.map((item) => item.id),
    ).toEqual(['match']);
  });

  it('잘못된 목록 속성은 표시와 해당 필터에서 제외한다', /** 오류 문서의 사용 가능한 목록 필드만 남긴다. */ () => {
    const catalog = complete(
      observation('bad.yaml', 'bad', '오류 문서', {
        domains: ['판매'],
        kind: 'unknown',
      }),
    );
    const all = projectCatalogList(catalog).items[0];
    expect(all).toMatchObject({ id: 'bad', hasErrors: true });
    expect(all).not.toHaveProperty('kind');
    expect(projectCatalogList(catalog, { kind: 'policy' }).items).toEqual([]);
  });

  it('중복 ID는 필터를 한 파일에서 판정하고 모든 경로만 정렬해 집계한다', /** 대표 문서 없는 충돌 항목을 검증한다. */ () => {
    const catalog = complete(
      observation('z.yaml', 'shared', '구매 문서', {
        domains: ['구매'],
        kind: 'decision',
      }),
      observation('a.yaml', 'shared', '판매 정책', {
        domains: ['판매'],
        kind: 'policy',
      }),
    );
    const item = projectCatalogList(catalog, {
      domain: '판매',
      kind: 'policy',
    }).items[0];
    expect(item).toEqual({
      id: 'shared',
      paths: ['a.yaml', 'z.yaml'],
      hasErrors: true,
      conflict: true,
    });
    expect(item).not.toHaveProperty('name');
    expect(item).not.toHaveProperty('domains');
  });
});

describe('Catalog 상세 투영', /** 복수 ID와 문서·참조 분기를 검증한다. */ () => {
  it('[A, B, A]를 첫 등장 순서로 중복 제거하고 정상·없음을 함께 반환한다', /** 항목별 독립 결과를 검증한다. */ () => {
    const results = successful(complete(observation('a.yaml', 'a', 'A')), [
      'a',
      'b',
      'a',
    ]);
    expect(results.map((result) => result.id)).toEqual(['a', 'b']);
    expect(results[0]).toMatchObject({ found: true, conflict: false });
    expect(results[1]).toEqual({
      id: 'b',
      found: false,
      diagnostics: [
        expect.objectContaining({ code: queryDiagnosticCodes.notFound }),
      ],
    });
  });

  it('빈 입력과 중복 제거 후 21개 입력은 전체 invalid_input이다', /** 유일한 get 크기 제한을 검증한다. */ () => {
    expect(projectCatalogGet(complete(), [])).toMatchObject({
      success: false,
      error: { code: queryDiagnosticCodes.invalidInput },
    });
    const twenty = Array.from({ length: 20 }, (_, index) => `id-${index}`);
    const deduplicated = projectCatalogGet(complete(), [...twenty, ...twenty]);
    expect(deduplicated.success).toBe(true);
    if (deduplicated.success) expect(deduplicated.results).toHaveLength(20);
    expect(projectCatalogGet(complete(), [...twenty, 'id-20'])).toMatchObject({
      success: false,
      error: { code: queryDiagnosticCodes.invalidInput },
    });
  });

  it('중복 ID와 정상 ID 중 충돌 결과만 내용·원문·revision을 생략한다', /** 충돌 union의 금지 필드를 검증한다. */ () => {
    const catalog = complete(
      observation('z.yaml', 'shared', 'Z'),
      observation('a.yaml', 'shared', 'A'),
      observation('normal.yaml', 'normal', '정상'),
    );
    const projection = projectCatalogGet(catalog, ['shared', 'normal'], {
      revisions: new Map([
        ['a.yaml', 'a-revision'],
        ['normal.yaml', 'normal-revision'],
        ['z.yaml', 'z-revision'],
      ]),
    });
    if (!projection.success) throw new Error('상세 조회가 성공해야 한다');
    const [conflict, normal] = projection.results;
    expect(conflict).toMatchObject({
      id: 'shared',
      found: true,
      conflict: true,
      paths: ['a.yaml', 'z.yaml'],
    });
    expect(conflict).not.toHaveProperty('document');
    expect(conflict).not.toHaveProperty('rawYaml');
    expect(conflict).not.toHaveProperty('revision');
    expect(normal).toMatchObject({
      id: 'normal',
      found: true,
      conflict: false,
      revision: 'normal-revision',
    });
    expect(normal).toHaveProperty('document');
  });

  it('JSON으로 표현할 수 없는 오류 문서는 전체 rawYaml과 진단·경로·revision을 반환한다', /** 손실 없는 원문 분기를 검증한다. */ () => {
    const rawYaml =
      'id: broken\nname: 오류 문서\ndefinition: 설명\ndomains: [도메인]\nvalue: .nan\n';
    const catalog = complete({
      path: 'broken.yaml',
      parsed: parseYaml(rawYaml),
    });
    const projection = projectCatalogGet(catalog, ['broken'], {
      revisions: new Map([['broken.yaml', 'raw-revision']]),
    });
    if (!projection.success) throw new Error('상세 조회가 성공해야 한다');
    expect(projection.results[0]).toMatchObject({
      id: 'broken',
      found: true,
      conflict: false,
      rawYaml,
      source: { path: 'broken.yaml' },
      revision: 'raw-revision',
    });
    expect(projection.results[0]?.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error' }),
    );
    expect(projection.results[0]).not.toHaveProperty('document');
  });

  it('확정 직접 참조 ID만 중복 제거해 정렬하며 본문을 확장하지 않는다', /** 유효 직접 ID 목록만 검증한다. */ () => {
    const catalog = complete(
      observation('z.yaml', 'zeta', 'Zulu'),
      observation('a.yaml', 'alpha', 'Alpha'),
      observation('source.yaml', 'source', 'Source', {
        definition: '[[Zulu]] [[Alpha]] [[Zulu]]',
      }),
    );
    const [result] = successful(catalog, ['source']);
    expect(result).toMatchObject({ references: ['alpha', 'zeta'] });
    expect(result).not.toHaveProperty('referencedDocuments');
  });

  it('없는 참조는 path를 만들지 않고 원문 위치와 외부 진단을 보존한다', /** 부재 경로를 추측하지 않는지 검증한다. */ () => {
    const [result] = successful(
      complete(
        observation('source.yaml', 'source', 'Source', {
          definition: '앞 [[Missing]] 뒤',
        }),
      ),
      ['source'],
    );
    expect(result).toMatchObject({ references: [] });
    const diagnostic = result?.diagnostics.find(
      (item) => item.code === queryDiagnosticCodes.referenceNotFound,
    );
    expect(diagnostic?.path).toBe('source.yaml');
    expect(diagnostic?.range?.start.line).toBeTypeOf('number');
    expect(diagnostic?.range?.end.line).toBeTypeOf('number');
    expect(diagnostic).not.toHaveProperty('relatedPaths');
  });

  it('모호한 참조는 외부 ID에서 제외하고 모든 후보 경로를 정렬한다', /** 후보 경로 보존을 검증한다. */ () => {
    const [result] = successful(
      complete(
        observation('z.yaml', 'z', 'Target'),
        observation('a.yaml', 'a', 'Target'),
        observation('source.yaml', 'source', 'Source', {
          definition: '[[Target]]',
        }),
      ),
      ['source'],
    );
    expect(result).toMatchObject({ references: [] });
    expect(result?.diagnostics).toContainEqual(
      expect.objectContaining({
        code: queryDiagnosticCodes.referenceAmbiguous,
        relatedPaths: ['a.yaml', 'z.yaml'],
      }),
    );
  });

  it('단일 대상의 ID 누락과 중복은 내부 연결을 유지하되 외부 ID에서 제외한다', /** 경로 연결과 외부 ID를 구분한다. */ () => {
    const missingCatalog = complete(
      observation('target.yaml', undefined, 'Target'),
      observation('source.yaml', 'source', 'Source', {
        definition: '[[Target]]',
      }),
    );
    expect(
      missingCatalog.documents
        .get('source.yaml')
        ?.references.map((item) => item.path),
    ).toEqual(['target.yaml']);
    const [missing] = successful(missingCatalog, ['source']);
    expect(missing).toMatchObject({ references: [] });
    expect(missing?.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'reference_target_error',
        relatedPaths: ['target.yaml'],
        reason: 'missing_id',
      }),
    );

    const duplicateCatalog = complete(
      observation('target.yaml', 'shared', 'Target'),
      observation('other.yaml', 'shared', 'Other'),
      observation('source.yaml', 'source', 'Source', {
        definition: '[[Target]]',
      }),
    );
    expect(
      duplicateCatalog.documents
        .get('source.yaml')
        ?.references.map((item) => item.path),
    ).toEqual(['target.yaml']);
    const [duplicate] = successful(duplicateCatalog, ['source']);
    expect(duplicate).toMatchObject({ references: [] });
    expect(duplicate?.diagnostics).toContainEqual(
      expect.objectContaining({
        relatedPaths: ['target.yaml'],
        reason: 'duplicate_id',
      }),
    );
  });

  it('역참조 출처의 ID가 없으면 외부 ID에서 제외하고 출처 경로와 이유를 반환한다', /** 역참조에도 같은 ID 규칙을 적용한다. */ () => {
    const catalog = complete(
      observation('target.yaml', 'target', 'Target'),
      observation('source.yaml', undefined, 'Source', {
        definition: '[[Target]]',
      }),
    );
    expect(
      catalog.documents
        .get('target.yaml')
        ?.referencedBy.map((item) => item.path),
    ).toEqual(['source.yaml']);
    const [target] = successful(catalog, ['target']);
    expect(target).toMatchObject({ referencedBy: [] });
    expect(target?.diagnostics).toContainEqual(
      expect.objectContaining({
        relatedPaths: ['source.yaml'],
        reason: 'missing_id',
      }),
    );
  });

  it('큰 본문과 20개 결과의 문서·참조 목록을 자르지 않는다', /** 응답 크기 절단이 없음을 검증한다. */ () => {
    const body = '큰 본문'.repeat(100_000);
    const targets = Array.from({ length: 19 }, (_, index) =>
      observation(`target-${index}.yaml`, `target-${index}`, `Target ${index}`),
    );
    const references = targets
      .map((_, index) => `[[Target ${index}]]`)
      .join(' ');
    const catalog = complete(
      ...targets,
      observation('large.yaml', 'large', 'Large', {
        definition: `${body}${references}`,
      }),
    );
    const ids = ['large', ...targets.map((_, index) => `target-${index}`)];
    const projection = projectCatalogGet(catalog, ids);
    if (!projection.success) throw new Error('20개 조회가 성공해야 한다');
    expect(projection.results).toHaveLength(20);
    const large = projection.results[0];
    expect(large).toMatchObject({
      references: Array.from(
        { length: 19 },
        (_, index) => `target-${index}`,
      ).sort(),
    });
    if (!large?.found || large.conflict)
      throw new Error('큰 문서 결과가 있어야 한다');
    expect(large.document?.definition).toBe(`${body}${references}`);
  });

  it('결과를 새 값으로 만들고 Catalog와 호출자 입력을 바꾸지 않는다', /** 순수 투영과 복사를 검증한다. */ () => {
    const catalog = complete(observation('a.yaml', 'a', 'A'));
    const ids = ['a', 'a'] as const;
    const beforeSource =
      catalog.documents.get('a.yaml')?.observation.parsed.source;
    const projection = projectCatalogGet(catalog, ids);
    expect(ids).toEqual(['a', 'a']);
    expect(catalog.documents.get('a.yaml')?.observation.parsed.source).toBe(
      beforeSource,
    );
    if (!projection.success) throw new Error('상세 조회가 성공해야 한다');
    const result = projection.results[0];
    if (!result?.found || result.conflict || !result.document)
      throw new Error('문서 결과가 있어야 한다');
    const parsed = catalog.documents.get('a.yaml')?.observation.parsed;
    expect(result.document).not.toBe(parsed?.success ? parsed.data : undefined);
  });
});
