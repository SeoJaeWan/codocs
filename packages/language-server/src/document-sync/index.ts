import type {
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  Position,
  Range,
} from 'vscode-languageserver/node.js';
import {
  TextDocument,
  type TextDocumentContentChangeEvent,
} from 'vscode-languageserver-textdocument';
export {
  documentUpdateRejections,
  type DocumentUpdateRejection,
} from './domain-values.js';
import {
  documentUpdateRejections,
  type DocumentUpdateRejection,
} from './domain-values.js';

/** 코어가 사용하는 UTF-16 반개방 offset 범위다. */
export interface Utf16OffsetRange {
  start: number;
  end: number;
}

/** 열린 문서 갱신 결과다. */
export type DocumentUpdateResult =
  | { accepted: true; document: TextDocument }
  | {
      accepted: false;
      reason: DocumentUpdateRejection;
    };

/** SDK TextDocument로 전체 원문과 단조 증가 버전을 관리한다. @codocs [[문서 동기화]] */
export class SynchronizedDocuments {
  readonly #documents = new Map<string, TextDocument>();

  /** didOpen의 전체 원문을 저장하며 같은 URI의 이전 버전은 되돌리지 않는다. */
  open(params: DidOpenTextDocumentParams): DocumentUpdateResult {
    const item = params.textDocument;
    const current = this.#documents.get(item.uri);
    if (current && item.version <= current.version)
      return { accepted: false, reason: documentUpdateRejections.staleVersion };
    const document = TextDocument.create(
      item.uri,
      item.languageId,
      item.version,
      item.text,
    );
    this.#documents.set(item.uri, document);
    return { accepted: true, document };
  }

  /** didChange의 단일 전체 원문만 받고 버전이 증가할 때 교체한다. @codocs [[문서 동기화]]#L11-L14 */
  change(params: DidChangeTextDocumentParams): DocumentUpdateResult {
    const current = this.#documents.get(params.textDocument.uri);
    if (!current)
      return { accepted: false, reason: documentUpdateRejections.notOpen };
    if (params.textDocument.version <= current.version)
      return { accepted: false, reason: documentUpdateRejections.staleVersion };
    if (
      params.contentChanges.length !== 1 ||
      !isFullTextChange(params.contentChanges[0])
    )
      return {
        accepted: false,
        reason: documentUpdateRejections.incrementalChange,
      };
    const document = TextDocument.update(
      current,
      params.contentChanges,
      params.textDocument.version,
    );
    this.#documents.set(document.uri, document);
    return { accepted: true, document };
  }

  /** 닫힌 URI의 편집 중 원문을 제거한다. @codocs [[문서 동기화]]#L38 */
  close(uri: string): boolean {
    return this.#documents.delete(uri);
  }

  /** 현재 URI의 불변 SDK 문서 snapshot을 반환한다. */
  get(uri: string): TextDocument | undefined {
    return this.#documents.get(uri);
  }

  /** 열린 문서 목록을 완료 관측 갱신에 사용한다. */
  all(): readonly TextDocument[] {
    return [...this.#documents.values()];
  }

  /** 서버 종료 시 모든 편집 중 원문을 제거한다. */
  clear(): void {
    this.#documents.clear();
  }
}

/** 범위 없는 변경만 전체 원문 동기화로 인정한다. */
function isFullTextChange(
  change: TextDocumentContentChangeEvent | undefined,
): change is { text: string } {
  return change !== undefined && !('range' in change);
}

/** UTF-16 offset 하나를 SDK의 줄/문자 좌표로 바꾼다. */
export function utf16OffsetToPosition(
  document: TextDocument,
  offset: number,
): Position {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > document.getText().length
  )
    throw new RangeError('UTF-16 offset이 문서 범위를 벗어났습니다.');
  return document.positionAt(offset);
}

/** UTF-16 [start,end) 범위를 LSP 반개방 Range로 바꾼다. @codocs [[문서 동기화]]#L12-L13 */
export function utf16OffsetsToRange(
  document: TextDocument,
  offsets: Utf16OffsetRange,
): Range {
  if (offsets.end < offsets.start)
    throw new RangeError('UTF-16 범위의 끝이 시작보다 앞섭니다.');
  return {
    start: utf16OffsetToPosition(document, offsets.start),
    end: utf16OffsetToPosition(document, offsets.end),
  };
}
