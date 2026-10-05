import {
  renameAbortReasons,
  renameAmbiguousStatus,
  renameApplyErrorCodes,
  renameBlockingReasons,
  renameChoiceReasons,
  renameFileStates,
  type RenameAbortReason,
} from './domain-values.js';

export {
  renameAbortReasons,
  renameApplyErrorCodes,
  renameBlockingReasons,
  renameChoiceReasons,
  renameFileStates,
  type RenameAbortReason,
} from './domain-values.js';

/** 이름 바꾸기를 시작할 수 있는 위치와 현재 이름을 확인하는 서버 요청이다. */
export const prepareRenameMethod = 'codocs/prepareRename';
/** 파일을 바꾸지 않고 이름 변경을 계산하는 서버 요청이다. */
export const planRenameMethod = 'codocs/planRename';
/** 미리보기와 같은 입력으로 이름 변경을 파일에 반영하는 서버 요청이다. */
export const applyRenameMethod = 'codocs/applyRename';

/** 이름 변경 대상 종류다. 문서 이름 변경과 섹션 이름 변경이 같은 흐름을 쓴다. */
export type RenameKind = 'document' | 'section';

/** 모호한 참조에서 사용자가 고른 대상이며 서버의 선택 입력과 같은 모양이다. */
export interface RenameSelection {
  sourcePath: string;
  occurrenceIndex: number;
  targetPath: string;
}

/** 사용자가 고를 수 있는 후보 문서다. */
export interface RenameCandidate {
  path: string;
  name?: string;
}

/** 자동으로 고치지 않은 참조와 그 후보다. */
export interface RenameImpact {
  path: string;
  occurrenceIndex: number;
  text: string;
  reason: string;
  before: { status: string; candidates: readonly RenameCandidate[] };
}

/** 서버가 계산한 이름 변경 미리보기에서 편집기가 쓰는 부분이다. */
export interface RenamePreview {
  status: string;
  blockingReason?: string;
  oldName?: string;
  newName: string;
  /** 섹션 이름 변경일 때 이름을 바꾸는 섹션의 현재 이름이다. */
  targetSection?: string;
  changeCount: number;
  impacts: readonly RenameImpact[];
  revisions: Readonly<Record<string, string>>;
  fileUris: Readonly<Record<string, string>>;
}

/** 서버가 보고한 반영 결과에서 편집기가 쓰는 부분이다. */
export interface RenameApplyResult {
  success: boolean;
  files: readonly { path: string; state: string }[];
  impactCount: number;
  error?: { code?: string; message?: string };
}

/** 사용자에게 보여줄 선택 목록의 항목이다. */
export interface RenameChoice {
  id: string;
  label: string;
  description?: string;
  detail?: string;
}

/** 사용자에게 보여줄 선택 목록이다. */
export interface RenameChoicePrompt {
  title: string;
  placeHolder: string;
  choices: readonly RenameChoice[];
}

/** 서버 요청·편집기 상태·UI를 이름 변경 흐름에서 분리하는 host 경계다. */
export interface RenameHost {
  /** 선택을 반영해 이름 변경을 계산하는 서버 요청이다. */
  planRename(selections: readonly RenameSelection[]): Promise<unknown>;
  /** 같은 선택과 미리보기의 revision으로 파일에 반영하는 서버 요청이다. */
  applyRename(
    selections: readonly RenameSelection[],
    revisions: Readonly<Record<string, string>>,
  ): Promise<unknown>;
  /** 주어진 file URI 중 저장하지 않은 수정이 있는 것을 반환한다. */
  findDirtyFiles(uris: readonly string[]): readonly string[];
  /** 목록에서 항목 하나를 고르며 고르지 않고 닫으면 undefined다. */
  choose(prompt: RenameChoicePrompt): Promise<string | undefined>;
  /** 결과를 사용자에게 알린다. */
  notify(level: 'information' | 'warning' | 'error', message: string): void;
  /** 편집기가 이름 바꾸기 요청을 취소했는지 확인한다. */
  isCancelled(): boolean;
}

/** 파일을 바꾸기 전에 이름 변경을 멈춘 이유와 사용자 안내 문구를 담는다. */
export class RenameAborted extends Error {
  readonly reason: RenameAbortReason;

  /** 중단 이유와 사용자에게 보여줄 문구를 보관한다. */
  constructor(reason: RenameAbortReason, message: string) {
    super(message);
    this.name = 'RenameAborted';
    this.reason = reason;
  }
}

