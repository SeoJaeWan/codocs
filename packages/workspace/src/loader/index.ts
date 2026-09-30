import {
  catalogFailureKinds,
  diagnosticSeverities,
  parseYaml,
  scanStatuses,
  validateDocument,
  type Document,
  type ScanStatus,
  type SchemaDiagnostic,
  type YamlDiagnostic,
  type YamlParseResult,
} from '@codocs/core';
import { constants } from 'node:fs';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createWorkspaceDiagnostic,
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
  type WorkspaceDiagnostic,
} from '../diagnostics/index.js';
import {
  workspacePathFailureStatuses,
  workspaceTargetKinds,
} from '../paths/domain-values.js';
import {
  resolveWorkspacePath,
  type WorkspaceAccessPolicy,
  type WorkspaceAccessScope,
  type WorkspacePathResult,
  type WorkspaceTargetKind,
} from '../paths/index.js';
import {
  codocsDirectoryName,
  resolveProjectRoot,
  type ProjectRoot,
} from '../project-root/index.js';

import { decodeWorkspaceBytes } from '../revision/index.js';
import { workspaceDocumentStatuses } from './domain-values.js';
export * from './domain-values.js';
export * from './observations.js';
import {
  WorkspaceObservationCache,
  type WorkspaceDocumentObservation,
} from './observations.js';

/** 파일이 많은 폴더에서도 파일 시스템 요청을 직렬화하지 않되 과도한 동시 요청은 피한다. */
const directoryEntryBatchSize = 64;

/** 읽은 문서의 발견 경로와 확인한 실제 파일이다. 경로 표기는 임의 변환하지 않는다. */
export interface WorkspaceDocumentSource {
  path: string;
  logicalPath: string;
  realPath: string;
}

/** 문서 내용의 파싱·검증 진단이다. 각각의 실제 좌표와 필드 경로 타입을 유지한다. */
export type WorkspaceDocumentDiagnostic = YamlDiagnostic | SchemaDiagnostic;

/** 문서 내용과 탐색 IO 진단을 코드로 좁혀 소비할 수 있는 공개 진단 타입이다. */
export type WorkspaceScanDiagnostic =
  WorkspaceDocumentDiagnostic | WorkspaceDiagnostic;

/** 실제로 읽은 UTF-8 원문과 현 시점 연결 범위다. 원문은 재포맷하지 않는다. */
interface ReadDocument {
  source: WorkspaceDocumentSource;
  raw: string;
  revision: string;
  utf8Lossless: boolean;
  scope: WorkspaceAccessScope;
  access: WorkspaceAccessPolicy;
  diagnostics: readonly WorkspaceDocumentDiagnostic[];
}

/** 오류 문서에는 검증 성공 데이터를 제공하지 않는다. 경고만 있는 문서는 유효하다. */
export type WorkspaceDocumentResult = ReadDocument &
  (
    | {
        status: typeof workspaceDocumentStatuses.valid;
        data: Document;
        parsed: Extract<YamlParseResult, { success: true }>;
      }
    | {
        status: typeof workspaceDocumentStatuses.parseError;
        diagnostics: readonly YamlDiagnostic[];
      }
    | {
        status: typeof workspaceDocumentStatuses.validationError;
        parsed: Extract<YamlParseResult, { success: true }>;
      }
  );

/** 확인하지 못한 파일·폴더 범위다. 얻지 못한 원문·실경로·ID·좌표는 없다. */
export interface WorkspaceScanFailure {
  kind: WorkspaceTargetKind | typeof catalogFailureKinds.unknown;
  path?: string;
  logicalPath?: string;
  realPath?: string;
  diagnostics: readonly WorkspaceDiagnostic[];
}

/** 읽은 문서와 확인하지 못한 범위를 분리하여 후속 색인의 삭제 오판을 방지한다. */
interface WorkspaceScanResults {
  documents: readonly WorkspaceDocumentResult[];
  failures: readonly WorkspaceScanFailure[];
  skippedLinks: readonly WorkspaceDiagnostic[];
  diagnostics: readonly WorkspaceScanDiagnostic[];
}

