import {
  Document as YamlDocument,
  isMap,
  isScalar,
  parseDocument,
  stringify,
} from 'yaml';
import {
  buildCatalog,
  catalogConfirmations,
  getSectionNames,
  referenceResolutionStatuses,
  renameChangeKinds,
  scanStatuses,
  type Catalog,
  type RenameChange,
} from '../catalog/index.js';
import {
  codeReferenceStatuses,
  resolveCodeReference,
  type CodeReferenceMarker,
} from '../code-reference/index.js';
import {
  changePlanDiagnosticCodes,
  changePlanDiagnosticMessages,
  diagnosticSeverities,
  type Diagnostic,
} from '../diagnostics/index.js';
import {
  getPropertyRange,
  getValueRange,
  parseYaml,
  type YamlParseResult,
} from '../parser/index.js';
import {
  codocsKey,
  metadataFields,
  validateDocument,
  type Document,
} from '../validator/index.js';
import { changePlanStatuses } from './domain-values.js';
export * from './domain-values.js';

/** 호출자가 같은 읽기에서 전달한 대상 원문과 revision이다. */
export interface ChangePlanSource {
  path: string;
  raw: string;
  revision: string;
  utf8Lossless: boolean;
}

/** 호출자가 디스크에서 새로 읽은, 이번 변경이 건드리지 않는 코드 파일의 명시 표기 하나다. */
export interface ChangePlanCodeReference {
  /** 표기가 있는 코드 파일의 프로젝트 기준 경로다. */
  sourcePath: string;
  /** 그 파일 원문에서 추출한 표기다. */
  marker: CodeReferenceMarker;
}

/** 순수 후보 계산에 사용하는 색인과 선택적인 대상 원문이다. */
export interface ChangePlanContext {
  catalog: Catalog;
  source?: ChangePlanSource;
  /**
   * 변경 전후를 같은 표기로 비교할 코드 참조다. 후보가 기존에 확정된 코드 참조를 끊으면 거절한다.
   * 섹션을 삭제하는 후보(`removedSections`)에서만 의미가 있으며 생략하면 코드 영향은 판단하지 않는다.
   */
  codeReferences?: readonly ChangePlanCodeReference[];
}

/** 저장 단계와 구분되는 단일 문서 후보 결과다. */
export type ChangePlanResult =
  | {
      status: typeof changePlanStatuses.failed;
      diagnostics: readonly Diagnostic<string>[];
    }
  | {
      status: typeof changePlanStatuses.unchanged;
      path: string;
      id: string;
      revision: string;
      diagnostics: readonly Diagnostic<string>[];
    }
  | {
      status: typeof changePlanStatuses.candidate;
      path: string;
      id: string;
      raw: string;
      data: Document;
      baseRevision?: string;
      /** 후보에서 사라지는 기존 섹션 이름이다. 코드 참조 보호 관측이 필요한지 판단하는 데 쓴다. */
      removedSections: readonly string[];
      diagnostics: readonly Diagnostic<string>[];
    };

/** 외부 객체의 자체 데이터 속성만 읽는다. */
function record(value: unknown): value is Record<string, unknown> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Reflect.ownKeys(value).every(
        /** 자체 문자열 데이터 속성만 받아 접근자를 실행하지 않는다. */ (
          key,
        ) => {
          if (typeof key !== 'string') return false;
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          return (
            descriptor !== undefined &&
            descriptor.enumerable &&
            'value' in descriptor
          );
        },
      )
    );
  } catch {
    return false;
  }
}

/** 접근자나 빈 슬롯이 없는 문자열 배열만 허용한다. */
function stringList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  try {
    return Array.from({ length: value.length }, (_, index) =>
      Object.getOwnPropertyDescriptor(value, index),
    ).every(
      (descriptor) =>
        descriptor !== undefined &&
        'value' in descriptor &&
        typeof descriptor.value === 'string',
    );
  } catch {
    return false;
  }
}

/** 접근자·특수 객체·순환 없이 데이터 속성만으로 이루어진 값인지 확인한다. 깊이는 제한한다. */
function plainData(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value !== 'object' || value === null) return true;
  if (Array.isArray(value))
    return Array.from({ length: value.length }, (_, index) =>
      Object.getOwnPropertyDescriptor(value, index),
    ).every(
      (descriptor) =>
        descriptor !== undefined &&
        'value' in descriptor &&
        plainData(descriptor.value, depth + 1),
    );
  return (
    record(value) &&
    Object.keys(value).every((key) => plainData(value[key], depth + 1))
  );
}

