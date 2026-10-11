import { scanStatuses } from '@codocs/core';
import path from 'node:path';
import {
  codocsLocationScanFailures,
  containsWorkspacePath,
  type WorkspaceDocumentResult,
  type WorkspaceLoadResult,
  type WorkspaceObservationCache,
  type WorkspacePathScanResult,
  type WorkspaceScanFailure,
  type WorkspaceScanResult,
} from '../loader/index.js';
import type { CodocsLocations } from '../paths/index.js';
import type { ProjectRoot } from '../project-root/index.js';

/** 게시된 snapshot과 분리된 전체 탐색의 작업 관측이다. 부분 보정만으로 전체 범위를 넓히지 않는다. */
export class QueryObservations {
  readonly #root: ProjectRoot;
  readonly #documents = new Map<string, WorkspaceDocumentResult>();
  #failures: readonly WorkspaceScanFailure[];
  #skippedLinks: WorkspaceScanResult['skippedLinks'];
  #locations: CodocsLocations | undefined;

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
    // 위치 규칙 실패는 경로 범위로 지울 수 없으므로 따로 보관하고 게시할 때 현재 위치 규칙으로 다시 만든다.
    this.#failures = scan.failures.filter((item) => !item.location);
    this.#skippedLinks = scan.skippedLinks;
    this.#locations = scan.codocsLocations;
  }

  /** 이후 게시에 쓸 하위 .codocs 위치 규칙을 교체한다. 위치 규칙 실패도 함께 바뀐다. */
  setLocations(locations: CodocsLocations | undefined): void {
    this.#locations = locations;
  }

  /**
   * 더 이상 인정하지 않는 .codocs 범위의 문서·실패·연결 경고를 읽지 않고 지운다.
   * @param scope 지울 .codocs의 발견 경로(OS 경로)다.
   */
  drop(scope: string): void {
    for (const candidate of this.#documents.keys())
      if (containsWorkspacePath(scope, candidate))
        this.#documents.delete(candidate);
    this.#failures = this.#failures.filter(
      (item) =>
        !item.logicalPath || !containsWorkspacePath(scope, item.logicalPath),
    );
    this.#skippedLinks = this.#skippedLinks.filter(
      /** 지운 범위의 이전 연결 경고를 남기지 않는다. */
      (item) =>
        !item.path ||
        !containsWorkspacePath(
          scope,
          path.join(this.#root.projectRoot, item.path),
        ),
    );
  }

  /** 현재 세대의 범위 확인만 부재·실패를 반영하고 읽기는 각 관측 세대로 검증한다. */
  apply(
    result: WorkspacePathScanResult,
    cache: WorkspaceObservationCache,
  ): void {
    const scope = result.coverage.logicalPath;
    if (!scope) return;
    if (cache.isScopeCurrent(scope, result.generation)) {
      this.drop(scope);
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
    const failures = [
      ...this.#failures,
      ...codocsLocationScanFailures(this.#locations),
    ];
    const status = failures.some(
      (item) => item.logicalPath === this.#root.codocsPath,
    )
      ? scanStatuses.failed
      : failures.length
        ? scanStatuses.partial
        : scanStatuses.complete;
    return {
      root: this.#root,
      status,
      documents,
      failures,
      skippedLinks: this.#skippedLinks,
      diagnostics: [
        ...documents.flatMap((item) => item.diagnostics),
        ...failures.flatMap((item) => item.diagnostics),
        ...this.#skippedLinks,
      ],
      ...(this.#locations ? { codocsLocations: this.#locations } : {}),
    };
  }
}
