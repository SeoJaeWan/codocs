import {
  compareEvidencePriority,
  diagnosticSeverities,
  matcherEvidenceKinds,
  scanStatuses,
  schemaDiagnosticCodes,
  schemaDiagnosticMessages,
  type CodeMatchCandidate,
  type CodeMatchEvidence,
  type Diagnostic,
  type OffsetRange,
} from '@codocs/core';
import {
  workspaceDiagnosticCodes,
  type WorkspacePathDocumentResult,
  type WorkspacePathGetSuccess,
  type WorkspacePathGetLink,
  type WorkspaceQueryDiagnostic,
  type WorkspaceReadiness,
} from '@codocs/workspace';
import {
  MarkupKind,
  type Hover,
  type Position,
  type Range,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { utf16OffsetsToRange } from '../document-sync/index.js';

/** VS Code 호스트가 등록하는 원문 열기 명령이다. */
export const openSourceCommand = 'codocs.openSource';

/** 원문 열기 명령에 전달하는 검증된 한 관측의 인자다. */
export interface OpenSourceCommandArgument {
  uri: string;
  range?: Range;
  catalogVersion: number;
  revision?: string;
}

/** 코어 offset과 LSP 좌표를 함께 가진 Hover 매칭 근거다. */
export type HoverMatchEvidence = Omit<CodeMatchEvidence, 'range'> & {
  offsetRange: OffsetRange;
  range: Range;
};

/** Hover 계산에 필요한 문서 후보의 최소 공개 형태다. */
export type HoverMatchCandidate = Omit<CodeMatchCandidate, 'evidence'> & {
  evidence: readonly HoverMatchEvidence[];
};

/** 같은 코드·catalog 관측에서 Hover가 소비하는 매칭 결과다. */
export interface HoverMatchSnapshot {
  catalogVersion: number;
  candidates: readonly HoverMatchCandidate[];
  partial: boolean;
  workspaceState: WorkspaceReadiness;
}

/** 커서에서 최상위가 된 후보와 그 비교 근거다. */
export interface HoverSelectedCandidate {
  candidate: HoverMatchCandidate;
  evidence: HoverMatchEvidence;
}

/** 커서 내용이 동일한 범위와 같은 식별자 묶음의 후보다. */
export interface HoverSelection {
  range: Range;
  top: readonly HoverSelectedCandidate[];
  groupedCandidates: readonly HoverMatchCandidate[];
}

const partialMessage = '일부 문서를 읽지 못해 후보가 누락될 수 있습니다.';
const preparingMessage = 'Codocs 문서 색인을 준비하고 있습니다.';
const failedMessage = 'Codocs Hover를 불러오지 못했습니다.';
const previousIdMessage = '이전 ID입니다.';
const unknownCurrentIdMessage = '현재 ID를 확인할 수 없습니다.';

/** 커서가 속한 연속 ASCII 식별자 묶음의 UTF-16 범위를 계산한다. */
function identifierGroupRange(
  text: string,
  offset: number,
): OffsetRange | null {
  if (
    offset < 0 ||
    offset >= text.length ||
    !isIdentifierCharacter(text[offset])
  )
    return null;
  let start = offset;
  let end = offset + 1;
  while (start > 0 && isIdentifierCharacter(text[start - 1])) start -= 1;
  while (end < text.length && isIdentifierCharacter(text[end])) end += 1;
  return { start, end };
}

/** 코어가 하나의 연속 토큰 묶음으로 처리할 수 있는 ASCII 문자인지 판별한다. */
function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z0-9_-]$/u.test(value);
}

/** 근거가 지정한 식별자 묶음 안에 완전히 포함되는지 확인한다. */
function evidenceInGroup(
  evidence: HoverMatchEvidence,
  group: OffsetRange,
): boolean {
  return (
    evidence.offsetRange.start >= group.start &&
    evidence.offsetRange.end <= group.end
  );
}

/** 커서가 시작 포함·끝 제외 근거 범위 안에 있는지 확인한다. */
function evidenceAtOffset(
  evidence: HoverMatchEvidence,
  offset: number,
): boolean {
  return (
    evidence.offsetRange.start <= offset && offset < evidence.offsetRange.end
  );
}