/** 탐색 완료 여부는 문서 유효성과 별개다. failed에서만 유효한 루트가 없을 수 있다. */
export type WorkspaceScanResult = WorkspaceScanResults &
  (
    | {
        status: Exclude<ScanStatus, typeof scanStatuses.failed>;
        root: ProjectRoot;
      }
    | {
        status: typeof scanStatuses.failed;
        root?: ProjectRoot;
        projectRoot?: string;
      }
  );

/** 실제 대상을 확인한 성공 경로다. FS 내부 타입을 공개 반환값에 넣지 않는다. */
type ResolvedPath = Extract<WorkspacePathResult, { success: true }>;

/** 확인한 파일 원문을 core 공개 파서·검증기에 그대로 전달한다. */
function parseDocument(
  target: ResolvedPath,
  bytes: Uint8Array,
): WorkspaceDocumentResult {
  const { raw, revision, utf8Lossless } = decodeWorkspaceBytes(bytes);
  const source: WorkspaceDocumentSource = {
    path: target.path,
    logicalPath: target.logicalPath,
    realPath: target.realPath,
  };
  const base = {
    source,
    raw,
    revision,
    utf8Lossless,
    scope: target.scope,
    access: target.access,
  };
  const parsed = parseYaml(raw);
  if (!parsed.success)
    return {
      ...base,
      status: workspaceDocumentStatuses.parseError,
      diagnostics: parsed.diagnostics.map(
        /** core의 실제 좌표·코드를 유지하고 확인한 프로젝트 상대 경로만 추가한다. */
        (diagnostic) => ({ ...diagnostic, path: target.path }),
      ),
    };
  const validation = validateDocument({
    data: parsed.data,
    source: raw,
    path: target.path,
    fields: parsed.fields,
    ...(parsed.rootRange === undefined ? {} : { rootRange: parsed.rootRange }),
  });
  const diagnostics = [...validation.errors, ...validation.warnings];
  return validation.success
    ? {
        ...base,
        status: workspaceDocumentStatuses.valid,
        data: validation.data,
        parsed,
        diagnostics,
      }
    : {
        ...base,
        status: workspaceDocumentStatuses.validationError,
        parsed,
        diagnostics,
      };
}

/** 경로 확인 실패에서 얻은 값만 실패 범위로 보존한다. */
function pathFailure(
  result: Extract<WorkspacePathResult, { success: false }>,
): WorkspaceScanFailure {
  return {
    kind: catalogFailureKinds.unknown,
    ...(result.path === undefined ? {} : { path: result.path }),
    ...(result.logicalPath === undefined
      ? {}
      : { logicalPath: result.logicalPath }),
    diagnostics: result.diagnostics,
  };
}

/**
 * 실제 읽기·열거 실패에서 이미 확인한 경로와 시스템 오류 코드만 보존한다.
 * @codocs [[작업 공간:불완전한 탐색]]#L11-L13
 */
function readFailure(
  target: ResolvedPath,
  error: unknown,
): WorkspaceScanFailure {
  return {
    kind: target.kind,
    path: target.path,
    logicalPath: target.logicalPath,
    realPath: target.realPath,
    diagnostics: [
      createWorkspaceDiagnostic(
        workspaceDiagnosticCodes.readFailed,
        workspaceDiagnosticMessages.readFailed,
        target.path,
        error,
      ),
    ],
  };
}

/** 전체 탐색 또는 경로 보정 사이에서 공유할 관측이다. */
export interface WorkspaceLoadOptions {
  cache?: WorkspaceObservationCache;
}

/** 직접 확인한 부재다. 미지원 연결·읽기 오류와 구분하며 전체 삭제 판정은 수행하지 않는다. */
export interface WorkspacePathAbsence {
  path: string;
  logicalPath: string;
}

/** 경로별 결과는 status가 없어 전체 WorkspaceScanResult로 사용할 수 없다. */
export interface WorkspacePathScanResult extends WorkspaceScanResults {
  root: ProjectRoot;
  coverage: { path?: string; logicalPath?: string };
  generation: number;
  outcome: ScanStatus;
  absent: readonly WorkspacePathAbsence[];
  observations: readonly WorkspaceDocumentObservation[];
}

/** 기존 전체 탐색 계약에 읽기 세대를 추가한다. */
export type WorkspaceLoadResult = WorkspaceScanResult & {
  observations: readonly WorkspaceDocumentObservation[];
};

