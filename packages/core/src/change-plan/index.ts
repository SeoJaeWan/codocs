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
  scanStatuses,
  type Catalog,
} from '../catalog/index.js';
import {
  changePlanDiagnosticCodes,
  changePlanDiagnosticMessages,
  diagnosticSeverities,
  schemaDiagnosticMessages,
  type Diagnostic,
} from '../diagnostics/index.js';
import {
  getPropertyRange,
  getValueRange,
  parseYaml,
  type YamlParseResult,
} from '../parser/index.js';
import {
  documentFields,
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

/** 순수 후보 계산에 사용하는 색인과 선택적인 대상 원문이다. */
export interface ChangePlanContext {
  catalog: Catalog;
  source?: ChangePlanSource;
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

/** JSON 자체의 안전성 오류를 YAML 직렬화 전에 걸러낸다. */
function unsafeJson(diagnostic: Diagnostic<string>): boolean {
  return new Set<string>([
    schemaDiagnosticMessages.nonFiniteNumber,
    schemaDiagnosticMessages.jsonValueRequired,
    schemaDiagnosticMessages.cyclicReference,
    schemaDiagnosticMessages.jsonObjectRequired,
    schemaDiagnosticMessages.jsonDataPropertyRequired,
    schemaDiagnosticMessages.missingArrayElement,
  ]).has(diagnostic.message);
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

/** 기존 확인 상태를 유지한 임시 색인에서 후보 경로의 진단만 추출한다. */
function candidateDiagnostics(
  catalog: Catalog,
  path: string,
  raw: string,
): readonly Diagnostic<string>[] {
  const parsed = parseYaml(raw, path);
  const confirmed = [...catalog.documents.values()]
    .filter(
      (doc) =>
        doc.path !== path &&
        doc.confirmation === catalogConfirmations.confirmed,
    )
    .map((doc) => doc.observation);
  const temporary = buildCatalog(
    {
      status: catalog.status,
      observations: [...confirmed, { path, parsed }],
      failures: catalog.failures,
    },
    catalog,
  );
  return temporary.documents.get(path)?.diagnostics ?? parsed.diagnostics;
}

/** create/update 요청을 파일 IO 없이 검증하고 YAML 후보를 계산한다. */
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
  if (!record(input) || (input.mode !== 'create' && input.mode !== 'update'))
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
    const validation = validateDocument({ data: input.document, path });
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
      id: validation.data.id,
      raw,
      data: validation.data,
      diagnostics,
    };
  }
  const id = input.id,
    revision = input.revision,
    set = input.set,
    unset = input.unset;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof revision !== 'string' ||
    !revision ||
    (set !== undefined && !record(set)) ||
    (unset !== undefined && !stringList(unset)) ||
    (!set && !unset)
  )
    return failure('invalidRequest');
  const changes = set ? Object.keys(set) : [],
    removals = unset ?? [];
  if (
    (!changes.length && !removals.length) ||
    new Set(removals).size !== removals.length ||
    changes.some((key) => removals.includes(key)) ||
    changes.includes(documentFields.deprecatedAliases) ||
    removals.includes(documentFields.deprecatedAliases) ||
    removals.some(
      /** 필수 필드는 unset할 수 없다. */
      (key) =>
        !key ||
        key === documentFields.id ||
        key === documentFields.name ||
        key === documentFields.definition ||
        key === documentFields.domains,
    )
  )
    return failure('invalidRequest');
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
  const expected: Record<string, unknown> = { ...parsed.data, ...(set ?? {}) };
  for (const key of removals) delete expected[key];
  const oldId = parsed.data[documentFields.id],
    newId = expected[documentFields.id];
  const preliminary = validateDocument({ data: expected, path: source.path });
  if (!preliminary.success && preliminary.errors.some(unsafeJson))
    return {
      status: changePlanStatuses.failed,
      diagnostics: preliminary.errors,
    };
  if (
    typeof oldId === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.exec(oldId)?.[0] === oldId &&
    typeof newId === 'string' &&
    oldId !== newId
  ) {
    const aliases = parsed.data[documentFields.deprecatedAliases];
    if (aliases !== undefined && !Array.isArray(aliases))
      return {
        status: changePlanStatuses.failed,
        diagnostics: validateDocument({
          data: parsed.data,
          path: source.path,
          source: source.raw,
          fields: parsed.fields,
          ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
        }).errors,
      };
    const previous = (aliases ?? []) as unknown[];
    expected[documentFields.deprecatedAliases] = [
      ...previous.filter((item) => !record(item) || item.id !== newId),
      ...(previous.some((item) => record(item) && item.id === oldId)
        ? []
        : [{ id: oldId }]),
    ];
  }
  const completeExpected = validateDocument({
    data: expected,
    path: source.path,
  });
  if (!completeExpected.success && completeExpected.errors.some(unsafeJson))
    return {
      status: changePlanStatuses.failed,
      diagnostics: completeExpected.errors,
    };
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
  const diagnostics = candidateDiagnostics(context.catalog, source.path, raw);
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
  if (raw === source.raw)
    return {
      status: changePlanStatuses.unchanged,
      path: source.path,
      id: validation.data.id,
      revision: source.revision,
      diagnostics,
    };
  return {
    status: changePlanStatuses.candidate,
    path: source.path,
    id: validation.data.id,
    raw,
    data: validation.data,
    baseRevision: source.revision,
    diagnostics,
  };
}
