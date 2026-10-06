import {
  planDocumentChange,
  planDocumentChanges,
  type ChangePlanSource,
  type ChangesPlanResult,
  changePlanStatuses,
  diagnosticSeverities,
  type Catalog,
  type ChangePlanCodeReference,
  type ChangePlanResult,
  type Diagnostic,
} from '@codocs/core';
import {
  workspaceCodeEvidenceDiagnosticCodes,
  workspaceCodeEvidenceDiagnosticMessages,
  type WorkspaceCodeEvidence,
} from '../code-reference/index.js';
import path from 'node:path';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import type { WorkspaceScanResult } from '../loader/index.js';
import { discoveryPath } from '../query/discovery-path.js';
import { calculateRevision } from '../revision/index.js';

/** 미저장 후보의 새 바이트 revision을 포함한다. */
export type WorkspaceChangePlanResult =
  | Exclude<ChangePlanResult, { status: typeof changePlanStatuses.candidate }>
  | (Extract<
      ChangePlanResult,
      { status: typeof changePlanStatuses.candidate }
    > & { revision: string });

/** 쓰기 직전 보호에 쓸 코드 파일의 저장 원문 증거를 새로 수집하는 경계다. */
export type WorkspaceCodeEvidenceCollector =
  () => Promise<WorkspaceCodeEvidence>;

/**
 * 같은 스캔의 원문·revision·확인 상태로 순수 core 후보 계산을 연결한다. 디스크를 다시 읽거나 쓰지 않는다.
 * @param input create·update·replace 요청이다.
 * @param scan 후보 계산의 기준이 되는 같은 스캔이다.
 * @param catalog 스캔에서 만든 색인이다.
 * @param codeReferences 이번 변경이 건드리지 않는 코드 파일의 표기다. 생략하면 코드 영향은 판단하지 않는다.
 */
export function planWorkspaceChange(
  input: unknown,
  scan: WorkspaceScanResult,
  catalog: Catalog = buildWorkspaceCatalog(scan),
  codeReferences?: readonly ChangePlanCodeReference[],
): WorkspaceChangePlanResult {
  let id: unknown;
  try {
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      const mode = Object.getOwnPropertyDescriptor(input, 'mode');
      const selected = Object.getOwnPropertyDescriptor(input, 'id');
      if (
        mode &&
        'value' in mode &&
        (mode.value === 'update' || mode.value === 'replace') &&
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
    ...(codeReferences ? { codeReferences } : {}),
    catalogPath: discoveryPath,
  });
  if (result.status !== changePlanStatuses.candidate) return result;
  return {
    ...result,
    revision: calculateRevision(new TextEncoder().encode(result.raw)),
  };
}

/** 코드 참조 보호를 증명하지 못해 저장을 거절하는 진단이다. 확인하지 못한 범위를 안내에 담는다. */
function incompleteEvidenceDiagnostic(
  evidence: WorkspaceCodeEvidence,
  sourcePath: string,
): Diagnostic<string> {
  const scopes = evidence.failures.map((failure) => failure.path ?? '전체');
  return {
    code: workspaceCodeEvidenceDiagnosticCodes.incomplete,
    severity: diagnosticSeverities.error,
    message: workspaceCodeEvidenceDiagnosticMessages.incomplete,
    path: sourcePath,
    suggestion: scopes.length
      ? `확인하지 못한 범위(${[...new Set(scopes)].join(', ')})를 정리하고 다시 시도하세요.`
      : '코드 수집이 끝난 뒤 다시 시도하세요.',
  };
}

/**
 * 후보를 계산하되 섹션을 삭제하는 후보에만 코드 파일의 새로 읽은 저장 원문으로 참조 단절을 확인한다.
 * 먼저 코드 증거 없이 계산하고, 삭제된 섹션이 있을 때만 증거를 수집해 다시 계산한다.
 * 생성·텍스트 수정·섹션 추가·변경 없음에는 코드 수집을 요구하지 않는다.
 * 증거가 완전하지 않으면 참조 보호를 증명하지 못한 것이므로 후보를 돌려주지 않고 실패한다.
 * @param input create·update·replace 요청이다.
 * @param scan 후보 계산의 기준이 되는 같은 스캔이다.
 * @param collect 호출 시점의 코드 저장 원문을 새로 수집한다. IDE buffer나 보유 색인에 의존하지 않는다.
 * @param catalog 스캔에서 만든 색인이다.
 */
export async function planProtectedWorkspaceChange(
  input: unknown,
  scan: WorkspaceScanResult,
  collect: WorkspaceCodeEvidenceCollector,
  catalog: Catalog = buildWorkspaceCatalog(scan),
): Promise<WorkspaceChangePlanResult> {
  const first = planWorkspaceChange(input, scan, catalog);
  if (
    first.status !== changePlanStatuses.candidate ||
    !first.removedSections.length
  )
    return first;
  const evidence = await collect();
  const targetPath = first.path.split(path.sep).join('/');
  if (!evidence.complete)
    return {
      status: changePlanStatuses.failed,
      diagnostics: [incompleteEvidenceDiagnostic(evidence, first.path)],
    };
  return planWorkspaceChange(
    input,
    scan,
    catalog,
    evidence.files
      .filter(
        /** 후보로 교체되는 대상 문서 자신의 이전 원문은 변경하지 않는 코드 증거가 아니다. */ (
          file,
        ) => file.path !== targetPath,
      )
      .flatMap(
        /** 코드 파일마다 모든 표기를 같은 출처 경로와 함께 전달한다. */ (
          file,
        ) => file.markers.map((marker) => ({ sourcePath: file.path, marker })),
      ),
  );
}

