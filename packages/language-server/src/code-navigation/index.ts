import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  scanStatuses,
  codeReferenceDestinationKinds,
  codeReferenceStatuses,
  extractCodeReferences,
} from '@codocs/core';
import { codeCollectionStatuses } from '@codocs/workspace';
import type {
  WorkspaceQuerySession,
  WorkspaceCodeReferenceOccurrence,
  WorkspaceCodeReferenceQuery,
} from '@codocs/workspace';
import type {
  Diagnostic,
  DocumentLink,
  InlayHint,
  Hover,
  Range,
} from 'vscode-languageserver/node.js';
import { escapeMarkdown } from '../hover/index.js';
import {
  isSourceSelection,
  selectionTarget,
  type SourceSelection,
} from '../navigation/index.js';
import { codeReferenceMessages } from './domain-values.js';

/** 명시적 참조 표현에 사용하는 공개 workspace 경계다. */
export type CodeSession = Pick<
  WorkspaceQuerySession,
  | 'setCodeReferenceOwner'
  | 'updateCodeBuffer'
  | 'codeReferenceSnapshot'
  | 'codeReferencesForRows'
  | 'codeReferencesForDocument'
  | 'captureCodeReference'
  | 'confirmCodeReference'
  | 'releaseCodeReference'
  | 'closeCodeBuffer'
  | 'getByPaths'
>;
/** 요청의 실제 열린 출처와 소유 서버를 함께 고정한다. */
export interface CodeOwner {
  uri: string;
  path: string;
  rootPath: string;
  version: number;
  text: string;
  session: CodeSession;
}
/** 최신 확인 뒤 클라이언트가 실제 buffer에 적용할 목적지다. */
export interface ConfirmedCodeSource {
  uri: string;
  destination:
    | { kind: 'top' }
    | { kind: 'rows'; startLine: number; endLine: number }
    | { kind: 'occurrence'; range: Range; markerText: string };
}
interface Selected {
  owner: CodeOwner;
  token: string;
  reverse: boolean;
  key: string;
}