/** 진행할 수 없는 이유별 안내 문구다. 알 수 없는 이유는 일반 문구를 쓴다. */
const blockedMessages: Readonly<Record<string, string>> = {
  [renameBlockingReasons.targetUnavailable]:
    '이름을 바꿀 문서를 확인할 수 없습니다.',
  [renameBlockingReasons.invalidName]: '새 이름이 비어 있습니다.',
  [renameBlockingReasons.nameConflict]:
    '프로젝트에 새 이름과 같은 문서가 있습니다.',
  [renameBlockingReasons.unconfirmed]:
    '프로젝트 탐색이 끝나지 않아 이름을 바꿀 수 없습니다.',
  [renameBlockingReasons.invalidSelection]: '선택한 참조가 올바르지 않습니다.',
  [renameBlockingReasons.sourceNotLossless]:
    '바꿀 파일의 원본을 UTF-8 손실 없이 보존할 수 없습니다.',
  [renameBlockingReasons.unrepresentable]:
    '새 이름을 그 위치의 표기로 안전하게 적을 수 없습니다.',
};

/** 섹션 이름 변경에서 이유별 안내 문구가 문서와 다른 경우의 문구다. */
const sectionBlockedMessages: Readonly<Record<string, string>> = {
  [renameBlockingReasons.targetUnavailable]:
    '이름을 바꿀 섹션을 확인할 수 없습니다.',
  [renameBlockingReasons.invalidName]:
    '새 섹션 이름이 올바르지 않습니다. 비어 있거나 _로 시작하거나 대괄호를 포함하거나 현재 이름과 같으면 쓸 수 없습니다.',
  [renameBlockingReasons.sectionConflict]:
    '문서에 새 이름과 같은 섹션이 있습니다.',
  [renameBlockingReasons.sectionNotFound]:
    '이름을 바꿀 섹션이 문서에 없습니다.',
  [renameBlockingReasons.unrepresentable]:
    '새 섹션 이름을 키의 표기로 안전하게 적을 수 없습니다.',
};

/** 반영이 거절·실패한 오류 코드별 안내 문구다. */
const applyErrorMessages: Readonly<Record<string, string>> = {
  [renameApplyErrorCodes.renameBlocked]:
    '이름을 바꿀 수 없는 상태라 파일을 바꾸지 않았습니다.',
  [renameApplyErrorCodes.affectedFilesChanged]:
    '영향받는 파일이 달라져 파일을 바꾸지 않았습니다. 이름 바꾸기를 다시 시작하세요.',
  [renameApplyErrorCodes.revisionConflict]:
    '파일이 계산한 뒤에 바뀌어 파일을 바꾸지 않았습니다. 이름 바꾸기를 다시 시작하세요.',
  [renameApplyErrorCodes.restoreFailed]:
    '파일을 쓰는 도중 실패했고 일부 파일을 원래대로 되돌리지 못했습니다.',
};

/** 파일별 반영 상태의 표시 이름이다. */
const fileStateLabels: Readonly<Record<string, string>> = {
  [renameFileStates.changed]: '바뀜',
  [renameFileStates.restored]: '복구됨',
  [renameFileStates.restoreFailed]: '복구 실패',
};

