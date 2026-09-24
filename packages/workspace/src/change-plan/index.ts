import {
  planDocumentChange,
  changePlanStatuses,
  type Catalog,
  type ChangePlanResult,
} from '@codocs/core';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import type { WorkspaceScanResult } from '../loader/index.js';
import { calculateRevision } from '../revision/index.js';

/** 미저장 후보의 새 바이트 revision을 포함한다. */
export type WorkspaceChangePlanResult =
  | Exclude<ChangePlanResult, { status: typeof changePlanStatuses.candidate }>
  | (Extract<
      ChangePlanResult,
      { status: typeof changePlanStatuses.candidate }
    > & { revision: string });

/** 같은 스캔의 원문·revision·확인 상태로 순수 core 후보 계산을 연결한다. 디스크를 다시 읽거나 쓰지 않는다. */
export function planWorkspaceChange(
  input: unknown,
  scan: WorkspaceScanResult,
  catalog: Catalog = buildWorkspaceCatalog(scan),
): WorkspaceChangePlanResult {
  let id: unknown;
  try {
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      const mode = Object.getOwnPropertyDescriptor(input, 'mode');
      const selected = Object.getOwnPropertyDescriptor(input, 'id');
      if (
        mode &&
        'value' in mode &&
        mode.value === 'update' &&
        selected &&
        'value' in selected
      )
        id = selected.value;
    }
  } catch {
    /* core가 입력 오류로 판정한다. */
  }
  const paths = typeof id === 'string' ? catalog.idPaths.get(id) : undefined;
  const path = paths?.size === 1 ? [...paths][0] : undefined;
  const document =
    path === undefined
      ? undefined
      : scan.documents.find((item) => item.source.path === path);
  const result = planDocumentChange(input, {
    catalog,
    ...(document
      ? {
          source: {
            path: document.source.path,
            raw: document.raw,
            revision: document.revision,
            utf8Lossless: document.utf8Lossless,
          },
        }
      : {}),
  });
  if (result.status !== changePlanStatuses.candidate) return result;
  return {
    ...result,
    revision: calculateRevision(new TextEncoder().encode(result.raw)),
  };
}
