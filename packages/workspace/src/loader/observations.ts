import path from 'node:path';
import type { WorkspaceDocumentResult } from './index.js';

/** 읽기 시작 세대와 그 읽기에서 얻은 원문·파싱·진단을 함께 보존한다. */
export interface WorkspaceDocumentObservation {
  generation: number;
  document: WorkspaceDocumentResult;
}

/** 같은 경로 또는 그 하위인지 OS 경로 연산으로 확인한다. */
export function containsWorkspacePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}

/**
 * 단일 프로젝트의 진행 중 탐색끼리 공유하는 발견 경로별 읽기 캐시다. 디스크 최신성 판단은 호출자가 무효화한다.
 */
export class WorkspaceObservationCache {
  #generation = 0;
  #invalidations = new Map<string, number>();
  #documents = new Map<string, WorkspaceDocumentObservation>();
  #pending = new Map<
    string,
    {
      generation: number;
      realPath: string;
      operation: Promise<WorkspaceDocumentObservation>;
    }
  >();

  /** 현재 무효화 순번이다. 결과가 시작된 시점과 후속 신호를 구분한다. */
  get version(): number {
    return this.#generation;
  }

  /** 파일 또는 폴더 하위의 읽기 세대를 올린다. 실경로를 발견 경로로 자동 확장하지 않는다. */
  invalidate(logicalPath: string): number {
    const scope = path.resolve(logicalPath);
    const generation = ++this.#generation;
    for (const candidate of this.#invalidations.keys())
      if (containsWorkspacePath(scope, candidate))
        this.#invalidations.delete(candidate);
    this.#invalidations.set(scope, generation);
    for (const candidate of this.#documents.keys())
      if (containsWorkspacePath(scope, candidate))
        this.#documents.delete(candidate);
    return generation;
  }

  /** 지정 발견 경로의 현재 읽기 세대다. 부모 폴더 교체도 하위에 반영한다. */
  generation(logicalPath: string): number {
    let generation = 0;
    for (const [scope, candidate] of this.#invalidations)
      if (containsWorkspacePath(scope, logicalPath))
        generation = Math.max(generation, candidate);
    return generation;
  }

  /** 범위 확인 시작 뒤 조상·자손의 무효화가 있었는지 검사해 오래된 열거·부재 적용을 막는다. */
  isScopeCurrent(logicalPath: string, generation: number): boolean {
    for (const [scope, changed] of this.#invalidations)
      if (
        changed > generation &&
        (containsWorkspacePath(scope, logicalPath) ||
          containsWorkspacePath(logicalPath, scope))
      )
        return false;
    return true;
  }

  /** 늦게 끝난 읽기가 경로 무효화 이전 결과인지 확인한다. */
  isCurrent(observation: WorkspaceDocumentObservation): boolean {
    return (
      observation.generation ===
      this.generation(observation.document.source.logicalPath)
    );
  }

  /** 경로·접근 재확인 후 같은 대상의 유효한 읽기만 재사용한다. 실패와 오래된 완료는 캐시에 넣지 않는다. */
  async observe(
    logicalPath: string,
    realPath: string,
    read: () => Promise<WorkspaceDocumentResult>,
  ): Promise<WorkspaceDocumentObservation> {
    const cached = this.#documents.get(logicalPath);
    const pending = this.#pending.get(logicalPath);
    // 신호 없이도 경로 재확인으로 대상 교체가 드러나면 이전 읽기와 세대를 분리한다.
    if (
      (cached && cached.document.source.realPath !== realPath) ||
      (pending && pending.realPath !== realPath)
    )
      this.invalidate(logicalPath);
    const generation = this.generation(logicalPath);
    if (
      cached?.generation === generation &&
      cached.document.source.realPath === realPath
    )
      return cached;
    if (pending?.generation === generation && pending.realPath === realPath)
      return pending.operation;
    /** 실제 읽기의 시작 세대를 고정해 이후 무효화와 구분한다. */
    const operation = (
      /** 실제 IO의 완료를 시작 세대에 묶는다. */ async (): Promise<WorkspaceDocumentObservation> => {
        const observation = { generation, document: await read() };
        if (this.isCurrent(observation))
          this.#documents.set(logicalPath, observation);
        return observation;
      }
    )();
    this.#pending.set(logicalPath, { generation, realPath, operation });
    try {
      return await operation;
    } finally {
      if (this.#pending.get(logicalPath)?.operation === operation)
        this.#pending.delete(logicalPath);
    }
  }
}
