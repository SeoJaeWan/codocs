import { z } from 'zod';
import { schemaDiagnosticCodes } from '../diagnostics/index.js';
import type {
  Diagnostic,
  FieldPath,
  OffsetRange,
  SchemaDiagnosticCode,
  SourceRange,
} from '../diagnostics/index.js';
import { offsetToPosition } from '../parser/index.js';
import type { FieldRanges } from '../parser/index.js';

/** 사용자 속성이 보존할 수 있는 재귀 JSON 값이다. 숫자는 유한해야 한다. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface JsonIssue {
  fieldPath: FieldPath;
  message: string;
  unsafe: boolean;
}

/** 자체 데이터 속성만 조회하며 getter와 상속 속성을 실행하지 않는다. */
function ownValue(value: unknown, key: string | number): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor
    ? (descriptor.value as unknown)
    : undefined;
}

/** JSON 이외의 값과 실제 순환만 거부한다. 같은 객체를 재사용하는 것은 허용한다. */
function inspectJson(
  value: unknown,
  fieldPath: FieldPath = [],
  ancestors = new Set<object>(),
): JsonIssue[] {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return [];
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? []
      : [{ fieldPath, message: 'JSON 숫자는 유한해야 합니다.', unsafe: false }];
  if (typeof value !== 'object')
    return [{ fieldPath, message: 'JSON 값이어야 합니다.', unsafe: true }];
  if (ancestors.has(value))
    return [
      { fieldPath, message: '순환 참조는 JSON 값이 아닙니다.', unsafe: true },
    ];
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    return [{ fieldPath, message: 'JSON 객체이어야 합니다.', unsafe: true }];
  ancestors.add(value);
  const issues: JsonIssue[] = [];
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const index = typeof key === 'string' ? Number(key) : NaN;
    const arrayIndex =
      array &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < value.length &&
      String(index) === key;
    const childPath =
      typeof key === 'string'
        ? [...fieldPath, arrayIndex ? index : key]
        : fieldPath;
    if (
      typeof key !== 'string' ||
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      (array && !arrayIndex)
    ) {
      issues.push({
        fieldPath: childPath,
        message: '문자열 키의 JSON 데이터 속성이어야 합니다.',
        unsafe: true,
      });
      continue;
    }
    issues.push(...inspectJson(descriptor.value, childPath, ancestors));
  }
  if (array) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index))
        issues.push({
          fieldPath: [...fieldPath, index],
          message: '빈 배열 원소는 JSON 값이 아닙니다.',
          unsafe: true,
        });
    }
  }
  ancestors.delete(value);
  return issues;
}

const nonblank = z
  .string()
  .refine(
    /** 공백 여부만 검사하고 원래 문자열은 변환하지 않는다. */ (value) =>
      value.trim().length > 0,
    { message: '빈 문자열이나 공백뿐인 문자열은 허용하지 않습니다.' },
  );
const id = nonblank.refine(
  /** 마지막 개행 앞에서 끝나는 정규식 매칭도 거부한다. */ (value) =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.exec(value)?.[0] === value,
  { message: 'ID는 소문자·숫자를 하이픈으로 연결해야 합니다.' },
);
const userValue = z.custom<JsonValue>();
const deprecatedAlias = z
  .object({ name: nonblank, message: nonblank.optional() })
  .catchall(userValue);
const termStructure = z
  .object({
    type: z.literal('term'),
    id,
    name: nonblank,
    definition: nonblank,
    domain: nonblank,
    examples: z.array(nonblank).optional(),
    deprecatedAliases: z.array(deprecatedAlias).optional(),
  })
  .catchall(userValue);
const knowledgeStructure = z
  .object({
    type: z.literal('knowledge'),
    id,
    title: nonblank,
    body: nonblank,
    domains: z.array(nonblank).min(1),
    kind: z.enum(['policy', 'procedure', 'decision', 'discussion']).optional(),
    status: z.enum(['proposed', 'confirmed', 'deprecated']).optional(),
  })
  .catchall(userValue);
