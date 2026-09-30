import {
  catalogConfirmations,
  duplicateDetectionConfig,
  duplicateExclusionReasons,
  scanStatuses,
  type Catalog,
  type DuplicateDocumentInput,
  type DuplicateExclusionCounts,
  type ScanStatus,
} from '@codocs/core';
import {
  resolveDuplicateCheckOptions,
  type WorkspaceDuplicateCheckOptions,
} from './config.js';
import {
  workspaceDuplicateDraftCoverages,
  workspaceDuplicateExpiryReasons,
  workspaceDuplicateIncompleteReasons,
  workspaceDuplicateScopes,
  workspaceDuplicateStatuses,
  workspaceDuplicateStopReasons,
  workspaceDuplicateUncheckedReasons,
  type WorkspaceDuplicateExpiryReason,
  type WorkspaceDuplicateIncompleteReason,
} from './domain-values.js';
import { DuplicatePreparationCache } from './preparation-cache.js';
import {
  decodeDuplicateCursor,
  duplicateSourceFingerprint,
  encodeDuplicateCursor,
  projectDuplicateResult,
  retainDuplicateResult,
  sliceDuplicatePage,
  type DuplicateSourceBasis,
  type DuplicateSourceEntry,
  type RetainedDuplicateResult,
  type WorkspaceDuplicateCandidate,
  type WorkspaceDuplicateExactGroup,
  type WorkspaceDuplicateReport,
} from './results.js';
import {
  runDuplicateCheck,
  type WorkspaceDuplicateUncheckedItem,
} from './runner.js';

/** 검사가 고정하는 색인 관측이다. 요청 시작 때 한 번 읽고 검사 중 바뀌어도 섞지 않는다. */
export interface DuplicateSnapshot {
  scanStatus: Exclude<ScanStatus, typeof scanStatuses.failed>;
  catalog: Catalog;
  revisions: ReadonlyMap<string, string>;
  catalogVersion: number;
}

/** 변경 계획이 만든 미저장 후보다. */
export interface DuplicateDraftInput {
  document: DuplicateDocumentInput & { id: string };
  /** 비교 집합에서 뺄 저장 문서의 원래 경로다. */
  excludedPath: string;
}

/** 세션이 응답으로 바꿀 성공 페이지다. */
export interface DuplicatePageSuccess extends WorkspaceDuplicateReport {
  candidates: readonly WorkspaceDuplicateCandidate[];
  exactGroups: readonly WorkspaceDuplicateExactGroup[];
  returnedCount: number;
  remainingCount: number;
  nextCursor: string | null;
  /** 결과를 만든 검사 중에 색인이 다시 게시되었다. 페이지 조회에서는 항상 false다. */
  indexChangedDuringCheck: boolean;
}

/** 세션 응답 변환 전의 결과다. */
export type DuplicateCheckerOutcome =
  | { kind: 'page'; page: DuplicatePageSuccess }
  | { kind: 'cancelled' }
  | { kind: 'expired'; reason: WorkspaceDuplicateExpiryReason }
  | { kind: 'error' };

/** 문서별 준비 캐시와 최근 검사 결과 한 건을 세션 수명 동안 소유하고 검사를 실행한다. */
export class WorkspaceDuplicateChecker {
  readonly #cache = new DuplicatePreparationCache();
  readonly #options: ReturnType<typeof resolveDuplicateCheckOptions>;
  #retained: RetainedDuplicateResult | undefined;

  /** 실행 설정을 확정한다. */
  constructor(options?: WorkspaceDuplicateCheckOptions) {
    this.#options = resolveDuplicateCheckOptions(options);
  }

