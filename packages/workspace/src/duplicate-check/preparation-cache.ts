import {
  duplicatePreparationKey,
  prepareDuplicateDocument,
  type DuplicateDocumentInput,
  type PreparedDuplicateDocument,
} from '@codocs/core';

/** 캐시가 준비 자료를 재사용했는지와 자료를 함께 반환한다. */
export interface DuplicatePreparationLookup {
  prepared: PreparedDuplicateDocument;
  reused: boolean;
}

/**
 * 저장 문서의 준비 자료를 경로별로 한 건씩 보관하는 세션 수명 캐시다.
 * 경로·원문 버전·설정 버전이 모두 같을 때만 재사용하며 초안은 넣지 않는다.
 */
export class DuplicatePreparationCache {
  readonly #entries = new Map<
    string,
    { key: string; prepared: PreparedDuplicateDocument }
  >();

  /** 보관한 준비 자료의 수다. */
  get size(): number {
    return this.#entries.size;
  }

  /** 색인에 없는 경로의 자료를 버린다. 삭제된 문서의 자료는 사용하지 않는다. */
  retainOnly(livePaths: ReadonlySet<string>): void {
    for (const cachedPath of [...this.#entries.keys()])
      if (!livePaths.has(cachedPath)) this.#entries.delete(cachedPath);
  }

  /** 같은 키의 자료가 있으면 재사용하고, 없으면 새로 준비해 경로의 이전 자료를 대체한다. 준비 오류는 그대로 던진다. */
  obtain(input: DuplicateDocumentInput): DuplicatePreparationLookup {
    const key = duplicatePreparationKey(input);
    const cached = this.#entries.get(input.path);
    if (cached?.key === key) return { prepared: cached.prepared, reused: true };
    const prepared = prepareDuplicateDocument(input);
    this.#entries.set(input.path, { key, prepared });
    return { prepared, reused: false };
  }

  /** 준비에 실패한 경로의 이전 버전 자료를 남기지 않는다. */
  discard(documentPath: string): void {
    this.#entries.delete(documentPath);
  }
}
