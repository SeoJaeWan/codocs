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

/** 디렉터리 항목의 작업공간 경로 해석 결과를 반환한다. */
function resolveDirectoryEntry(
  root: ProjectRoot,
  directoryPath: string,
  entry: string,
): Promise<WorkspacePathResult> {
  return resolveWorkspacePath(root, path.join(directoryPath, entry));
}
import { decodeWorkspaceBytes } from '../revision/index.js';
import { workspaceDocumentStatuses } from './domain-values.js';
export * from './domain-values.js';

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

/** 현재 가지의 조상 실제 폴더로 돌아오므로 의도적으로 건너뛴 연결이다. */
export interface WorkspaceSkippedCycle {
  path: string;
  logicalPath: string;
  realPath: string;
  diagnostics: readonly WorkspaceDiagnostic[];
}

/** 읽은 문서와 확인하지 못한 범위를 분리하여 후속 색인의 삭제 오판을 방지한다. */
interface WorkspaceScanResults {
  documents: readonly WorkspaceDocumentResult[];
  failures: readonly WorkspaceScanFailure[];
  skippedCycles: readonly WorkspaceSkippedCycle[];
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

/** 실제 읽기·열거 실패에서 이미 확인한 경로와 시스템 오류 코드만 보존한다. */
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

/**
 * 선택한 루트의 .codocs 아래 yaml/yml을 논리 경로마다 읽고 core로 파싱·검증한다.
 * 옵션은 resolveProjectRoot와 같다. 상위 프로젝트를 탐색하지 않는다.
 * .codocs 부재는 complete 0개, 루트·.codocs 접근 실패는 failed, 하위 IO 실패는 partial이다.
 * 읽은 내용 오류는 탐색 누락이 아니다. 순환 연결은 별도로 기록하고 다른 가지는 계속 탐색한다.
 * 접근 정책은 현 시점 연결 범위이며 실제 저장·watcher·색인·잠금은 수행하지 않는다.
 */
export async function loadWorkspace(
  input: unknown = {},
): Promise<WorkspaceScanResult> {
  const documents: WorkspaceDocumentResult[] = [];
  const failures: WorkspaceScanFailure[] = [];
  const skippedCycles: WorkspaceSkippedCycle[] = [];
  const diagnostics: WorkspaceScanDiagnostic[] = [];
  const results = { documents, failures, skippedCycles, diagnostics };
  const selected = await resolveProjectRoot(input);
  if (!selected.success) {
    diagnostics.push(...selected.diagnostics);
    failures.push({
      kind: workspaceTargetKinds.directory,
      ...(selected.projectRoot === undefined
        ? {}
        : { logicalPath: selected.projectRoot }),
      diagnostics: selected.diagnostics,
    });
    return {
      ...results,
      status: scanStatuses.failed,
      ...(selected.projectRoot === undefined
        ? {}
        : { projectRoot: selected.projectRoot }),
    };
  }
  const root = selected.root;
  const initial = await resolveWorkspacePath(root, codocsDirectoryName);
  if (!initial.success) {
    if (initial.status === workspacePathFailureStatuses.missing)
      return { ...results, status: scanStatuses.complete, root };
    failures.push(pathFailure(initial));
    diagnostics.push(...initial.diagnostics);
    return { ...results, status: scanStatuses.failed, root };
  }
  // 전역 방문 집합이 아니라 현재 탐색 가지의 실제 폴더만 유지한다.
  const ancestors: ResolvedPath[] = [];

  /** 폴더 진입 시 조상을 추가하고 돌아올 때 반드시 제거한다. */
  async function visit(target: ResolvedPath): Promise<void> {
    if (target.kind === workspaceTargetKinds.directory) {
      if (
        ancestors.some(
          /** 실제 경로 또는 확인한 0이 아닌 현재 폴더 식별 정보로만 같은 조상임을 판정한다. */
          (ancestor) =>
            ancestor.realPath === target.realPath ||
            (ancestor.directoryIdentity !== undefined &&
              target.directoryIdentity !== undefined &&
              ancestor.directoryIdentity.device > 0n &&
              ancestor.directoryIdentity.inode > 0n &&
              target.directoryIdentity.device > 0n &&
              target.directoryIdentity.inode > 0n &&
              ancestor.directoryIdentity.device ===
                target.directoryIdentity.device &&
              ancestor.directoryIdentity.inode ===
                target.directoryIdentity.inode),
        )
      ) {
        const diagnostic: WorkspaceDiagnostic = {
          ...createWorkspaceDiagnostic(
            workspaceDiagnosticCodes.circularDirectoryLink,
            workspaceDiagnosticMessages.circularDirectoryLink,
            target.path,
          ),
          severity: diagnosticSeverities.warning,
        };
        skippedCycles.push({
          path: target.path,
          logicalPath: target.logicalPath,
          realPath: target.realPath,
          diagnostics: [diagnostic],
        });
        diagnostics.push(diagnostic);
        return;
      }
      ancestors.push(target);
      try {
        let entries: string[];
        try {
          // 열거 자체가 읽기 권한을 확인하고 별도로 폴더 탐색 권한도 확인한다.
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
                resolveDirectoryEntry(root, target.logicalPath, entry),
              ),
          );
          const files: ResolvedPath[] = [];
          for (const child of children) {
            if (!child.success) {
              failures.push(pathFailure(child));
              diagnostics.push(...child.diagnostics);
              continue;
            }
            if (child.kind === workspaceTargetKinds.directory)
              await visit(child);
            else files.push(child);
          }
          await Promise.all(files.map((child) => visit(child)));
        }
      } finally {
        ancestors.pop();
      }
      return;
    }
    if (
      target.kind !== workspaceTargetKinds.file ||
      !/\.ya?ml$/u.test(target.logicalPath)
    )
      return;
    let bytes: Buffer;
    try {
      bytes = await readFile(target.logicalPath);
    } catch (error: unknown) {
      const failure = readFailure(target, error);
      failures.push(failure);
      diagnostics.push(...failure.diagnostics);
      return;
    }
    const document = parseDocument(target, bytes);
    documents.push(document);
    diagnostics.push(...document.diagnostics);
  }

  await visit(initial);
  documents.sort((left, right) =>
    left.source.path.localeCompare(right.source.path),
  );
  const rootReadFailed = failures.some(
    /** 스캔 시작 폴더 자체의 실패는 하위 누락과 다르게 전체 실패다. */
    (failure) => failure.logicalPath === initial.logicalPath,
  );
  return {
    ...results,
    root,
    status: rootReadFailed
      ? scanStatuses.failed
      : failures.length > 0
        ? scanStatuses.partial
        : scanStatuses.complete,
  };
}