/** 사용자에게 보이는 고정 안내 문구다. */
export const renameMessages = {
  notRenamable: '이 위치에서는 문서나 섹션 이름을 바꿀 수 없습니다.',
  noChange: '바꿀 내용이 없습니다.',
  /** 계산에 실패한 이유를 서버 안내와 함께 알린다. */
  planFailed: (detail: string): string =>
    `이름 변경을 계산하지 못해 파일을 바꾸지 않았습니다: ${detail}`,
  /** 진행할 수 없는 이유를 알린다. */
  blocked: (
    reason: string | undefined,
    kind: RenameKind = 'document',
  ): string =>
    `${kind === 'section' ? '섹션 ' : ''}이름을 바꿀 수 없어 파일을 바꾸지 않았습니다. ${
      (reason &&
        ((kind === 'section' ? sectionBlockedMessages[reason] : undefined) ??
          blockedMessages[reason])) ??
      '진행할 수 없는 상태입니다.'
    }`,
  /** 저장하지 않은 파일을 알리고 중단했음을 안내한다. */
  dirtyFiles: (
    paths: readonly string[],
    kind: RenameKind = 'document',
  ): string =>
    `저장하지 않은 수정이 있는 파일이 있어 ${kind === 'section' ? '섹션 ' : ''}이름을 바꾸지 않았습니다. 저장하거나 되돌린 뒤 다시 시작하세요: ${paths.join(', ')}`,
  /** 참조 선택 목록의 제목이다. */
  chooseTitle: (
    path: string,
    text: string,
    kind: RenameKind = 'document',
  ): string =>
    `${kind === 'section' ? '섹션 ' : ''}이름 변경: ${path}의 ${text}가 가리킬 문서를 고르세요`,
  choosePlaceHolder:
    '고르지 않고 닫으면 이 참조는 바꾸지 않고 미해결로 남깁니다.',
  /** 반영 성공 결과를 알린다. */
  applied: (
    oldName: string | undefined,
    newName: string,
    changedFiles: number,
    kind: RenameKind = 'document',
  ): string =>
    `${kind === 'section' ? '섹션' : '문서'} 이름을 ${oldName === undefined ? '' : `'${oldName}'에서 `}'${newName}'(으)로 바꿨습니다. 바뀐 파일: ${changedFiles}개.`,
  /** 바꾸지 않고 남긴 참조를 알린다. */
  leftUnchanged: (count: number): string =>
    `바꾸지 않고 남긴 참조가 ${count}개 있습니다.`,
  /** 반영 실패를 알린다. 쓰는 도중 실패했으면 파일별 상태를 덧붙인다. */
  applyFailed: (
    error: RenameApplyResult['error'],
    files: RenameApplyResult['files'],
  ): string => {
    const base =
      (error?.code && applyErrorMessages[error.code]) ??
      `이름 변경을 반영하지 못했습니다${error?.message ? `: ${error.message}` : '.'}`;
    const states = files
      .filter((file) => file.state !== renameFileStates.unchanged)
      .map(
        (file) => `${file.path}(${fileStateLabels[file.state] ?? file.state})`,
      );
    return states.length ? `${base} 파일 상태: ${states.join(', ')}` : base;
  },
};

/** 외부 값이 객체인지 확인한다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 문자열 값만 모은 객체를 만들고 다른 값이 있으면 undefined다. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return undefined;
    result[key] = item;
  }
  return result;
}

/** 후보 목록을 확인해 편집기가 쓰는 값으로 줄인다. */
function parseCandidates(value: unknown): RenameCandidate[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: RenameCandidate[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item) || typeof item['path'] !== 'string') return undefined;
    result.push({
      path: item['path'],
      ...(typeof item['name'] === 'string' ? { name: item['name'] } : {}),
    });
  }
  return result;
}

/** 이름 바꾸기를 시작할 수 있는 위치의 범위와 현재 이름이다. */
export interface RenamePreparation {
  /** 문서 이름 변경인지 섹션 이름 변경인지 나타낸다. */
  kind: RenameKind;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  placeholder: string;
  targetPath: string;
  /** 섹션 이름 변경일 때 현재 섹션 이름이다. */
  section?: string;
}

/** 위치 하나가 유효한 편집기 좌표인지 확인한다. */
function isPosition(
  value: unknown,
): value is { line: number; character: number } {
  return (
    isRecord(value) &&
    typeof value['line'] === 'number' &&
    typeof value['character'] === 'number'
  );
}

/**
 * 이름 바꾸기 시작 위치 확인 요청의 서버 응답을 확인한다.
 * @param value 서버가 돌려준 값이다.
 * @returns 시작할 수 없는 위치이거나 형식이 맞지 않으면 undefined다.
 */
export function parsePrepareRenameResponse(
  value: unknown,
): RenamePreparation | undefined {
  if (!isRecord(value) || !isRecord(value['range'])) return undefined;
  const { start, end } = value['range'];
  if (
    !isPosition(start) ||
    !isPosition(end) ||
    typeof value['placeholder'] !== 'string' ||
    typeof value['targetPath'] !== 'string'
  )
    return undefined;
  const kind = value['kind'] === 'section' ? 'section' : 'document';
  if (kind === 'section' && typeof value['section'] !== 'string')
    return undefined;
  return {
    kind,
    ...(kind === 'section' ? { section: value['section'] as string } : {}),
    range: {
      start: { line: start.line, character: start.character },
      end: { line: end.line, character: end.character },
    },
    placeholder: value['placeholder'],
    targetPath: value['targetPath'],
  };
}

/** 영향 목록을 확인해 편집기가 쓰는 값으로 줄인다. */
function parseImpacts(value: unknown): RenameImpact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: RenameImpact[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item) || !isRecord(item['before'])) return undefined;
    const candidates = parseCandidates(item['before']['candidates']);
    if (
      typeof item['path'] !== 'string' ||
      typeof item['occurrenceIndex'] !== 'number' ||
      typeof item['text'] !== 'string' ||
      typeof item['reason'] !== 'string' ||
      typeof item['before']['status'] !== 'string' ||
      !candidates
    )
      return undefined;
    result.push({
      path: item['path'],
      occurrenceIndex: item['occurrenceIndex'],
      text: item['text'],
      reason: item['reason'],
      before: { status: item['before']['status'], candidates },
    });
  }
  return result;
}

