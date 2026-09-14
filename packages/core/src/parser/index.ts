import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseAllDocuments,
  Parser,
} from 'yaml';
import {
  yamlDiagnosticCodes,
  yamlDiagnosticMessages,
} from '../diagnostics/index.js';
import type {
  Diagnostic,
  FieldPath,
  OffsetRange,
  SourcePosition,
  YamlDiagnosticCode,
} from '../diagnostics/index.js';

/** 문법 또는 지원하지 않는 YAML 구문의 오류다. */
export interface YamlDiagnostic extends Diagnostic {
  code: YamlDiagnosticCode;
  severity: 'error';
  offsetRange?: OffsetRange;
}
/** 특정 속성의 세 가지 원문 범위를 구분한다. */
export interface FieldRanges {
  fieldPath: FieldPath;
  key: OffsetRange | undefined;
  value: OffsetRange | undefined;
  property: OffsetRange | undefined;
}
/** 파싱 성공은 후속 스키마 검증이나 저장 허용을 보장하지 않는다. */
export type YamlParseResult =
  | {
      success: true;
      source: string;
      data: Record<string, unknown>;
      fields: readonly FieldRanges[];
      /** 최상위 매핑 AST의 확인된 값 범위이며 문서 표시와 앞뒤 독립 주석은 제외한다. */
      rootRange?: OffsetRange;
      diagnostics: readonly YamlDiagnostic[];
    }
  | {
      success: false;
      source: string | undefined;
      diagnostics: readonly YamlDiagnostic[];
    };

/** 외부 값이 객체인지 검사한다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 유효한 UTF-16 offset을 줄 좌표로 변환한다. CRLF도 원문 그대로 센다.
 * @param source 원문 문자열이다.
 * @param offset EOF를 포함한 원문 offset이다.
 * @returns 범위 밖 또는 정수가 아닌 offset에는 좌표가 없다.
 */
export function offsetToPosition(
  source: string,
  offset: number,
): SourcePosition | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length)
    return undefined;
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    if (source[index] === '\n') {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, character: offset - lineStart };
}

/** 위치가 확인된 경우에만 외부 좌표를 가진 오류를 만든다. */
function diagnostic(
  source: string | undefined,
  code: YamlDiagnostic['code'],
  message: string,
  path: string | undefined,
  offsets?: readonly number[],
): YamlDiagnostic {
  const start = offsets?.[0];
  const end = offsets?.[1];
  const startPosition =
    source !== undefined && start !== undefined
      ? offsetToPosition(source, start)
      : undefined;
  const endPosition =
    source !== undefined && end !== undefined
      ? offsetToPosition(source, end)
      : undefined;
  const valid =
    startPosition !== undefined &&
    endPosition !== undefined &&
    start !== undefined &&
    end !== undefined &&
    start <= end;
  return {
    code,
    severity: 'error',
    message,
    ...(path !== undefined ? { path } : {}),
    ...(valid
      ? {
          offsetRange: { start, end },
          range: { start: startPosition, end: endPosition },
        }
      : {}),
  };
}

/** CST 내의 실제 토큰만 재귀적으로 수집한다. 원문 문자열을 재검색하지 않는다. */
function sourceTokens(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(sourceTokens);
  if (!isRecord(value)) return [];
  const own =
    typeof value.type === 'string' &&
    typeof value.offset === 'number' &&
    typeof value.source === 'string'
      ? [value]
      : [];
  return [...own, ...Object.values(value).flatMap(sourceTokens)];
}

/** AST의 확인된 범위를 복사하며 값 범위는 뒤의 주석을 제외한다. */
function nodeRange(value: unknown): OffsetRange | undefined {
  if (!isNode(value) || !value.range) return undefined;
  return { start: value.range[0], end: value.range[1] };
}