  /** 색인 문서에서 지문 입력과 준비 대상, 검사하지 못한 범위를 나눈다. */
  #scope(
    snapshot: DuplicateSnapshot,
    excludedPath: string | undefined,
  ): {
    entries: DuplicateSourceEntry[];
    documents: DuplicateDocumentInput[];
    unchecked: WorkspaceDuplicateUncheckedItem[];
  } {
    const entries: DuplicateSourceEntry[] = [];
    const documents: DuplicateDocumentInput[] = [];
    const unchecked: WorkspaceDuplicateUncheckedItem[] = [];
    const paths = [...snapshot.catalog.documents.keys()].sort();
    for (const documentPath of paths) {
      const document = snapshot.catalog.documents.get(documentPath);
      if (!document) continue;
      const revision = snapshot.revisions.get(documentPath);
      const confirmed =
        document.confirmation === catalogConfirmations.confirmed;
      entries.push({ path: documentPath, revision, confirmed });
      if (documentPath === excludedPath) continue;
      if (!confirmed)
        unchecked.push({
          path: documentPath,
          ...(revision === undefined ? {} : { revision }),
          reason: workspaceDuplicateUncheckedReasons.unconfirmed,
        });
      else if (revision === undefined)
        unchecked.push({
          path: documentPath,
          reason: workspaceDuplicateUncheckedReasons.revisionUnavailable,
        });
      else
        documents.push({
          path: documentPath,
          ...(document.id === undefined ? {} : { id: document.id }),
          revision,
          parsed: document.observation.parsed,
        });
    }
    for (const failure of snapshot.catalog.failures) {
      const failedPath =
        ('path' in failure ? failure.path : undefined) ??
        failure.diagnostics?.[0]?.path;
      unchecked.push({
        ...(failedPath === undefined ? {} : { path: failedPath }),
        reason: workspaceDuplicateUncheckedReasons.readFailed,
      });
    }
    return { entries, documents, unchecked };
  }

  /** 현재 색인 전체 또는 초안 후보를 검사하고 완료·부분 완료 결과를 최근 결과로 보관한다. */
  async check(
    snapshot: DuplicateSnapshot,
    draft: DuplicateDraftInput | undefined,
    signal: AbortSignal | undefined,
    state: () => { catalogVersion: number; closed: boolean },
  ): Promise<DuplicateCheckerOutcome> {
    const scope = this.#scope(snapshot, draft?.excludedPath);
    this.#cache.retainOnly(new Set(snapshot.catalog.documents.keys()));
    const basis: DuplicateSourceBasis = draft
      ? {
          scope: workspaceDuplicateScopes.draft,
          excludedPath: draft.excludedPath,
          draft: {
            path: draft.document.path,
            revision: draft.document.revision,
          },
        }
      : { scope: workspaceDuplicateScopes.all };
    let outcome;
    try {
      outcome = await runDuplicateCheck({
        documents: scope.documents,
        ...(draft ? { draft: draft.document } : {}),
        cache: this.#cache,
        options: this.#options,
        ...(signal ? { signal } : {}),
      });
    } catch {
      return { kind: 'error' };
    }
    if (outcome.cancelled || state().closed) return { kind: 'cancelled' };
    const unchecked: WorkspaceDuplicateUncheckedItem[] = [
      ...scope.unchecked,
      ...outcome.unchecked,
      ...(outcome.result?.skippedInputs.map(
        /** core가 건너뛴 입력을 미확인 범위로 옮긴다. */ (skipped) => ({
          path: skipped.path,
          revision: skipped.revision,
          reason: skipped.reason,
        }),
      ) ?? []),
    ].sort(
      (left, right) =>
        (left.path ?? '￿').localeCompare(right.path ?? '￿') ||
        left.reason.localeCompare(right.reason),
    );
    const incompleteReasons: WorkspaceDuplicateIncompleteReason[] = [
      ...(outcome.stopped
        ? [workspaceDuplicateIncompleteReasons.timeLimit]
        : []),
      ...(snapshot.scanStatus === scanStatuses.complete
        ? []
        : [workspaceDuplicateIncompleteReasons.discoveryPartial]),
      ...(unchecked.length
        ? [workspaceDuplicateIncompleteReasons.uncheckedDocuments]
        : []),
    ];
    const projected = outcome.result
      ? projectDuplicateResult(outcome.result, draft?.document.path)
      : { candidates: [], exactGroups: [] };
    const report: WorkspaceDuplicateReport = {
      status: incompleteReasons.length
        ? workspaceDuplicateStatuses.partial
        : workspaceDuplicateStatuses.complete,
      scope: basis.scope,
      scanStatus: snapshot.scanStatus,
      catalogVersion: snapshot.catalogVersion,
      configVersion: duplicateDetectionConfig.version,
      incompleteReasons,
      ...(outcome.stopped
        ? { stopReason: workspaceDuplicateStopReasons.timeLimit }
        : {}),
      progress: outcome.progress,
      comparedDocumentCount: outcome.comparedDocumentCount,
      unchecked,
      exclusions:
        outcome.result?.exclusions ??
        (Object.fromEntries(
          Object.values(duplicateExclusionReasons).map((reason) => [reason, 0]),
        ) as DuplicateExclusionCounts),
      totalCandidates: projected.candidates.length,
      preparation: {
        preparedCount: outcome.preparedCount,
        reusedCount: outcome.reusedCount,
      },
      ...(draft
        ? {
            draft: {
              path: draft.document.path,
              id: draft.document.id,
              revision: draft.document.revision,
              coverage: workspaceDuplicateDraftCoverages.candidateFullText,
            },
          }
        : {}),
    };
    const retained = retainDuplicateResult({
      fingerprint: duplicateSourceFingerprint(basis, scope.entries),
      report,
      candidates: projected.candidates,
      exactGroups: projected.exactGroups,
      basis,
    });
    this.#retained = retained;
    return {
      kind: 'page',
      page: this.#page(
        retained,
        0,
        state().catalogVersion !== snapshot.catalogVersion,
      ),
    };
  }

  /** 보관한 결과에서 한 페이지를 만든다. */
  #page(
    retained: RetainedDuplicateResult,
    offset: number,
    indexChangedDuringCheck: boolean,
  ): DuplicatePageSuccess {
    const page = sliceDuplicatePage(retained, offset);
    return {
      ...retained.report,
      candidates: page.candidates,
      exactGroups: page.exactGroups,
      returnedCount: page.candidates.length,
      remainingCount: page.remainingCount,
      nextCursor:
        page.nextOffset === null
          ? null
          : encodeDuplicateCursor({
              offset: page.nextOffset,
              fingerprint: retained.fingerprint,
              configVersion: retained.report.configVersion,
              resultId: retained.id,
            }),
      indexChangedDuringCheck,
    };
  }

  /** 커서의 결과가 아직 보관 중이고 원문 버전 목록과 설정이 같을 때만 다음 페이지를 제공한다. */
  page(cursor: string, snapshot: DuplicateSnapshot): DuplicateCheckerOutcome {
    const payload = decodeDuplicateCursor(cursor);
    const retained = this.#retained;
    if (!payload || !retained)
      return {
        kind: 'expired',
        reason: workspaceDuplicateExpiryReasons.unrecognized,
      };
    if (payload.resultId !== retained.id)
      return {
        kind: 'expired',
        reason: workspaceDuplicateExpiryReasons.resultReplaced,
      };
    const current = duplicateSourceFingerprint(
      retained.basis,
      this.#scope(snapshot, retained.basis.excludedPath).entries,
    );
    if (
      current !== retained.fingerprint ||
      payload.fingerprint !== retained.fingerprint ||
      payload.configVersion !== duplicateDetectionConfig.version
    )
      return {
        kind: 'expired',
        reason: workspaceDuplicateExpiryReasons.sourceChanged,
      };
    if (payload.offset > retained.candidates.length)
      return {
        kind: 'expired',
        reason: workspaceDuplicateExpiryReasons.unrecognized,
      };
    return { kind: 'page', page: this.#page(retained, payload.offset, false) };
  }
}
