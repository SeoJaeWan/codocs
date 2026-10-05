import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  scanStatuses,
  codeReferenceDestinationKinds,
  codeReferenceStatuses,
  extractCodeReferences,
  getSectionKeyRange,
  getSectionNames,
  parseYaml,
} from '@codocs/core';
import { codeCollectionStatuses, codeFileReasons } from '@codocs/workspace';
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
  Position,
  Range,
} from 'vscode-languageserver/node.js';
import { escapeMarkdown } from '../hover/index.js';
import { nameValueRange, sectionKeyAt } from '../rename/index.js';
import { isSourceSelection, selectionTarget } from '../navigation/index.js';
import {
  codeCollectionMessages,
  codeReferenceMessages,
} from './domain-values.js';

/** 명시적 참조 표현에 사용하는 공개 workspace 경계다. */
export type CodeSession = Pick<
  WorkspaceQuerySession,
  | 'setCodeReferenceOwner'
  | 'updateCodeBuffer'
  | 'codeReferenceSnapshot'
  | 'codeReferencesForSection'
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
    { kind: 'top' } | { kind: 'occurrence'; range: Range; markerText: string };
}
interface Selected {
  owner: CodeOwner;
  token: string;
  reverse: boolean;
  key: string;
}

/** source-owned 토큰으로 명시 링크·역참조·힌트를 표현한다. */
export class CodeNavigation {
  readonly #selected = new Map<string, Selected>();
  readonly #ready = new Map<
    string,
    { owner: CodeOwner; promise: Promise<void> }
  >();
  /** 최신 열린 원문을 한 번만 동기화하고 같은 버전의 요청은 공유한다. */
  async prepare(owner: CodeOwner): Promise<void> {
    const previous = this.#ready.get(owner.uri);
    // 최초 수집 중에는 등록을 뒤에서 이어 가고 요청 경로는 수집을 기다리지 않는다.
    if (previous && sameOwner(previous.owner, owner))
      return (await initialPending(owner)) ? undefined : previous.promise;
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
    if (await initialPending(owner)) {
      promise.catch(
        /** 뒤에서 이어지는 등록 실패는 요청을 막지 않고 기록한다. */ (
          error: unknown,
        ) => console.error('Code buffer registration failed', error),
      );
      return;
    }
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
  /** 클릭 전후 현재 출처 버전·서버와 양쪽 파일 정체를 재확인한다. */
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
        item.destination.kind === codeReferenceDestinationKinds.section
          ? {
              kind: 'occurrence',
              range: item.destination.range,
              markerText: item.destination.markerText,
            }
          : { kind: 'top' },
    };
  }
  /** 유효·무효 전체 span을 ID Hover보다 먼저 확인한다. */
  markerAt(owner: CodeOwner, offset: number): boolean {
    return extractCodeReferences(owner.text).some(
      (item) =>
        item.offsetRange.start <= offset && offset < item.offsetRange.end,
    );
  }
  /** 무효 명시 표기에는 ID 설명 대신 구별 가능한 오류 이유만 제공한다. */
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
  /** 적격 source의 확인한 출현만 직접 링크로 만든다. */
  async forward(
    owner: CodeOwner,
  ): Promise<{ links: DocumentLink[]; diagnostics: Diagnostic[] }> {
    await this.prepare(owner);
    const snapshot = await owner.session.codeReferenceSnapshot();
    if (snapshot.hasCompletedCollection === false)
      return { links: [], diagnostics: [] };
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
  /**
   * 커서가 문서 name 값 위이면 문서 전체 참조 목록, 섹션 키 위이면 그 섹션 참조 목록을 만든다.
   * 두 위치가 아니면 빈 문자열이다.
   */
  async reverseHover(owner: CodeOwner, offset: number): Promise<string> {
    await this.prepare(owner);
    const name = nameValueRange(owner.text);
    if (name && name.range.start <= offset && offset <= name.range.end)
      return this.render(
        owner,
        await owner.session.codeReferencesForDocument(owner.path),
      );
    const key = sectionKeyAt(owner.text, offset);
    return key
      ? this.render(
          owner,
          await owner.session.codeReferencesForSection(owner.path, key.section),
        )
      : '';
  }
  /** 문서 전체 출현은 첫 행에, 섹션 출현은 섹션 키 옆에 클릭 없는 개수 Hint로 표시한다. */
  async hints(owner: CodeOwner): Promise<InlayHint[]> {
    await this.prepare(owner);
    const query = await owner.session.codeReferencesForDocument(owner.path);
    if (isInitialCollection(query))
      return [
        {
          position: { line: 0, character: 0 },
          label: [{ value: codeCollectionMessages.initialLabel }],
          tooltip: {
            kind: 'markdown',
            value: codeCollectionMessages.initialLabel,
          },
          paddingRight: true,
        },
      ];
    const hints: InlayHint[] = [];
    if (!query.absent)
      hints.push(
        await this.countHint(owner, query, { line: 0, character: 0 }, false),
      );
    const parsed = parseYaml(owner.text);
    if (!parsed.success) return hints;
    const document = { observation: { path: owner.path, parsed } };
    for (const section of getSectionNames(parsed)) {
      const key = getSectionKeyRange(document, section);
      if (!key) continue;
      const sectionQuery = await owner.session.codeReferencesForSection(
        owner.path,
        section,
      );
      if (sectionQuery.occurrences.length === 0) continue;
      hints.push(
        await this.countHint(owner, sectionQuery, key.range.end, true),
      );
    }
    return hints;
  }
  /** 개수만 표시하고 명령은 두지 않는 Hint 하나를 만든다. 목록은 tooltip에 둔다. */
  async countHint(
    owner: CodeOwner,
    query: WorkspaceCodeReferenceQuery,
    position: Position,
    afterKey: boolean,
  ): Promise<InlayHint> {
    const count = query.occurrences.length;
    const documentComplete = await this.documentComplete(owner, query);
    const value = !documentComplete
      ? `확인된 코드 ${count}곳 · 문서 탐색 미확인`
      : query.status === codeCollectionStatuses.complete
        ? `코드 ${count}곳`
        : `확인된 코드 ${count}곳 · ${incompleteLabel(query)}`;
    return {
      position,
      label: [{ value }],
      tooltip: { kind: 'markdown', value: await this.render(owner, query) },
      ...(afterKey ? { paddingLeft: true } : { paddingRight: true }),
    };
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
  /** 개별 위치와 수집 상태를 Markdown에 안전하게 표시한다. */
  async render(
    owner: CodeOwner,
    query: WorkspaceCodeReferenceQuery,
  ): Promise<string> {
    if (isInitialCollection(query)) return codeCollectionMessages.initialLabel;
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
    if (query.status !== codeCollectionStatuses.complete) {
      lines.push(
        `확인된 코드 ${query.occurrences.length}곳 · ${incompleteLabel(query)}`,
      );
      for (const item of query.failures) {
        if (item.reason === codeFileReasons.watch)
          console.error('Code watch failed', item.message);
        else lines.push(escapeMarkdown(item.message));
      }
      if (query.failures.some((item) => item.reason === codeFileReasons.watch))
        lines.push(codeCollectionMessages.reconnectingGuidance);
    }
    if (!documentComplete)
      lines.push('저장 문서 탐색을 완전히 확인하지 못했습니다.');
    return lines.join('\n');
  }
}
/** 미완료 수집의 상태 문구를 정한다. 감시 실패만 있으면 재연결 중이다. */
function incompleteLabel(query: WorkspaceCodeReferenceQuery): string {
  if (query.status === codeCollectionStatuses.collecting)
    return codeCollectionMessages.collectingLabel;
  return query.failures.length > 0 &&
    query.failures.every((item) => item.reason === codeFileReasons.watch)
    ? codeCollectionMessages.reconnectingLabel
    : codeCollectionMessages.incompleteLabel;
}
/** 최초 수집이 아직 끝나지 않아 유일·부재를 말할 수 없는 상태인지 확인한다. */
function isInitialCollection(query: {
  hasCompletedCollection?: boolean;
}): boolean {
  return query.hasCompletedCollection === false;
}
/** 최초 수집이 끝나지 않았는지 기다리지 않고 확인한다. */
async function initialPending(owner: CodeOwner): Promise<boolean> {
  return isInitialCollection(await owner.session.codeReferenceSnapshot());
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