const documentStructure = z.discriminatedUnion('type', [
  termStructure,
  knowledgeStructure,
]);

/** Zod로 구조·JSON을 검사하면서 원래 값과 모든 사용자 키를 그대로 반환한다. */
function preservingSchema<Schema extends z.ZodType>(
  structure: Schema,
): z.ZodType<z.output<Schema>> {
  return z.custom<z.output<Schema>>().superRefine(
    /** 비JSON 객체는 구조 검사 전에 거부하여 getter 실행과 변환을 방지한다. */ (
      value,
      context,
    ) => {
      const jsonIssues = inspectJson(value);
      for (const issue of jsonIssues)
        context.addIssue({
          code: 'custom',
          path: [...issue.fieldPath],
          message: issue.message,
        });
      if (jsonIssues.some((issue) => issue.unsafe)) return;
      const result = structure.safeParse(value);
      if (!result.success)
        for (const issue of result.error.issues) {
          if (
            jsonIssues.some(
              /** JSON 자체 오류가 있으면 같은 경로의 구조 오류를 중복하지 않는다. */
              (jsonIssue) =>
                jsonIssue.fieldPath.length === issue.path.length &&
                jsonIssue.fieldPath.every(
                  (key, index) => key === issue.path[index],
                ),
            )
          )
            continue;
          context.addIssue({ ...issue });
        }
    },
  );
}

/** type으로 분기하며 모든 사용자 JSON 값을 보존하는 문서 스키마다. */
const documentSchema = preservingSchema(documentStructure);
/** Zod term 스키마에서 추출한 성공 문서 타입이다. */
export type Term = z.infer<typeof termStructure>;
/** Zod knowledge 스키마에서 추출한 성공 문서 타입이다. */
export type Knowledge = z.infer<typeof knowledgeStructure>;

/** 전체 문서 데이터와 호출자가 확인한 선택적인 원문 위치다. */
export interface ValidateDocumentInput {
  data: unknown;
  path?: string;
  source?: string;
  fields?: readonly FieldRanges[];
  rootRange?: OffsetRange;
}
/** Zod 내부 오류를 노출하지 않는 제품 스키마 진단이다. */
export interface SchemaDiagnostic extends Diagnostic {
  code: SchemaDiagnosticCode;
  fieldPath: FieldPath;
}
/** 오류가 없을 때만 문서 타입을 제공한다. 경고는 성공을 막지 않는다. */
export type DocumentValidationResult =
  | {
      success: true;
      data: Term | Knowledge;
      errors: readonly SchemaDiagnostic[];
      warnings: readonly SchemaDiagnostic[];
    }
  | {
      success: false;
      errors: readonly SchemaDiagnostic[];
      warnings: readonly SchemaDiagnostic[];
    };

/** 확인된 경로의 범위만 선택하며 누락은 직접 부모의 값 범위를 사용한다. */
function diagnosticRange(
  input: ValidateDocumentInput,
  fieldPath: FieldPath,
  code: SchemaDiagnosticCode,
): SourceRange | undefined {
  if (input.source === undefined) return undefined;
  const missing = code === schemaDiagnosticCodes.missingRequiredField;
  const target = missing ? fieldPath.slice(0, -1) : fieldPath;
  const field = input.fields?.find(
    (candidate) =>
      candidate.fieldPath.length === target.length &&
      candidate.fieldPath.every((part, index) => part === target[index]),
  );
  const offsets =
    target.length === 0
      ? input.rootRange
      : code === schemaDiagnosticCodes.unknownField
        ? field?.key
        : field?.value;
  if (!offsets || offsets.start > offsets.end) return undefined;
  const start = offsetToPosition(input.source, offsets.start);
  const end = offsetToPosition(input.source, offsets.end);
  return start && end ? { start, end } : undefined;
}