/** source-owned 토큰으로 명시 링크·역참조·힌트를 표현한다. @codocs [[IDE 지원]]#L16-L54 */
export class CodeNavigation {
  readonly #selected = new Map<string, Selected>();
  readonly #ready = new Map<
    string,
    { owner: CodeOwner; promise: Promise<void> }
  >();
  /** 최신 열린 원문을 한 번만 동기화하고 같은 버전의 요청은 공유한다. @codocs [[문서 동기화]]#L37 @codocs [[문서 동기화]]#L61 */
  prepare(owner: CodeOwner): Promise<void> {
    const previous = this.#ready.get(owner.uri);
    if (previous && sameOwner(previous.owner, owner)) return previous.promise;
    const promise = (previous?.promise ?? Promise.resolve()).then(
      /** 최신 출처 버전과 적격 열린 원문을 같은 API 관측에 등록한다. */ async () => {
        await owner.session.setCodeReferenceOwner(owner.path, owner.version);
        const accepted = await owner.session.updateCodeBuffer({
          sourcePath: owner.path,
          text: owner.text,
          documentVersion: owner.version,
        });
        // 제외에서 재포함으로 바뀌면 같은 buffer 버전도 다시 등록한다.
        if (!accepted && this.#ready.get(owner.uri)?.promise === promise)
          this.#ready.delete(owner.uri);
      },
    );
    this.#ready.set(owner.uri, { owner, promise });
    return promise;
  }
  /** 편집·닫기에서 표시 토큰을 즉시 폐기한다. */
  release(uri?: string): void {
    for (const [key, item] of this.#selected)
      if (uri === undefined || item.owner.uri === uri) {
        item.owner.session.releaseCodeReference(item.token);
        this.#selected.delete(key);
      }
    if (uri === undefined) this.#ready.clear();
  }
  /** 닫힌 출처의 원문 동기화 캐시도 제거한다. */
  forget(uri: string): void {
    this.release(uri);
    const previous = this.#ready.get(uri);
    this.#ready.delete(uri);
    if (previous)
      void previous.promise
        .then(
          /** 닫기 전 동기화가 끝난 뒤 재개방되지 않은 overlay만 해제한다. */ async () => {
            if (!this.#ready.has(uri))
              await previous.owner.session.closeCodeBuffer(previous.owner.path);
          },
        )
        .catch((error: unknown) =>
          console.error('Code source close failed', error),
        );
  }
  /** 현재 서버가 발급한 코드 선택만 resolve한다. */
  has(input: unknown): boolean {
    return (
      isSourceSelection(input) &&
      this.#selected.get(input.token)?.owner.uri === input.sourceUri
    );
  }
  /** 공개 코드 토큰은 외부에 노출하지 않고 서버 토큰 안에 보관한다. */
  async target(
    owner: CodeOwner,
    item: WorkspaceCodeReferenceOccurrence,
    reverse = false,
    generation = '',
  ): Promise<string | undefined> {
    const identity = JSON.stringify([
      owner.uri,
      owner.version,
      item.occurrenceId,
      item.sourceRevision,
      reverse,
      generation,
    ]);
    for (const [key, selected] of this.#selected)
      if (selected.key === identity && selected.owner.session === owner.session)
        return selectionTarget({ sourceUri: owner.uri, token: key });
    const token = await owner.session.captureCodeReference({
      occurrenceId: item.occurrenceId,
      ownerPath: owner.path,
      ownerVersion: owner.version,
    });
    if (!token) return undefined;
    const key = randomBytes(24).toString('base64url');
    this.#selected.set(key, { owner, token, reverse, key: identity });
    return selectionTarget({ sourceUri: owner.uri, token: key });
  }
  /** 클릭 전후 현재 출처 버전·서버와 양쪽 파일 정체를 재확인한다. @codocs [[IDE 지원]]#L94-L96 */
  async confirm(
    input: unknown,
    current: (owner: CodeOwner) => boolean,
  ): Promise<ConfirmedCodeSource | null> {
    if (!isSourceSelection(input)) return null;
    const selected = this.#selected.get(input.token);
    if (
      !selected ||
      selected.owner.uri !== input.sourceUri ||
      !current(selected.owner)
    )
      return null;
    const item = await selected.owner.session.confirmCodeReference(
      selected.token,
      {
        sourcePath: selected.owner.path,
        documentVersion: selected.owner.version,
      },
    );
    if (
      !item ||
      this.#selected.get(input.token) !== selected ||
      !current(selected.owner)
    )
      return null;
    if (selected.reverse)
      return {
        uri: item.sourceUri,
        destination: {
          kind: 'occurrence',
          range: item.marker.range,
          markerText: item.marker.text,
        },
      };
    if (!item.target || !item.destination) return null;
    return {
      uri: pathToFileURL(
        path.resolve(selected.owner.rootPath, item.target.path),
      ).href,
      destination:
        item.destination.kind === codeReferenceDestinationKinds.rows
          ? { ...item.destination }
          : { kind: 'top' },
    };
  }
  /** 유효·무효 전체 span을 ID Hover보다 먼저 확인한다. @codocs [[코드 호버]]#L8 */
  markerAt(owner: CodeOwner, offset: number): boolean {
    return extractCodeReferences(owner.text).some(
      (item) =>
        item.offsetRange.start <= offset && offset < item.offsetRange.end,
    );
  }
  /** 무효 명시 표기에는 ID 설명 대신 구별 가능한 오류 이유만 제공한다. @codocs [[IDE 지원]]#L19-L22 */
  async markerHover(owner: CodeOwner, offset: number): Promise<Hover | null> {
    await this.prepare(owner);
    const snapshot = await owner.session.codeReferenceSnapshot();
    const item = snapshot.occurrences.find(
      (value) =>
        value.sourcePath === owner.path &&
        value.marker.offsetRange.start <= offset &&
        offset < value.marker.offsetRange.end,
    );
    if (!item || item.status === codeReferenceStatuses.resolved) return null;
    return {
      contents: {
        kind: 'markdown',
        value: escapeMarkdown(codeReferenceMessages[item.status]),
      },
      range: item.marker.range,
    };
  }
  /** 적격 source의 확인한 출현만 직접 링크로 만든다. @codocs [[IDE 지원]]#L100-L101 */
  async forward(
    owner: CodeOwner,
  ): Promise<{ links: DocumentLink[]; diagnostics: Diagnostic[] }> {
    await this.prepare(owner);
    const snapshot = await owner.session.codeReferenceSnapshot();
    const links: DocumentLink[] = [];
    const diagnostics: Diagnostic[] = [];
    for (const item of snapshot.occurrences.filter(
      (item) => item.sourcePath === owner.path,
    )) {
      if (item.status === codeReferenceStatuses.resolved) {
        const target = await this.target(
          owner,
          item,
          false,
          `${snapshot.codeGeneration}/${snapshot.documentGeneration}`,
        );
        if (target) links.push({ range: item.marker.range, target });
      } else
        diagnostics.push({
          range: item.marker.range,
          severity: 2,
          source: 'codocs',
          code: `codocs.codeReference.${item.status}`,
          message: codeReferenceMessages[item.status],
        });
    }
    return { links, diagnostics };
  }
  /** 같은 행의 모든 겹친 구간을 합집합으로 조회한다. */
  async reverseHover(owner: CodeOwner, line: number): Promise<string> {
    await this.prepare(owner);
    const query = await owner.session.codeReferencesForRows(
      owner.path,
      line + 1,
    );
    return this.render(owner, query);
  }
  /** 완료 단일 구간만 직접 연결하며 문서 이름 링크와 겹친 구간은 양보한다. @codocs [[IDE 지원]]#L29-L36 */
  async reverseLinks(
    owner: CodeOwner,
    yamlLinks: readonly DocumentLink[],
  ): Promise<DocumentLink[]> {
    await this.prepare(owner);
    const snapshot = await owner.session.codeReferenceSnapshot();
    const rows = owner.text.split(/\r\n|\r|\n/u);
    const boundaries = new Set<number>();
    for (const item of snapshot.occurrences)
      if (
        item.target?.path.split(path.sep).join('/') === owner.path &&
        item.destination?.kind === codeReferenceDestinationKinds.rows
      ) {
        boundaries.add(item.destination.startLine);
        boundaries.add(item.destination.endLine + 1);
      }
    const sorted = [...boundaries].sort((a, b) => a - b);
    const links: DocumentLink[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const first = sorted[i]!,
        last = sorted[i + 1]! - 1;
      if (first < 1 || last > rows.length) continue;
      const query = await owner.session.codeReferencesForRows(
        owner.path,
        first,
        last,
      );
      if (!query.unique || query.occurrences.length !== 1) continue;
      for (let line = first - 1; line < last; line++) {
        const length = rows[line]!.length;
        const blocked = yamlLinks
          .filter(
            (link) =>
              link.range.start.line <= line && line <= link.range.end.line,
          )
          .map(
            /** 실제 관측을 요청에 연결하고 실패를 호출자에게 전달한다. */ (
              link,
            ) => ({
              start:
                link.range.start.line === line ? link.range.start.character : 0,
              end:
                link.range.end.line === line
                  ? link.range.end.character
                  : length,
            }),
          )
          .sort((left, right) => left.start - right.start);
        let start = 0;
        const segments: { start: number; end: number }[] = [];
        for (const block of blocked) {
          if (start < block.start) segments.push({ start, end: block.start });
          start = Math.max(start, block.end);
        }
        if (start < length) segments.push({ start, end: length });
        const target = await this.target(
          owner,
          query.occurrences[0]!,
          true,
          `${query.codeGeneration}/${query.documentGeneration}`,
        );
        if (target)
          for (const segment of segments)
            links.push({
              range: {
                start: { line, character: segment.start },
                end: { line, character: segment.end },
              },
              target,
            });
      }
    }
    return links;
  }
  /** 문서 전체 출현만 실제 첫 행 앞에 표시한다. @codocs [[IDE 지원]]#L40-L45 */
  async hints(owner: CodeOwner): Promise<InlayHint[]> {
    await this.prepare(owner);
    const query = await owner.session.codeReferencesForDocument(owner.path);
    if (query.absent) return [];
    const count = query.occurrences.length;
    const documentComplete = await this.documentComplete(owner, query);
    const value = !documentComplete
      ? `확인된 코드 ${count}곳 · 문서 탐색 미확인`
      : query.status === codeCollectionStatuses.complete
        ? `문서 전체에 연결된 코드 · ${count}곳`
        : `확인된 코드 ${count}곳 · ${query.status === codeCollectionStatuses.collecting ? '수집 중' : '수집 불완전'}`;
    const target =
      query.unique && query.occurrences.length === 1
        ? await this.target(
            owner,
            query.occurrences[0]!,
            true,
            `${query.codeGeneration}/${query.documentGeneration}`,
          )
        : undefined;
    let command:
      | { title: string; command: string; arguments: SourceSelection[] }
      | undefined;
    if (target)
      command = {
        title: '코드 참조 열기',
        command: 'codocs.openSource',
        arguments: JSON.parse(
          decodeURIComponent(target.slice(target.indexOf('?') + 1)),
        ) as SourceSelection[],
      };
    return [
      {
        position: { line: 0, character: 0 },
        label: [{ value, ...(command ? { command } : {}) }],
        tooltip: { kind: 'markdown', value: await this.render(owner, query) },
        paddingRight: true,
      },
    ];
  }
  /** 코드 수집과 별개인 저장 문서 탐색 완료 여부를 같은 세대로 확인한다. */
  async documentComplete(
    owner: CodeOwner,
    query: WorkspaceCodeReferenceQuery,
  ): Promise<boolean> {
    const result = await owner.session.getByPaths(
      [owner.path],
      query.documentGeneration,
    );
    return result.success && result.scanStatus === scanStatuses.complete;
  }
  /** 개별 위치와 수집 상태를 Markdown에 안전하게 표시한다. @codocs [[IDE 지원]]#L51-L54 */
  async render(
    owner: CodeOwner,
    query: WorkspaceCodeReferenceQuery,
  ): Promise<string> {
    const documentComplete = await this.documentComplete(owner, query);
    const lines: string[] =
      query.occurrences.length &&
      documentComplete &&
      query.status === codeCollectionStatuses.complete
        ? [`연결된 코드 · ${query.occurrences.length}곳`]
        : [];
    for (const item of query.occurrences) {
      const label = escapeMarkdown(
        `${item.sourcePath}:${item.marker.range.start.line + 1}:${item.marker.range.start.character + 1}`,
      );
      const target = await this.target(
        owner,
        item,
        true,
        `${query.codeGeneration}/${query.documentGeneration}`,
      );
      lines.push(target ? `- [${label}](${target})` : `- ${label}`);
    }
    if (query.status !== codeCollectionStatuses.complete)
      lines.push(
        `확인된 코드 ${query.occurrences.length}곳 · ${query.status === codeCollectionStatuses.collecting ? '수집 중' : '수집 불완전'}`,
        ...query.failures.map((item) => escapeMarkdown(item.message)),
      );
    if (!documentComplete)
      lines.push('저장 문서 탐색을 완전히 확인하지 못했습니다.');
    return lines.join('\n');
  }
}
/** 같은 출처·원문·버전·공개 세션의 준비만 공유한다. */
function sameOwner(left: CodeOwner, right: CodeOwner): boolean {
  return (
    left.uri === right.uri &&
    left.path === right.path &&
    left.version === right.version &&
    left.text === right.text &&
    left.session === right.session
  );
}
