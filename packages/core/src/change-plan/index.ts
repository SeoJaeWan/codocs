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
  type CatalogObservation,
  type RenameChange,
} from '../catalog/index.js';
import {
  codeReferenceStatuses,
  resolveCodeReference,
  type CodeReferenceMarker,
} from '../code-reference/index.js';
import {
  catalogDiagnosticCodes,
  changePlanDiagnosticCodes,
  changePlanDiagnosticMessages,
  diagnosticSeverities,
  queryDiagnosticCodes,
  queryDiagnosticMessages,
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
import {
  changePlanModes,
  changePlanStatuses,
  type ChangePlanMode,
} from './domain-values.js';
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
  /**
   * 요청의 `/` 구분 문서 경로를 색인이 쓰는 경로 표기로 바꾼다. 생략하면 요청 표기 그대로 쓴다.
   * 색인·원문의 경로가 OS 구분자인 환경에서 create·move 대상의 존재·중복 확인과 결과 경로를 색인 표기와 맞춘다.
   */
  catalogPath?: (requestPath: string) => string;
}

/** 요청이나 후보 검증이 실패한 결과다. 실패한 항목의 경로와 위치를 진단에 담는다. */
export interface ChangePlanFailure {
  status: typeof changePlanStatuses.failed;
  diagnostics: readonly Diagnostic<string>[];
}

/** 다중 항목 계획에 쓰는 색인과 대상 문서 원문들이다. */
export interface ChangePlansContext {
  catalog: Catalog;
  /**
   * update/replace/delete/move 대상 문서의 같은 읽기 원문이다. 대상 ID의 유일한 경로와 같은 `path`의 원문이 있어야 한다.
   * create만 있는 계획이면 생략할 수 있다.
   */
  sources?: readonly ChangePlanSource[];
  /**
   * 변경 전후를 같은 표기로 비교할 코드 참조다. 계획이 기존에 확정된 코드 참조를 끊으면 거절한다.
   * 결과의 `requiresCodeEvidence`가 true일 때만 의미가 있으며 생략하면 코드 영향은 판단하지 않는다.
   */
  codeReferences?: readonly ChangePlanCodeReference[];
  /**
   * 요청의 `/` 구분 문서 경로를 색인이 쓰는 경로 표기로 바꾼다. 생략하면 요청 표기 그대로 쓴다.
   * 색인·원문의 경로가 OS 구분자인 환경에서 create·move 대상의 존재·중복 확인과 결과 경로를 색인 표기와 맞춘다.
   */
  catalogPath?: (requestPath: string) => string;
}

/** 다중 항목 계획의 항목 하나가 입력 순서대로 돌려주는 후보다. */
export interface PlannedChangeItem {
  /** 입력 배열에서의 위치다. 결과 `items`는 입력 순서와 같다. */
  index: number;
  mode: ChangePlanMode;
  /** 문서 ID다. */
  id: string;
  /** 반영 뒤 경로다. delete는 지워지는 경로, move는 새 경로다. */
  path: string;
  /** move의 원래 경로다. */
  previousPath?: string;
  /** false이면 update/replace가 원문을 바꾸지 않아 저장할 것이 없다. */
  changed: boolean;
  /** 후보 원문이다. create/update/replace의 새 원문, move는 원래와 같은 원문이며 delete와 변경 없음은 없다. */
  raw?: string;
  /** create/update/replace 후보의 검증된 데이터다. */
  data?: Document;
  /** 기존 문서를 대상으로 한 항목(update/replace/delete/move)이 읽은 원문 revision이다. */
  baseRevision?: string;
  /** 변경 없음 항목의 현재 revision이다. */
  revision?: string;
  /** 후보에서 사라지는 기존 섹션 이름이다. delete는 문서의 모든 섹션이다. */
  removedSections: readonly string[];
  /** 이 항목의 최종 색인 진단(경고 포함)이다. */
  diagnostics: readonly Diagnostic<string>[];
}