/** 서버 오류의 코드와 문구를 확인해 줄인다. */
function parseError(value: unknown): { code?: string; message?: string } {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value['code'] === 'string' ? { code: value['code'] } : {}),
    ...(typeof value['message'] === 'string'
      ? { message: value['message'] }
      : {}),
  };
}

/**
 * 미리보기 요청의 서버 응답을 확인한다.
 * @param value 서버가 돌려준 값이다.
 * @returns 형식이 맞는 미리보기이거나 사용자에게 알릴 실패 문구다.
 */
export function parsePlanResponse(
  value: unknown,
): { preview: RenamePreview } | { failure: string } {
  if (!isRecord(value)) return { failure: '서버 응답을 확인할 수 없습니다.' };
  if (value['success'] !== true)
    return { failure: parseError(value['error']).message ?? '알 수 없는 오류' };
  const impacts = parseImpacts(value['impacts']);
  const revisions = stringRecord(value['revisions']);
  const fileUris = stringRecord(value['fileUris']);
  if (
    typeof value['status'] !== 'string' ||
    typeof value['newName'] !== 'string' ||
    !Array.isArray(value['changes']) ||
    !impacts ||
    !revisions ||
    !fileUris
  )
    return { failure: '서버 응답을 확인할 수 없습니다.' };
  return {
    preview: {
      status: value['status'],
      ...(typeof value['blockingReason'] === 'string'
        ? { blockingReason: value['blockingReason'] }
        : {}),
      ...(typeof value['oldName'] === 'string'
        ? { oldName: value['oldName'] }
        : {}),
      newName: value['newName'],
      ...(typeof value['targetSection'] === 'string'
        ? { targetSection: value['targetSection'] }
        : {}),
      changeCount: (value['changes'] as unknown[]).length,
      impacts,
      revisions,
      fileUris,
    },
  };
}

/** 파일별 반영 결과 하나를 확인하며 형식이 맞지 않으면 건너뛴다. */
function parseFileResult(file: unknown): { path: string; state: string }[] {
  return isRecord(file) &&
    typeof file['path'] === 'string' &&
    typeof file['state'] === 'string'
    ? [{ path: file['path'], state: file['state'] }]
    : [];
}

/**
 * 반영 요청의 서버 응답을 확인한다.
 * @param value 서버가 돌려준 값이다.
 * @returns 형식이 맞지 않으면 실패한 결과로 취급한다.
 */
export function parseApplyResponse(value: unknown): RenameApplyResult {
  if (!isRecord(value))
    return { success: false, files: [], impactCount: 0, error: {} };
  const files = Array.isArray(value['files'])
    ? (value['files'] as unknown[]).flatMap(parseFileResult)
    : [];
  return {
    success: value['success'] === true,
    files,
    impactCount: Array.isArray(value['impacts'])
      ? (value['impacts'] as unknown[]).length
      : 0,
    error: parseError(value['error']),
  };
}

/**
 * 사용자가 대상을 골라야 하는 영향인지 확인한다.
 * 후보가 여러 개였던 참조는 이름 변경 뒤에도 모호하면 selection_required, 다른 후보로 확정되면 changed_resolution으로 보고되며 둘 다 대상을 고르게 한다.
 */
function isChoice(impact: RenameImpact): boolean {
  return (
    (impact.reason === renameChoiceReasons.selectionRequired ||
      impact.reason === renameChoiceReasons.changedResolution) &&
    impact.before.status === renameAmbiguousStatus
  );
}

/** 영향 하나를 식별하는 키다. */
function impactKey(impact: RenameImpact): string {
  return `${impact.reason}\0${impact.path}\0${impact.occurrenceIndex}`;
}

/** 후보 문서를 목록 항목으로 바꾼다. 경로는 구분자를 통일해 보여준다. */
function candidateChoice(candidate: RenameCandidate): RenameChoice {
  return {
    id: candidate.path,
    label: candidate.name ?? candidate.path,
    detail: candidate.path.replaceAll('\\', '/'),
  };
}

/** 선택을 같은 참조의 이전 선택을 대체하며 추가한다. */
function withSelection(
  selections: readonly RenameSelection[],
  next: RenameSelection,
): RenameSelection[] {
  return [
    ...selections.filter(
      (item) =>
        item.sourcePath !== next.sourcePath ||
        item.occurrenceIndex !== next.occurrenceIndex,
    ),
    next,
  ];
}

