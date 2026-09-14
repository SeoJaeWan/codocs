/** YAML 파서가 반환하는 오류 코드와 발생 조건이다. */
export const yamlDiagnosticCodes = {
  /** 입력이 문자열이 아니거나, YAML 문법 오류가 있거나, 최상위 값이 매핑이 아니면 반환한다. 빈 문서도 포함한다. */
  invalidYaml: 'invalid_yaml',
  /** 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 매핑 키가 있으면 반환한다. 중첩 매핑과 flow 표기 자체는 허용한다. */
  unsupportedYamlFeature: 'unsupported_yaml_feature',
} as const;

/** 오류 코드 정의에서 도출한 YAML 진단 코드 타입이다. */
export type YamlDiagnosticCode =
  (typeof yamlDiagnosticCodes)[keyof typeof yamlDiagnosticCodes];

/** 문서 스키마 검증이 반환하는 진단 코드와 발생 조건이다. */
export const schemaDiagnosticCodes = {
  /** 필수 속성이 입력에 없으면 반환한다. */
  missingRequiredField: 'missing_required_field',
  /** 속성이나 배열 원소의 자료형이 계약과 다르면 반환한다. */
  invalidFieldType: 'invalid_field_type',
  /** 문자열·ID·열거 값·배열 길이 또는 JSON 값이 계약과 다르면 반환한다. */
  invalidFieldValue: 'invalid_field_value',
  /** 문서의 업무 스키마에 없는 사용자 속성을 보존하며 경고한다. */
  unknownField: 'unknown_field',
} as const;

/** 코드 정의에서 도출한 스키마 진단 코드 타입이다. */
export type SchemaDiagnosticCode =
  (typeof schemaDiagnosticCodes)[keyof typeof schemaDiagnosticCodes];
/** 파서와 스키마 검증에서 공통으로 사용하는 진단 코드다. */
export type DiagnosticCode = YamlDiagnosticCode | SchemaDiagnosticCode;
/** 오류와 경고를 구분하는 공통 심각도다. */
export type DiagnosticSeverity = 'error' | 'warning';
/** 시작 포함·끝 제외인 0 기반 UTF-16 원문 범위다. */
export interface OffsetRange {
  start: number;
  end: number;
}
/** 0 기반 UTF-16 줄 좌표다. */
export interface SourcePosition {
  line: number;
  character: number;
}
/** 외부 진단에 사용하는 시작 포함·끝 제외 좌표다. */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}
/** 매핑 키와 배열 인덱스로 구성한 경로다. */
export type FieldPath = readonly (string | number)[];
/** 파서와 스키마 검증의 공통 진단이며 확인할 수 없는 메타데이터는 생략한다. */
export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  fieldPath?: FieldPath;
  range?: SourceRange;
}
