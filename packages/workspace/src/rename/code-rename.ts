import {
  codeReferenceSyntaxes,
  offsetToPosition,
  referenceResolutionStatuses,
  renameImpactReasons,
  replaceCodeReferencePart,
  resolveReference,
  type Catalog,
  type CatalogDocument,
  type OffsetRange,
  type ReferenceCandidate,
  type ReferenceResolution,
  type RenameSelection,
} from '@codocs/core';
import type {
  WorkspaceCodeRenameFile,
  WorkspaceCodeRenameSources,
} from '../code-reference/index.js';
import {
  workspaceRenameFileKinds,
  workspaceRenameUnknownCodePath,
  workspaceRenameUnreadOccurrenceIndex,
} from './domain-values.js';
import type {
  WorkspaceRenameChange,
  WorkspaceRenameEdit,
  WorkspaceRenameImpact,
  WorkspaceRenameRequest,
  WorkspaceRenameResolution,
} from './index.js';

/** 코드 파일의 이름 변경 계산 결과다. */
export interface CodeRenamePlan {
  /** 고칠 표기이며 경로와 원문 위치 순서다. */
  changes: readonly WorkspaceRenameChange[];
  /** 자동으로 고치지 않은 코드 표기와 확인하지 못한 코드 파일이다. */
  impacts: readonly WorkspaceRenameImpact[];
  /** 모호한 코드 표기가 아니거나 후보에 없는 대상을 고른 선택이다. */
  invalidSelections: readonly RenameSelection[];
  /** 파일별 새 원문이다. */
  edits: readonly WorkspaceRenameEdit[];
  /** 영향을 확인한 코드 파일의 현재 revision이다. 읽지 못한 파일은 없다. */
  revisions: Readonly<Record<string, string>>;
}

/** 코드 수집 경로가 .codocs 안이면 문서 쪽 계산이 다루므로 제외한다. */
function insideCodocs(filePath: string): boolean {
  return filePath === '.codocs' || filePath.startsWith('.codocs/');
}

/**
 * 이름 변경이 고칠 수 있는 코드 파일을 경로로 모은다. .codocs 안의 파일은 문서 계산의 대상이므로 제외한다.
 * @param catalog 같은 스캔의 문서 색인이다.
 * @param sources 코드 수집의 저장 관측이다.
 */
export function codeRenameFiles(
  catalog: Catalog,
  sources: WorkspaceCodeRenameSources,
): ReadonlyMap<string, WorkspaceCodeRenameFile> {
  return new Map(
    sources.files
      .filter(
        (file) => !insideCodocs(file.path) && !catalog.documents.has(file.path),
      )
      .map((file) => [file.path, file]),
  );
}

/** 후보를 이름·경로만 가진 값으로 줄인다. */
function candidate(item: Pick<ReferenceCandidate, 'path' | 'name'>): {
  path: string;
  name?: string;
} {
  return {
    path: item.path,
    ...(item.name === undefined ? {} : { name: item.name }),
  };
}

/** 참조 해석을 보고용 값으로 줄인다. */
function resolution(item: ReferenceResolution): WorkspaceRenameResolution {
  return { status: item.status, candidates: item.candidates.map(candidate) };
}

/** 같은 표기에 대한 선택이 있으면 찾는다. */
function findSelection(
  selections: readonly RenameSelection[],
  sourcePath: string,
  occurrenceIndex: number,
): RenameSelection | undefined {
  return selections.find(
    (item) =>
      item.sourcePath === sourcePath &&
      item.occurrenceIndex === occurrenceIndex,
  );
}

/**
 * 코드 표기에 대한 선택이 올바른지 확인한다.
 * 존재하는 유효 표기이고 후보 안의 대상이며 같은 표기를 두 번 고르지 않아야 한다.
 */
