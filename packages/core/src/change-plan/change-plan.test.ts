/* eslint-disable codocs/korean-jsdoc, jsdoc/require-jsdoc -- Vitest의 인라인 콜백은 선언 함수가 아니다. */
import { describe, expect, it } from 'vitest';
import { buildCatalog, scanStatuses } from '../catalog/index.js';
import { diagnosticSeverities } from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import { changePlanStatuses, planDocumentChange } from './index.js';

const base = 'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\n';

/** 확인한 원문을 한 번만 파싱하여 변경 계획의 중립 관측을 만든다. */
function context(
  raw: string,
  others: readonly { path: string; raw: string }[] = [],
) {
  const path = '.codocs/zone.yaml';
  const catalog = buildCatalog({
    status: scanStatuses.complete,
    observations: [
      { path, parsed: parseYaml(raw, path) },
      ...others.map((item) => ({
        path: item.path,
        parsed: parseYaml(item.raw, item.path),
      })),
    ],
  });
  return {
    catalog,
    source: { path, raw, revision: 'old-revision', utf8Lossless: true },
  };
}

describe('단일 문서 변경 후보', () => {
  it('ID 왕복에서 직전 ID만 남기고 기존 message를 보존한다', () => {
    const first = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'return-zone' },
      },
      context(base),
    );
    expect(first.status).toBe(changePlanStatuses.candidate);
    if (first.status !== changePlanStatuses.candidate) return;
    expect(parseYaml(first.raw).success).toBe(true);
    const second = planDocumentChange(
      {
        mode: 'update',
        id: 'return-zone',
        revision: 'old-revision',
        set: { id: 'zone' },
      },
      {
        ...context(first.raw),
        catalog: buildCatalog({
          status: scanStatuses.complete,
          observations: [
            { path: '.codocs/zone.yaml', parsed: parseYaml(first.raw) },
          ],
        }),
      },
    );
    expect(second.status).toBe(changePlanStatuses.candidate);
    if (second.status !== changePlanStatuses.candidate) return;
    expect(second.data.deprecatedAliases).toEqual([{ id: 'return-zone' }]);
    const raw =
      'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\ndeprecatedAliases: [{id: previous, message: 남길 메시지}]\n';
    const changed = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone' },
      },
      context(raw),
    );
    expect(changed.status).toBe(changePlanStatuses.candidate);
    if (changed.status === changePlanStatuses.candidate)
      expect(changed.data.deprecatedAliases).toEqual([
        { id: 'previous', message: '남길 메시지' },
        { id: 'zone' },
      ]);
  });

  it('이전 목록 직접 수정과 빈 변경을 요청 경계에서 거부한다', () => {
    for (const request of [
      { set: { deprecatedAliases: [] } },
      { unset: ['deprecatedAliases'] },
      { set: { id: 'zone', deprecatedAliases: [] } },
      { set: {} },
      { set: { name: '동일' }, unset: ['name'] },
    ]) {
      const result = planDocumentChange(
        { mode: 'update', id: 'zone', revision: 'old-revision', ...request },
        context(base),
      );
      expect(result.status).toBe(changePlanStatuses.failed);
    }
  });

  it('오류 무변경은 실패하고 경고 무변경은 성공한다', () => {
    const broken = base.replace('id: zone', 'id: Bad');
    const invalid = planDocumentChange(
      {
        mode: 'update',
        id: 'Bad',
        revision: 'old-revision',
        unset: ['missing'],
      },
      context(broken),
    );
    expect(invalid.status).toBe(changePlanStatuses.failed);
    const warned = base + 'custom: value\n';
    const unchanged = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['missing'],
      },
      context(warned),
    );
    expect(unchanged.status).toBe(changePlanStatuses.unchanged);
    if (unchanged.status === changePlanStatuses.unchanged)
      expect(unchanged.revision).toBe('old-revision');
  });

  it('문서 밖 오류는 반환하지 않고 대상의 ID 충돌은 반환한다', () => {
    const other = {
      path: '.codocs/other.yaml',
      raw: 'id: other\nname: 다른 이름\ndomains: [운영]\ndefinition: "[[없음]]"\n',
    };
    const clean = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명' },
      },
      context(base, [other]),
    );
    expect(clean.status).toBe(changePlanStatuses.candidate);
    const collision = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'other' },
      },
      context(base, [other]),
    );
    expect(collision.status).toBe(changePlanStatuses.failed);
    if (collision.status === changePlanStatuses.failed)
      expect(collision.diagnostics.some((d) => d.code === 'duplicate_id')).toBe(
        true,
      );
  });

  it('원문의 따옴표, 주석, CRLF와 EOF 형식을 바뀌지 않은 구간에 유지한다', () => {
    const raw =
      '# 앞 주석\r\nid: zone\r\nname: "구역" # 옆 주석\r\ndomains: [운영]\r\ndefinition: 설명';
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새😀설명' },
      },
      context(raw),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate)
      expect(result.raw).toBe(
        '# 앞 주석\r\nid: zone\r\nname: "구역" # 옆 주석\r\ndomains: [운영]\r\ndefinition: 새😀설명',
      );
  });

  it('flow 매핑의 첫째, 중간, 마지막 선택 속성을 제거한다', () => {
    for (const key of ['first', 'middle', 'last']) {
      const raw =
        '{id: zone, name: 구역, domains: [운영], definition: 설명, first: 1, middle: 2, last: 3}\n';
      const result = planDocumentChange(
        { mode: 'update', id: 'zone', revision: 'old-revision', unset: [key] },
        context(raw),
      );
      expect(result.status, key).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate)
        expect(Object.hasOwn(result.data, key)).toBe(false);
    }
  });

  it('블록 문자열의 끝 개행과 배열 전체 교체를 해석값까지 보존한다', () => {
    const raw =
      'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\nexamples: [옛 예시]\n';
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명\n', examples: ['하나', '둘'] },
      },
      context(raw),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate) {
      expect(result.data.definition).toBe('새 설명\n');
      expect(result.data.examples).toEqual(['하나', '둘']);
      expect(
        result.raw.startsWith('id: zone\nname: 구역\ndomains: [운영]\n'),
      ).toBe(true);
    }
  });

  it('EOF 개행이 없는 배열 전체 교체에서도 파일 끝을 유지한다', () => {
    const raw =
      'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\nexamples: [옛 예시]';
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { examples: ['새 예시', '다음 예시'] },
      },
      context(raw),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate) {
      expect(result.raw.endsWith('\n')).toBe(false);
      expect(result.data.examples).toEqual(['새 예시', '다음 예시']);
    }
  });

  it('들여쓴 최상위 매핑에서 배열 교체와 이전 ID 추가의 들여쓰기를 유지한다', () => {
    const raw =
      '  id: zone\n  name: 구역\n  domains: [운영]\n  definition: 설명\n  examples: [옛 예시]\n';
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'next-zone', examples: ['새 예시', '두 번째'] },
      },
      context(raw),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate) {
      expect(result.raw).toContain(
        '  examples: \n    - 새 예시\n    - 두 번째',
      );
      expect(result.raw).toContain('  deprecatedAliases:');
      expect(result.data.deprecatedAliases).toEqual([{ id: 'zone' }]);
    }
  });

  it('flow의 중첩 객체를 추가하고 독립 주석은 선택 속성 삭제 후에도 남긴다', () => {
    const flow = '{id: zone, name: 구역, domains: [운영], definition: 설명}\n';
    const added = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { 'custom.key': { nested: [1, 2] } },
      },
      context(flow),
    );
    expect(added.status).toBe(changePlanStatuses.candidate);
    if (added.status === changePlanStatuses.candidate)
      expect(added.data['custom.key']).toEqual({ nested: [1, 2] });
    const block =
      'id: zone\nname: 구역\ndomains: [운영]\ndefinition: 설명\nextra: 1 # 옆 주석\n# 독립 주석\nother: 2\n';
    const removed = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['extra'],
      },
      context(block),
    );
    expect(removed.status).toBe(changePlanStatuses.candidate);
    if (removed.status === changePlanStatuses.candidate)
      expect(removed.raw).toContain('# 독립 주석\nother: 2');
  });

  it('생성 경로는 관측과 충돌하면 실패하고 새 문서는 후보가 된다', () => {
    const catalog = context(base).catalog;
    const document = {
      id: 'new-zone',
      name: '새 구역',
      domains: ['운영'],
      definition: '설명',
    };
    expect(
      planDocumentChange(
        { mode: 'create', path: '.codocs/zone.yaml', document },
        { catalog },
      ).status,
    ).toBe(changePlanStatuses.failed);
    const created = planDocumentChange(
      { mode: 'create', path: '.codocs/new-zone.yaml', document },
      { catalog },
    );
    expect(created.status).toBe(changePlanStatuses.candidate);
  });

  it('불완전한 색인을 완전한 확인으로 승격하지 않는다', () => {
    const catalog = buildCatalog({
      status: scanStatuses.partial,
      observations: [{ path: '.codocs/zone.yaml', parsed: parseYaml(base) }],
    });
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '새 설명' },
      },
      { catalog, source: context(base).source },
    );
    expect(result.status).toBe(changePlanStatuses.failed);
  });

  it('flow의 인접 주석을 지우고 쉼표가 든 독립 주석은 보존한다', () => {
    const raw =
      '{id: zone, name: 구역, domains: [운영], definition: 설명, a: 1, # a comment\n # independent, comma\n b: 2}\n';
    for (const key of ['a', 'b']) {
      const result = planDocumentChange(
        { mode: 'update', id: 'zone', revision: 'old-revision', unset: [key] },
        context(raw),
      );
      expect(result.status, key).toBe(changePlanStatuses.candidate);
      if (result.status === changePlanStatuses.candidate) {
        expect(result.raw).toContain('# independent, comma');
        if (key === 'a') expect(result.raw).not.toContain('# a comment');
      }
    }
  });

  it('인접한 flow 속성을 함께 지우고 trailing comma 앞에 새 속성을 추가한다', () => {
    const raw =
      '{id: zone, name: 구역, domains: [운영], definition: 설명, a: 1, b: 2, c: 3,}\n';
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['a', 'b'],
        set: { extra: [1, 2] },
      },
      context(raw),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate) {
      expect(result.data.extra).toEqual([1, 2]);
      expect(result.raw).not.toContain('a: 1');
      expect(result.raw).not.toContain('b: 2');
    }
  });

  it('flow 마지막 속성 삭제와 새 속성 추가를 한 후보에 반영한다', () => {
    const raw =
      '{id: zone, name: 구역, domains: [운영], definition: 설명, old: 1,}\n';
    const result = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['old'],
        set: { newest: 2 },
      },
      context(raw),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate)
      expect(result.data.newest).toBe(2);
  });

  it('중간 flow 속성 바로 앞의 독립 주석을 유지한다', () => {
    const raw =
      '{id: zone, name: 구역, domains: [운영], definition: 설명, # 옆\n # 독립 주석, 쉼표\n old: 1, tail: 2}\n';
    const result = planDocumentChange(
      { mode: 'update', id: 'zone', revision: 'old-revision', unset: ['old'] },
      context(raw),
    );
    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status === changePlanStatuses.candidate)
      expect(result.raw).toContain('# 독립 주석, 쉼표');
  });

  it('접근자 입력과 순환 JSON은 실행하지 않고 실패한다', () => {
    let invoked = 0;
    const request = Object.defineProperty({}, 'mode', {
      get() {
        invoked++;
        return 'update';
      },
      enumerable: true,
    });
    expect(planDocumentChange(request, context(base)).status).toBe(
      changePlanStatuses.failed,
    );
    expect(invoked).toBe(0);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      planDocumentChange(
        {
          mode: 'update',
          id: 'zone',
          revision: 'old-revision',
          set: { custom: cyclic },
        },
        context(base),
      ).status,
    ).toBe(changePlanStatuses.failed);
  });

  it('잘못된 새 ID, 오래된 revision, 잘못된 이전 목록을 진단한다', () => {
    const badId = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { id: 'Bad ID' },
      },
      context(base),
    );
    expect(badId.status).toBe(changePlanStatuses.failed);
    if (badId.status === changePlanStatuses.failed)
      expect(
        badId.diagnostics.some(
          (d) => d.code === 'invalid_field_value' && d.range,
        ),
      ).toBe(true);
    const stale = planDocumentChange(
      { mode: 'update', id: 'zone', revision: 'stale', unset: ['absent'] },
      context(base),
    );
    expect(stale.status).toBe(changePlanStatuses.failed);
    if (stale.status === changePlanStatuses.failed)
      expect(stale.diagnostics[0]?.code).toBe('change_revision_mismatch');
    const invalidAliases = base + 'deprecatedAliases: [{id: Bad ID}]\n';
    const unchanged = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['absent'],
      },
      context(invalidAliases),
    );
    expect(unchanged.status).toBe(changePlanStatuses.failed);
  });

  it('대상의 참조 오류를 고친 후보를 허용하고 참조 대상 오류는 경고로 둔다', () => {
    const broken = base.replace(
      'definition: 설명',
      'definition: "[[없는 이름]]"',
    );
    const recovered = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        set: { definition: '설명' },
      },
      context(broken),
    );
    expect(recovered.status).toBe(changePlanStatuses.candidate);
    const badTarget = {
      path: '.codocs/target.yaml',
      raw: 'id: target\nname: 대상\ndomains: [운영]\ndefinition: ""\n',
    };
    const referring = base.replace(
      'definition: 설명',
      'definition: "[[대상]]"',
    );
    const warning = planDocumentChange(
      {
        mode: 'update',
        id: 'zone',
        revision: 'old-revision',
        unset: ['absent'],
      },
      context(referring, [badTarget]),
    );
    expect(warning.status).toBe(changePlanStatuses.unchanged);
    if (warning.status === changePlanStatuses.unchanged)
      expect(
        warning.diagnostics.some(
          (d) =>
            d.code === 'reference_target_error' &&
            d.severity === diagnosticSeverities.warning,
        ),
      ).toBe(true);
  });
});
