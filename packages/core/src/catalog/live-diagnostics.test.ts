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
        'id: target\nname: 대상\ndefinition: 설명\ndomains: [test]\n',
      ),
    };
    const catalog = buildCatalog({
      status: scanStatuses.complete,
      observations: [saved],
    });
    const live = {
      path: 'source.yaml',
      parsed: parseYaml(
        '# 😀\r\nid: target\r\nname: 출처\r\ndefinition: 설명\r\ndomains: [test]\r\n',
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
        'id: source\nname: 출처\ndefinition: 설명\ndomains: [test]\n',
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
            'id: same\nname: 출처\ndefinition: 설명\ndomains: [test]\n',
          ),
        },
        {
          path: 'target.yaml',
          parsed: parseYaml(
            'id: same\nname: 대상\ndefinition: 설명\ndomains: [test]\n',
          ),
        },
      ],
    });
    const result = resolveLiveDocument(catalog, {
      path: 'source.yaml',
      parsed: parseYaml(
        'id: unique\nname: 출처\ndefinition: 설명\ndomains: [test]\n',
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
            'id: same\nname: 대상\ndefinition: 설명\ndomains: [test]\n',
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