/** 다중 항목 계획 결과다. 후보에는 항목별로 새 바이트 revision을 붙이지 않는다. 반영 뒤 디스크 revision을 쓴다. */
export type WorkspaceChangesPlanResult = ChangesPlanResult;

/** 항목 객체에서 자체 데이터 속성 값만 읽는다. 접근자는 실행하지 않는다. */
function ownValue(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && 'value' in descriptor
      ? (descriptor.value as unknown)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 기존 문서를 대상으로 하는 항목들의 같은 스캔 원문을 모은다. 유일한 경로로 정해지지 않는 ID는 core가 판정한다. */
function batchSources(
  items: unknown,
  scan: WorkspaceScanResult,
  catalog: Catalog,
): ChangePlanSource[] {
  if (!Array.isArray(items)) return [];
  const sources = new Map<string, ChangePlanSource>();
  for (let index = 0; index < items.length; index++) {
    const item = ownValue(items, String(index));
    const mode = ownValue(item, 'mode');
    const id = ownValue(item, 'id');
    if (mode === 'create' || typeof id !== 'string') continue;
    const paths = catalog.idPaths.get(id);
    const selected = paths?.size === 1 ? [...paths][0] : undefined;
    if (selected === undefined || sources.has(selected)) continue;
    const document = scan.documents.find(
      (candidate) => candidate.source.path === selected,
    );
    if (document)
      sources.set(selected, {
        path: document.source.path,
        raw: document.raw,
        revision: document.revision,
        utf8Lossless: document.utf8Lossless,
      });
  }
  return [...sources.values()];
}

/**
 * 같은 스캔의 원문으로 여러 항목의 순수 core 다중 계획을 연결한다. 디스크를 다시 읽거나 쓰지 않는다.
 * @param items create·update·replace·delete·move 항목 배열이다.
 * @param scan 계획의 기준이 되는 같은 스캔이다.
 * @param catalog 스캔에서 만든 색인이다.
 * @param codeReferences 이번 변경이 건드리지 않는 코드 파일의 표기다. 생략하면 코드 영향은 판단하지 않는다.
 */
export function planWorkspaceChanges(
  items: unknown,
  scan: WorkspaceScanResult,
  catalog: Catalog = buildWorkspaceCatalog(scan),
  codeReferences?: readonly ChangePlanCodeReference[],
): WorkspaceChangesPlanResult {
  const sources = batchSources(items, scan, catalog);
  return planDocumentChanges(items, {
    catalog,
    ...(sources.length ? { sources } : {}),
    ...(codeReferences ? { codeReferences } : {}),
    catalogPath: discoveryPath,
  });
}

/**
 * 다중 계획을 만들되 코드 영향이 있는 계획(`requiresCodeEvidence`)에만 코드 저장 원문을 한 번 새로 수집한다.
 * 증거가 완전하지 않으면 참조 보호를 증명하지 못한 것이므로 후보를 돌려주지 않고 실패한다.
 * 이번 계획이 바꾸거나 지우거나 옮기는 문서 자신의 이전 원문은 변경하지 않는 코드 증거에서 제외한다.
 * @param items 항목 배열이다.
 * @param scan 계획의 기준이 되는 같은 스캔이다.
 * @param collect 호출 시점의 코드 저장 원문을 새로 수집한다. IDE buffer나 보유 색인에 의존하지 않는다.
 * @param catalog 스캔에서 만든 색인이다.
 */
export async function planProtectedWorkspaceChanges(
  items: unknown,
  scan: WorkspaceScanResult,
  collect: WorkspaceCodeEvidenceCollector,
  catalog: Catalog = buildWorkspaceCatalog(scan),
): Promise<WorkspaceChangesPlanResult> {
  const first = planWorkspaceChanges(items, scan, catalog);
  if (
    first.status !== changePlanStatuses.candidate ||
    !first.requiresCodeEvidence
  )
    return first;
  const evidence = await collect();
  if (!evidence.complete) {
    const changed = first.items.find((item) => item.changed);
    return {
      status: changePlanStatuses.failed,
      diagnostics: [
        incompleteEvidenceDiagnostic(evidence, changed?.path ?? ''),
      ],
    };
  }
  const touched = new Set(
    first.items
      .filter((item) => item.changed)
      .flatMap((item) =>
        item.previousPath === undefined
          ? [item.path]
          : [item.path, item.previousPath],
      )
      .map((item) => item.split(path.sep).join('/')),
  );
  return planWorkspaceChanges(
    items,
    scan,
    catalog,
    evidence.files
      .filter(
        /** 계획이 바꾸는 문서 자신의 이전 원문은 변경하지 않는 코드 증거가 아니다. */ (
          file,
        ) => !touched.has(file.path),
      )
      .flatMap(
        /** 코드 파일마다 모든 표기를 같은 출처 경로와 함께 전달한다. */ (
          file,
        ) => file.markers.map((marker) => ({ sourcePath: file.path, marker })),
      ),
  );
}
