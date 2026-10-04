import { describe, expect, it } from 'vitest';
import { parseYaml } from '../parser/index.js';
import {
  catalogDiagnosticCodes,
  catalogDiagnosticMessages,
} from '../diagnostics/index.js';
import { buildCatalog, resolveLiveDocument, scanStatuses } from './index.js';

describe('저장 ID 색인과 현재 편집 진단', () => {
  it('다른 저장 문서의 ID를 입력하면 현재 CRLF 원문의 ID 위치에 중복을 표시한다', () => {
    const saved = {
      path: 'target.yaml',
      parsed: parseYaml(
        'id: target\nname: 대상\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
      ),
    };
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [saved],
    });
    const live = {
      path: 'source.yaml',
      parsed: parseYaml(
        '# 😀\r\nid: target\r\nname: 출처\r\ndefinition: 설명\r\ndomains: [test]\r\ndeprecatedAliases: []\r\n',
      ),
    };
    const result = resolveLiveDocument(catalog, live);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: catalogDiagnosticCodes.duplicateId,
        message: catalogDiagnosticMessages.duplicateId,
        path: live.path,
        severity: 'error',
        range: {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 10 },
        },
        relatedPaths: ['source.yaml', 'target.yaml'],
      }),
    );
    expect(catalog.idPaths.get('target')).toEqual(new Set([saved.path]));
    expect(catalog.documents.has(live.path)).toBe(false);
  });

  it('현재 파일의 저장 ID만 같으면 자기 자신을 중복으로 진단하지 않는다', () => {
    const saved = {
      path: 'source.yaml',
      parsed: parseYaml(
        'id: source\nname: 출처\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
      ),
    };
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [saved],
    });
    expect(resolveLiveDocument(catalog, saved).diagnostics).toEqual([]);
  });

  it('저장 중복을 편집으로 해소하면 저장을 기다리지 않고 현재 중복 진단을 제거한다', () => {
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [
        {
          path: 'source.yaml',
          parsed: parseYaml(
            'id: same\nname: 출처\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
          ),
        },
        {
          path: 'target.yaml',
          parsed: parseYaml(
            'id: same\nname: 대상\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
          ),
        },
      ],
    });
    const result = resolveLiveDocument(catalog, {
      path: 'source.yaml',
      parsed: parseYaml(
        'id: unique\nname: 출처\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
      ),
    });
    expect(result.diagnostics).toEqual([]);
    expect(catalog.documents.get('target.yaml')?.diagnostics).toContainEqual(
      expect.objectContaining({ code: catalogDiagnosticCodes.duplicateId }),
    );
  });

  it('파싱 입력에 원문 위치가 없으면 중복 범위를 만들어 내지 않는다', () => {
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [
        {
          path: 'target.yaml',
          parsed: parseYaml(
            'id: same\nname: 대상\ndefinition: 설명\ndomains: [test]\ndeprecatedAliases: []\n',
          ),
        },
      ],
    });
    const result = resolveLiveDocument(catalog, {
      path: 'source.yaml',
      parsed: {
        success: true,
        data: { id: 'same', name: '출처', definition: '설명' },
        source: '',
        fields: [],
        strings: [],
        diagnostics: [],
      },
    });
    const duplicate = result.diagnostics.find(
      (item) => item.code === catalogDiagnosticCodes.duplicateId,
    );
    expect(duplicate).toBeDefined();
    expect(duplicate).not.toHaveProperty('range');
  });
});

describe('저장 이름·도메인 색인과 현재 편집 진단', () => {
  const source = {
    path: 'source.yaml',
    parsed: parseYaml(
      'id: source\nname: Same\ndefinition: 설명\ndomains: [shared]\ndeprecatedAliases: []\n',
    ),
  };
  const target = {
    path: 'target.yaml',
    parsed: parseYaml(
      'id: target\nname: Same\ndefinition: 설명\ndomains: [shared, other]\ndeprecatedAliases: []\n',
    ),
  };

  it('저장된 이름 중복 문서를 그대로 열면 동일한 진단과 위치를 유지한다', () => {
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [source, target],
    });
    const result = resolveLiveDocument(catalog, source);
    expect(result.documentDiagnostics).toEqual(
      catalog.documents.get(source.path)?.documentDiagnostics,
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: catalogDiagnosticCodes.duplicateName,
        domain: 'shared',
        relatedPaths: ['source.yaml', 'target.yaml'],
        range: {
          start: { line: 1, character: 6 },
          end: { line: 1, character: 10 },
        },
      }),
    );
  });

  it.each([
    ['이름', 'name: Unique\ndomains: [shared]'],
    ['도메인', 'name: Same\ndomains: [different]'],
  ])('%s 편집으로 충돌을 해소하면 현재 진단만 제거한다', (_label, fields) => {
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [source, target],
    });
    const result = resolveLiveDocument(catalog, {
      path: source.path,
      parsed: parseYaml(
        'id: source\ndefinition: 설명\ndeprecatedAliases: []\n' + fields + '\n',
      ),
    });
    expect(result.diagnostics).toEqual([]);
    expect(catalog.documents.get(target.path)?.diagnostics).toContainEqual(
      expect.objectContaining({ code: catalogDiagnosticCodes.duplicateName }),
    );
    expect(catalog.domainNamePaths.get('shared')?.get('Same')).toEqual(
      new Set([source.path, target.path]),
    );
  });

  it('미저장 이름이 여러 도메인에서 충돌하면 각 도메인을 현재 원문 위치에 진단한다', () => {
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [target],
    });
    const result = resolveLiveDocument(catalog, {
      path: source.path,
      parsed: parseYaml(
        '# 😀\r\nid: source\r\nname: Same\r\ndefinition: 설명\r\ndomains: [shared, other, shared]\r\ndeprecatedAliases: []\r\n',
      ),
    });
    const diagnostics = result.documentDiagnostics.filter(
      (item) => item.code === catalogDiagnosticCodes.duplicateName,
    );
    expect(diagnostics).toHaveLength(2);
    for (const domain of ['shared', 'other'])
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          domain,
          relatedPaths: [source.path, target.path],
          range: {
            start: { line: 2, character: 6 },
            end: { line: 2, character: 10 },
          },
        }),
      );
    expect(catalog.documents.has(source.path)).toBe(false);
  });
});

describe('편집 중인 출처의 참조 해석', () => {
  it('저장 원문과 다른 참조로 편집하면 현재 편집 내용의 참조로 대상을 판단한다', () => {
    const observation = (id: string, name: string, definition: string) => ({
      path: `${id}.yaml`,
      parsed: parseYaml(
        `id: ${id}\nname: ${name}\ndefinition: "${definition}"\ndomains: [test]\ndeprecatedAliases: []\n`,
      ),
    });
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [
        observation('a', 'A', '설명'),
        observation('b', 'B', '설명'),
        observation('source', '출처', '[[A]]'),
      ],
    });
    const result = resolveLiveDocument(
      catalog,
      observation('source', '출처', '[[B]]'),
    );
    expect(result.references.map((reference) => reference.path)).toEqual([
      'b.yaml',
    ]);
  });
});
