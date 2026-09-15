import {
  buildCatalog,
  type Catalog,
  type CatalogFailure,
  type CatalogObservation,
  type CatalogScan,
} from '@codocs/core';
import type {
  WorkspaceDocumentResult,
  WorkspaceScanFailure,
  WorkspaceScanResult,
} from '../loader/index.js';

/** 파싱 성공 모델을 재사용하며 파싱 실패에서 미검증 정보나 참조를 추측하지 않는다. */
function observation(document: WorkspaceDocumentResult): CatalogObservation {
  return {
    path: document.source.path,
    realPath: document.source.realPath,
    parsed:
      document.status === 'parseError'
        ? {
            success: false,
            source: document.raw,
            diagnostics: document.diagnostics,
          }
        : document.parsed,
  };
}

/** 확인한 프로젝트 상대 실패 범위만 core에 전달하고 IO 진단은 그대로 유지한다. */
function failure(scope: WorkspaceScanFailure): CatalogFailure {
  if (
    scope.path !== undefined &&
    (scope.kind === 'file' || scope.kind === 'directory')
  ) {
    return {
      kind: scope.kind === 'directory' ? 'folder' : 'file',
      path: scope.path,
      diagnostics: scope.diagnostics,
    };
  }
  return { kind: 'unknown', diagnostics: scope.diagnostics };
}

/**
 * 실제 로더 스캔을 중립 core 관측으로 변환한다. IO·경로 보정·ID/실경로 병합은 하지 않는다.
 * 파싱 성공 데이터와 원문 문자열 매핑은 검증 성공 여부와 무관하게 같은 모델을 재사용한다.
 * @param scan 로더가 확인한 문서와 실패 범위다.
 * @returns 확인한 상태와 발견 경로별 관측이다. 순환 건너뜀은 누락 실패로 바꾸지 않는다.
 */
export function toCatalogScan(scan: WorkspaceScanResult): CatalogScan {
  return {
    status: scan.status,
    observations: scan.documents.map(observation),
    failures: scan.failures.map(failure),
  };
}

/**
 * 새 스캔과 이전 색인을 연결하여 직접/역참조 및 진단을 다시 계산한다. 입력은 변경하지 않는다.
 * complete의 부재만 삭제 증거다. partial은 누락 자료를 미확인으로, failed는 이전 자료를 보존한다.
 * @param scan 실제 로더 또는 결정적인 테스트에서 제공한 새 스캔이다.
 * @param previous 같은 프로젝트의 이전 색인이다. 다른 프로젝트 색인을 섞지 않는다.
 * @returns core의 경로별 문서 색인과 실패 상태다. 저장·watcher·rename 실행은 수행하지 않는다.
 */
export function buildWorkspaceCatalog(
  scan: WorkspaceScanResult,
  previous?: Catalog,
): Catalog {
  return buildCatalog(toCatalogScan(scan), previous);
}