/** 의미 우선순위가 같은 근거의 표시 순서를 원문과 값으로 고정한다. */
function compareEvidence(
  left: HoverMatchEvidence,
  right: HoverMatchEvidence,
): number {
  return (
    compareHoverEvidencePriority(left, right) ||
    left.offsetRange.start - right.offsetRange.start ||
    left.offsetRange.end - right.offsetRange.end ||
    left.sourceId.localeCompare(right.sourceId, 'en') ||
    (left.message ?? '').localeCompare(right.message ?? '', 'en')
  );
}

/** LSP 좌표와 분리해 보존한 코어 offset 근거만 의미 우선순위에 사용한다. */
function compareHoverEvidencePriority(
  left: HoverMatchEvidence,
  right: HoverMatchEvidence,
): number {
  return compareEvidencePriority(
    { ...left, range: left.offsetRange },
    { ...right, range: right.offsetRange },
  );
}

/** 후보 표시 순서를 ID와 발견 경로로 결정한다. */
function compareCandidates(
  left: HoverMatchCandidate,
  right: HoverMatchCandidate,
): number {
  return (
    (left.id ?? '').localeCompare(right.id ?? '', 'en') ||
    left.path.localeCompare(right.path, 'en')
  );
}

/** 현재 커서에서 내용 구성이 바뀌지 않는 가장 좁은 반개방 범위를 구한다. */
function stableHoverRange(
  group: OffsetRange,
  evidence: readonly HoverMatchEvidence[],
  offset: number,
): OffsetRange {
  const boundaries = new Set<number>([group.start, group.end]);
  for (const item of evidence) {
    boundaries.add(item.offsetRange.start);
    boundaries.add(item.offsetRange.end);
  }
  const sorted = [...boundaries].sort((left, right) => left - right);
  const start = sorted.filter((boundary) => boundary <= offset).at(-1);
  const end = sorted.find((boundary) => boundary > offset);
  return { start: start ?? group.start, end: end ?? group.end };
}

/** 최신 열린 문서의 커서에 걸리는 최상위 동률과 같은 식별자 후보를 선택한다. @codocs [[코드 호버]]#L12-L19 */
export function selectHover(
  document: TextDocument,
  match: HoverMatchSnapshot,
  position: Position,
): HoverSelection | null {
  const offset = document.offsetAt(position);
  const group = identifierGroupRange(document.getText(), offset);
  if (!group) return null;
  const groupedCandidates = match.candidates
    .flatMap(
      /** 현재 식별자 묶음의 근거만 후보에 남긴다. */ (candidate) => {
        const evidence = candidate.evidence.filter(
          /** 같은 후보·범위의 이전 근거만 현재 근거로 대체한다. */ (item) =>
            evidenceInGroup(item, group) &&
            !candidate.evidence.some(
              /** 원래 후보의 같은 위치에서 현재 근거를 찾는다. */ (current) =>
                item.kind === matcherEvidenceKinds.previous &&
                current.kind === matcherEvidenceKinds.current &&
                current.offsetRange.start === item.offsetRange.start &&
                current.offsetRange.end === item.offsetRange.end,
            ),
        );
        return evidence.length ? [{ ...candidate, evidence }] : [];
      },
    )
    .sort(compareCandidates);
  const selected = groupedCandidates.flatMap(
    /** 후보마다 커서에 걸리는 최상위 근거 하나를 선택한다. */ (candidate) => {
      const evidence = candidate.evidence
        .filter((item) => evidenceAtOffset(item, offset))
        .sort(compareEvidence)[0];
      return evidence ? [{ candidate, evidence }] : [];
    },
  );
  const best = selected.map((item) => item.evidence).sort(compareEvidence)[0];
  if (!best) return null;
  const top = selected
    .filter((item) => compareHoverEvidencePriority(item.evidence, best) === 0)
    .sort((left, right) => compareCandidates(left.candidate, right.candidate));
  const groupedEvidence = groupedCandidates.flatMap((candidate) =>
    candidate.evidence.filter((evidence) => evidenceInGroup(evidence, group)),
  );
  return {
    range: utf16OffsetsToRange(
      document,
      stableHoverRange(group, groupedEvidence, offset),
    ),
    top,
    groupedCandidates,
  };
}