function invalidCodeSelections(
  catalog: Catalog,
  files: ReadonlyMap<string, WorkspaceCodeRenameFile>,
  selections: readonly RenameSelection[],
): RenameSelection[] {
  /** 선택 하나가 올바르지 않은지 판단한다. index는 선택 목록 안의 순번이다. */
  function invalid(selection: RenameSelection, index: number): boolean {
    const marker = files.get(selection.sourcePath)?.markers[
      selection.occurrenceIndex
    ];
    if (
      !Number.isInteger(selection.occurrenceIndex) ||
      selection.occurrenceIndex < 0 ||
      !marker ||
      marker.syntax !== codeReferenceSyntaxes.valid ||
      marker.name === undefined ||
      selections.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          other.sourcePath === selection.sourcePath &&
          other.occurrenceIndex === selection.occurrenceIndex,
      )
    )
      return true;
    const before = resolveReference(catalog, {
      name: marker.name,
      ...(marker.section === undefined ? {} : { section: marker.section }),
    });
    return !before.candidates.some(
      (item) => item.path === selection.targetPath,
    );
  }
  return selections.filter(invalid);
}

/** 파일 원문 위치를 줄 좌표 범위로 바꾼다. 유효한 offset이라 항상 값이 있다. */
function sourceRange(
  text: string,
  start: number,
  end: number,
): WorkspaceRenameChange['range'] {
  return {
    start: offsetToPosition(text, start)!,
    end: offsetToPosition(text, end)!,
  };
}

/** 고칠 표기 하나와 파일 원문에서의 위치다. */
interface CodeEdit {
  change: WorkspaceRenameChange;
  offsetRange: OffsetRange;
}

/** 읽은 파일 하나의 표기를 살펴 고칠 것과 보고할 것으로 나눈다. */
function planFile(
  request: WorkspaceRenameRequest,
  target: CatalogDocument,
  catalog: Catalog,
  file: WorkspaceCodeRenameFile,
  selections: readonly RenameSelection[],
): { edits: CodeEdit[]; impacts: WorkspaceRenameImpact[] } {
  const edits: CodeEdit[] = [];
  const impacts: WorkspaceRenameImpact[] = [];
  const sectionRequest = 'section' in request ? request.section : undefined;
  for (const [occurrenceIndex, marker] of file.markers.entries()) {
    if (
      marker.syntax !== codeReferenceSyntaxes.valid ||
      marker.name === undefined
    )
      continue;
    const before = resolveReference(catalog, {
      name: marker.name,
      ...(marker.section === undefined ? {} : { section: marker.section }),
    });
    /** 이 표기를 자동으로 고치지 않고 영향으로 보고한다. */
    const report = (
      reason: WorkspaceRenameImpact['reason'],
      after: WorkspaceRenameResolution = resolution(before),
    ): void => {
      impacts.push({
        path: file.path,
        occurrenceIndex,
        text: marker.text,
        range: marker.range,
        reason,
        before: resolution(before),
        after,
        fileKind: workspaceRenameFileKinds.code,
      });
    };
    /** 표기의 이름 또는 섹션 부분을 새 이름으로 고치는 변경을 더한다. */
    const change = (): void => {
      const edit = replaceCodeReferencePart(
        marker,
        sectionRequest === undefined ? 'name' : 'section',
        request.newName,
      );
      if (!edit) return report(renameImpactReasons.unrepresentable);
      if (edit.newText === edit.oldText) return;
      edits.push({
        offsetRange: edit.offsetRange,
        change: {
          path: file.path,
          fieldPath: [],
          range: sourceRange(
            file.text,
            edit.offsetRange.start,
            edit.offsetRange.end,
          ),
          oldText: edit.oldText,
          newText: edit.newText,
          targetPath: target.path,
          occurrenceIndex,
          fileKind: workspaceRenameFileKinds.code,
        },
      });
    };
    const sameSection =
      sectionRequest === undefined || marker.section === sectionRequest;
    if (
      before.status === referenceResolutionStatuses.ambiguous &&
      sameSection &&
      before.candidates.some((item) => item.path === target.path)
    ) {
      const selection = findSelection(selections, file.path, occurrenceIndex);
      if (!selection) report(renameImpactReasons.selectionRequired);
      else if (selection.targetPath === target.path) change();
      continue;
    }
    if (sectionRequest === undefined) {
      if (
        (before.status === referenceResolutionStatuses.resolved ||
          before.status === referenceResolutionStatuses.missingSection) &&
        before.target?.path === target.path
      )
        change();
      else if (
        before.candidates.length === 0 &&
        target.name !== request.newName &&
        marker.name === request.newName
      )
        report(renameImpactReasons.changedResolution, {
          status: referenceResolutionStatuses.resolved,
          candidates: [candidate(target)],
        });
      continue;
    }
    if (
      before.status === referenceResolutionStatuses.resolved &&
      before.target?.path === target.path &&
      before.section === sectionRequest
    )
      change();
  }
  return { edits, impacts };
}

