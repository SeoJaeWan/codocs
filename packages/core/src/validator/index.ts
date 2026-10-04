import { z } from 'zod';
import { diagnosticSeverities } from '../diagnostics/domain-values.js';
import type {
  Diagnostic,
  DiagnosticSeverity,
  FieldPath,
  OffsetRange,
  SchemaDiagnosticCode,
  SourceRange,
} from '../diagnostics/index.js';
import {
  schemaDiagnosticCodes,
  schemaDiagnosticMessages,
} from '../diagnostics/index.js';
import type { FieldRanges } from '../parser/index.js';
import { offsetToPosition } from '../parser/index.js';

/** 외부 응답에서 문서 값을 그대로 전달할 때 쓰는 재귀 JSON 값이다. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const nonblank = z
  .string()
  .refine(
    /** 공백 여부만 검사하고 원래 문자열은 변환하지 않는다. */ (value) =>
      value.trim().length > 0,
    { message: schemaDiagnosticMessages.blankString },
  );
const id = nonblank.refine(
  /** 마지막 개행 앞에서 끝나는 정규식 매칭도 거부한다. */ (value) =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.exec(value)?.[0] === value,
  { message: schemaDiagnosticMessages.invalidId },
);
const metadataStructure = z.object({
  id,
  name: nonblank,
  parent: z.array(nonblank).optional(),
});
/** 문서 메타데이터를 담는 루트 키다. 이 키가 아닌 루트 키는 모두 section이다. */
export const codocsKey = '_codocs';
const documentStructure = z
  .object({ [codocsKey]: metadataStructure })
  .catchall(nonblank);

/** 스키마 원본에서 도출한 `_codocs` 안의 필드 이름이다. @domainValues */
export const metadataFields = {
  /** 외부 조회에 사용하는 문서 식별자다. */
  id: metadataStructure.keyof().enum.id,
  /** 이름 참조에서 사용하는 문서 이름이다. */
  name: metadataStructure.keyof().enum.name,
  /** 상위 문서 이름 목록이다. 선택 속성이다. */
  parent: metadataStructure.keyof().enum.parent,
} satisfies Record<keyof typeof metadataStructure.shape, string>;

/** 문서 메타데이터 필드의 루트부터의 경로다. @domainValues */
export const documentFields = {
  /** 외부 조회에 사용하는 문서 식별자의 경로다. */
  id: [codocsKey, metadataFields.id],
  /** 이름 참조에서 사용하는 문서 이름의 경로다. */
  name: [codocsKey, metadataFields.name],
  /** 상위 문서 이름 목록의 경로다. */
  parent: [codocsKey, metadataFields.parent],
} as const satisfies Record<keyof typeof metadataFields, FieldPath>;
/** 스키마에서 도출한 문서 메타데이터 필드 경로다. */
export type DocumentField =
  (typeof documentFields)[keyof typeof documentFields];

/** 검증을 통과한 `_codocs` 메타데이터다. */
export type CodocsMetadata = z.infer<typeof metadataStructure>;
/** 검증을 통과한 문서다. `_codocs` 외 루트 키는 비어 있지 않은 문자열 section이다. */
export interface Document {
  [codocsKey]: CodocsMetadata;
  [section: string]: unknown;
}

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
      data: Document;
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
  const offsets = target.length === 0 ? input.rootRange : field?.value;
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
  severity: DiagnosticSeverity = diagnosticSeverities.error,
): SchemaDiagnostic {
  const range = diagnosticRange(input, fieldPath, code);
  return {
    code,
    severity,
    message,
    fieldPath: [...fieldPath],
    ...(input.path !== undefined ? { path: input.path } : {}),
    ...(range ? { range } : {}),
  };
}

/** 자체 데이터 속성만 조회하며 getter와 상속 속성을 실행하지 않는다. */
function ownValue(value: unknown, key: string | number): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor
    ? (descriptor.value as unknown)
    : undefined;
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

/** Zod가 표현하지 못하는 루트 구조 규칙(허용 키·section 수)의 오류 후보다. */
interface StructureIssue {
  fieldPath: FieldPath;
  message: string;
}

/**
 * `_codocs`의 미정의 키, `_codocs` 외 `_` 접두 루트 키, section 부재를 찾는다.
 * 객체가 아닌 입력은 Zod가 보고하므로 빈 목록을 반환한다.
 */
function structureIssues(data: unknown): StructureIssue[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return [];
  const issues: StructureIssue[] = [];
  const metadata = ownValue(data, codocsKey);
  if (typeof metadata === 'object' && metadata !== null) {
    const known: readonly string[] = Object.values(metadataFields);
    for (const key of Object.keys(metadata))
      if (!known.includes(key))
        issues.push({
          fieldPath: [codocsKey, key],
          message: schemaDiagnosticMessages.unknownMetadataKey,
        });
  }
  const rootKeys = Object.keys(data).filter((key) => key !== codocsKey);
  for (const key of rootKeys)
    if (key.startsWith('_'))
      issues.push({
        fieldPath: [key],
        message: schemaDiagnosticMessages.reservedRootKey,
      });
  if (!rootKeys.some((key) => !key.startsWith('_')))
    issues.push({
      fieldPath: [],
      message: schemaDiagnosticMessages.sectionRequired,
    });
  return issues;
}

/** IO 없이 전체 문서를 검증한다. 입력 데이터와 원문·범위를 변경하지 않는다.
 * @param input 호출자가 읽거나 병합한 전체 데이터와 선택적인 위치다.
 * @returns 성공 문서 또는 오류다. 저장 허용은 판단하지 않는다.
 */
export function validateDocument(
  input: ValidateDocumentInput,
): DocumentValidationResult {
  const result = documentStructure.safeParse(input.data);
  const extras = structureIssues(input.data);
  if (result.success && extras.length === 0)
    return {
      success: true,
      data: input.data as Document,
      errors: [],
      warnings: [],
    };
  const errors = (result.success ? [] : result.error.issues).map(
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
  for (const extra of extras)
    if (
      !errors.some(
        /** 같은 경로에 구조 오류가 이미 있으면 중복 보고하지 않는다. */ (
          error,
        ) =>
          error.fieldPath.length === extra.fieldPath.length &&
          error.fieldPath.every((key, index) => key === extra.fieldPath[index]),
      )
    )
      errors.push(
        diagnostic(
          input,
          schemaDiagnosticCodes.invalidFieldValue,
          extra.fieldPath,
          extra.message,
        ),
      );
  return { success: false, errors, warnings: [] };
}
