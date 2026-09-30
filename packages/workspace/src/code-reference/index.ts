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
  codeWatchRuleKey,
  computeCodeFilePolicy,
  discoverCodeFiles,
  hasTrackedDescendant,
  isCodeFileIgnored,
  isCodeWatchIgnored,
  readEligibleCodeFile,
  codeFileRelativePath,
  type CodeCollectionFailure,
  type CodeFileDiscovery,
  type CodeFileObservation,
  type CodeFilePolicy,
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
  status: (typeof codeCollectionStatuses)[keyof typeof codeCollectionStatuses];
  codeGeneration: number;
  documentGeneration: number;
  occurrences: readonly WorkspaceCodeReferenceOccurrence[];
  confirmedCount: number;
  failures: readonly CodeCollectionFailure[];
}
/** 완료 상태에서만 유일성·부재를 확정한다. */
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
  targetRevision: string;
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
}
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
/** 한 번의 수집 중 규칙 변화로 감시를 다시 구성하는 최대 횟수다. */
const maximumWatchRebuilds = 3;
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
  #discovery: CodeFileDiscovery | undefined;
  #disk = new Map<string, CodeFileObservation>();
  #markers = new Map<string, readonly CodeReferenceMarker[]>();
  #buffers = new Map<string, BufferObservation>();
  #owners = new Map<string, number>();
  #pendingBuffers = new Map<string, WorkspaceCodeBufferInput>();
  #selections = new Map<string, Selection>();
  #listeners = new Set<(snapshot: WorkspaceCodeReferenceSnapshot) => void>();
  #watcher: CodeWatchConnection | undefined;
  #registeredRules: string | undefined;
  #recovering: Promise<void> | undefined;
  #cancelRetry: (() => void) | undefined;
  #failedAttempts = 0;
  #brokenAgain = false;
  #watchFailure: CodeCollectionFailure | undefined;
  #status: WorkspaceCodeReferenceSnapshot['status'] =
    codeCollectionStatuses.collecting;
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
  ) {}
  /** 저장 document snapshot만 교체하고 원문 코드 관측을 재사용한다. */
  setCatalog(catalog: Catalog | undefined, documentGeneration: number): void {
    if (this.#closed) return;
    this.#catalog = catalog;
    this.#documentGeneration = documentGeneration;
    this.#publish();
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
    await this.snapshot();
    if (
      this.#closed ||
      this.#pendingBuffers.get(relative) !== pending ||
      this.#owners.get(relative) !== input.documentVersion ||
      !this.#discovery
    )
      return false;
    const observed = await readEligibleCodeFile(
      this.#discovery.policy,
      relative,
    );
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
    this.#codeGeneration++;
    this.#publish();
    return true;
  }
  /** 편집 출처·소유권·토큰을 해제하고 저장 원문을 다시 확인한다. */
  async closeBuffer(sourcePath: string): Promise<void> {
    const relative = codeFileRelativePath(this.projectRoot, sourcePath);
    if (!relative) return;
    this.#owners.delete(relative);
    this.#pendingBuffers.delete(relative);
    this.#buffers.delete(relative);
    for (const [token, selection] of this.#selections)
      if (
        selection.ownerPath === relative ||
        selection.occurrence.sourcePath === relative
      )
        this.#selections.delete(token);
    this.#codeGeneration++;
    if (this.#discovery) await this.refresh([relative]);
    else this.#publish();
  }
  /** 현재 저장 또는 IDE 관측을 요청하며 완료 후 조회에서는 파일 IO를 하지 않는다. */
  async snapshot(): Promise<WorkspaceCodeReferenceSnapshot> {
    if (!this.#discovery && !this.#closed) await this.refresh();
    return this.#snapshot();
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
      status: this.#status,
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
    const complete =
      snapshot.status === codeCollectionStatuses.complete &&
      this.#catalog?.status === scanStatuses.complete;
    return {
      ...snapshot,
      occurrences,
      confirmedCount: occurrences.length,
      unique: complete && occurrences.length === 1,
      absent: complete && occurrences.length === 0,
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
    const snapshot = await this.snapshot();
    const occurrence = snapshot.occurrences.find(
      (item) =>
        item.occurrenceId === input.occurrenceId &&
        item.status === codeReferenceStatuses.resolved,
    );
    if (!occurrence?.target || !this.#discovery) return undefined;
    const target = await readEligibleCodeFile(
      {
        ...this.#discovery.policy,
        tracked: new Set([
          codeFileRelativePath(this.projectRoot, occurrence.target.path)!,
        ]),
      },
      occurrence.target.path,
    );
    if (
      !target ||
      !('text' in target) ||
      target.revision !==
        calculateRevision(
          Buffer.from(
            this.#catalog?.documents.get(occurrence.target.path)?.observation
              .parsed.source ?? '',
            'utf8',
          ),
        ) ||
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
      targetRevision: target.revision,
    });
    return token;
  }
  /**
   * 세대 변화만으로 거부하지 않고 최신 완료 관측에서 source·version·marker·target·file identity를
   * 다시 확인한다. 진행 중 수집은 기다리고, 확인 중 관측이 교체되면 최대 3회·2초 안에서 재확인한다.
   */
  async confirm(
    token: string,
    owner: { sourcePath: string; documentVersion: number },
  ): Promise<WorkspaceCodeReferenceOccurrence | undefined> {
    if (this.#closed || !this.#selections.has(token)) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    /** 일시 관측 교체만 최신 완료 관측으로 제한해 재확인한다. */
    const retry = async (): Promise<
      WorkspaceCodeReferenceOccurrence | undefined
    > => {
      for (
        let attempt = 0;
        attempt < 3 && !controller.signal.aborted;
        attempt++
      ) {
        const result = await this.#confirmOnce(token, owner, controller.signal);
        if (result !== false) return result;
      }
      return undefined;
    };
    try {
      return await Promise.race([
        retry(),
        new Promise<undefined>(
          /** 시간 제한은 공유 수집을 취소하지 않고 클릭만 끝낸다. */ (
            resolve,
          ) => {
            controller.signal.addEventListener(
              'abort',
              () => resolve(undefined),
              { once: true },
            );
          },
        ),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  /** 진행 중이거나 예약된 수집이 끝나 최신 완료 관측이 될 때까지 기다린다. */
  async #settled(signal: AbortSignal): Promise<void> {
    while (
      !this.#closed &&
      !signal.aborted &&
      (this.#operation || this.#timer || this.#pending.size)
    ) {
      if (this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
      await this.refresh([...this.#pending]);
    }
  }
  /** false는 관측 교체, undefined는 무효 선택이다. 무효 선택은 재시도하지 않는다. */
  async #confirmOnce(
    token: string,
    owner: { sourcePath: string; documentVersion: number },
    signal: AbortSignal,
  ): Promise<WorkspaceCodeReferenceOccurrence | undefined | false> {
    await this.#settled(signal);
    const selection = this.#selections.get(token);
    if (
      !selection ||
      !this.#discovery ||
      this.#closed ||
      signal.aborted ||
      codeFileRelativePath(this.projectRoot, owner.sourcePath) !==
        selection.ownerPath ||
      owner.documentVersion !== selection.ownerVersion ||
      this.#owners.get(selection.ownerPath) !== selection.ownerVersion
    )
      return undefined;
    const epoch = this.#epoch;
    /** 확인 중 수집이 시작되었거나 예약되었다면 재시도, 아니면 무효 선택이다. */
    const fail = (): undefined | false =>
      !this.#closed &&
      (epoch !== this.#epoch ||
        this.#operation ||
        this.#timer ||
        this.#pending.size)
        ? false
        : undefined;
    const source = await readEligibleCodeFile(
      this.#discovery.policy,
      selection.occurrence.sourcePath,
    );
    if (
      !source ||
      !('text' in source) ||
      source.identity !== selection.occurrence.sourceIdentity
    )
      return fail();
    const targetPath = selection.occurrence.target!.path;
    const target = await readEligibleCodeFile(
      {
        ...this.#discovery.policy,
        tracked: new Set([codeFileRelativePath(this.projectRoot, targetPath)!]),
      },
      targetPath,
    );
    if (
      !target ||
      !('text' in target) ||
      target.identity !== selection.targetIdentity ||
      target.revision !== selection.targetRevision
    )
      return fail();
    const buffer = this.#buffers.get(source.path);
    const text = buffer?.text ?? source.text;
    if (
      (buffer?.revision ?? source.revision) !==
        selection.occurrence.sourceRevision ||
      buffer?.documentVersion !== selection.occurrence.documentVersion
    )
      return fail();
    const marker = extractCodeReferences(text).find(
      /** 캡처한 정확한 위치와 표기의 연속성을 확인한다. */ (item) =>
        item.offsetRange.start ===
          selection.occurrence.marker.offsetRange.start &&
        item.offsetRange.end === selection.occurrence.marker.offsetRange.end &&
        item.text === selection.occurrence.marker.text,
    );
    if (!marker || !this.#catalog) return fail();
    const current = resolveCodeReference(this.#catalog, marker);
    if (
      current.status !== codeReferenceStatuses.resolved ||
      current.target?.path !== targetPath
    )
      return fail();
    if (
      this.#closed ||
      signal.aborted ||
      this.#selections.get(token) !== selection ||
      this.#owners.get(selection.ownerPath) !== selection.ownerVersion
    )
      return undefined;
    if (
      epoch !== this.#epoch ||
      this.#operation ||
      this.#timer ||
      this.#pending.size
    )
      return false;
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
  /** 코드 generation과 문서 generation을 분리한 현재 상태를 게시한다. */
  #publish(): void {
    const snapshot = this.#snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch (error: unknown) {
        console.error('Code snapshot listener failed', error);
      }
    }
  }
  /** 변경 경로의 cached bytes만 버리고 Git·ignore 변경은 적격 집합을 재확인한다. */
  #changed(paths: readonly string[]): void {
    if (this.#closed) return;
    const affected = paths.filter(
      /** 제외 코드의 신호가 원문 재수집을 반복하지 않게 한다. */ (input) => {
        const relative = codeFileRelativePath(this.projectRoot, input);
        if (
          !relative ||
          !this.#discovery ||
          path.basename(input) === '.gitignore'
        )
          return true;
        return (
          !isCodeFileIgnored(this.#discovery.policy, relative) ||
          hasTrackedDescendant(this.#discovery.policy, relative)
        );
      },
    );
    if (!affected.length) return;
    this.#epoch++;
    this.#codeGeneration++;
    for (const input of affected) this.#pending.add(input);
    this.#status = codeCollectionStatuses.collecting;
    this.#publish();
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
    const first =
      !this.#watchFailure || this.#status !== codeCollectionStatuses.incomplete;
    this.#watchFailure = {
      reason: codeFileReasons.watch,
      message: String(error),
    };
    this.#status = codeCollectionStatuses.incomplete;
    if (first) this.#publish();
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
   * 등록 중 도착한 오류는 등록 실패로 반환하며 이전 연결은 새 연결이 대체한다.
   */
  async #register(
    known?: CodeFilePolicy,
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
    const watcher: CodeWatchConnection = (
      this.options.createWatcher ?? createChokidarWatcher
    )(
      this.projectRoot,
      /** 등록 중 신호도 버리지 않고 병합한다. */ (paths) =>
        this.#changed(paths),
      /** 현재 연결의 오류만 등록 실패 또는 연결 손상으로 다룬다. */ (
        error,
      ) => {
        if (this.#closed || watcher !== this.#watcher) return;
        if (registering) failure ??= { error };
        else this.#watchBroken(error);
      },
      /** 수집과 같은 정책으로 감시 제외를 판단한다. */ (input, stats) =>
        isCodeWatchIgnored(policy, input, stats),
    );
    const replaced = this.#watcher;
    this.#watcher = watcher;
    this.#registeredRules = codeWatchRuleKey(policy);
    await replaced?.close();
    try {
      await watcher.start();
    } catch (error: unknown) {
      failure ??= { error };
    }
    registering = false;
    if (failure && watcher === this.#watcher) {
      this.#watcher = undefined;
      this.#registeredRules = undefined;
      await watcher.close();
    }
    return failure;
  }
  /** 기존 연결을 종료하고 다시 등록한다. */
  async #reregister(
    known?: CodeFilePolicy,
  ): Promise<WatchRegistrationFailure | undefined> {
    const previous = this.#watcher;
    this.#watcher = undefined;
    this.#registeredRules = undefined;
    await previous?.close();
    if (this.#closed) return undefined;
    return this.#register(known);
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
  /** Full reconciliation은 메타데이터가 같은 cached 원문을 다시 읽지 않는다. */
  #collect(paths?: readonly string[]): Promise<WorkspaceCodeReferenceSnapshot> {
    if (paths) for (const input of paths) this.#pending.add(input);
    if (this.#operation) return this.#operation;
    this.#status = codeCollectionStatuses.collecting;
    this.#codeGeneration++;
    /** 수집 중 신호는 새 pass로 처리하며 완료 전에 draining한다. */
    const reconcile = async (): Promise<WorkspaceCodeReferenceSnapshot> => {
      await this.#start();
      let rebuilds = 0;
      let rerun: boolean;
      do {
        rerun = false;
        const affected = [...this.#pending];
        this.#pending.clear();
        const epoch = this.#epoch;
        const cache = new Map(this.#disk);
        for (const input of affected) {
          const relative = codeFileRelativePath(this.projectRoot, input);
          if (relative)
            for (const key of cache.keys())
              if (key === relative || key.startsWith(relative + '/'))
                cache.delete(key);
        }
        await this.options.beforeRead?.(paths);
        const discovery = await discoverCodeFiles(this.projectRoot, cache);
        if (this.#closed) return this.#snapshot();
        if (epoch !== this.#epoch) continue;
        const rules = codeWatchRuleKey(discovery.policy);
        if (
          this.#watcher &&
          this.#registeredRules !== undefined &&
          this.#registeredRules !== rules &&
          rebuilds < maximumWatchRebuilds
        ) {
          // 감시 규칙이 달라졌다면 새 정책으로 전체 감시를 다시 구성하고 재확인한다.
          rebuilds++;
          const failure = await this.#reregister(discovery.policy);
          if (failure) this.#watchBroken(failure.error);
          rerun = true;
          continue;
        }
        this.#discovery = discovery;
        const disk = new Map(discovery.files.map((file) => [file.path, file]));
        for (const file of discovery.files)
          if (this.#disk.get(file.path) !== file)
            this.#markers.set(file.path, extractCodeReferences(file.text));
        for (const key of this.#markers.keys())
          if (!disk.has(key)) this.#markers.delete(key);
        for (const [key, buffer] of this.#buffers)
          if (disk.get(key)?.identity !== buffer.identity)
            this.#buffers.delete(key);
        this.#disk = disk;
        this.#failures = discovery.failures;
        this.#status = this.#watchFailure
          ? codeCollectionStatuses.incomplete
          : discovery.status;
        this.#codeGeneration++;
        this.options.observe?.('code-index-published', {
          codeGeneration: this.#codeGeneration,
          files: disk.size,
          affected,
        });
        this.#publish();
      } while ((rerun || this.#pending.size) && !this.#closed);
      return this.#snapshot();
    };
    const operation = reconcile().catch(
      /** IO 예외도 incomplete 상태로 종료한다. */ (error: unknown) => {
        this.#failures = [
          { reason: codeFileReasons.read, message: String(error) },
        ];
        this.#status = codeCollectionStatuses.incomplete;
        this.#publish();
        return this.#snapshot();
      },
    );
    this.#operation = operation;
    /** 후속 변경이 공유 작업 완료 경계에서 사라지지 않게 한다. */
    const clear = (): void => {
      if (this.#operation === operation) this.#operation = undefined;
      if (this.#pending.size && !this.#closed)
        this.refresh([...this.#pending]).catch(
          /** 감시 실패를 수집 상태로 게시한다. */ (error) =>
            this.#watchBroken(error),
        );
    };
    operation
      .then(clear, clear)
      .catch(
        /** 감시 실패를 수집 상태로 게시한다. */ (error) =>
          this.#watchBroken(error),
      );
    return operation;
  }
  /** 비동기 완료·버퍼·토큰을 무효화하고 연결을 종료한다. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#epoch++;
    if (this.#timer) clearTimeout(this.#timer);
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