/** CST와 AST를 함께 사용해 속성 범위를 수집한다. 앞의 독립 주석은 제외한다. */
function collectFields(
  value: unknown,
  fieldPath: FieldPath,
  fields: FieldRanges[],
  source: string,
): void {
  if (isMap(value)) {
    for (let index = 0; index < value.items.length; index++) {
      const pair = value.items[index];
      if (!pair) continue;
      const key = nodeRange(pair.key);
      const childPath = isScalar(pair.key)
        ? [...fieldPath, String(pair.key.value)]
        : undefined;
      if (!childPath) continue;
      const valueRange = nodeRange(pair.value);
      const tokens = sourceTokens(
        pair.srcToken
          ? {
              key: pair.srcToken.key,
              sep: pair.srcToken.sep,
              value: pair.srcToken.value,
            }
          : undefined,
      );
      let end = Math.max(
        key?.end ?? 0,
        ...tokens.map(
          (token) => Number(token.offset) + String(token.source).length,
        ),
      );
      if (isNode(pair.value) && pair.value.range)
        end = Math.max(end, pair.value.range[2]);
      // flow의 쉼표 뒤 같은 줄 주석은 다음 항목의 start 토큰에 속한다.
      const next = value.items[index + 1]?.srcToken?.start ?? [];
      const comments = next.filter((token) => token.type === 'comment');
      const sameLine = comments[0];
      if (
        value.flow &&
        sameLine &&
        !next.some(
          (token) => token.type === 'newline' && token.offset < sameLine.offset,
        )
      ) {
        end = sameLine.offset + sameLine.source.length;
        const newline = next.find(
          (token) => token.type === 'newline' && token.offset >= end,
        );
        if (newline) end = newline.offset + newline.source.length;
      }
      // yaml은 중첩 값 뒤의 들여쓰기 없는 독립 주석도 collection 끝에 붙일 수 있다.
      const keyToken = pair.srcToken?.key;
      const keyIndent = keyToken && 'indent' in keyToken ? keyToken.indent : 0;
      const independent = tokens.find(
        /** 값 뒤의 독립 주석을 실제 줄과 들여쓰기로 구분한다. */ (token) => {
          if (
            token.type !== 'comment' ||
            Number(token.offset) < (valueRange?.end ?? key?.end ?? 0) ||
            Number(token.indent) > keyIndent
          )
            return false;
          const lineStart =
            source.lastIndexOf('\n', Number(token.offset) - 1) + 1;
          return /^[ \t]*$/u.test(
            source.slice(lineStart, Number(token.offset)),
          );
        },
      );
      if (independent)
        end = Math.min(
          end,
          source.lastIndexOf('\n', Number(independent.offset) - 1) + 1,
        );
      fields.push({
        fieldPath: childPath,
        key,
        value: valueRange,
        property: key ? { start: key.start, end } : undefined,
      });
      collectFields(pair.value, childPath, fields, source);
    }
  } else if (isSeq(value)) {
    for (let index = 0; index < value.items.length; index++) {
      const childPath = [...fieldPath, index];
      fields.push({
        fieldPath: childPath,
        key: undefined,
        value: nodeRange(value.items[index]),
        property: undefined,
      });
      collectFields(value.items[index], childPath, fields, source);
    }
  }
}

/** 매핑 전체에서 병합 키를 찾아 위치가 있는 오류를 추가한다. */
function rejectMergeKeys(
  value: unknown,
  source: string,
  path: string | undefined,
  diagnostics: YamlDiagnostic[],
): void {
  if (isMap(value)) {
    for (const pair of value.items) {
      if (
        isScalar(pair.key) &&
        ((pair.key.value === '<<' && pair.key.type === 'PLAIN') ||
          pair.key.tag === 'tag:yaml.org,2002:merge')
      ) {
        diagnostics.push(
          diagnostic(
            source,
            yamlDiagnosticCodes.unsupportedYamlFeature,
            yamlDiagnosticMessages.mergeKeyNotSupported,
            path,
            pair.key.range ?? undefined,
          ),
        );
      }
      rejectMergeKeys(pair.key, source, path, diagnostics);
      rejectMergeKeys(pair.value, source, path, diagnostics);
    }
  } else if (isSeq(value)) {
    for (const item of value.items)
      rejectMergeKeys(item, source, path, diagnostics);
  }
}

/** 오류 offset에 일치하는 실제 키 범위를 찾아 중복 키 전체를 지목한다. */
function keyAtOffset(value: unknown, offset: number): OffsetRange | undefined {
  if (isMap(value)) {
    for (const pair of value.items) {
      const range = nodeRange(pair.key);
      if (range?.start === offset) return range;
      const child =
        keyAtOffset(pair.key, offset) ?? keyAtOffset(pair.value, offset);
      if (child) return child;
    }
  } else if (isSeq(value)) {
    for (const item of value.items) {
      const child = keyAtOffset(item, offset);
      if (child) return child;
    }
  }
  return undefined;
}

/** IO 없이 단일 YAML 매핑을 해석한다. 오류가 있으면 정상 데이터와 범위를 제공하지 않는다.
 * @param input 호출자가 읽은 외부 원문이다. 문자열만 허용한다.
 * @param path 진단에 전달할 경로이며 파일을 읽지 않는다.
 * @returns 원문과 오류 또는 해석 데이터 및 확인된 원문 위치다.
 */