/** 요청 오류를 코드와 함께 반환한다. */
function failure(
  code: keyof typeof changePlanDiagnosticCodes,
  path?: string,
): ChangePlanResult {
  return {
    status: changePlanStatuses.failed,
    diagnostics: [
      {
        code: changePlanDiagnosticCodes[code],
        severity: diagnosticSeverities.error,
        message: changePlanDiagnosticMessages[code],
        ...(path === undefined ? {} : { path }),
      },
    ],
  };
}

/** 순서 차이와 관계없이 JSON 데이터의 의미를 비교한다. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (record(a) && record(b)) {
    const ak = Object.keys(a),
      bk = Object.keys(b);
    return (
      ak.length === bk.length &&
      ak.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
    );
  }
  return false;
}

/** YAML 값만 출력하되 블록 값의 마지막 개행은 후속 재파싱으로 검증한다. */
function valueText(
  value: unknown,
  eol: string,
  flow: boolean,
  followingNewline: boolean,
  indentation = 0,
): string {
  if (flow) {
    const document = new YamlDocument();
    document.contents = document.createNode({ placeholder: value });
    if (isMap(document.contents)) document.contents.flow = true;
    const output = document.toString({ lineWidth: 0 });
    return output.slice(output.indexOf(':') + 2, output.lastIndexOf(' }'));
  }
  const output = stringify({ placeholder: value }, { lineWidth: 0 });
  const text = output.slice(output[12] === '\n' ? 12 : 13);
  const keepFinalNewline =
    typeof value === 'string' && value.endsWith('\n') && !followingNewline;
  return (keepFinalNewline ? text : text.replace(/\n$/u, ''))
    .replace(/\n(?=.)/gu, `\n${' '.repeat(indentation)}`)
    .replace(/\n/gu, eol);
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface FlowEntry {
  key: string;
  keyStart: number;
  end: number;
  separator?: number;
  startTokens: readonly { type: string; offset: number; source: string }[];
}

/** CST의 쉼표 토큰으로 flow 항목 경계를 확인한다. 사용자 문자열과 주석은 검색하지 않는다. */
function flowEntries(
  source: string,
): { entries: FlowEntry[]; trailingComma?: number } | undefined {
  const root = parseDocument(source, { keepSourceTokens: true }).contents;
  if (!isMap(root) || !root.flow) return undefined;
  const entries: FlowEntry[] = [];
  for (const pair of root.items) {
    if (!isScalar(pair.key) || !pair.key.range) return undefined;
    const startTokens = pair.srcToken?.start ?? [];
    const separator = startTokens.find(
      (token) => token.type === 'comma',
    )?.offset;
    const property = pair.value?.range?.[2] ?? pair.key.range[2];
    entries.push({
      key: String(pair.key.value),
      keyStart: pair.key.range[0],
      end: property,
      ...(separator === undefined ? {} : { separator }),
      startTokens,
    });
  }
  const token = root.srcToken as
    | {
        items?: readonly {
          start?: readonly { type: string; offset: number }[];
          key?: unknown;
        }[];
      }
    | undefined;
  const trailingComma = token?.items
    ?.find((item) => !item.key)
    ?.start?.find((item) => item.type === 'comma')?.offset;
  return { entries, ...(trailingComma === undefined ? {} : { trailingComma }) };
}

/** 쉼표 뒤의 같은 줄 주석만 삭제하고 다음 줄의 독립 주석은 보존한다. */
function adjacentCommentEdit(entry: FlowEntry): Edit | undefined {
  const comment = entry.startTokens.find((token) => token.type === 'comment');
  const firstNewline = entry.startTokens.find(
    (token) => token.type === 'newline',
  );
  if (!comment || !firstNewline || comment.offset > firstNewline.offset)
    return undefined;
  return {
    start: comment.offset,
    end: firstNewline.offset + firstNewline.source.length,
    text: '',
  };
}

/** 각 최상위 값·속성 범위만 수정한다. */
function editYaml(
  parsed: Extract<YamlParseResult, { success: true }>,
  expected: Record<string, unknown>,
): string | undefined {
  const source = parsed.source;
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const flow = source[parsed.rootRange?.start ?? 0] === '{';
  const flowInfo = flow ? flowEntries(source) : undefined;
  if (flow && !flowInfo) return undefined;
  const edits: Edit[] = [];
  for (const key of Object.keys(parsed.data)) {
    if (Object.hasOwn(expected, key) && same(parsed.data[key], expected[key]))
      continue;
    const field = parsed.fields.find(
      (x) => x.fieldPath.length === 1 && x.fieldPath[0] === key,
    );
    if (!field) return undefined;
    if (Object.hasOwn(expected, key)) {
      const range = getValueRange(parsed, [key]);
      if (!range) return undefined;
      const blockText = nestedBlockText(
        expected[key],
        source,
        range,
        field.key,
        flow,
        eol,
      );
      if (blockText !== undefined) {
        edits.push({ ...range, text: blockText });
        continue;
      }
      edits.push({
        ...range,
        text: valueText(
          expected[key],
          eol,
          flow,
          source[range.end] === '\n',
          field.key
            ? field.key.start -
                (source.lastIndexOf('\n', field.key.start - 1) + 1)
            : 0,
        ),
      });
    } else {
      const range = getPropertyRange(parsed, [key]);
      if (!range) return undefined;
      if (!flow) edits.push({ ...range, text: '' });
    }
  }
  if (flowInfo) {
    const entries = flowInfo.entries;
    for (let index = 0; index < entries.length;) {
      const first = entries[index];
      if (!first || Object.hasOwn(expected, first.key)) {
        index++;
        continue;
      }
      const startIndex = index;
      while (
        index < entries.length &&
        !Object.hasOwn(expected, entries[index]!.key)
      )
        index++;
      const last = entries[index - 1]!;
      const next = entries[index];
      if (startIndex > 0) {
        if (first.separator === undefined) return undefined;
        const firstNewline = first.startTokens.find(
          (token) => token.type === 'newline',
        );
        const independentComment =
          firstNewline &&
          first.startTokens.find(
            (token) =>
              token.type === 'comment' && token.offset > firstNewline.offset,
          );
        if (independentComment && firstNewline) {
          edits.push({
            start: first.separator,
            end: firstNewline.offset,
            text: '',
          });
          edits.push({
            start: first.keyStart,
            end: next
              ? last.end
              : (flowInfo.trailingComma ?? last.end) +
                (flowInfo.trailingComma === undefined ? 0 : 1),
            text: '',
          });
        } else
          edits.push({
            start: first.separator,
            end: next
              ? last.end
              : (flowInfo.trailingComma ?? last.end) +
                (flowInfo.trailingComma === undefined ? 0 : 1),
            text: '',
          });
      } else if (next) {
        if (next.separator === undefined) return undefined;
        edits.push({
          start: first.keyStart,
          end: next.separator + 1,
          text: '',
        });
      } else return undefined;
      if (next) {
        const comment = adjacentCommentEdit(next);
        if (comment) edits.push(comment);
      }
    }
  }
  const added = Object.keys(expected).filter(
    (key) => !Object.hasOwn(parsed.data, key),
  );
  if (added.length) {
    const rootEnd = parsed.rootRange?.end;
    if (rootEnd === undefined) return undefined;
    if (flow) {
      const trailingSurvives =
        flowInfo?.trailingComma !== undefined &&
        Object.hasOwn(expected, flowInfo.entries.at(-1)?.key ?? '');
      const existingSurvives = Object.keys(expected).some((key) =>
        Object.hasOwn(parsed.data, key),
      );
      const insert = added
        .map(
          (key) =>
            `${stringify(key).trimEnd()}: ${valueText(expected[key], eol, true, false)}`,
        )
        .join(', ');
      edits.push({
        start: rootEnd - 1,
        end: rootEnd - 1,
        text: `${existingSurvives && !trailingSurvives ? ', ' : ''}${insert}${trailingSurvives ? ', ' : ''}`,
      });
    } else {
      const rootStart = parsed.rootRange?.start ?? 0;
      const indentation =
        rootStart - (source.lastIndexOf('\n', rootStart - 1) + 1);
      const prefix = ' '.repeat(indentation);
      const insert = added
        .map(
          /** 기존 최상위 키의 들여쓰기와 줄바꿈 표기를 따른다. */ (key) =>
            stringify({ [key]: expected[key] }, { lineWidth: 0 })
              .replace(/\n$/u, '')
              .replace(/\n/gu, `\n${prefix}`)
              .replace(/\n/gu, eol),
        )
        .join(eol + prefix);
      edits.push({
        start: rootEnd,
        end: rootEnd,
        text: `${rootEnd > 0 && source[rootEnd - 1] !== '\n' ? eol : ''}${prefix}${insert}${source.endsWith(eol) ? eol : ''}`,
      });
    }
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (let index = 1; index < edits.length; index++) {
    const left = edits[index];
    const right = edits[index - 1];
    if (
      !left ||
      !right ||
      left.start < 0 ||
      left.end < left.start ||
      right.end > source.length ||
      left.end > right.start
    )
      return undefined;
  }
  let result = source;
  for (const edit of edits)
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

/**
 * 값이 다음 줄에서 시작하는 블록 매핑을 새 매핑으로 바꿀 텍스트를 만든다.
 * 첫 줄은 원래 값이 시작하던 자리에 이어지고 나머지 줄은 같은 들여쓰기를 따른다.
 * @returns 블록 매핑 교체가 아니면 undefined다.
 */
function nestedBlockText(
  value: unknown,
  source: string,
  range: { start: number; end: number },
  key: { start: number; end: number } | undefined,
  flow: boolean,
  eol: string,
): string | undefined {
  if (flow || !key || !record(value) || !Object.keys(value).length)
    return undefined;
  if (!source.slice(key.end, range.start).includes('\n')) return undefined;
  const column = range.start - (source.lastIndexOf('\n', range.start - 1) + 1);
  const output = stringify(value, { lineWidth: 0 }).replace(/\n$/u, '');
  const text = output
    .replace(/\n/gu, `\n${' '.repeat(column)}`)
    .replace(/\n/gu, eol);
  return source[range.end - 1] === '\n' ? text + eol : text;
}

/** 후보를 반영하고 기존 확인 상태를 유지한 임시 색인을 만든다. */
function candidateCatalog(
  catalog: Catalog,
  path: string,
  raw: string,
  parsed: YamlParseResult = parseYaml(raw, path),
): Catalog {
  const confirmed = [...catalog.documents.values()]
    .filter(
      (doc) =>
        doc.path !== path &&
        doc.confirmation === catalogConfirmations.confirmed,
    )
    .map((doc) => doc.observation);
  return buildCatalog(
    {
      status: catalog.status,
      observations: [...confirmed, { path, parsed }],
      failures: catalog.failures,
    },
    catalog,
  );
}

/** 임시 색인에서 후보 경로의 진단만 추출한다. */
function candidateDiagnostics(
  catalog: Catalog,
  path: string,
  raw: string,
): readonly Diagnostic<string>[] {
  const parsed = parseYaml(raw, path);
  return (
    candidateCatalog(catalog, path, raw, parsed).documents.get(path)
      ?.diagnostics ?? parsed.diagnostics
  );
}

/** replace 요청이 mode·id·revision·document 외의 속성을 담지 않았는지 확인한다. */
function replaceRequest(input: Record<string, unknown>): boolean {
  const allowed = new Set(['mode', 'id', 'revision', 'document']);
  return Object.keys(input).every((key) => allowed.has(key));
}

/**
 * 후보가 대상 문서를 가리키던 기존 확정 참조를 새로 끊는지 같은 출처 표기로 비교한다.
 * 변경 전에 확정이었고 변경 후에 확정이 아닌 참조만 거절 근거다. 무관한 기존 오류는 보지 않는다.
 * @param after 후보를 반영한 임시 색인이다.
 * @param path 변경 대상 문서 경로다.
 * @param codeReferences 변경하지 않는 코드 파일의 표기다.
 * @returns 끊기는 참조마다 출처 경로와 위치를 담은 오류다. 없으면 빈 배열이다.
 */
function brokenReferences(
  context: ChangePlanContext,
  after: Catalog,
  path: string,
  codeReferences: readonly ChangePlanCodeReference[],
): readonly Diagnostic<string>[] {
  const result: Diagnostic<string>[] = [];
  /** 끊기는 참조 하나를 출처 경로와 위치를 담은 오류로 만든다. */
  const diagnostic = (
    sourcePath: string,
    range: Diagnostic<string>['range'],
    fieldPath?: Diagnostic<string>['fieldPath'],
  ): Diagnostic<string> => ({
    code: changePlanDiagnosticCodes.brokenReference,
    severity: diagnosticSeverities.error,
    message: changePlanDiagnosticMessages.brokenReference,
    path: sourcePath,
    ...(fieldPath ? { fieldPath } : {}),
    ...(range ? { range } : {}),
  });
  for (const [sourcePath, before] of context.catalog.documents) {
    const next = after.documents.get(sourcePath);
    if (
      sourcePath === path ||
      !next ||
      before.confirmation !== catalogConfirmations.confirmed
    )
      continue;
    before.occurrences.forEach(
      /** 같은 순서의 변경 후 등장과 해석 결과를 비교한다. */ (item, index) => {
        const now = next.occurrences[index];
        if (
          item.resolution.status !== referenceResolutionStatuses.resolved ||
          item.resolution.target?.path !== path ||
          !now ||
          now.occurrence.offsetRange.start !== item.occurrence.offsetRange.start
        )
          return;
        if (now.resolution.status !== referenceResolutionStatuses.resolved)
          result.push(
            diagnostic(
              sourcePath,
              item.occurrence.range,
              item.occurrence.fieldPath,
            ),
          );
      },
    );
  }
  for (const { sourcePath, marker } of codeReferences) {
    const was = resolveCodeReference(context.catalog, marker);
    if (
      was.status !== codeReferenceStatuses.resolved ||
      was.target?.path !== path
    )
      continue;
    if (
      resolveCodeReference(after, marker).status !==
      codeReferenceStatuses.resolved
    )
      result.push(diagnostic(sourcePath, marker.range));
  }
  return result;
}

/** create/update/replace 요청을 파일 IO 없이 검증하고 YAML 후보를 계산한다. */
export function planDocumentChange(
  input: unknown,
  context: ChangePlanContext,
): ChangePlanResult {
  try {
    return planDocumentChangeInternal(input, context);
  } catch {
    return failure('invalidRequest');
  }
}

/** 확인한 요청으로 한 문서의 후보만 계산한다. */
function planDocumentChangeInternal(
  input: unknown,
  context: ChangePlanContext,
): ChangePlanResult {
  if (
    !record(input) ||
    (input.mode !== 'create' &&
      input.mode !== 'update' &&
      input.mode !== 'replace')
  )
    return failure('invalidRequest');
  if (input.mode === 'create') {
    const path = input.path;
    if (
      typeof path !== 'string' ||
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !/\.ya?ml$/u.test(path)
    )
      return failure('invalidRequest');
    if (context.catalog.documents.has(path)) return failure('pathExists', path);
    if (!plainData(input.document)) return failure('invalidRequest');
    const validation = validateDocument({
      data: input.document,
      path,
    });
    if (!validation.success)
      return {
        status: changePlanStatuses.failed,
        diagnostics: [...validation.errors, ...validation.warnings],
      };
    if (context.catalog.status !== scanStatuses.complete)
      return failure('incompleteCatalog', path);
    const raw = stringify(validation.data, { lineWidth: 0 });
    const parsed = parseYaml(raw, path);
    if (!parsed.success || !same(parsed.data, validation.data))
      return failure('candidateMismatch', path);
    const diagnostics = candidateDiagnostics(context.catalog, path, raw);
    if (diagnostics.some((d) => d.severity === diagnosticSeverities.error))
      return { status: changePlanStatuses.failed, diagnostics };
    return {
      status: changePlanStatuses.candidate,
      path,
      id: validation.data._codocs.id,
      raw,
      data: validation.data,
      removedSections: [],
      diagnostics,
    };
  }
  const id = input.id,
    revision = input.revision;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof revision !== 'string' ||
    !revision
  )
    return failure('invalidRequest');
  let replacement: Record<string, unknown> | undefined;
  let set: Record<string, unknown> | undefined;
  let removals: string[] = [];
  if (input.mode === 'replace') {
    const document = input.document;
    if (
      !replaceRequest(input) ||
      !record(document) ||
      !record(document[codocsKey]) ||
      !plainData(document)
    )
      return failure('invalidRequest');
    replacement = document;
  } else {
    const requestedSet = input.set,
      requestedUnset = input.unset;
    if (
      (requestedSet !== undefined && !record(requestedSet)) ||
      (requestedUnset !== undefined && !stringList(requestedUnset)) ||
      (!requestedSet && !requestedUnset)
    )
      return failure('invalidRequest');
    set = requestedSet;
    removals = requestedUnset ?? [];
    const changes = set ? Object.keys(set) : [];
    if (
      (!changes.length && !removals.length) ||
      new Set(removals).size !== removals.length ||
      changes.some((key) => removals.includes(key)) ||
      removals.some(
        /** 메타데이터 `_codocs`는 unset할 수 없다. */
        (key) => !key || key === codocsKey,
      ) ||
      (set !== undefined &&
        !Object.values(set).every((value) => plainData(value)))
    )
      return failure('invalidRequest');
  }
  const paths = context.catalog.idPaths.get(id);
  const source = context.source;
  const target = source && context.catalog.documents.get(source.path);
  if (
    !paths ||
    paths.size !== 1 ||
    !source ||
    !paths.has(source.path) ||
    target?.confirmation !== catalogConfirmations.confirmed ||
    target.id !== id ||
    target.observation.parsed.source !== source.raw
  )
    return failure('targetUnavailable');
  if (revision !== source.revision)
    return failure('revisionMismatch', source.path);
  if (!source.utf8Lossless) return failure('sourceNotLossless', source.path);
  const parsed = parseYaml(source.raw, source.path);
  if (!parsed.success)
    return {
      status: changePlanStatuses.failed,
      diagnostics: parsed.diagnostics,
    };
  const requestedMetadata = replacement
    ? replacement[codocsKey]
    : set?.[codocsKey];
  const currentMetadata = parsed.data[codocsKey];
  if (
    record(requestedMetadata) &&
    Object.hasOwn(requestedMetadata, metadataFields.name) &&
    requestedMetadata[metadataFields.name] !==
      (record(currentMetadata)
        ? currentMetadata[metadataFields.name]
        : undefined)
  )
    return failure('nameChangeNotAllowed', source.path);
  const expected: Record<string, unknown> = replacement
    ? { ...replacement }
    : { ...parsed.data, ...(set ?? {}) };
  for (const key of removals) delete expected[key];
  const raw = editYaml(parsed, expected);
  if (raw === undefined) return failure('candidateMismatch', source.path);
  const candidate = parseYaml(raw, source.path);
  if (!candidate.success)
    return {
      status: changePlanStatuses.failed,
      diagnostics: candidate.diagnostics,
    };
  if (!same(candidate.data, expected))
    return failure('candidateMismatch', source.path);
  const after = candidateCatalog(context.catalog, source.path, raw, candidate);
  const diagnostics =
    after.documents.get(source.path)?.diagnostics ?? candidate.diagnostics;
  if (diagnostics.some((d) => d.severity === diagnosticSeverities.error))
    return { status: changePlanStatuses.failed, diagnostics };
  if (context.catalog.status !== scanStatuses.complete)
    return failure('incompleteCatalog', source.path);
  const validation = validateDocument({ data: candidate.data });
  if (!validation.success)
    return {
      status: changePlanStatuses.failed,
      diagnostics: validation.errors,
    };
  if (raw === source.raw || same(expected, parsed.data))
    return {
      status: changePlanStatuses.unchanged,
      path: source.path,
      id: validation.data._codocs.id,
      revision: source.revision,
      diagnostics,
    };
  const broken = brokenReferences(
    context,
    after,
    source.path,
    context.codeReferences ?? [],
  );
  if (broken.length)
    return { status: changePlanStatuses.failed, diagnostics: broken };
  return {
    status: changePlanStatuses.candidate,
    path: source.path,
    id: validation.data._codocs.id,
    raw,
    data: validation.data,
    baseRevision: source.revision,
    removedSections: getSectionNames(parsed).filter(
      (section) => !Object.hasOwn(candidate.data, section),
    ),
    diagnostics,
  };
}

/** 이름 변경 수정안을 원문에 적용한 결과다. 성공은 재파싱으로 의도한 값만 바뀐 것을 확인했다. */
export type RenameEditResult =
  { success: true; raw: string } | { success: false };

/** 문자열 스칼라의 원문 표기 형식이다. */
const scalarSourceTypes = {
  plain: 'PLAIN',
  doubleQuoted: 'QUOTE_DOUBLE',
  singleQuoted: 'QUOTE_SINGLE',
  blockLiteral: 'BLOCK_LITERAL',
  blockFolded: 'BLOCK_FOLDED',
} as const;

/** 큰따옴표 스칼라 안에서 이름 그대로 쓰면 안 되는 문자인지 확인한다. */
function needsEscape(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    char === '\\' ||
    char === '"' ||
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff
  );
}

/** 문자 하나를 YAML 큰따옴표 escape로 바꾼다. 이름 있는 escape가 없으면 유니코드 escape를 쓴다. */
function escapeDoubleQuotedChar(char: string): string {
  const named = new Map([
    ['\\', '\\\\'],
    ['"', '\\"'],
    ['\n', '\\n'],
    ['\t', '\\t'],
    ['\r', '\\r'],
  ]).get(char);
  return named ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/** 큰따옴표 스칼라 안에서 그대로 쓸 수 없는 문자를 YAML escape로 바꾼다. */
function escapeDoubleQuoted(value: string): string {
  let result = '';
  for (const char of value)
    result += needsEscape(char) ? escapeDoubleQuotedChar(char) : char;
  return result;
}

/** 스칼라 형식에 맞춰 새 텍스트를 원문에 쓸 표기로 바꾼다. 안전하게 쓸 수 없는 형식은 undefined다. */
function escapeForScalar(
  value: string,
  type: string | undefined,
): string | undefined {
  if (type === scalarSourceTypes.doubleQuoted) return escapeDoubleQuoted(value);
  if (type === scalarSourceTypes.singleQuoted)
    return value.replace(/'/gu, "''");
  if (
    type === scalarSourceTypes.plain ||
    type === scalarSourceTypes.blockLiteral ||
    type === scalarSourceTypes.blockFolded
  )
    return value;
  return undefined;
}

/** 해석 문자열의 어느 코드 단위 구간이 원문 범위 하나에 대응하는지 계산한다. */
function decodedSpan(
  ranges: readonly { start: number; end: number }[],
  offset: { start: number; end: number },
): { start: number; end: number } | undefined {
  const indexes: number[] = [];
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (
      range &&
      range.start < range.end &&
      range.start >= offset.start &&
      range.end <= offset.end
    )
      indexes.push(index);
  }
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  if (
    first === undefined ||
    last === undefined ||
    last - first + 1 !== indexes.length
  )
    return undefined;
  return { start: first, end: last + 1 };
}

/** 경로가 가리키는 중첩 값을 복제본에서 교체한다. */
function setAtPath(
  root: Record<string, unknown>,
  fieldPath: readonly (string | number)[],
  value: string,
): boolean {
  let current: unknown = root;
  for (const key of fieldPath.slice(0, -1)) {
    if (typeof current !== 'object' || current === null) return false;
    current = Reflect.get(current, key);
  }
  const last = fieldPath[fieldPath.length - 1];
  if (typeof current !== 'object' || current === null || last === undefined)
    return false;
  Reflect.set(current, last, value);
  return true;
}

/** 키의 원문 표기 형식에 맞춰 새 키 이름을 쓴다. 따옴표는 유지하고 plain은 따옴표로 승격하지 않는다. */
function keyText(value: string, type: string | undefined): string | undefined {
  const quote =
    type === scalarSourceTypes.doubleQuoted
      ? '"'
      : type === scalarSourceTypes.singleQuoted
        ? "'"
        : type === scalarSourceTypes.plain
          ? ''
          : undefined;
  const escaped =
    quote === undefined ? undefined : escapeForScalar(value, type);
  return quote === undefined || escaped === undefined
    ? undefined
    : quote + escaped + quote;
}

/**
 * 이름 변경 수정안을 원문 offset으로만 적용한다. 바꾸는 위치 밖의 원문은 그대로 두고,
 * 새 텍스트는 그 위치의 YAML 스칼라 형식(plain·작은따옴표·큰따옴표·block)에 맞게 escape한다.
 * 적용 뒤 다시 파싱해 바꾼 위치만 의도한 값이고 나머지 데이터는 같을 때만 성공한다.
 * @param parsed 수정안을 계산한 같은 원문의 파싱 결과다.
 * @param changes 이 원문에 속한 수정안이다. 다른 파일의 수정안은 넘기지 않는다.
 * @returns 성공하면 새 원문이다. 겹치거나 형식에 쓸 수 없거나 재파싱 검증에 실패하면 실패다.
 */
export function applyRenameChanges(
  parsed: Extract<YamlParseResult, { success: true }>,
  changes: readonly RenameChange[],
): RenameEditResult {
  const source = parsed.source;
  const document = parseDocument(source, { keepSourceTokens: true });
  const ordered = [...changes].sort(
    (a, b) => b.offsetRange.start - a.offsetRange.start,
  );
  const expectedValues = new Map<string, string>();
  let keyRename: { oldText: string; newText: string; type: string } | undefined;
  let result = source;
  let limit = source.length;
  for (const change of ordered) {
    const { start, end } = change.offsetRange;
    if (start < 0 || end < start || end > limit) return { success: false };
    if (change.kind === renameChangeKinds.key) {
      const pair =
        keyRename === undefined && isMap(document.contents)
          ? document.contents.items.find(
              (item) => isScalar(item.key) && item.key.value === change.oldText,
            )
          : undefined;
      const key = pair?.key;
      if (
        !isScalar(key) ||
        change.fieldPath.length !== 1 ||
        change.fieldPath[0] !== change.oldText ||
        key.range?.[0] !== start ||
        key.range[1] !== end ||
        key.type === undefined
      )
        return { success: false };
      const written = keyText(change.newText, key.type);
      if (written === undefined) return { success: false };
      result = result.slice(0, start) + written + result.slice(end);
      limit = start;
      keyRename = {
        oldText: change.oldText,
        newText: change.newText,
        type: key.type,
      };
      continue;
    }
    const mapping = parsed.strings.find(
      (item) =>
        item.fieldPath.length === change.fieldPath.length &&
        item.fieldPath.every((part, index) => part === change.fieldPath[index]),
    );
    const span =
      mapping && decodedSpan(mapping.sourceRanges, change.offsetRange);
    if (!mapping || !span) return { success: false };
    if (mapping.value.slice(span.start, span.end) !== change.oldText)
      return { success: false };
    const node = document.getIn(change.fieldPath, true);
    const type = isScalar(node) ? node.type : undefined;
    const written = escapeForScalar(change.newText, type);
    if (written === undefined) return { success: false };
    result = result.slice(0, start) + written + result.slice(end);
    limit = start;
    const key = JSON.stringify(change.fieldPath);
    const value = expectedValues.get(key) ?? mapping.value;
    expectedValues.set(
      key,
      value.slice(0, span.start) + change.newText + value.slice(span.end),
    );
  }
  const reparsed = parseYaml(result);
  if (!reparsed.success) return { success: false };
  let expectedData = JSON.parse(JSON.stringify(parsed.data)) as Record<
    string,
    unknown
  >;
  for (const [key, value] of expectedValues) {
    const fieldPath = JSON.parse(key) as (string | number)[];
    if (!setAtPath(expectedData, fieldPath, value)) return { success: false };
  }
  if (keyRename) {
    const { oldText, newText, type } = keyRename;
    expectedData = Object.fromEntries(
      Object.entries(expectedData).map(([name, value]) => [
        name === oldText ? newText : name,
        value,
      ]),
    );
    const root = parseDocument(result).contents;
    const renamed = isMap(root)
      ? root.items.find(
          (item) => isScalar(item.key) && item.key.value === newText,
        )?.key
      : undefined;
    /** 키가 문자열 그대로 읽히고 형식이 같으며 순서가 유지되어야 한다. */
    if (
      !isScalar(renamed) ||
      renamed.type !== type ||
      !same(Object.keys(reparsed.data), Object.keys(expectedData))
    )
      return { success: false };
  }
  return same(reparsed.data, expectedData)
    ? { success: true, raw: result }
    : { success: false };
}