/** 다중 항목 후보 결과다. */
export type ChangesPlanResult =
  | ChangePlanFailure
  | {
      status: typeof changePlanStatuses.unchanged;
      items: readonly PlannedChangeItem[];
      diagnostics: readonly Diagnostic<string>[];
    }
  | {
      status: typeof changePlanStatuses.candidate;
      items: readonly PlannedChangeItem[];
      /**
       * 코드 참조 보호에 코드 파일의 새 증거가 필요하다(섹션 제거 또는 delete가 있다).
       * true이면 증거를 수집해 `codeReferences`와 함께 다시 계획해야 한다.
       */
      requiresCodeEvidence: boolean;
      diagnostics: readonly Diagnostic<string>[];
    };

/** 저장 단계와 구분되는 단일 문서 후보 결과다. */
export type ChangePlanResult =
  | ChangePlanFailure
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
): ChangePlanFailure {
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

/** replace 요청이 mode·id·revision·document 외의 속성을 담지 않았는지 확인한다. */
function replaceRequest(input: Record<string, unknown>): boolean {
  const allowed = new Set(['mode', 'id', 'revision', 'document']);
  return Object.keys(input).every((key) => allowed.has(key));
}

/** 문서 경로 규칙이다. `.codocs` 아래 상대 경로, `/` 구분, `.yaml`/`.yml`, 빈·`.`·`..` 구간과 절대·역슬래시 금지. */
function documentPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path !== '' &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..') &&
    /\.ya?ml$/u.test(path)
  );
}

/** 경로 표기를 바꾸지 않는 기본 변환이다. */
function keepPath(requestPath: string): string {
  return requestPath;
}

/** 파싱이 끝난 문서 하나의 후보 계산 중간 값이다. 최종 색인이 만들어진 뒤에 판정을 마친다. */
interface PreparedItem {
  index: number;
  mode: ChangePlanMode;
  /** 문서 ID다. create는 검증을 통과한 뒤에만 알 수 있다. */
  id: string;
  /** 변경 뒤 경로다. delete는 지워지는 경로다. */
  path: string;
  previousPath?: string;
  source?: ChangePlanSource;
  raw?: string;
  parsed?: YamlParseResult;
  data?: Document;
  /** update/replace 후보가 요청 데이터와 같아 파일을 바꿀 필요가 없다. */
  noop?: boolean;
  removedSections: readonly string[];
}

type PrepareResult =
  | { ok: true; item: PreparedItem }
  | { ok: false; diagnostics: readonly Diagnostic<string>[] };

/** 준비 단계의 요청 오류를 코드와 함께 반환한다. */
function prepareFailure(
  code: keyof typeof changePlanDiagnosticCodes,
  path?: string,
): PrepareResult {
  return { ok: false, diagnostics: failure(code, path).diagnostics };
}