/**
 * 선택한 루트의 .codocs 아래 yaml/yml을 발견 경로마다 읽고 core로 파싱·검증한다.
 * .codocs 부재는 complete 0개, 루트 접근 실패는 failed, 하위 IO 실패는 partial이다.
 * 읽은 내용 오류와 미지원 하위 연결은 누락 실패가 아니다. 상위 프로젝트는 탐색하지 않는다.
 * 캐시는 감시 신호로 무효화된 초기화 작업 안에서만 공유한다.
 * 수동 전체 refresh는 새 캐시를 사용하거나 .codocs 전체를 먼저 무효화한다.
 * @codocs [[작업 공간:문서 탐색]]
 * @codocs [[작업 공간:탐색 상태]]#L10-L15
 */
export async function loadWorkspace(
  input: unknown = {},
  options: WorkspaceLoadOptions = {},
): Promise<WorkspaceLoadResult> {
  const selected = await resolveProjectRoot(input);
  if (!selected.success)
    return {
      documents: [],
      skippedLinks: [],
      observations: [],
      failures: [
        {
          kind: workspaceTargetKinds.directory,
          ...(selected.projectRoot === undefined
            ? {}
            : { logicalPath: selected.projectRoot }),
          diagnostics: selected.diagnostics,
        },
      ],
      diagnostics: selected.diagnostics,
      status: scanStatuses.failed,
      ...(selected.projectRoot === undefined
        ? {}
        : { projectRoot: selected.projectRoot }),
    };
  const result = await scanPath(selected.root, codocsDirectoryName, options);
  return {
    root: selected.root,
    status: result.outcome,
    documents: result.documents,
    failures: result.failures,
    skippedLinks: result.skippedLinks,
    diagnostics: result.diagnostics,
    observations: result.observations,
  };
}

/**
 * 같은 프로젝트의 발견 경로만 재확인한다. 외부 이벤트 실경로는 직접 입력할 수 없다.
 * @codocs [[작업 공간:문서 탐색]]#L24-L27
 * @codocs [[작업 공간:파일 접근 범위]]#L21-L22
 */
export function loadWorkspacePath(
  root: ProjectRoot,
  input: unknown,
  options: WorkspaceLoadOptions = {},
): Promise<WorkspacePathScanResult> {
  return scanPath(root, input, options);
}

