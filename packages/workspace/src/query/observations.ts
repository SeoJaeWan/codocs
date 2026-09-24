import { scanStatuses } from '@codocs/core';
import path from 'node:path';
import {
  containsWorkspacePath,
  type WorkspaceDocumentResult,
  type WorkspaceLoadResult,
  type WorkspaceObservationCache,
  type WorkspacePathScanResult,
  type WorkspaceScanFailure,
  type WorkspaceScanResult,
} from '../loader/index.js';
import type { ProjectRoot } from '../project-root/index.js';

/** 게시된 snapshot과 분리된 전체 탐색의 작업 관측이다. 부분 보정만으로 전체 범위를 넓히지 않는다. */
export class QueryObservations {
  readonly #root: ProjectRoot;
  readonly #documents = new Map<string, WorkspaceDocumentResult>();
  #failures: readonly WorkspaceScanFailure[];
  #skippedLinks: WorkspaceScanResult['skippedLinks'];

  /** 이전 전체 범위 또는 이번 전체 순회의 관측에서 작업 상태를 시작한다. */
  constructor(
    root: ProjectRoot,
    scan: WorkspaceScanResult,
    cache: WorkspaceObservationCache,
    observations?: WorkspaceLoadResult['observations'],
  ) {
    this.#root = root;
    for (const document of observations
      ? observations
          .filter((item) => cache.isCurrent(item))
          .map((item) => item.document)
      : scan.documents)
      this.#documents.set(document.source.logicalPath, document);
    this.#failures = scan.failures;
    this.#skippedLinks = scan.skippedLinks;
  }

  /** 현재 세대의 범위 확인만 부재·실패를 반영하고 읽기는 각 관측 세대로 검증한다. */
  apply(
    result: WorkspacePathScanResult,
    cache: WorkspaceObservationCache,
  ): void {
    const scope = result.coverage.logicalPath;
    if (!scope) return;
    if (cache.isScopeCurrent(scope, result.generation)) {
      for (const candidate of this.#documents.keys())
        if (containsWorkspacePath(scope, candidate))
          this.#documents.delete(candidate);
      this.#failures = this.#failures.filter(
        (item) =>
          !item.logicalPath || !containsWorkspacePath(scope, item.logicalPath),
      );
      this.#skippedLinks = this.#skippedLinks.filter(
        /** 재확인 범위의 이전 연결 경고를 현재 관측으로 교체한다. */
        (item) =>
          !item.path ||
          !containsWorkspacePath(
            scope,
            path.join(this.#root.projectRoot, item.path),
          ),
      );
      this.#failures = [...this.#failures, ...result.failures];
      this.#skippedLinks = [...this.#skippedLinks, ...result.skippedLinks];
    }
    if (result.outcome !== scanStatuses.failed)
      for (const observation of result.observations)
        if (cache.isCurrent(observation))
          this.#documents.set(
            observation.document.source.logicalPath,
            observation.document,
          );
  }

  /** 채택한 원문에서 진단을 재구성하며 전체 범위의 실패를 보수적으로 유지한다. */
  snapshot(): WorkspaceScanResult {
    const documents = [...this.#documents.values()].sort((a, b) =>
      a.source.path.localeCompare(b.source.path),
    );
    const status = this.#failures.some(
      (item) => item.logicalPath === this.#root.codocsPath,
    )
      ? scanStatuses.failed
      : this.#failures.length
        ? scanStatuses.partial
        : scanStatuses.complete;
    return {
      root: this.#root,
      status,
      documents,
      failures: this.#failures,
      skippedLinks: this.#skippedLinks,
      diagnostics: [
        ...documents.flatMap((item) => item.diagnostics),
        ...this.#failures.flatMap((item) => item.diagnostics),
        ...this.#skippedLinks,
      ],
    };
  }
}
