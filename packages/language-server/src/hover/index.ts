import {
  workspaceDiagnosticCodes,
  type WorkspacePathDocumentResult,
  type WorkspaceQueryDiagnostic,
  type WorkspaceReadiness,
} from '@codocs/workspace';
import { MarkupKind, type Hover } from 'vscode-languageserver/node.js';

/** VS Code 호스트가 등록하는 원문 열기 명령이다. */
export const openSourceCommand = 'codocs.openSource';

const partialMessage = '일부 문서를 읽지 못해 후보가 누락될 수 있습니다.';
const preparingMessage = 'Codocs 문서 색인을 준비하고 있습니다.';
const failedMessage = 'Codocs Hover를 불러오지 못했습니다.';

/** Markdown의 사용자 제공 텍스트가 링크·명령·서식을 만들지 못하게 이스케이프한다. */
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

/** 상세 결과에서 이름·현재 ID·경로 순서로 링크 이름을 선택한다. */
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

/** 완전한 관측이면 null, 부분 관측이면 누락 안내를 반환한다. */
export function createEmptyHover(partial: boolean): Hover | null {
  if (!partial) return null;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: `> ${partialMessage}`,
    },
  };
}
