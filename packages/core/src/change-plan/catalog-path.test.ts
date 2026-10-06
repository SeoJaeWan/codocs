import { describe, expect, it } from 'vitest';
import { buildCatalog, scanStatuses } from '../catalog/index.js';
import {
  changePlanDiagnosticCodes,
  queryDiagnosticCodes,
} from '../diagnostics/index.js';
import { parseYaml } from '../parser/index.js';
import {
  changePlanModes,
  changePlanStatuses,
  planDocumentChange,
  planDocumentChanges,
  type ChangePlanSource,
} from './index.js';

/** Windows 색인처럼 `\`로 이어진 경로다. */
const windowsPath = (...segments: string[]): string => segments.join('\\');

/** 요청의 `/` 경로를 Windows 색인 표기로 바꾸는 변환이다. */
const toWindows = (requestPath: string): string =>
  requestPath.replaceAll('/', '\\');

const aPath = windowsPath('.codocs', 'a.yaml');
const bPath = windowsPath('.codocs', 'b.yaml');
const raws: Record<string, string> = {
  [aPath]: '_codocs:\n  id: a\n  name: 가\n개요: 가 설명\n',
  [bPath]: '_codocs:\n  id: b\n  name: 나\n개요: 나 설명\n',
};

/** 경로가 Windows 표기인 색인과 원문을 만든다. */
function windowsContext(catalogPath?: (requestPath: string) => string) {
  const catalog = buildCatalog({
    status: scanStatuses.complete,
    observations: Object.entries(raws).map(([file, raw]) => ({
      path: file,
      parsed: parseYaml(raw, file),
    })),
  });
  const sources: ChangePlanSource[] = Object.entries(raws).map(
    ([file, raw]) => ({
      path: file,
      raw,
      revision: `r-${file}`,
      utf8Lossless: true,
    }),
  );
  return { catalog, sources, ...(catalogPath ? { catalogPath } : {}) };
}

const create = (requestPath: string, id: string) => ({
  mode: 'create',
  path: requestPath,
  document: { _codocs: { id, name: `${id}문서` }, 개요: '설명' },
});

describe('planDocumentChanges: 색인 경로 표기 변환', () => {
  it('create와 move 결과는 요청의 / 경로를 색인 표기로 바꿔 담고 previousPath는 색인 경로 그대로다', () => {
    const result = planDocumentChanges(
      [
        create('.codocs/sub/n.yaml', 'n'),
        {
          mode: 'move',
          id: 'a',
          revision: `r-${aPath}`,
          path: '.codocs/moved/a.yaml',
        },
      ],
      windowsContext(toWindows),
    );

    expect(result.status).toBe(changePlanStatuses.candidate);
    if (result.status !== changePlanStatuses.candidate) return;
    expect(result.items.map((item) => item.path)).toEqual([
      windowsPath('.codocs', 'sub', 'n.yaml'),
      windowsPath('.codocs', 'moved', 'a.yaml'),
    ]);
    expect(result.items[1]).toMatchObject({
      mode: changePlanModes.move,
      previousPath: aPath,
    });
  });

  it('이미 있는 문서 경로가 / 표기로 요청돼도 create와 move 모두 pathExists로 거절한다', () => {
    const created = planDocumentChanges(
      [create('.codocs/b.yaml', 'n')],
      windowsContext(toWindows),
    );
    const moved = planDocumentChanges(
      [
        {
          mode: 'move',
          id: 'a',
          revision: `r-${aPath}`,
          path: '.codocs/b.yaml',
        },
      ],
      windowsContext(toWindows),
    );

    for (const result of [created, moved]) {
      expect(result.status).toBe(changePlanStatuses.failed);
      expect(result.diagnostics.map((item) => item.code)).toEqual([
        changePlanDiagnosticCodes.pathExists,
      ]);
      expect(result.diagnostics[0]?.path).toBe(bPath);
    }
  });

  it('기존 문서의 색인 경로와 같은 / 경로를 다른 항목이 요청하면 같은 경로로 보아 invalid_input으로 거절한다', () => {
    const result = planDocumentChanges(
      [
        {
          mode: 'move',
          id: 'a',
          revision: `r-${aPath}`,
          path: '.codocs/sub/a.yaml',
        },
        create('.codocs/a.yaml', 'n'),
      ],
      windowsContext(toWindows),
    );

    expect(result.status).toBe(changePlanStatuses.failed);
    expect(result.diagnostics).toMatchObject([
      { code: queryDiagnosticCodes.invalidInput, path: aPath },
    ]);
  });

  it('단일 create의 결과 경로도 같은 색인 표기를 따른다', () => {
    const result = planDocumentChange(
      create('.codocs/sub/n.yaml', 'n'),
      windowsContext(toWindows),
    );

    expect(result).toMatchObject({
      status: changePlanStatuses.candidate,
      path: windowsPath('.codocs', 'sub', 'n.yaml'),
    });
  });
});