export function parseYaml(input: unknown, path?: string): YamlParseResult {
  if (typeof input !== 'string')
    return {
      success: false,
      source: undefined,
      diagnostics: [
        diagnostic(
          undefined,
          yamlDiagnosticCodes.invalidYaml,
          yamlDiagnosticMessages.sourceMustBeString,
          path,
        ),
      ],
    };
  const source = input;
  const documents = parseAllDocuments(source, {
    keepSourceTokens: true,
    merge: false,
    prettyErrors: false,
    version: '1.2',
  });
  const diagnostics: YamlDiagnostic[] = [];
  const tokens = [...new Parser().parse(source)].flatMap(sourceTokens);
  for (const token of tokens) {
    const messages: Record<string, string> = {
      anchor: yamlDiagnosticMessages.anchorNotSupported,
      alias: yamlDiagnosticMessages.aliasNotSupported,
      tag: yamlDiagnosticMessages.customTagNotSupported,
    };
    if (
      token.type === 'tag' &&
      (String(token.source).startsWith('!!') ||
        String(token.source).startsWith('!<tag:yaml.org,2002:'))
    )
      continue;
    const message = messages[String(token.type)];
    if (message)
      diagnostics.push(
        diagnostic(
          source,
          yamlDiagnosticCodes.unsupportedYamlFeature,
          message,
          path,
          [
            Number(token.offset),
            Number(token.offset) + String(token.source).length,
          ],
        ),
      );
  }
  if (documents.length > 1) {
    const secondStart = documents[1]?.range?.[0];
    const start = tokens.find(
      (token) =>
        token.type === 'doc-start' && Number(token.offset) === secondStart,
    );
    diagnostics.push(
      diagnostic(
        source,
        yamlDiagnosticCodes.unsupportedYamlFeature,
        yamlDiagnosticMessages.multipleDocumentsNotSupported,
        path,
        start
          ? [Number(start.offset), Number(start.offset) + 3]
          : (documents[1]?.range ?? undefined),
      ),
    );
  }
  for (const document of documents) {
    rejectMergeKeys(document.contents, source, path, diagnostics);
    for (const issue of [...document.errors, ...document.warnings]) {
      const unsupported =
        issue.code === 'DUPLICATE_KEY' || issue.code === 'TAG_RESOLVE_FAILED';
      const message =
        issue.code === 'DUPLICATE_KEY'
          ? yamlDiagnosticMessages.duplicateKeyNotSupported
          : issue.code === 'TAG_RESOLVE_FAILED'
            ? yamlDiagnosticMessages.customTagNotSupported
            : `${yamlDiagnosticMessages.syntaxErrorPrefix}${issue.message}`;
      const duplicateRange =
        issue.code === 'DUPLICATE_KEY'
          ? keyAtOffset(document.contents, issue.pos[0])
          : undefined;
      const offsets = duplicateRange
        ? [duplicateRange.start, duplicateRange.end]
        : issue.pos[0] === source.length && issue.pos[1] === source.length + 1
          ? [source.length, source.length]
          : issue.pos;
      diagnostics.push(
        diagnostic(
          source,
          unsupported
            ? yamlDiagnosticCodes.unsupportedYamlFeature
            : yamlDiagnosticCodes.invalidYaml,
          message,
          path,
          offsets,
        ),
      );
    }
  }
  const document = documents[0];
  if (diagnostics.length > 0) return { success: false, source, diagnostics };
  if (!document || !isMap(document.contents))
    return {
      success: false,
      source,
      diagnostics: [
        diagnostic(
          source,
          yamlDiagnosticCodes.invalidYaml,
          yamlDiagnosticMessages.rootMustBeMapping,
          path,
          document?.contents && isNode(document.contents)
            ? (document.contents.range ?? undefined)
            : undefined,
        ),
      ],
    };
  const data: unknown = document.toJS();
  if (!isRecord(data))
    return {
      success: false,
      source,
      diagnostics: [
        diagnostic(
          source,
          yamlDiagnosticCodes.invalidYaml,
          yamlDiagnosticMessages.rootMustBeMapping,
          path,
        ),
      ],
    };
  const fields: FieldRanges[] = [];
  collectFields(document.contents, [], fields, source);
  const rootRange = nodeRange(document.contents);
  return {
    success: true,
    source,
    data,
    fields,
    diagnostics,
    ...(rootRange ? { rootRange } : {}),
  };
}

/** 성공 결과의 fieldPath에 대응하는 확인된 범위를 조회한다. */
function findRange(
  result: YamlParseResult,
  fieldPath: FieldPath,
  kind: 'key' | 'value' | 'property',
): OffsetRange | undefined {
  if (!result.success) return undefined;
  const field = result.fields.find(
    (candidate) =>
      candidate.fieldPath.length === fieldPath.length &&
      candidate.fieldPath.every((part, index) => part === fieldPath[index]),
  );
  const range = field?.[kind];
  return range ? { ...range } : undefined;
}
/** 속성 키의 원문 범위를 조회한다. 배열 항목에는 키 범위가 없다. */
export function getKeyRange(
  result: YamlParseResult,
  fieldPath: FieldPath,
): OffsetRange | undefined {
  return findRange(result, fieldPath, 'key');
}
/** 따옴표와 블록 헤더를 포함한 값의 원문 범위를 조회한다. */
export function getValueRange(
  result: YamlParseResult,
  fieldPath: FieldPath,
): OffsetRange | undefined {
  return findRange(result, fieldPath, 'value');
}
/** 키부터 같은 줄·값 내부 주석과 줄바꿈을 포함한 속성 전체 범위를 조회한다. 삭제 허용 판정은 수행하지 않는다. */
export function getPropertyRange(
  result: YamlParseResult,
  fieldPath: FieldPath,
): OffsetRange | undefined {
  return findRange(result, fieldPath, 'property');
}