/** 영향받는 파일 중 저장하지 않은 수정이 있는 파일이 있으면 중단한다. */
function ensureClean(
  host: RenameHost,
  preview: RenamePreview,
  kind: RenameKind,
): void {
  const byUri = new Map(
    Object.entries(preview.fileUris).map(([path, uri]) => [uri, path]),
  );
  const dirty = host.findDirtyFiles([...byUri.keys()]);
  if (dirty.length)
    throw new RenameAborted(
      renameAbortReasons.dirtyFiles,
      renameMessages.dirtyFiles(
        dirty.map((uri) => (byUri.get(uri) ?? uri).replaceAll('\\', '/')),
        kind,
      ),
    );
}

/** 파일을 바꾸지 않고 계산한 뒤 진행할 수 없거나 저장하지 않은 파일이 있으면 중단한다. */
async function plan(
  host: RenameHost,
  selections: readonly RenameSelection[],
  kind: RenameKind,
): Promise<RenamePreview> {
  const parsed = parsePlanResponse(await host.planRename(selections));
  if ('failure' in parsed)
    throw new RenameAborted(
      renameAbortReasons.planFailed,
      renameMessages.planFailed(parsed.failure),
    );
  const { preview } = parsed;
  if (preview.status === 'blocked')
    throw new RenameAborted(
      renameAbortReasons.blocked,
      renameMessages.blocked(preview.blockingReason, kind),
    );
  ensureClean(host, preview, kind);
  return preview;
}

/** 영향 하나에 대해 사용자가 고른 선택을 반환하며 닫았으면 undefined다. 같은 이름의 후보는 경로로 구분한다. */
async function choose(
  host: RenameHost,
  impact: RenameImpact,
  kind: RenameKind,
): Promise<RenameSelection | undefined> {
  const picked = await host.choose({
    title: renameMessages.chooseTitle(
      impact.path.replaceAll('\\', '/'),
      impact.text,
      kind,
    ),
    placeHolder: renameMessages.choosePlaceHolder,
    choices: impact.before.candidates.map(candidateChoice),
  });
  return picked === undefined
    ? undefined
    : {
        sourcePath: impact.path,
        occurrenceIndex: impact.occurrenceIndex,
        targetPath: picked,
      };
}

/**
 * 이름 변경을 미리보기, 모호 참조 선택, 반영, 결과 알림 순서로 진행한다.
 * 파일을 바꾸기 전에 진행할 수 없으면 RenameAborted로 중단하며 파일을 바꾸지 않는다.
 * @param host 서버 요청·저장하지 않은 파일 확인·선택 목록·알림을 제공하는 경계다.
 * @param kind 문서 이름 변경인지 섹션 이름 변경인지이며 안내 문구만 달라진다.
 */
export async function renameDocument(
  host: RenameHost,
  kind: RenameKind = 'document',
): Promise<void> {
  let selections: readonly RenameSelection[] = [];
  const asked = new Set<string>();
  let preview = await plan(host, selections, kind);
  while (true) {
    const pending = preview.impacts.filter(
      (impact) => isChoice(impact) && !asked.has(impactKey(impact)),
    );
    if (!pending.length) break;
    const before = selections;
    for (const impact of pending) {
      asked.add(impactKey(impact));
      const picked = await choose(host, impact, kind);
      if (picked) selections = withSelection(selections, picked);
      if (host.isCancelled())
        throw new RenameAborted(
          renameAbortReasons.cancelled,
          renameMessages.noChange,
        );
    }
    if (selections === before) break;
    preview = await plan(host, selections, kind);
  }
  if (preview.changeCount === 0 && preview.impacts.length === 0) {
    host.notify('information', renameMessages.noChange);
    return;
  }
  if (host.isCancelled())
    throw new RenameAborted(
      renameAbortReasons.cancelled,
      renameMessages.noChange,
    );
  ensureClean(host, preview, kind);
  const result = parseApplyResponse(
    await host.applyRename(selections, preview.revisions),
  );
  if (!result.success) {
    host.notify(
      'error',
      renameMessages.applyFailed(result.error, result.files),
    );
    return;
  }
  const changed = result.files.filter(
    (file) => file.state === renameFileStates.changed,
  ).length;
  const applied = renameMessages.applied(
    preview.oldName,
    preview.newName,
    changed,
    kind,
  );
  if (result.impactCount > 0)
    host.notify(
      'warning',
      `${applied} ${renameMessages.leftUnchanged(result.impactCount)}`,
    );
  else host.notify('information', applied);
}