/** 항목 하나의 요청 형태와 원문 대조를 마치고 후보 원문을 계산한다. 최종 색인 판정은 하지 않는다. */
function prepareItem(
  input: unknown,
  index: number,
  context: ChangePlansContext,
): PrepareResult {
  if (
    !record(input) ||
    typeof input.mode !== 'string' ||
    !Object.hasOwn(changePlanModes, input.mode)
  )
    return prepareFailure('invalidRequest');
  const mode = input.mode as ChangePlanMode;
  if (mode === changePlanModes.create) {
    if (!documentPath(input.path)) return prepareFailure('invalidRequest');
    const path = (context.catalogPath ?? keepPath)(input.path);
    if (context.catalog.documents.has(path))
      return prepareFailure('pathExists', path);
    if (!plainData(input.document)) return prepareFailure('invalidRequest');
    const validation = validateDocument({
      data: input.document,
      path,
    });
    if (!validation.success)
      return {
        ok: false,
        diagnostics: [...validation.errors, ...validation.warnings],
      };
    if (context.catalog.status !== scanStatuses.complete)
      return prepareFailure('incompleteCatalog', path);
    const raw = stringify(validation.data, { lineWidth: 0 });
    const parsed = parseYaml(raw, path);
    if (!parsed.success || !same(parsed.data, validation.data))
      return prepareFailure('candidateMismatch', path);
    return {
      ok: true,
      item: {
        index,
        mode,
        id: validation.data._codocs.id,
        path,
        raw,
        parsed,
        data: validation.data,
        removedSections: [],
      },
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
    return prepareFailure('invalidRequest');
  let replacement: Record<string, unknown> | undefined;
  let set: Record<string, unknown> | undefined;
  let removals: string[] = [];
  let newPath: string | undefined;
  if (mode === changePlanModes.replace) {
    const document = input.document;
    if (
      !replaceRequest(input) ||
      !record(document) ||
      !record(document[codocsKey]) ||
      !plainData(document)
    )
      return prepareFailure('invalidRequest');
    replacement = document;
  } else if (mode === changePlanModes.delete) {
    if (!exactKeys(input, ['mode', 'id', 'revision']))
      return prepareFailure('invalidRequest');
  } else if (mode === changePlanModes.move) {
    if (
      !exactKeys(input, ['mode', 'id', 'revision', 'path']) ||
      !documentPath(input.path)
    )
      return prepareFailure('invalidRequest');
    newPath = (context.catalogPath ?? keepPath)(input.path);
  } else {
    const requestedSet = input.set,
      requestedUnset = input.unset;
    if (
      (requestedSet !== undefined && !record(requestedSet)) ||
      (requestedUnset !== undefined && !stringList(requestedUnset)) ||
      (!requestedSet && !requestedUnset)
    )
      return prepareFailure('invalidRequest');
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
      return prepareFailure('invalidRequest');
  }
  const paths = context.catalog.idPaths.get(id);
  const onlyPath = paths?.size === 1 ? [...paths][0] : undefined;
  const source = context.sources?.find((item) => item.path === onlyPath);
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
    return prepareFailure('targetUnavailable');
  if (revision !== source.revision)
    return prepareFailure('revisionMismatch', source.path);
  if (mode === changePlanModes.delete || mode === changePlanModes.move) {
    if (context.catalog.status !== scanStatuses.complete)
      return prepareFailure('incompleteCatalog', source.path);
    if (mode === changePlanModes.delete)
      return {
        ok: true,
        item: {
          index,
          mode,
          id,
          path: source.path,
          source,
          removedSections: getSectionNames(target.observation.parsed),
        },
      };
    if (newPath === undefined) return prepareFailure('invalidRequest');
    if (context.catalog.documents.has(newPath))
      return prepareFailure('pathExists', newPath);
    return {
      ok: true,
      item: {
        index,
        mode,
        id,
        path: newPath,
        previousPath: source.path,
        source,
        raw: source.raw,
        parsed: parseYaml(source.raw, newPath),
        removedSections: [],
      },
    };
  }
  if (!source.utf8Lossless)
    return prepareFailure('sourceNotLossless', source.path);
  const parsed = parseYaml(source.raw, source.path);
  if (!parsed.success) return { ok: false, diagnostics: parsed.diagnostics };
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
    return prepareFailure('nameChangeNotAllowed', source.path);
  const expected: Record<string, unknown> = replacement
    ? { ...replacement }
    : { ...parsed.data, ...(set ?? {}) };
  for (const key of removals) delete expected[key];
  const raw = editYaml(parsed, expected);
  if (raw === undefined)
    return prepareFailure('candidateMismatch', source.path);
  const candidate = parseYaml(raw, source.path);
  if (!candidate.success)
    return { ok: false, diagnostics: candidate.diagnostics };
  if (!same(candidate.data, expected))
    return prepareFailure('candidateMismatch', source.path);
  return {
    ok: true,
    item: {
      index,
      mode,
      id,
      path: source.path,
      source,
      raw,
      parsed: candidate,
      noop: raw === source.raw || same(expected, parsed.data),
      removedSections: getSectionNames(parsed).filter(
        (section) => !Object.hasOwn(candidate.data, section),
      ),
    },
  };
}

/** 요청이 정확히 허용한 키만 가졌는지 확인한다. */
function exactKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(input);
  return (
    keys.length === allowed.length && keys.every((key) => allowed.includes(key))
  );
}

/** 항목 사이에 같은 문서 ID나 같은 경로가 두 번 이상 나오는지 찾아 입력 오류로 만든다. */
function duplicateInput(
  items: readonly unknown[],
  catalog: Catalog,
  catalogPath: (requestPath: string) => string,
): Diagnostic<string> | undefined {
  const ids = new Set<string>(),
    paths = new Set<string>();
  /** 항목 하나가 쓰는 값들을 전체 집합과 비교한다. 같은 항목 안의 반복은 세지 않는다. */
  const take = (
    seen: Set<string>,
    values: readonly (string | undefined)[],
  ): string | undefined => {
    const own = new Set(values.filter((v): v is string => v !== undefined));
    for (const value of own) {
      if (seen.has(value)) return value;
      seen.add(value);
    }
    return undefined;
  };
  /** 중복 값을 입력 오류 진단으로 만든다. */
  const invalid = (suggestion: string, path?: string): Diagnostic<string> => ({
    code: queryDiagnosticCodes.invalidInput,
    severity: diagnosticSeverities.error,
    message: queryDiagnosticMessages.invalidInput,
    suggestion,
    ...(path === undefined ? {} : { path }),
  });
  for (const item of items) {
    if (!record(item)) continue;
    const created = item.mode === changePlanModes.create;
    const document = item.document;
    const metadata = record(document) ? document[codocsKey] : undefined;
    const createdId = record(metadata)
      ? metadata[metadataFields.id]
      : undefined;
    const id = created ? createdId : item.id;
    const known =
      typeof item.id === 'string' ? catalog.idPaths.get(item.id) : undefined;
    const original = !created && known?.size === 1 ? [...known][0] : undefined;
    const added =
      typeof item.path === 'string' ? catalogPath(item.path) : undefined;
    const duplicateId = take(ids, [typeof id === 'string' ? id : undefined]);
    if (duplicateId !== undefined)
      return invalid(`같은 문서 ID(${duplicateId})는 한 번만 지정하세요.`);
    const duplicatePath = take(paths, [original, added]);
    if (duplicatePath !== undefined)
      return invalid(
        `같은 경로(${duplicatePath})는 한 번만 지정하세요.`,
        duplicatePath,
      );
  }
  return undefined;
}

/** 변경하는 항목의 코드 확인이 필요한지 판단한다. 섹션 제거와 문서 삭제만 해당한다. */
function needsCodeEvidence(item: PlannedChangeItem): boolean {
  return (
    item.changed &&
    (item.mode === changePlanModes.delete || item.removedSections.length > 0)
  );
}

/** 참조 하나가 끊겼음을 출처 경로와 위치로 알리는 오류다. */
function brokenDiagnostic(
  sourcePath: string,
  range: Diagnostic<string>['range'],
  fieldPath?: Diagnostic<string>['fieldPath'],
): Diagnostic<string> {
  return {
    code: changePlanDiagnosticCodes.brokenReference,
    severity: diagnosticSeverities.error,
    message: changePlanDiagnosticMessages.brokenReference,
    path: sourcePath,
    ...(fieldPath ? { fieldPath } : {}),
    ...(range ? { range } : {}),
  };
}

/**
 * 이번 계획이 대상으로 삼은 문서를 가리키던 기존 확정 참조를 새로 끊는지 같은 출처 표기로 비교한다.
 * 변경 전에 확정이었고 변경 후에 확정이 아닌 참조만 거절 근거다. 무관한 기존 오류는 보지 않는다.
 * 대상은 경로가 아니라 문서 ID로 비교한다. 이번 계획이 건드린 출처 문서는 자신의 최종 진단으로 판단하므로 건너뛴다.
 * @param after 모든 항목을 반영한 최종 색인이다.
 * @param changedIds 고치거나 지우거나 옮기는 문서의 ID다.
 * @param touchedPaths 고치거나 지우거나 옮기는 문서의 원래 경로다.
 * @param codeReferences 변경하지 않는 코드 파일의 표기다.
 * @returns 끊기는 참조마다 출처 경로와 위치를 담은 오류다. 없으면 빈 배열이다.
 */
function brokenReferences(
  context: ChangePlansContext,
  after: Catalog,
  changedIds: ReadonlySet<string>,
  touchedPaths: ReadonlySet<string>,
  codeReferences: readonly ChangePlanCodeReference[],
): readonly Diagnostic<string>[] {
  const result: Diagnostic<string>[] = [];
  for (const [sourcePath, before] of context.catalog.documents) {
    const next = after.documents.get(sourcePath);
    if (
      touchedPaths.has(sourcePath) ||
      !next ||
      before.confirmation !== catalogConfirmations.confirmed
    )
      continue;
    before.occurrences.forEach(
      /** 같은 순서의 변경 후 등장과 해석 결과를 비교한다. */ (item, index) => {
        const now = next.occurrences[index];
        const targetId = item.resolution.target?.id;
        if (
          item.resolution.status !== referenceResolutionStatuses.resolved ||
          targetId === undefined ||
          !changedIds.has(targetId) ||
          !now ||
          now.occurrence.offsetRange.start !== item.occurrence.offsetRange.start
        )
          return;
        if (now.resolution.status !== referenceResolutionStatuses.resolved)
          result.push(
            brokenDiagnostic(
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
    const targetId = was.target?.id;
    if (
      was.status !== codeReferenceStatuses.resolved ||
      targetId === undefined ||
      !changedIds.has(targetId)
    )
      continue;
    if (
      resolveCodeReference(after, marker).status !==
      codeReferenceStatuses.resolved
    )
      result.push(brokenDiagnostic(sourcePath, marker.range));
  }
  return result;
}

/** parent 관계 오류 코드다. */
const parentDiagnosticCodes: ReadonlySet<string> = new Set([
  catalogDiagnosticCodes.parentNotFound,
  catalogDiagnosticCodes.parentCycle,
]);

/**
 * 이번 계획이 건드리지 않은 문서에 새로 생긴 parent 단절을 찾는다.
 * 변경 전에도 있던 오류는 무관한 기존 오류이므로 같은 코드·parent 항목 위치로 비교해 제외한다.
 * @returns 자식 문서 경로와 `_codocs.parent` 항목 위치를 담은 참조 단절 오류다.
 */
function brokenParents(
  before: Catalog,
  after: Catalog,
  touchedPaths: ReadonlySet<string>,
): readonly Diagnostic<string>[] {
  const result: Diagnostic<string>[] = [];
  /** 같은 parent 오류를 식별하는 키다. */
  const key = (item: Diagnostic<string>): string =>
    `${item.code}:${JSON.stringify(item.fieldPath ?? [])}`;
  for (const [path, was] of before.documents) {
    const next = after.documents.get(path);
    if (touchedPaths.has(path) || !next) continue;
    const known = new Set(
      was.diagnostics
        .filter((item) => parentDiagnosticCodes.has(item.code))
        .map(key),
    );
    for (const item of next.diagnostics)
      if (parentDiagnosticCodes.has(item.code) && !known.has(key(item)))
        result.push(brokenDiagnostic(path, item.range, item.fieldPath));
  }
  return result;
}

/** 모든 항목을 반영한 최종 observation으로 색인을 한 번 만든다. */
function finalCatalog(
  catalog: Catalog,
  prepared: readonly PreparedItem[],
): Catalog {
  const byPath = new Map<string, PreparedItem>();
  for (const item of prepared)
    if (item.source) byPath.set(item.source.path, item);
  const observations = [...catalog.documents.values()]
    .filter((doc) => doc.confirmation === catalogConfirmations.confirmed)
    .flatMap(
      /** 문서 하나를 변경 계획에 따라 그대로 두거나 교체·제거한 관측으로 바꾼다. */ (
        doc,
      ): CatalogObservation[] => {
        const item = byPath.get(doc.path);
        if (!item) return [doc.observation];
        if (item.mode === changePlanModes.delete || !item.parsed) return [];
        return [{ path: item.path, parsed: item.parsed }];
      },
    );
  for (const item of prepared)
    if (item.mode === changePlanModes.create && item.parsed)
      observations.push({ path: item.path, parsed: item.parsed });
  return buildCatalog(
    {
      status: catalog.status,
      observations,
      failures: catalog.failures,
    },
    catalog,
  );
}

/** 최종 색인에서 확인한 항목 하나의 결과다. 요청이 실패하면 진단만 돌려준다. */
function judgeItem(
  item: PreparedItem,
  after: Catalog,
  context: ChangePlansContext,
): {
  diagnostics: readonly Diagnostic<string>[];
  failed: boolean;
  planned?: PlannedChangeItem;
} {
  if (item.mode === changePlanModes.delete)
    return {
      diagnostics: [],
      failed: false,
      planned: {
        index: item.index,
        mode: item.mode,
        id: item.id,
        path: item.path,
        changed: true,
        ...(item.source ? { baseRevision: item.source.revision } : {}),
        removedSections: item.removedSections,
        diagnostics: [],
      },
    };
  const parsed = item.parsed;
  const diagnostics =
    after.documents.get(item.path)?.diagnostics ??
    (parsed ? parsed.diagnostics : []);
  if (diagnostics.some((d) => d.severity === diagnosticSeverities.error))
    return { diagnostics, failed: true };
  if (item.mode === changePlanModes.create) {
    if (!item.data || item.raw === undefined)
      return { diagnostics, failed: true };
    return {
      diagnostics,
      failed: false,
      planned: {
        index: item.index,
        mode: item.mode,
        id: item.id,
        path: item.path,
        changed: true,
        raw: item.raw,
        data: item.data,
        removedSections: [],
        diagnostics,
      },
    };
  }
  if (item.mode === changePlanModes.move) {
    return {
      diagnostics,
      failed: false,
      planned: {
        index: item.index,
        mode: item.mode,
        id: item.id,
        path: item.path,
        ...(item.previousPath === undefined
          ? {}
          : { previousPath: item.previousPath }),
        changed: true,
        ...(item.raw === undefined ? {} : { raw: item.raw }),
        ...(item.source ? { baseRevision: item.source.revision } : {}),
        removedSections: [],
        diagnostics,
      },
    };
  }
  if (context.catalog.status !== scanStatuses.complete)
    return {
      diagnostics: failure('incompleteCatalog', item.path).diagnostics,
      failed: true,
    };
  if (!parsed?.success || !item.source || item.raw === undefined)
    return { diagnostics, failed: true };
  const validation = validateDocument({ data: parsed.data });
  if (!validation.success)
    return { diagnostics: validation.errors, failed: true };
  if (item.noop)
    return {
      diagnostics,
      failed: false,
      planned: {
        index: item.index,
        mode: item.mode,
        id: validation.data._codocs.id,
        path: item.source.path,
        changed: false,
        revision: item.source.revision,
        removedSections: [],
        diagnostics,
      },
    };
  return {
    diagnostics,
    failed: false,
    planned: {
      index: item.index,
      mode: item.mode,
      id: validation.data._codocs.id,
      path: item.source.path,
      changed: true,
      raw: item.raw,
      data: validation.data,
      baseRevision: item.source.revision,
      removedSections: item.removedSections,
      diagnostics,
    },
  };
}

/**
 * create/update/replace/delete/move 항목 목록을 파일 IO 없이 한 번에 검증하고 항목별 후보를 계산한다.
 * 모든 항목을 반영한 최종 observation으로 색인을 한 번만 만들어, 중간 상태 때문에 생기는 참조 오류를 피한다.
 * 같은 문서 ID나 경로가 두 번 나오면 `invalid_input`이다. 한 항목이라도 error이면 전체가 failed다.
 * 결과의 `requiresCodeEvidence`가 true이면 `context.codeReferences`를 채워 같은 입력으로 다시 호출해야 코드 참조까지 보호한다.
 * @param input 항목 배열이다. 비어 있으면 안 된다.
 * @param context 같은 스캔의 색인과 대상 문서 원문들이다.
 */
export function planDocumentChanges(
  input: unknown,
  context: ChangePlansContext,
): ChangesPlanResult {
  try {
    return planDocumentChangesInternal(input, context);
  } catch {
    return failure('invalidRequest');
  }
}

/** 확인한 요청 목록으로 최종 상태를 한 번 검증한다. */
function planDocumentChangesInternal(
  input: unknown,
  context: ChangePlansContext,
): ChangesPlanResult {
  if (!Array.isArray(input) || !input.length) return failure('invalidRequest');
  const items: unknown[] = Array.from(
    { length: input.length },
    /** 접근자를 실행하지 않고 항목의 자체 데이터 값만 읽는다. */ (
      _,
      index,
    ): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(input, index);
      return descriptor && 'value' in descriptor
        ? (descriptor.value as unknown)
        : undefined;
    },
  );
  const duplicate = duplicateInput(
    items,
    context.catalog,
    context.catalogPath ?? keepPath,
  );
  if (duplicate)
    return { status: changePlanStatuses.failed, diagnostics: [duplicate] };
  const prepared: PreparedItem[] = [];
  const failures: Diagnostic<string>[] = [];
  for (const [index, item] of items.entries()) {
    const result = prepareItem(item, index, context);
    if (result.ok) prepared.push(result.item);
    else failures.push(...result.diagnostics);
  }
  if (failures.length)
    return { status: changePlanStatuses.failed, diagnostics: failures };
  const after = finalCatalog(context.catalog, prepared);
  const planned: PlannedChangeItem[] = [];
  const judged = prepared.map((item) => judgeItem(item, after, context));
  for (const result of judged) {
    if (result.failed) failures.push(...result.diagnostics);
    else if (result.planned) planned.push(result.planned);
  }
  if (failures.length)
    return { status: changePlanStatuses.failed, diagnostics: failures };
  const changed = planned.filter((item) => item.changed);
  const changedIds = new Set(
    changed
      .filter((item) => item.mode !== changePlanModes.create)
      .map((item) => item.id),
  );
  const touchedPaths = new Set(
    prepared.flatMap((item, index) =>
      item.source && planned[index]?.changed ? [item.source.path] : [],
    ),
  );
  const diagnostics = planned.flatMap((item) => item.diagnostics);
  if (!changed.length)
    return {
      status: changePlanStatuses.unchanged,
      items: planned,
      diagnostics,
    };
  const broken = [
    ...brokenReferences(
      context,
      after,
      changedIds,
      touchedPaths,
      context.codeReferences ?? [],
    ),
    ...brokenParents(context.catalog, after, touchedPaths),
  ];
  if (broken.length)
    return { status: changePlanStatuses.failed, diagnostics: broken };
  return {
    status: changePlanStatuses.candidate,
    items: planned,
    requiresCodeEvidence: planned.some(needsCodeEvidence),
    diagnostics,
  };
}

/** create/update/replace 요청을 파일 IO 없이 검증하고 YAML 후보를 계산한다. 항목 하나의 다중 항목 계획이다. */
export function planDocumentChange(
  input: unknown,
  context: ChangePlanContext,
): ChangePlanResult {
  try {
    const mode = record(input) ? input.mode : undefined;
    if (
      mode !== changePlanModes.create &&
      mode !== changePlanModes.update &&
      mode !== changePlanModes.replace
    )
      return failure('invalidRequest');
    const result = planDocumentChanges([input], {
      catalog: context.catalog,
      ...(context.source ? { sources: [context.source] } : {}),
      ...(context.codeReferences
        ? { codeReferences: context.codeReferences }
        : {}),
      ...(context.catalogPath ? { catalogPath: context.catalogPath } : {}),
    });
    if (result.status === changePlanStatuses.failed) return result;
    const item = result.items[0];
    if (!item) return failure('invalidRequest');
    if (result.status === changePlanStatuses.unchanged)
      return {
        status: changePlanStatuses.unchanged,
        path: item.path,
        id: item.id,
        revision: item.revision ?? '',
        diagnostics: item.diagnostics,
      };
    if (item.raw === undefined || !item.data) return failure('invalidRequest');
    return {
      status: changePlanStatuses.candidate,
      path: item.path,
      id: item.id,
      raw: item.raw,
      data: item.data,
      ...(item.baseRevision === undefined
        ? {}
        : { baseRevision: item.baseRevision }),
      removedSections: item.removedSections,
      diagnostics: item.diagnostics,
    };
  } catch {
    return failure('invalidRequest');
  }
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
