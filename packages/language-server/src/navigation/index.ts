import { randomBytes } from 'node:crypto';
import type {
  WorkspaceCandidateOrigin,
  WorkspaceQuerySession,
  WorkspaceSectionDestination,
  WorkspacePathDocumentResult,
} from '@codocs/workspace';
import { openSourceCommand } from '../hover/index.js';

/** 출처 client로만 전달하는 서버 발급 원문 선택이다. */
export interface SourceSelection {
  sourceUri: string;
  token: string;
}

/** 최신 후보를 확인하는 요청과 완료 관측 알림의 프로토콜 이름이다. */
export const confirmSourceMethod = 'codocs/confirmSource';
export const snapshotChangedMethod = 'codocs/snapshotChanged';

/** 선택 확인에 사용하는 공개 workspace 경계다. */
export type CandidateSession = Pick<
  WorkspaceQuerySession,
  'captureCandidate' | 'confirmCandidate' | 'releaseCandidate'
>;

interface Selection {
  key: string;
  sourceUri: string;
  version: number;
  session: CandidateSession;
  candidateToken: string | undefined;
}

/** 임의 URI 대신 현재 서버가 발급한 선택 근거만 보관한다. */
export class SourceSelections {
  readonly #selections = new Map<string, Selection>();

  /** 현재 서버가 해당 출처에 발급한 선택인지 확인한다. */
  has(input: unknown): boolean {
    return (
      isSourceSelection(input) &&
      this.#selections.get(input.token)?.sourceUri === input.sourceUri
    );
  }

  /** Workspace가 출처를 확인한 후보에만 실행 가능한 선택을 발급한다. */
  capture(
    sourceUri: string,
    version: number,
    session: CandidateSession,
    origin: WorkspaceCandidateOrigin | undefined,
    target: WorkspacePathDocumentResult,
    catalogVersion: number,
  ): SourceSelection | undefined {
    const key = JSON.stringify([
      sourceUri,
      version,
      origin,
      target.path,
      catalogVersion,
    ]);
    for (const [token, selected] of this.#selections)
      if (selected.session === session && selected.key === key)
        return { sourceUri, token };
    const token = randomBytes(24).toString('base64url');
    const candidateToken = origin
      ? session.captureCandidate(origin, target.path, catalogVersion)
      : undefined;
    if (!candidateToken) return undefined;
    this.#selections.set(token, {
      key,
      sourceUri,
      version,
      session,
      candidateToken,
    });
    return { sourceUri, token };
  }

  /** 닫기·원문 편집·서버 종료에서 출처의 모든 선택을 해제한다. */
  release(sourceUri?: string): void {
    for (const [token, selection] of this.#selections) {
      if (sourceUri !== undefined && sourceUri !== selection.sourceUri)
        continue;
      if (selection.candidateToken)
        selection.session.releaseCandidate(selection.candidateToken);
      this.#selections.delete(token);
    }
  }

  /** 외부 인자는 토큰과 출처만 허용하고 최신 문서·세션을 전후로 확인한다. */
  async confirm(
    input: unknown,
    current: (
      sourceUri: string,
      version: number,
      session: CandidateSession,
    ) => boolean,
  ): Promise<{
    uri: string;
    destination?: WorkspaceSectionDestination;
  } | null> {
    if (!isSourceSelection(input)) return null;
    const selected = this.#selections.get(input.token);
    if (
      !selected ||
      selected.sourceUri !== input.sourceUri ||
      !selected.candidateToken ||
      !current(selected.sourceUri, selected.version, selected.session)
    )
      return null;
    const confirmed = await selected.session.confirmCandidate(
      selected.candidateToken,
    );
    if (
      !confirmed ||
      this.#selections.get(input.token) !== selected ||
      !current(selected.sourceUri, selected.version, selected.session)
    )
      return null;
    return {
      uri: confirmed.result.source.uri,
      // 섹션 링크만 최신 확인에서 얻은 섹션 키 위치를 함께 전달한다.
      ...(confirmed.destination ? { destination: confirmed.destination } : {}),
    };
  }
}

/** command 링크에 외부 URI나 추가 명령을 넣지 않는다. */
export function selectionTarget(selection: SourceSelection): string {
  // Host URI 파싱과 CommandOpener의 추가 디코딩에서 URI 내부의 %를 보존한다.
  // 서버 resolve의 단일 디코딩도 같은 JSON 값을 복원한다.
  const argumentsJson = JSON.stringify([selection]).replace(/%/gu, '\\u0025');
  return `command:${openSourceCommand}?${encodeURIComponent(argumentsJson)}`;
}

/** JSON 경계에서 토큰과 file 출처의 최소 구조를 확인한다. */
export function isSourceSelection(value: unknown): value is SourceSelection {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Partial<SourceSelection>;
  if (
    typeof input.sourceUri !== 'string' ||
    typeof input.token !== 'string' ||
    !/^[\w-]{32}$/u.test(input.token)
  )
    return false;
  try {
    return new URL(input.sourceUri).protocol === 'file:';
  } catch {
    return false;
  }
}
