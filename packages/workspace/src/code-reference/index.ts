import { randomBytes } from 'node:crypto';
import { calculateRevision } from '../revision/index.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  codeReferenceDestinationKinds,
  codeReferenceStatuses,
  scanStatuses,
  extractCodeReferences,
  resolveCodeReference,
  type Catalog,
  type CodeReferenceMarker,
  type CodeReferenceResolution,
} from '@codocs/core';
import {
  applyCodeSignals,
  codeFileFailures,
  codeFileStatus,
  codeWatchRuleKey,
  computeCodeFilePolicy,
  diffCodeWatchRules,
  discoverCodeFiles,
  hasTrackedDescendant,
  isCodeFileIgnored,
  isCodeWatchIgnored,
  readEligibleCodeFile,
  recheckCodeDirectories,
  codeFileRelativePath,
  type CodeCollectionFailure,
  type CodeFileObservation,
  type CodeFilePolicy,
  type CodeFileState,
} from '../paths/code-file-access.js';
import {
  CodeReferenceWatcher,
  type CodeWatchExclusion,
} from '../watcher/code-reference-watcher.js';
import {
  codeCollectionStatuses,
  codeFileReasons,
  codeObservationKinds,
} from './domain-values.js';
export * from './domain-values.js';

/** 한 출현은 저장 관측 또는 최신 편집 관측 하나만 갖는다. */
export interface WorkspaceCodeReferenceOccurrence extends CodeReferenceResolution {
  occurrenceId: string;
  sourcePath: string;
  sourceUri: string;
  sourceIdentity: string;
  sourceRevision: string;
  documentVersion?: number;
  observation: (typeof codeObservationKinds)[keyof typeof codeObservationKinds];
}
/** 각 세대의 확인한 출현과 별도 수집 상태를 함께 제공한다. */
export interface WorkspaceCodeReferenceSnapshot {
  /** 게시된 수집 상태다. 짧은 재확인 동안에는 보유한 마지막 상태를 유지한다. */
  status: (typeof codeCollectionStatuses)[keyof typeof codeCollectionStatuses];
  /**
   * 수집이 한 번이라도 끝났는지 나타낸다. false인 동안에는 링크 없이 수집 중 안내만 표시한다.
   * 이 색인은 항상 값을 채우며, 생략된 값은 완료(true)로 해석한다.
   */
  hasCompletedCollection?: boolean;
  codeGeneration: number;
  documentGeneration: number;
  occurrences: readonly WorkspaceCodeReferenceOccurrence[];
  confirmedCount: number;
  failures: readonly CodeCollectionFailure[];
}
/**
 * 표시 가능한 상태(완료 이력이 있고 문서 catalog가 complete)에서 표시용 유일성·부재를 계산한다.
 * 수집 상태의 확정 여부는 status가 따로 나타낸다.
 */
export interface WorkspaceCodeReferenceQuery extends WorkspaceCodeReferenceSnapshot {
  unique: boolean;
  absent: boolean;
}
/** 열린 source의 버전은 호출자가 단조 증가시키며 closeBuffer로 해제한다. */
export interface WorkspaceCodeBufferInput {
  sourcePath: string;
  text: string;
  documentVersion: number;
}
interface BufferObservation extends WorkspaceCodeBufferInput {
  identity: string;
  revision: string;
  markers: readonly CodeReferenceMarker[];
}
/** 클릭 토큰의 source 소유권을 현재 문서 버전과 함께 고정한다. */
export interface WorkspaceCodeReferenceCaptureInput {
  occurrenceId: string;
  ownerPath: string;
  ownerVersion: number;
}
interface Selection {
  occurrence: WorkspaceCodeReferenceOccurrence;
  ownerPath: string;
  ownerVersion: number;
  codeGeneration: number;
  documentGeneration: number;
  targetIdentity: string;
}
/** 코드 감시 연결이 수집 계층에 요구하는 최소 계약이다. */
export interface CodeWatchConnection {
  start(): Promise<void>;
  close(): Promise<void>;
}
/** 실제 IO 경합 제어, 감시 연결·재시도 시각 교체와 관측 계수만 제공하는 검사 경계다. */
export interface WorkspaceCodeReferenceIndexOptions {
  beforeRead?: (paths: readonly string[] | undefined) => Promise<void>;
  observe?: (kind: string, detail: Record<string, unknown>) => void;
  /** 기본값은 실제 chokidar 감시다. */
  createWatcher?: (
    projectRoot: string,
    changed: (paths: readonly string[]) => void,
    failed: (error: unknown) => void,
    excluded: CodeWatchExclusion,
  ) => CodeWatchConnection;
  /** 재시도 예약을 교체하며 반환값은 예약 취소 함수다. 기본값은 setTimeout이다. */
  schedule?: (callback: () => void, delay: number) => () => void;
  /** 재확인이 이 시간(ms)을 넘길 때만 collecting을 게시한다. 기본값은 구현 상수다. */
  collectingThreshold?: number;
}
/** 짧은 재확인에서 collecting 깜박임을 막는 구현 상수이며 계약 수치가 아니다. */
const defaultCollectingThreshold = 300;
/** 감시 재등록 재시도는 1초에서 시작해 두 배씩 늘리며 30초를 넘지 않는다. */
const watchRetryDelay = { initial: 1_000, maximum: 30_000 } as const;
/** 기본 감시는 실제 chokidar 연결이다. */
function createChokidarWatcher(
  ...args: ConstructorParameters<typeof CodeReferenceWatcher>
): CodeWatchConnection {
  return new CodeReferenceWatcher(...args);
}
/** 기본 재시도 예약은 타이머이며 반환값으로 취소한다. */
function scheduleTimer(callback: () => void, delay: number): () => void {
  const timer = setTimeout(callback, delay);
  return /** 예약한 타이머를 해제한다. */ () => clearTimeout(timer);
}
/** 등록 실패를 값으로 전달해 falsy 오류도 구분한다. */
interface WatchRegistrationFailure {
  error: unknown;
}
/**
 * 코드 수집·overlay·재해석·안전한 클릭을 저장 catalog와 분리한다.
 * @codocs [[작업 공간:코드 참조 색인]]
 */