/** 파일 또는 하위 트리의 확인 범위를 명시하여 전체 순회와 같은 IO 규칙으로 탐색한다. */
async function scanPath(
  root: ProjectRoot,
  input: unknown,
  options: WorkspaceLoadOptions,
): Promise<WorkspacePathScanResult> {
  const documents: WorkspaceDocumentResult[] = [];
  const observations: WorkspaceDocumentObservation[] = [];
  const failures: WorkspaceScanFailure[] = [];
  const skippedLinks: WorkspaceDiagnostic[] = [];
  const diagnostics: WorkspaceScanDiagnostic[] = [];
  const absent: WorkspacePathAbsence[] = [];
  const cache = options.cache ?? new WorkspaceObservationCache();
  const generation = cache.version;
  const results = {
    documents,
    observations,
    failures,
    skippedLinks,
    diagnostics,
    absent,
  };
  const initial = await resolveWorkspacePath(root, input);
  const coverage = {
    ...(initial.path === undefined ? {} : { path: initial.path }),
    ...(initial.logicalPath === undefined
      ? {}
      : { logicalPath: initial.logicalPath }),
  };
  if (!initial.success) {
    if (
      initial.status === workspacePathFailureStatuses.missing &&
      initial.path !== undefined &&
      initial.logicalPath !== undefined
    ) {
      absent.push({ path: initial.path, logicalPath: initial.logicalPath });
      return {
        ...results,
        root,
        coverage,
        generation,
        outcome: scanStatuses.complete,
      };
    }
    failures.push(pathFailure(initial));
    diagnostics.push(...initial.diagnostics);
    return {
      ...results,
      root,
      coverage,
      generation,
      outcome: scanStatuses.failed,
    };
  }
  /** 발견된 자식의 연결은 경고로 건너뛰고 다른 접근 실패는 범위 실패로 남긴다. */
  function recordDiscoveredFailure(
    child: Extract<WorkspacePathResult, { success: false }>,
  ): void {
    if (
      child.status === workspacePathFailureStatuses.missing &&
      child.path !== undefined &&
      child.logicalPath !== undefined
    ) {
      absent.push({ path: child.path, logicalPath: child.logicalPath });
      return;
    }
    if (
      child.diagnostics.some(
        (item) =>
          item.code === workspaceDiagnosticCodes.unsupportedWorkspaceLink,
      )
    ) {
      const warnings = child.diagnostics.map((item) => ({
        ...item,
        severity: diagnosticSeverities.warning,
      }));
      skippedLinks.push(...warnings);
      diagnostics.push(...warnings);
      return;
    }
    failures.push(pathFailure(child));
    diagnostics.push(...child.diagnostics);
  }
  /** 일반 폴더와 YAML 파일만 방문하며 발견한 연결은 경고 후 제외한다. */
  async function visit(
    target: ResolvedPath,
    discovered = false,
  ): Promise<void> {
    // 디렉터리 열기와 문서 읽기 전에 탐색 당시의 경로 성분을 다시 확인한다.
    const checked = await resolveWorkspacePath(root, target.logicalPath);
    if (!checked.success) {
      if (discovered) recordDiscoveredFailure(checked);
      else {
        failures.push(pathFailure(checked));
        diagnostics.push(...checked.diagnostics);
      }
      return;
    }
    target = checked;
    if (target.kind === workspaceTargetKinds.directory) {
      let entries: string[];
      try {
        await access(target.logicalPath, constants.X_OK);
        entries = await readdir(target.logicalPath);
      } catch (error: unknown) {
        const failure = readFailure(target, error);
        failures.push(failure);
        diagnostics.push(...failure.diagnostics);
        return;
      }
      entries.sort();
      for (
        let offset = 0;
        offset < entries.length;
        offset += directoryEntryBatchSize
      ) {
        const children = await Promise.all(
          entries
            .slice(offset, offset + directoryEntryBatchSize)
            .map((entry) =>
              resolveWorkspacePath(root, path.join(target.logicalPath, entry)),
            ),
        );
        const files: ResolvedPath[] = [];
        for (const child of children) {
          if (!child.success) {
            recordDiscoveredFailure(child);
            continue;
          }
          if (child.kind === workspaceTargetKinds.directory)
            await visit(child, true);
          else files.push(child);
        }
        await Promise.all(files.map((child) => visit(child, true)));
      }
      return;
    }
    if (
      target.kind !== workspaceTargetKinds.file ||
      !/\.ya?ml$/u.test(target.logicalPath)
    )
      return;
    let observation: WorkspaceDocumentObservation;
    let invalidated:
      Extract<WorkspacePathResult, { success: false }> | undefined;
    try {
      await access(target.logicalPath, constants.R_OK);
      observation = await cache.observe(
        target.logicalPath,
        target.realPath,
        /** 실제 읽기 직전 파일 경로가 일반 항목인지 다시 확인한다. */
        async () => {
          const current = await resolveWorkspacePath(root, target.logicalPath);
          if (!current.success) {
            invalidated = current;
            throw new Error('Workspace path changed before read');
          }
          if (current.kind !== workspaceTargetKinds.file)
            throw new Error('Workspace file changed before read');
          return parseDocument(current, await readFile(current.logicalPath));
        },
      );
    } catch (error: unknown) {
      if (invalidated) {
        if (discovered) recordDiscoveredFailure(invalidated);
        else {
          failures.push(pathFailure(invalidated));
          diagnostics.push(...invalidated.diagnostics);
        }
        return;
      }
      const failure = readFailure(target, error);
      failures.push(failure);
      diagnostics.push(...failure.diagnostics);
      return;
    }
    const document = observation.document;
    observations.push(observation);
    documents.push(document);
    diagnostics.push(...document.diagnostics);
  }

  await visit(initial);
  documents.sort((left, right) =>
    left.source.path.localeCompare(right.source.path),
  );
  observations.sort((left, right) =>
    left.document.source.path.localeCompare(right.document.source.path),
  );
  const rootReadFailed = failures.some(
    /** 스캔 시작 폴더 자체의 실패는 하위 누락과 다르게 전체 실패다. */
    (failure) => failure.logicalPath === initial.logicalPath,
  );
  return {
    ...results,
    root,
    coverage,
    generation,
    outcome: rootReadFailed
      ? scanStatuses.failed
      : failures.length > 0
        ? scanStatuses.partial
        : scanStatuses.complete,
  };
}
