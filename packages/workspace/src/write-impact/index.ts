import path from 'node:path';
import {
  calculateChangeImpact,
  catalogConfirmations,
  changeImpactDiagnosticMessages,
  changeImpactStatuses,
  codeReferenceStatuses,
  type ChangeImpact,
  type SourceRange,
} from '@codocs/core';
import {
  codeCollectionStatuses,
  codeFileReasons,
  type WorkspaceCodeReferenceSnapshot,
} from '../code-reference/index.js';
import type { WorkspaceQuerySession } from '../query/index.js';
import type { SavedChangeContext } from '../storage/save-context.js';
import { writeImpactBases } from './domain-values.js';
export * from './domain-values.js';

/** 저장 전 수집과 같은 문서 세대의 revision을 내부 비교 자료로 보관한다. */
export interface WorkspaceWriteImpactCapture {
  snapshot: WorkspaceCodeReferenceSnapshot;
  revisions: ReadonlyMap<string, string>;
  failures: readonly string[];
}
/** 실제 변경 저장에 덧붙이는 안내다. 전후 문서 본문은 포함하지 않는다. */
export interface WorkspaceWriteImpactNotice {
  basis: (typeof writeImpactBases)[keyof typeof writeImpactBases];
  target: { path: string; revision: string; beforeRevision?: string };
  collection: Omit<WorkspaceCodeReferenceSnapshot, 'occurrences'>;
  calculation: {
    status: (typeof changeImpactStatuses)[keyof typeof changeImpactStatuses];
    failures: readonly string[];
  };
  impacts: readonly (ChangeImpact & {
    sourcePath: string;
    sourceUri: string;
    sourceRevision: string;
    range: SourceRange;
    marker: string;
  })[];
}
/** 저장을 차단하지 않고 디스크 출현과 그 해석에 사용한 문서 revision을 확보한다. */
export async function captureWorkspaceWriteImpact(
  session: WorkspaceQuerySession,
): Promise<WorkspaceWriteImpactCapture> {
  try {
    const snapshot = await session.savedCodeReferenceSnapshot();
    const paths = [
      ...new Set(
        snapshot.occurrences.flatMap((occurrence) =>
          occurrence.target ? [occurrence.target.path] : [],
        ),
      ),
    ];
    if (!paths.length) return { snapshot, revisions: new Map(), failures: [] };
    const details = await session.getByPaths(
      paths,
      snapshot.documentGeneration,
    );
    const revisions = new Map<string, string>();
    if (details.success)
      for (const item of details.results)
        if (
          item.found &&
          item.confirmation === catalogConfirmations.confirmed &&
          item.revision
        )
          revisions.set(item.source.path, item.revision);
    return {
      snapshot,
      revisions,
      failures: details.success
        ? []
        : [changeImpactDiagnosticMessages.revisionMismatch],
    };
  } catch (error: unknown) {
    return {
      snapshot: {
        status: codeCollectionStatuses.incomplete,
        codeGeneration: 0,
        documentGeneration: session.catalogVersion,
        occurrences: [],
        confirmedCount: 0,
        failures: [
          {
            reason: codeFileReasons.read,
            message: `${changeImpactDiagnosticMessages.captureFailed} ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      },
      revisions: new Map(),
      failures: [changeImpactDiagnosticMessages.captureFailed],
    };
  }
}
/** 실제 저장한 전후 자료를 비교하며 계산 예외를 저장 성공과 분리한다. */
export function createWorkspaceWriteImpactNotice(
  capture: WorkspaceWriteImpactCapture,
  context: SavedChangeContext | undefined,
  target: { path: string; revision: string },
  beforeCalculate?: () => void,
): WorkspaceWriteImpactNotice {
  const { occurrences, ...collection } = capture.snapshot;
  const base = {
    basis: writeImpactBases.savedFiles,
    target: {
      ...target,
      // 공개 안내의 경로는 플랫폼과 무관하게 프로젝트 상대 '/' 표기다.
      path: target.path.split(path.sep).join('/'),
      ...(context?.baseRevision
        ? { beforeRevision: context.baseRevision }
        : {}),
    },
    collection,
  };
  try {
    if (capture.failures.length)
      return {
        ...base,
        calculation: {
          status: changeImpactStatuses.incomplete,
          failures: capture.failures,
        },
        impacts: [],
      };
    if (!context)
      return {
        ...base,
        calculation: {
          status: changeImpactStatuses.incomplete,
          failures: [changeImpactDiagnosticMessages.contextMissing],
        },
        impacts: [],
      };
    if (!context.before && context.baseRevision !== undefined)
      return {
        ...base,
        calculation: {
          status: changeImpactStatuses.incomplete,
          failures: [changeImpactDiagnosticMessages.contextMissing],
        },
        impacts: [],
      };
    if (!context.before)
      return {
        ...base,
        calculation: { status: changeImpactStatuses.complete, failures: [] },
        impacts: [],
      };
    const selected = occurrences.filter(
      (occurrence) =>
        occurrence.status === codeReferenceStatuses.resolved &&
        occurrence.target?.path === context.path &&
        occurrence.destination,
    );
    if (
      selected.length &&
      capture.revisions.get(context.path) !== context.before.revision
    )
      return {
        ...base,
        calculation: {
          status: changeImpactStatuses.incomplete,
          failures: [changeImpactDiagnosticMessages.revisionMismatch],
        },
        impacts: [],
      };
    beforeCalculate?.();
    const calculated = calculateChangeImpact({
      before: context.before,
      after: context.after,
      references: selected.map(
        /** 저장 전의 명시 영역과 도메인 한정만 순수 판단에 전달한다. */ (
          occurrence,
        ) => ({
          occurrenceId: occurrence.occurrenceId,
          destination: occurrence.destination!,
          ...(occurrence.marker.domain === undefined
            ? {}
            : { domain: occurrence.marker.domain }),
        }),
      ),
    });
    const byId = new Map(
      selected.map((occurrence) => [occurrence.occurrenceId, occurrence]),
    );
    return {
      ...base,
      calculation: { status: calculated.status, failures: calculated.failures },
      impacts: calculated.impacts.map(
        /** 계산 사유를 원래 코드 출현 위치에 연결한다. */ (impact) => {
          const occurrence = byId.get(impact.occurrenceId)!;
          return {
            ...impact,
            sourcePath: occurrence.sourcePath,
            sourceUri: occurrence.sourceUri,
            sourceRevision: occurrence.sourceRevision,
            range: occurrence.marker.range,
            marker: occurrence.marker.text,
          };
        },
      ),
    };
  } catch (error: unknown) {
    return {
      ...base,
      calculation: {
        status: changeImpactStatuses.incomplete,
        failures: [
          `${changeImpactDiagnosticMessages.calculationFailed} ${error instanceof Error ? error.message : String(error)}`,
        ],
      },
      impacts: [],
    };
  }
}