export class WorkspaceCodeReferenceIndex {
  #catalog: Catalog | undefined;
  #documentGeneration = 0;
  #codeGeneration = 0;
  #state: CodeFileState | undefined;
  #disk = new Map<string, CodeFileObservation>();
  #markers = new Map<string, readonly CodeReferenceMarker[]>();
  #buffers = new Map<string, BufferObservation>();
  #owners = new Map<string, number>();
  #pendingBuffers = new Map<string, WorkspaceCodeBufferInput>();
  #selections = new Map<string, Selection>();
  #listeners = new Set<(snapshot: WorkspaceCodeReferenceSnapshot) => void>();
  #watcher: CodeWatchConnection | undefined;
  #registered: { policy: CodeFilePolicy; rules: string } | undefined;
  #overlapping = false;
  #rebuilding = false;
  #overlapErrors: unknown[] = [];
  #fullPending = false;
  #recovering: Promise<void> | undefined;
  #cancelRetry: (() => void) | undefined;
  #failedAttempts = 0;
  #brokenAgain = false;
  #watchFailure: CodeCollectionFailure | undefined;
  #status: WorkspaceCodeReferenceSnapshot['status'] =
    codeCollectionStatuses.collecting;
  #published: string;
  #checking = false;
  #collectingShown = false;
  #collectingTimer: ReturnType<typeof setTimeout> | undefined;
  #failures: readonly CodeCollectionFailure[] = [];
  #pending = new Set<string>();
  #operation: Promise<WorkspaceCodeReferenceSnapshot> | undefined;
  #starting: Promise<void> | undefined;
  #closed = false;
  #epoch = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** 프로젝트 root와 실제 IO 옵션만 고정하고 최초 snapshot에서 시작한다. */
  constructor(
    readonly projectRoot: string,
    readonly options: WorkspaceCodeReferenceIndexOptions = {},
  ) {
    this.#published = this.#signature();
  }
  /** 저장 document snapshot만 교체하고 원문 코드 관측을 재사용한다. 바뀐 경우에만 알린다. */
  setCatalog(catalog: Catalog | undefined, documentGeneration: number): void {
    if (this.#closed) return;
    const changed =
      catalog !== this.#catalog ||
      documentGeneration !== this.#documentGeneration;
    this.#catalog = catalog;
    this.#documentGeneration = documentGeneration;
    if (changed) this.#notify();
  }
  /** IDE 출처의 버전·소유권은 클릭 확인에서 다시 검사한다. */
  setOwner(sourcePath: string, documentVersion: number): boolean {
    const relative = codeFileRelativePath(this.projectRoot, sourcePath);
    if (
      !relative ||
      this.#closed ||
      !Number.isSafeInteger(documentVersion) ||
      documentVersion < 0 ||
      (this.#owners.get(relative) ?? -1) > documentVersion
    )
      return false;
    this.#owners.set(relative, documentVersion);
    return true;
  }
  /** 동일 버전의 원문까지 확인한 후 적격 저장 파일만 편집 관측으로 대체한다. */
  async updateBuffer(input: WorkspaceCodeBufferInput): Promise<boolean> {
    const relative = codeFileRelativePath(this.projectRoot, input.sourcePath);
    if (!relative || !this.setOwner(relative, input.documentVersion))
      return false;
    const previous = this.#buffers.get(relative);
    if (
      previous?.documentVersion === input.documentVersion &&
      previous.text !== input.text
    )
      return false;
    const pending = { ...input, sourcePath: relative };
    this.#pendingBuffers.set(relative, pending);
    await this.ready();
    if (
      this.#closed ||
      this.#pendingBuffers.get(relative) !== pending ||
      this.#owners.get(relative) !== input.documentVersion ||
      !this.#state
    )
      return false;
    const observed = await readEligibleCodeFile(this.#state.policy, relative);
    if (
      this.#closed ||
      this.#pendingBuffers.get(relative) !== pending ||
      this.#owners.get(relative) !== input.documentVersion ||
      !observed ||
      !('text' in observed)
    )
      return false;
    this.#buffers.set(relative, {
      ...pending,
      identity: observed.identity,
      revision: `buffer:${input.documentVersion}`,
      markers: extractCodeReferences(input.text),
    });
    this.#commit();
    return true;
  }
  /** 편집 출처·소유권·토큰을 해제한다. 저장 원문은 다시 읽지 않고 표기가 달랐을 때만 게시한다. */
  closeBuffer(sourcePath: string): Promise<void> {
    const relative = codeFileRelativePath(this.projectRoot, sourcePath);
    if (!relative) return Promise.resolve();
    this.#owners.delete(relative);
    this.#pendingBuffers.delete(relative);
    this.#buffers.delete(relative);
    for (const [token, selection] of this.#selections)
      if (
        selection.ownerPath === relative ||
        selection.occurrence.sourcePath === relative
      )
        this.#selections.delete(token);
    this.#commit();
    return Promise.resolve();
  }
  /**
   * 보유한 관측을 기다리지 않고 돌려준다. 최초 수집은 시작만 하고 끝나기를 기다리지 않으며,
   * 완료 후 조회에서는 파일 IO를 하지 않는다.
   */
  snapshot(): Promise<WorkspaceCodeReferenceSnapshot> {
    this.#startInitial();
    return Promise.resolve(this.#snapshot());
  }
  /** 최초 수집이 끝날 때까지 기다린 뒤 snapshot을 돌려준다. 이후에는 재확인을 기다리지 않는다. */
  async ready(): Promise<WorkspaceCodeReferenceSnapshot> {
    if (!this.#state && !this.#closed) await this.refresh();
    return this.#snapshot();
  }
  /** 최초 수집을 기다리지 않고 시작하며 예외는 수집 상태로 게시된다. */
  #startInitial(): void {
    if (this.#state || this.#closed || this.#operation) return;
    this.#collect().catch(
      /** 수집 예외는 작업 안에서 incomplete로 게시되므로 감시 손상만 알린다. */ (
        error: unknown,
      ) => this.#watchBroken(error),
    );
  }
  /** 보유한 marker를 저장 catalog로 재해석하며 파일별 overlay를 한 번만 집계한다. */
  #snapshot(): WorkspaceCodeReferenceSnapshot {
    const occurrences: WorkspaceCodeReferenceOccurrence[] = [];
    for (const [sourcePath, file] of this.#disk) {
      const buffer = this.#buffers.get(sourcePath);
      const markers = buffer?.markers ?? this.#markers.get(sourcePath) ?? [];
      for (const cachedMarker of markers) {
        const marker: CodeReferenceMarker = {
          ...cachedMarker,
          offsetRange: { ...cachedMarker.offsetRange },
          range: {
            start: { ...cachedMarker.range.start },
            end: { ...cachedMarker.range.end },
          },
          ...(cachedMarker.destination
            ? { destination: { ...cachedMarker.destination } }
            : {}),
        };
        const resolution: CodeReferenceResolution = this.#catalog
          ? resolveCodeReference(this.#catalog, marker)
          : {
              marker,
              status: codeReferenceStatuses.unconfirmed,
              candidates: [],
            };
        occurrences.push({
          ...resolution,
          occurrenceId: `${sourcePath}:${marker.offsetRange.start}:${marker.offsetRange.end}`,
          sourcePath,
          sourceUri: pathToFileURL(path.join(this.projectRoot, sourcePath))
            .href,
          sourceIdentity: buffer?.identity ?? file.identity,
          sourceRevision: buffer?.revision ?? file.revision,
          ...(buffer ? { documentVersion: buffer.documentVersion } : {}),
          observation: buffer
            ? codeObservationKinds.buffer
            : codeObservationKinds.disk,
        });
      }
    }
    return {
      status: this.#visibleStatus(),
      hasCompletedCollection: this.#state !== undefined,
      codeGeneration: this.#codeGeneration,
      documentGeneration: this.#documentGeneration,
      occurrences,
      confirmedCount: occurrences.filter(
        (item) => item.status === codeReferenceStatuses.resolved,
      ).length,
      failures: [
        ...this.#failures,
        ...(this.#watchFailure ? [this.#watchFailure] : []),
      ],
    };
  }
  /** 1부터 시작하는 행 또는 문서 전체에 연결된 정확한 출현 합집합이다. */
  async reverse(
    targetPath: string,
    rows?: { startLine: number; endLine: number },
  ): Promise<WorkspaceCodeReferenceQuery> {
    const relative = codeFileRelativePath(this.projectRoot, targetPath);
    const snapshot = await this.snapshot();
    const occurrences = snapshot.occurrences.filter(
      /** 저장 대상과 요청한 실제 행의 교집합만 고른다. */ (item) =>
        item.status === codeReferenceStatuses.resolved &&
        codeFileRelativePath(this.projectRoot, item.target?.path ?? '') ===
          relative &&
        (rows
          ? item.destination?.kind === codeReferenceDestinationKinds.rows &&
            item.destination.startLine <= rows.endLine &&
            item.destination.endLine >= rows.startLine
          : item.destination?.kind === codeReferenceDestinationKinds.document),
    );
    const displayable =
      snapshot.hasCompletedCollection !== false &&
      this.#catalog?.status === scanStatuses.complete;
    return {
      ...snapshot,
      occurrences,
      confirmedCount: occurrences.length,
      unique: displayable && occurrences.length === 1,
      absent: displayable && occurrences.length === 0,
    };
  }
  /** 모든 출처의 현재 버전과 양쪽 파일 정체를 저장한 opaque 클릭 토큰이다. */
  async capture(
    input: WorkspaceCodeReferenceCaptureInput,
  ): Promise<string | undefined> {
    const ownerPath = codeFileRelativePath(this.projectRoot, input.ownerPath);
    if (
      !ownerPath ||
      this.#owners.get(ownerPath) !== input.ownerVersion ||
      this.#closed
    )
      return undefined;
    const snapshot = await this.ready();
    const occurrence = snapshot.occurrences.find(
      (item) =>
        item.occurrenceId === input.occurrenceId &&
        item.status === codeReferenceStatuses.resolved,
    );
    if (!occurrence?.target || !this.#state) return undefined;
    const target = await readEligibleCodeFile(
      {
        ...this.#state.policy,
        tracked: new Set([
          codeFileRelativePath(this.projectRoot, occurrence.target.path)!,
        ]),
      },
      occurrence.target.path,
    );
    if (
      !target ||
      !('text' in target) ||
      !this.#matchesCatalog(occurrence.target.path, target.revision) ||
      this.#closed ||
      snapshot.codeGeneration !== this.#codeGeneration ||
      snapshot.documentGeneration !== this.#documentGeneration
    )
      return undefined;
    const token = randomBytes(24).toString('base64url');
    this.#selections.set(token, {
      occurrence,
      ownerPath,
      ownerVersion: input.ownerVersion,
      codeGeneration: snapshot.codeGeneration,
      documentGeneration: snapshot.documentGeneration,
      targetIdentity: target.identity,
    });
    return token;
  }
  /** 디스크 대상 원문이 저장 catalog가 해석에 쓴 원문과 같은지 확인한다. */
  #matchesCatalog(targetPath: string, revision: string): boolean {
    return (
      revision ===
      calculateRevision(
        Buffer.from(
          this.#catalog?.documents.get(targetPath)?.observation.parsed.source ??
            '',
          'utf8',
        ),
      )
    );
  }
  /**
   * 수집 완료나 세대와 무관하게 source·target 파일을 직접 읽어 확인한다. source 정체, 표기 오프셋·원문 연속성,
   * target 정체와 현재 catalog 해석이 모두 같아야 하며 source 파일 전체 revision은 비교하지 않는다.
   * 진행 중인 수집은 기다리지 않고 재시도하지 않는다.
   */
  async confirm(
    token: string,
    owner: { sourcePath: string; documentVersion: number },
  ): Promise<WorkspaceCodeReferenceOccurrence | undefined> {
    const selection = this.#selections.get(token);
    if (
      !selection ||
      !this.#state ||
      !this.#catalog ||
      this.#closed ||
      codeFileRelativePath(this.projectRoot, owner.sourcePath) !==
        selection.ownerPath ||
      owner.documentVersion !== selection.ownerVersion ||
      this.#owners.get(selection.ownerPath) !== selection.ownerVersion
    )
      return undefined;
    const { policy } = this.#state;
    const source = await readEligibleCodeFile(
      policy,
      selection.occurrence.sourcePath,
    );
    if (
      !source ||
      !('text' in source) ||
      source.identity !== selection.occurrence.sourceIdentity
    )
      return undefined;
    const targetPath = selection.occurrence.target!.path;
    const target = await readEligibleCodeFile(
      {
        ...policy,
        tracked: new Set([codeFileRelativePath(this.projectRoot, targetPath)!]),
      },
      targetPath,
    );
    if (
      !target ||
      !('text' in target) ||
      target.identity !== selection.targetIdentity ||
      !this.#matchesCatalog(targetPath, target.revision)
    )
      return undefined;
    const buffer = this.#buffers.get(source.path);
    if (buffer?.documentVersion !== selection.occurrence.documentVersion)
      return undefined;
    const marker = extractCodeReferences(buffer?.text ?? source.text).find(
      /** 캡처한 정확한 위치와 표기의 연속성을 확인한다. */ (item) =>
        item.offsetRange.start ===
          selection.occurrence.marker.offsetRange.start &&
        item.offsetRange.end === selection.occurrence.marker.offsetRange.end &&
        item.text === selection.occurrence.marker.text,
    );
    const catalog = this.#catalog;
    if (!marker || !catalog) return undefined;
    const current = resolveCodeReference(catalog, marker);
    if (
      current.status !== codeReferenceStatuses.resolved ||
      current.target?.path !== targetPath ||
      this.#closed ||
      this.#selections.get(token) !== selection ||
      this.#owners.get(selection.ownerPath) !== selection.ownerVersion
    )
      return undefined;
    return { ...selection.occurrence, ...current };
  }
  /** source 소유자의 토큰만 폐기한다. */
  release(token: string): void {
    this.#selections.delete(token);
  }
  /** 게시 후 변경 알림을 구독하며 실패 listener는 수집 상태를 되돌리지 않는다. */
  onDidChange(
    listener: (snapshot: WorkspaceCodeReferenceSnapshot) => void,
  ): () => void {
    if (!this.#closed) this.#listeners.add(listener);
    return /** 해당 구독만 해제한다. */ (): void => {
      this.#listeners.delete(listener);
    };
  }
  /** 표기·위치·상태·실패의 게시 대상 지문이며 catalog 해석은 포함하지 않는다. */
  #signature(): string {
    const files: unknown[] = [];
    for (const [sourcePath] of this.#disk)
      files.push([
        sourcePath,
        this.#buffers.get(sourcePath)?.markers ??
          this.#markers.get(sourcePath) ??
          [],
      ]);
    return JSON.stringify([
      this.#visibleStatus(),
      this.#state !== undefined,
      this.#failures,
      this.#watchFailure,
      files,
    ]);
  }
  /** 보유한 최종 상태에 재확인 지연이 넘었을 때만 collecting을 덧씌운다. */
  #visibleStatus(): WorkspaceCodeReferenceSnapshot['status'] {
    return this.#collectingShown
      ? codeCollectionStatuses.collecting
      : this.#status;
  }
  /** 마지막 게시와 다른 경우에만 codeGeneration을 올려 알린다. */
  #commit(): boolean {
    if (this.#closed) return false;
    const signature = this.#signature();
    if (signature === this.#published) return false;
    this.#published = signature;
    this.#codeGeneration++;
    this.#notify();
    return true;
  }
  /** 재확인 시작을 기록하고 지연 시간이 넘으면 collecting을 한 번만 게시한다. */
  #beginCheck(): void {
    if (this.#closed || this.#checking) return;
    this.#checking = true;
    if (!this.#state) return;
    this.#collectingTimer = setTimeout(
      /** 지연을 넘긴 재확인만 collecting으로 알린다. */ () => {
        this.#collectingTimer = undefined;
        if (!this.#checking || this.#closed) return;
        this.#collectingShown = true;
        this.#commit();
      },
      this.options.collectingThreshold ?? defaultCollectingThreshold,
    );
  }
  /** 재확인을 끝내고 최종 결과가 달라졌을 때만 게시한다. */
  #endCheck(): void {
    if (!this.#checking) return;
    this.#checking = false;
    if (this.#collectingTimer) clearTimeout(this.#collectingTimer);
    this.#collectingTimer = undefined;
    this.#collectingShown = false;
    this.#commit();
  }
  /** 코드 generation과 문서 generation을 분리한 현재 상태를 구독자에게 전달한다. */
  #notify(): void {
    const snapshot = this.#snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch (error: unknown) {
        console.error('Code snapshot listener failed', error);
      }
    }
  }
  /** 변경 경로를 누적하고 제외 경로의 신호는 버린다. 분류와 읽기는 처리 시점에 한다. */
  #changed(paths: readonly string[]): void {
    if (this.#closed) return;
    const affected = paths.filter(
      /** 제외 코드의 신호가 원문 재수집을 반복하지 않게 한다. */ (input) => {
        const relative = codeFileRelativePath(this.projectRoot, input);
        if (
          !relative ||
          !this.#state ||
          this.#rebuilding ||
          path.basename(input) === '.gitignore'
        )
          return true;
        return (
          !isCodeFileIgnored(this.#state.policy, relative) ||
          hasTrackedDescendant(this.#state.policy, relative)
        );
      },
    );
    if (!affected.length) return;
    this.#epoch++;
    for (const input of affected) this.#pending.add(input);
    this.#beginCheck();
    if (!this.#timer)
      this.#timer = setTimeout(
        /** 감지한 경로를 하나의 재확인 요청으로 묶는다. */ () => {
          this.#timer = undefined;
          this.refresh([...this.#pending]).catch(
            /** 감시 실패를 수집 상태로 게시한다. */ (error) =>
              this.#watchBroken(error),
          );
        },
        30,
      );
  }
  /**
   * 경로를 알 수 없는 오류도 감시 연결의 손상으로 보고 확인한 출현을 보존한 채 incomplete로 게시한다.
   * 복구가 진행 중이거나 예약되어 있으면 새 복구를 만들지 않고 합친다.
   */
  #watchBroken(error: unknown): void {
    if (this.#closed) return;
    this.#watchFailure = {
      reason: codeFileReasons.watch,
      message: String(error),
    };
    this.#status = codeCollectionStatuses.incomplete;
    this.#commit();
    if (this.#recovering) this.#brokenAgain = true;
    else if (!this.#cancelRetry) this.#recoverInBackground();
  }
  /** 호출자가 기다리지 않는 복구의 예외는 기록하고 삼키지 않는다. */
  #recoverInBackground(): void {
    this.#recover().catch(
      /** 복구 자체가 실패하면 원인을 남긴다. */ (error: unknown) => {
        console.error('Code watch recovery failed', error);
      },
    );
  }
  /**
   * 정책을 먼저 계산해 수집할 수 있는 경로만 감시하고, 모든 연결의 ready·error 뒤에 반환한다.
   * 등록 중 도착한 오류는 등록 실패로 반환한다. overlap이면 이전 연결을 유지한 채 새 연결을 시작해
   * ready 뒤에 교체하며, 등록에 실패하면 이전 연결도 닫는다.
   */
  async #register(
    known?: CodeFilePolicy,
    overlap = false,
  ): Promise<WatchRegistrationFailure | undefined> {
    let policy: CodeFilePolicy;
    try {
      policy = known ?? (await computeCodeFilePolicy(this.projectRoot)).policy;
    } catch (error: unknown) {
      return { error };
    }
    if (this.#closed) return undefined;
    let registering = true;
    let failure: WatchRegistrationFailure | undefined;
    const registered = { policy, rules: codeWatchRuleKey(policy) };
    const watcher: CodeWatchConnection = (
      this.options.createWatcher ?? createChokidarWatcher
    )(
      this.projectRoot,
      /** 겹치는 동안의 신호도 경로 단위로 하나의 대기 집합에 합친다. */ (
        paths,
      ) => this.#changed(paths),
      /** 등록 중 오류는 등록 실패로, 이후에는 현재 연결의 오류만 연결 손상으로 다룬다. */ (
        error,
      ) => {
        if (this.#closed) return;
        if (registering) failure ??= { error };
        else if (watcher === this.#watcher) {
          if (this.#overlapping) this.#overlapErrors.push(error);
          else this.#watchBroken(error);
        }
      },
      /** 수집과 같은 정책으로 감시 제외를 판단한다. */ (input, stats) =>
        isCodeWatchIgnored(policy, input, stats),
    );
    const replaced = overlap ? this.#watcher : undefined;
    if (overlap) {
      this.#overlapping = true;
      this.#overlapErrors = [];
    } else {
      this.#watcher = watcher;
      this.#registered = registered;
    }
    try {
      await watcher.start();
    } catch (error: unknown) {
      failure ??= { error };
    }
    registering = false;
    if (!overlap) {
      if (failure && watcher === this.#watcher) {
        this.#watcher = undefined;
        this.#registered = undefined;
        await watcher.close();
      }
      return failure;
    }
    this.#overlapping = false;
    if (this.#closed) {
      await watcher.close();
      return undefined;
    }
    if (failure) {
      this.#watcher = undefined;
      this.#registered = undefined;
      await watcher.close();
      await replaced?.close();
      return failure;
    }
    this.#watcher = watcher;
    this.#registered = registered;
    await replaced?.close();
    const [overlapError] = this.#overlapErrors;
    if (this.#overlapErrors.length) this.#watchBroken(overlapError);
    this.#overlapErrors = [];
    return undefined;
  }
  /** 기존 연결을 종료하고 다시 등록한다. */
  async #reregister(): Promise<WatchRegistrationFailure | undefined> {
    const previous = this.#watcher;
    this.#watcher = undefined;
    this.#registered = undefined;
    await previous?.close();
    if (this.#closed) return undefined;
    return this.#register();
  }
  /** 최초 등록을 공유하며 실패는 복구로 넘긴다. */
  async #start(): Promise<void> {
    this.#starting ??= this.#register()
      .then(
        /** 등록 실패를 감시 손상으로 게시한다. */ (failure) => {
          if (failure) this.#watchBroken(failure.error);
        },
      )
      .catch(
        /** 예외도 감시 손상으로 게시한다. */ (error: unknown) =>
          this.#watchBroken(error),
      );
    await this.#starting;
  }
  /**
   * 진행 중인 복구를 공유하거나 예약된 재시도를 취소하고 즉시 시작한다.
   * 재등록 뒤 전체 재확인이 끝나고 다른 오류가 없으면 성공이다.
   */
  #recover(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#recovering) return this.#recovering;
    this.#cancelRetry?.();
    this.#cancelRetry = undefined;
    const run: Promise<void> = this.#recoverOnce().finally(() => {
      if (this.#recovering === run) this.#recovering = undefined;
    });
    this.#recovering = run;
    return run;
  }
  /** 한 번의 재등록·재확인을 수행하고 실패하면 다음 재시도를 예약한다. */
  async #recoverOnce(): Promise<void> {
    let failure: WatchRegistrationFailure | undefined;
    try {
      failure = await this.#reregister();
      if (!failure && !this.#closed) {
        this.#brokenAgain = false;
        // 재등록 전에 시작한 수집이 complete를 게시하지 않도록 끝난 뒤 실패를 해제한다.
        while (this.#operation) await this.#operation;
        if (!this.#brokenAgain) this.#watchFailure = undefined;
        await this.#collect();
      }
    } catch (error: unknown) {
      failure = { error };
    }
    if (this.#closed) return;
    if (!failure && !this.#brokenAgain) {
      this.#failedAttempts = 0;
      return;
    }
    if (failure)
      this.#watchFailure = {
        reason: codeFileReasons.watch,
        message: String(failure.error),
      };
    this.#status = codeCollectionStatuses.incomplete;
    this.#commit();
    const delay = Math.min(
      watchRetryDelay.initial * 2 ** this.#failedAttempts,
      watchRetryDelay.maximum,
    );
    this.#failedAttempts++;
    this.#cancelRetry = (this.options.schedule ?? scheduleTimer)(() => {
      this.#cancelRetry = undefined;
      this.#recoverInBackground();
    }, delay);
  }
  /** 경로 없는 명시 refresh는 감시 손상 중이면 예약을 취소하고 바로 복구한다. */
  refresh(paths?: readonly string[]): Promise<WorkspaceCodeReferenceSnapshot> {
    if (this.#closed) return Promise.resolve(this.#snapshot());
    if (!paths && (this.#watchFailure || this.#recovering))
      return this.#recover().then(() => this.#snapshot());
    return this.#collect(paths);
  }
  /**
   * 경로 없는 수집(최초·명시 refresh·감시 오류 복구)만 전체 탐색을 하고,
   * 경로가 있는 수집은 누적한 경로만 증분으로 반영한다.
   */
  #collect(paths?: readonly string[]): Promise<WorkspaceCodeReferenceSnapshot> {
    if (paths) for (const input of paths) this.#pending.add(input);
    else this.#fullPending = true;
    if (this.#operation) return this.#operation;
    this.#beginCheck();
    /** 수집 중 신호는 누적해 다음 pass로 처리하며 완료 전에 draining한다. */
    const reconcile = async (): Promise<WorkspaceCodeReferenceSnapshot> => {
      await this.#start();
      do {
        const full = this.#fullPending || !this.#state;
        this.#fullPending = false;
        const affected = [...this.#pending];
        this.#pending.clear();
        const epoch = this.#epoch;
        await this.options.beforeRead?.(paths);
        let state: CodeFileState;
        let policyChanged = true;
        if (full) {
          const cache = new Map(this.#disk);
          for (const input of affected) {
            const relative = codeFileRelativePath(this.projectRoot, input);
            if (relative)
              for (const key of cache.keys())
                if (key === relative || key.startsWith(relative + '/'))
                  cache.delete(key);
          }
          state = (await discoverCodeFiles(this.projectRoot, cache)).state;
          if (this.#closed) return this.#snapshot();
          if (epoch !== this.#epoch) {
            // 전체 탐색 중 신호가 도착했다면 중간 결과를 게시하지 않고 다시 읽는다.
            for (const input of affected) this.#pending.add(input);
            this.#fullPending = true;
            continue;
          }
        } else {
          const previous = this.#state!;
          state = await applyCodeSignals(previous, affected);
          if (this.#closed) return this.#snapshot();
          policyChanged = state.policy !== previous.policy;
        }
        state = await this.#syncWatch(state, policyChanged);
        if (this.#closed) return this.#snapshot();
        this.#apply(state);
        // collecting을 이미 알렸다면 마지막 pass의 최종 결과만 게시해 중간 결과로 다시 알리지 않는다.
        const following =
          this.#pending.size > 0 ||
          this.#fullPending ||
          this.#timer !== undefined;
        if (!this.#collectingShown) this.#commit();
        else if (!following) this.#endCheck();
        this.options.observe?.('code-index-published', {
          codeGeneration: this.#codeGeneration,
          files: this.#disk.size,
          affected,
        });
      } while ((this.#pending.size || this.#fullPending) && !this.#closed);
      return this.#snapshot();
    };
    const operation = reconcile().catch(
      /** IO 예외도 incomplete 상태로 종료한다. */ (error: unknown) => {
        this.#failures = [
          { reason: codeFileReasons.read, message: String(error) },
        ];
        this.#status = codeCollectionStatuses.incomplete;
        this.#commit();
        return this.#snapshot();
      },
    );
    this.#operation = operation;
    /** 후속 변경이 공유 작업 완료 경계에서 사라지지 않게 한다. */
    const clear = (): void => {
      if (this.#operation === operation) this.#operation = undefined;
      if ((this.#pending.size || this.#fullPending) && !this.#closed)
        this.#collect(this.#fullPending ? undefined : [...this.#pending]).catch(
          /** 감시 실패를 수집 상태로 게시한다. */ (error) =>
            this.#watchBroken(error),
        );
      else if (!this.#timer && !this.#pending.size) this.#endCheck();
    };
    operation
      .then(clear, clear)
      .catch(
        /** 감시 실패를 수집 상태로 게시한다. */ (error) =>
          this.#watchBroken(error),
      );
    return operation;
  }
  /**
   * 감시 규칙이 달라졌을 때만 새 감시를 시작해 ready가 된 뒤 이전 감시를 닫는다.
   * 재구성 뒤에는 규칙이 달라진 폴더만 다시 확인하며, 등록 실패는 감시 오류 복구로 넘긴다.
   */
  async #syncWatch(
    state: CodeFileState,
    policyChanged: boolean,
  ): Promise<CodeFileState> {
    if (
      !policyChanged ||
      !this.#watcher ||
      !this.#registered ||
      this.#recovering ||
      codeWatchRuleKey(state.policy) === this.#registered.rules
    )
      return state;
    const previous = this.#registered.policy;
    // 재구성 중에는 아직 반영하지 않은 새 정책의 신호를 이전 정책으로 버리지 않는다.
    this.#rebuilding = true;
    try {
      const failure = await this.#register(state.policy, true);
      if (this.#closed) return state;
      if (failure) {
        this.#watchBroken(failure.error);
        return state;
      }
      const changed = diffCodeWatchRules(previous, state.policy);
      return changed.length
        ? await recheckCodeDirectories(state, changed)
        : state;
    } finally {
      this.#rebuilding = false;
    }
  }
  /** 새 상태를 보유 관측·marker·buffer에 반영하며 바뀐 파일의 marker만 다시 추출한다. */
  #apply(state: CodeFileState): void {
    this.#state = state;
    for (const [key, file] of state.files)
      if (this.#disk.get(key) !== file)
        this.#markers.set(key, extractCodeReferences(file.text));
    for (const key of this.#markers.keys())
      if (!state.files.has(key)) this.#markers.delete(key);
    for (const [key, buffer] of this.#buffers)
      if (state.files.get(key)?.identity !== buffer.identity)
        this.#buffers.delete(key);
    this.#disk = new Map(state.files);
    this.#failures = codeFileFailures(state);
    this.#status = this.#watchFailure
      ? codeCollectionStatuses.incomplete
      : codeFileStatus(state);
  }
  /** 비동기 완료·버퍼·토큰을 무효화하고 연결을 종료한다. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#epoch++;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#collectingTimer) clearTimeout(this.#collectingTimer);
    this.#cancelRetry?.();
    this.#cancelRetry = undefined;
    this.#listeners.clear();
    this.#buffers.clear();
    this.#pendingBuffers.clear();
    this.#owners.clear();
    this.#selections.clear();
    // 진행 중인 수집과 감시 시작이 만든 프로세스·핸들이 끝난 뒤에만 종료를 완료한다.
    await Promise.allSettled([
      this.#operation,
      this.#starting,
      this.#recovering,
    ]);
    await this.#watcher?.close();
  }
}