/** 제품 코드와 선택적인 메타데이터로 진단을 만든다. */
function diagnostic(
  input: ValidateDocumentInput,
  code: SchemaDiagnosticCode,
  fieldPath: FieldPath,
  message: string,
): SchemaDiagnostic {
  const range = diagnosticRange(input, fieldPath, code);
  return {
    code,
    severity: code === schemaDiagnosticCodes.unknownField ? 'warning' : 'error',
    message,
    fieldPath: [...fieldPath],
    ...(input.path !== undefined ? { path: input.path } : {}),
    ...(range ? { range } : {}),
  };
}

/** 알려진 업무 객체의 미등록 키만 경고하며 사용자 JSON 내부는 해석하지 않는다. */
function unknownWarnings(input: ValidateDocumentInput): SchemaDiagnostic[] {
  const type = ownValue(input.data, 'type');
  if (type !== 'term' && type !== 'knowledge') return [];
  const warnings: SchemaDiagnostic[] = [];
  /** 직접 업무 속성만 검사하고 비문자열 키는 JSON 오류에 맡긴다. */
  function collect(
    value: unknown,
    known: readonly string[],
    path: FieldPath,
  ): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return;
    for (const key of Object.keys(value))
      if (!known.includes(key))
        warnings.push(
          diagnostic(
            input,
            schemaDiagnosticCodes.unknownField,
            [...path, key],
            '알려지지 않은 사용자 속성을 보존합니다.',
          ),
        );
  }
  collect(
    input.data,
    Object.keys(
      type === 'term' ? termStructure.shape : knowledgeStructure.shape,
    ),
    [],
  );
  const aliases = ownValue(input.data, 'deprecatedAliases');
  if (type === 'term' && Array.isArray(aliases))
    for (let index = 0; index < aliases.length; index++)
      collect(
        ownValue(aliases, index),
        ['name', 'message'],
        ['deprecatedAliases', index],
      );
  return warnings;
}

/** Zod 오류를 원래 입력의 존재 여부와 자료형으로 제품 오류 코드에 연결한다. */
function issueCode(
  data: unknown,
  issue: z.core.$ZodIssue,
): SchemaDiagnosticCode {
  let value: unknown = data;
  let present = true;
  for (const key of issue.path) {
    if (typeof key !== 'string' && typeof key !== 'number') break;
    present =
      typeof value === 'object' && value !== null && Object.hasOwn(value, key);
    value = ownValue(value, key);
  }
  if (!present && issue.code !== 'custom')
    return schemaDiagnosticCodes.missingRequiredField;
  if (issue.code === 'invalid_type')
    return schemaDiagnosticCodes.invalidFieldType;
  if (
    (issue.code === 'invalid_value' || issue.code === 'invalid_union') &&
    typeof value !== 'string'
  )
    return schemaDiagnosticCodes.invalidFieldType;
  return schemaDiagnosticCodes.invalidFieldValue;
}

/** IO 없이 전체 문서를 검증한다. 입력 데이터와 원문·범위를 변경하지 않는다.
 * @param input 호출자가 읽거나 병합한 전체 데이터와 선택적인 위치다.
 * @returns 성공 문서 또는 오류와 별도의 사용자 속성 경고다. 저장 허용은 판단하지 않는다.
 */
export function validateDocument(
  input: ValidateDocumentInput,
): DocumentValidationResult {
  const warnings = unknownWarnings(input);
  const result = documentSchema.safeParse(input.data);
  if (result.success)
    return { success: true, data: result.data, errors: [], warnings };
  const errors = result.error.issues.map(
    /** Zod의 경로를 공통 문자열 키·숫자 인덱스 경로로 변환한다. */ (issue) =>
      diagnostic(
        input,
        issueCode(input.data, issue),
        issue.path.filter(
          (key): key is string | number =>
            typeof key === 'string' || typeof key === 'number',
        ),
        issue.message,
      ),
  );
  return { success: false, errors, warnings };
}