/** 선택된 후보를 자세히 표시하는 데 필요한 경로를 중복 없이 반환한다. */
export function hoverCandidatePaths(
  selection: HoverSelection,
): readonly string[] {
  return [
    ...new Set(selection.groupedCandidates.map((candidate) => candidate.path)),
  ];
}

/** 첫 경로 조회에서 확인한 직접·역참조와 충돌 경로를 다음 조회에 포함한다. */
export function hoverDetailPaths(
  candidatePaths: readonly string[],
  details: WorkspacePathGetSuccess,
): readonly string[] {
  const paths = new Set(candidatePaths);
  for (const result of details.results) {
    if (!result.found) continue;
    for (const path of result.conflictPaths ?? []) paths.add(path);
    for (const link of result.references ?? []) paths.add(link.path);
    for (const link of result.referencedBy ?? []) paths.add(link.path);
  }
  return [...paths];
}

/** Markdown의 사용자 제공 텍스트가 링크·명령·서식을 만들지 못하게 이스케이프한다. @codocs [[코드 호버]]#L45 */
export function escapeMarkdown(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(/([`*_{}\[\]()#+.!<>|-])/gu, '\\$1');
}

/** JSON 문서의 own 문자열 필드를 유효한 표시 값으로 좁힌다. */
function documentString(
  result: WorkspacePathDocumentResult,
  key: string,
): string | undefined {
  if (!result.document) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(result.document, key);
  if (!descriptor || !('value' in descriptor)) return undefined;
  return typeof descriptor.value === 'string' && descriptor.value.trim().length
    ? descriptor.value
    : undefined;
}

/** 발견 경로의 마지막 요소를 안전한 대체 표시 이름으로 사용한다. */
function pathLabel(documentPath: string): string {
  return documentPath.split(/[\\/]/u).at(-1) ?? documentPath;
}

/** 상세 결과에서 이름·현재 ID·경로 순서로 링크 이름을 선택한다. @codocs [[IDE 지원]]#L82-L86 */
export function detailLabel(
  result: WorkspacePathDocumentResult,
  peers: readonly WorkspacePathDocumentResult[] = [],
): string {
  const name =
    documentString(result, 'name') ??
    result.id ??
    pathLabel(result.source.path);
  if (
    peers.filter(
      (peer) =>
        (documentString(peer, 'name') ??
          peer.id ??
          pathLabel(peer.source.path)) === name,
    ).length < 2
  )
    return name;
  const domains = result.document?.domains;
  const labels = Array.isArray(domains)
    ? domains.filter((value): value is string => typeof value === 'string')
    : [];
  return `${name} — ${[...labels, result.path.replace(/^\.codocs[/\\]/u, '')].join(' · ')}`;
}

/** 프로토콜 명령 인자의 file URI와 선택 범위를 모두 검증한다. */
export function isOpenSourceCommandArgument(
  value: OpenSourceCommandArgument,
): boolean {
  try {
    if (new URL(value.uri).protocol !== 'file:') return false;
  } catch {
    return false;
  }
  if (!Number.isSafeInteger(value.catalogVersion) || value.catalogVersion < 0)
    return false;
  if (value.revision !== undefined && !/^[a-f0-9]{64}$/u.test(value.revision))
    return false;
  if (!value.range) return true;
  const parts = [
    value.range.start.line,
    value.range.start.character,
    value.range.end.line,
    value.range.end.character,
  ];
  if (!parts.every((part) => Number.isSafeInteger(part) && part >= 0))
    return false;
  return (
    value.range.start.line < value.range.end.line ||
    (value.range.start.line === value.range.end.line &&
      value.range.start.character <= value.range.end.character)
  );
}

/** 확인한 원문 위치와 관측 근거만 포함한 VS Code command 링크를 만든다. */
function sourceLink(
  result: WorkspacePathDocumentResult,
  catalogVersion: number,
  label: string,
  relationship?: { path: string; reverse: boolean },
): string | undefined {
  const argument: OpenSourceCommandArgument & {
    relationship?: { path: string; reverse: boolean };
  } = {
    uri: result.source.uri,
    ...(result.source.range ? { range: result.source.range } : {}),
    catalogVersion,
    ...(result.revision ? { revision: result.revision } : {}),
    ...(relationship ? { relationship } : {}),
  };
  if (!isOpenSourceCommandArgument(argument)) return undefined;
  const query = encodeURIComponent(JSON.stringify([argument]));
  return `[${escapeMarkdown(label)}](command:${openSourceCommand}?${query})`;
}

/** 진단 목록을 안정적인 키로 중복 제거한다. */
function uniqueDiagnostics(
  diagnostics: readonly Diagnostic<string>[],
): readonly Diagnostic<string>[] {
  const unique = new Map<string, Diagnostic<string>>();
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.path,
      diagnostic.fieldPath,
      diagnostic.range,
    ]);
    if (!unique.has(key)) unique.set(key, diagnostic);
  }
  return [...unique.values()];
}

/** 오류와 경고를 본문과 분리한 Markdown 문단으로 만든다. */
function diagnosticMarkdown(
  diagnostics: readonly Diagnostic<string>[],
): readonly string[] {
  const unique = uniqueDiagnostics(
    diagnostics.filter(
      /** YAML에 남기는 별칭중복 원인만 코드 표시에서 제외한다. */ (
        diagnostic,
      ) =>
        !(
          diagnostic.code === schemaDiagnosticCodes.invalidFieldValue &&
          diagnostic.message ===
            schemaDiagnosticMessages.deprecatedAliasMatchesCurrentId
        ),
    ),
  );
  const errors = unique.filter(
    (diagnostic) => diagnostic.severity === diagnosticSeverities.error,
  );
  const warnings = unique.filter(
    (diagnostic) => diagnostic.severity !== diagnosticSeverities.error,
  );
  const sections: string[] = [];
  if (errors.length)
    sections.push(
      `**오류**\n\n${errors.map((item) => `- ${escapeMarkdown(item.message)}`).join('\n')}`,
    );
  if (warnings.length)
    sections.push(
      `**진단**\n\n${warnings.map((item) => `- ${escapeMarkdown(item.message)}`).join('\n')}`,
    );
  return sections;
}

/** 경로 링크를 상세 결과의 안전한 command 링크로 바꿔 중복 제거한다. */
function relatedLinks(
  links: readonly WorkspacePathGetLink[] | undefined,
  byPath: ReadonlyMap<string, WorkspacePathDocumentResult>,
  catalogVersion: number,
  relationship: { path: string; reverse: boolean },
): readonly string[] {
  const markdown = new Map<string, string>();
  for (const link of links ?? []) {
    const detail = byPath.get(link.path);
    if (!detail || markdown.has(link.path)) continue;
    const value = sourceLink(
      detail,
      catalogVersion,
      detailLabel(detail, [...byPath.values()]),
      relationship,
    );
    if (value) markdown.set(link.path, value);
  }
  return [...markdown.values()];
}

/** 링크가 있는 관계만 제목과 함께 Markdown으로 만든다. */
function linkSection(
  title: string,
  links: readonly string[],
): string | undefined {
  return links.length
    ? `**${escapeMarkdown(title)}**\n\n${links.map((link) => `- ${link}`).join('\n')}`
    : undefined;
}

/** 이전 ID 근거를 유효한 message 또는 현재 ID 기본 안내로 표현한다. @codocs [[코드 호버]]#L32-L35 */
function previousEvidenceMarkdown(
  evidence: HoverMatchEvidence,
  currentId: string | undefined,
): string | undefined {
  if (evidence.kind !== matcherEvidenceKinds.previous) return undefined;
  return `> ${previousIdMessage} ${
    currentId
      ? `현재 ID: ${escapeMarkdown(currentId)}`
      : unknownCurrentIdMessage
  }${evidence.message ? ` — ${escapeMarkdown(evidence.message)}` : ''}`;
}

/** 후보별 기본 정보·관계·오류를 안전한 Markdown 섹션으로 만든다. @codocs [[코드 호버]]#L12-L35 */
function candidateMarkdown(
  selected: HoverSelectedCandidate,
  detail: WorkspacePathDocumentResult,
  selection: HoverSelection,
  byPath: ReadonlyMap<string, WorkspacePathDocumentResult>,
  catalogVersion: number,
): string {
  const parts: string[] = [];
  parts.push(
    `### ${escapeMarkdown(detailLabel(detail, [...byPath.values()]))}`,
  );
  const definition = documentString(detail, 'definition');
  if (definition) parts.push(escapeMarkdown(definition));
  if (detail.id) parts.push(`**현재 ID:** \`${detail.id}\``);
  const domains = selected.candidate.domains;
  if (domains.length)
    parts.push(`**도메인:** ${domains.map(escapeMarkdown).join(', ')}`);
  const source = sourceLink(detail, catalogVersion, '원문 열기');
  if (source) parts.push(source);
  const previous = previousEvidenceMarkdown(selected.evidence, detail.id);
  if (previous) parts.push(previous);
  const otherPrevious = selected.candidate.evidence
    .filter(
      (evidence) =>
        evidence.kind === matcherEvidenceKinds.previous &&
        (evidence.offsetRange.start !== selected.evidence.offsetRange.start ||
          evidence.offsetRange.end !== selected.evidence.offsetRange.end),
    )
    .flatMap((evidence) => {
      const notice = previousEvidenceMarkdown(evidence, detail.id);
      return notice ? [notice] : [];
    });
  if (otherPrevious.length)
    parts.push(
      '**같은 식별자의 다른 위치:**\n\n' +
        [...new Set(otherPrevious)].join('\n\n'),
    );
  const topPaths = new Set(selection.top.map((item) => item.candidate.path));
  const together = selection.groupedCandidates
    .filter(
      (candidate) =>
        candidate.path !== selected.candidate.path &&
        !topPaths.has(candidate.path),
    )
    .flatMap(
      /** 본문을 표시하지 않는 같은 식별자 후보를 원문 링크로 바꾼다. */ (
        candidate,
      ) => {
        const related = byPath.get(candidate.path);
        if (!related) return [];
        const link = sourceLink(
          related,
          catalogVersion,
          detailLabel(related, [...byPath.values()]),
        );
        if (!link) return [];
        const previousEvidence = candidate.evidence.find(
          (evidence) => evidence.kind === matcherEvidenceKinds.previous,
        );
        return [
          previousEvidence
            ? `${link} \\(${escapeMarkdown(previousIdMessage)}\\)`
            : link,
        ];
      },
    );
  const togetherSection = linkSection('함께 매칭된 용어', [
    ...new Set(together),
  ]);
  if (togetherSection) parts.push(togetherSection);
  const references = linkSection(
    '이 문서가 참조',
    relatedLinks(detail.references, byPath, catalogVersion, {
      path: detail.path,
      reverse: false,
    }),
  );
  if (references) parts.push(references);
  const referencedBy = linkSection(
    '이 문서를 참조',
    relatedLinks(detail.referencedBy, byPath, catalogVersion, {
      path: detail.path,
      reverse: true,
    }),
  );
  if (referencedBy) parts.push(referencedBy);
  parts.push(...diagnosticMarkdown(detail.diagnostics));
  return parts.join('\n\n');
}

/** 중복 현재 ID는 대표 본문 없이 오류와 모든 충돌 원문 링크를 만든다. @codocs [[코드 호버]]#L36 */
function conflictMarkdown(
  details: readonly WorkspacePathDocumentResult[],
  byPath: ReadonlyMap<string, WorkspacePathDocumentResult>,
  catalogVersion: number,
): string {
  const paths = new Set(
    details.flatMap((detail) => detail.conflictPaths ?? []),
  );
  const links = [...paths].flatMap(
    /** 충돌 경로가 확인된 상세에만 원문 링크를 만든다. */ (documentPath) => {
      const detail = byPath.get(documentPath);
      if (!detail) return [];
      const link = sourceLink(
        detail,
        catalogVersion,
        detailLabel(detail, [...byPath.values()]),
      );
      return link ? [link] : [];
    },
  );
  const diagnostics = details.flatMap((detail) => detail.diagnostics);
  return [
    '### ID 충돌',
    linkSection('충돌 문서', [...new Set(links)]),
    ...diagnosticMarkdown(diagnostics),
  ]
    .filter((part): part is string => part !== undefined)
    .join('\n\n');
}

/** 같은 catalog 관측의 경로 상세를 표준 LSP Hover로 표현한다. @codocs [[코드 호버]] */
export function createHover(
  selection: HoverSelection,
  match: HoverMatchSnapshot,
  details: WorkspacePathGetSuccess,
): Hover {
  const found = details.results.filter(
    (result): result is WorkspacePathDocumentResult => result.found,
  );
  const byPath = new Map(found.map((result) => [result.path, result]));
  const topDetails = selection.top.flatMap((selected) => {
    const detail = byPath.get(selected.candidate.path);
    return detail ? [detail] : [];
  });
  const conflictDetails = topDetails.filter(
    (detail) => (detail.conflictPaths?.length ?? 0) > 1,
  );
  const conflictPaths = new Set(conflictDetails.map((detail) => detail.path));
  const sections = selection.top.flatMap(
    /** 충돌하지 않은 최상위 후보만 정상 본문으로 만든다. */ (selected) => {
      const detail = byPath.get(selected.candidate.path);
      return detail && !conflictPaths.has(detail.path)
        ? [
            candidateMarkdown(
              selected,
              detail,
              selection,
              byPath,
              match.catalogVersion,
            ),
          ]
        : [];
    },
  );
  if (conflictDetails.length)
    sections.push(
      conflictMarkdown(conflictDetails, byPath, match.catalogVersion),
    );
  if (conflictDetails.length === selection.top.length) {
    const topPaths = new Set(selection.top.map((item) => item.candidate.path));
    const links = selection.groupedCandidates
      .filter((candidate) => !topPaths.has(candidate.path))
      .flatMap(
        /** 최상위가 모두 충돌해도 정상 보조 링크를 보존한다. */ (
          candidate,
        ) => {
          const detail = byPath.get(candidate.path);
          if (!detail) return [];
          const link = sourceLink(
            detail,
            match.catalogVersion,
            detailLabel(detail, found),
          );
          return link
            ? [
                candidate.evidence.some(
                  (item) => item.kind === matcherEvidenceKinds.previous,
                )
                  ? `${link} ${previousIdMessage}`
                  : link,
              ]
            : [];
        },
      );
    const together = linkSection('함께 매칭된 용어', links);
    if (together) sections.push(together);
  }
  if (match.partial || details.scanStatus !== scanStatuses.complete)
    sections.push(`> ${partialMessage}`);
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: sections.join('\n\n---\n\n'),
    },
    range: selection.range,
  };
}

/** 준비·실패 상태를 매칭 없음과 구분하는 정보 Hover를 만든다. */
export function createStatusHover(
  readiness: WorkspaceReadiness | undefined,
  error?: WorkspaceQueryDiagnostic,
): Hover {
  const preparing =
    error?.code === workspaceDiagnosticCodes.indexNotReady ||
    (readiness !== undefined && !readiness.ready && !error);
  const lines = [preparing ? preparingMessage : failedMessage];
  if (error) lines.push(error.message);
  if (readiness?.cause) lines.push(readiness.cause);
  if (readiness?.guidance) lines.push(readiness.guidance);
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: lines.map(escapeMarkdown).join('\n\n'),
    },
  };
}

/** 완전한 관측에서 매칭이 없으면 null, 부분 관측이면 누락 안내를 반환한다. @codocs [[코드 호버]]#L41 */
export function createEmptyHover(match: HoverMatchSnapshot): Hover | null {
  if (!match.partial) return null;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: `> ${partialMessage}`,
    },
  };
}