/** 파일 하나의 변경을 원문 뒤쪽부터 적용해 새 원문을 만든다. */
function editedText(text: string, edits: readonly CodeEdit[]): string {
  let result = text;
  for (const item of [...edits].sort(
    (a, b) => b.offsetRange.start - a.offsetRange.start,
  ))
    result =
      result.slice(0, item.offsetRange.start) +
      item.change.newText +
      result.slice(item.offsetRange.end);
  return result;
}

/**
 * 코드 파일에서 이번 이름 변경으로 고칠 표기와 보고할 표기를 계산한다. 파일과 색인은 바꾸지 않는다.
 * 문서 이름 변경은 이름이 그 문서로 확정된 표기의 이름 부분만, 섹션 이름 변경은 이름과 섹션이 모두 그 대상으로 확정된
 * 표기의 섹션 부분만 고친다. 후보가 여럿이라 모호한 표기는 선택을 따르고 선택이 없으면 영향으로 보고한다.
 * 읽지 못한 코드 경로와 특정할 수 없는 수집 실패는 확인하지 못한 영향으로 보고한다.
 * @param request 문서 또는 섹션 이름 변경 요청이다. 선택은 코드 표기를 가리키는 것만 쓴다.
 * @param catalog 같은 스캔에서 만든 색인이다.
 * @param files 이름 변경이 고칠 수 있는 코드 파일이다.
 * @param sources 수집 상태와 실패 목록이다.
 * @param selections 코드 표기를 가리키는 선택이다. sourcePath는 코드 파일 경로, occurrenceIndex는 그 파일의 표기 순번이다.
 */
export function planCodeRename(
  request: WorkspaceRenameRequest,
  catalog: Catalog,
  files: ReadonlyMap<string, WorkspaceCodeRenameFile>,
  sources: WorkspaceCodeRenameSources,
  selections: readonly RenameSelection[],
): CodeRenamePlan {
  const target = catalog.documents.get(request.targetPath);
  const invalidSelections = invalidCodeSelections(catalog, files, selections);
  if (!target || invalidSelections.length)
    return {
      changes: [],
      impacts: [],
      invalidSelections,
      edits: [],
      revisions: {},
    };
  const changes: WorkspaceRenameChange[] = [];
  const impacts: WorkspaceRenameImpact[] = [];
  const edits: WorkspaceRenameEdit[] = [];
  const revisions: Record<string, string> = {};
  for (const file of files.values()) {
    const planned = planFile(request, target, catalog, file, selections);
    if (!planned.edits.length && !planned.impacts.length) continue;
    changes.push(...planned.edits.map((item) => item.change));
    impacts.push(...planned.impacts);
    revisions[file.path] = file.revision;
    if (planned.edits.length)
      edits.push({
        path: file.path,
        raw: editedText(file.text, planned.edits),
        revision: file.revision,
        fileKind: workspaceRenameFileKinds.code,
      });
  }
  const unread = new Set<string>();
  for (const failure of sources.failures) {
    const failedPath = failure.path ?? workspaceRenameUnknownCodePath;
    if (insideCodocs(failedPath) || unread.has(failedPath)) continue;
    unread.add(failedPath);
  }
  for (const failedPath of [...unread].sort())
    impacts.push({
      path: failedPath,
      occurrenceIndex: workspaceRenameUnreadOccurrenceIndex,
      text: '',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      reason: renameImpactReasons.unconfirmed,
      before: {
        status: referenceResolutionStatuses.unconfirmed,
        candidates: [],
      },
      after: {
        status: referenceResolutionStatuses.unconfirmed,
        candidates: [],
      },
      fileKind: workspaceRenameFileKinds.code,
    });
  return { changes, impacts, invalidSelections: [], edits, revisions };
}
