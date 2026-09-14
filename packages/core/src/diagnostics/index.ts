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

/** 사용자에게 반환하는 YAML 진단의 고정 문구다. 라이브러리의 상세 문구는 별도로 이어 붙인다. */
export const yamlDiagnosticMessages = {
  /** 원문 입력이 문자열이 아닐 때 사용한다. */
  sourceMustBeString: 'YAML 원문은 문자열이어야 합니다.',
  /** 빈 문서 또는 최상위 값이 매핑이 아닐 때 사용한다. */
  rootMustBeMapping: '최상위 YAML 값은 매핑이어야 합니다.',
  /** 병합 키를 발견했을 때 사용한다. */
  mergeKeyNotSupported: '병합 키는 지원하지 않습니다.',
  /** 앵커 토큰을 발견했을 때 사용한다. */
  anchorNotSupported: '앵커는 지원하지 않습니다.',
  /** 별칭 토큰을 발견했을 때 사용한다. */
  aliasNotSupported: '별칭은 지원하지 않습니다.',
  /** 사용자 태그를 발견했을 때 사용한다. */
  customTagNotSupported: '사용자 태그는 지원하지 않습니다.',
  /** 두 번째 YAML 문서를 발견했을 때 사용한다. */
  multipleDocumentsNotSupported: '복수 YAML 문서는 지원하지 않습니다.',
  /** 중복 매핑 키를 발견했을 때 사용한다. */
  duplicateKeyNotSupported: '중복 매핑 키는 지원하지 않습니다.',
  /** YAML 라이브러리의 문법 오류 상세 문구 앞에 붙인다. */
  syntaxErrorPrefix: 'YAML 문법 오류: ',
} as const;

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

/** 사용자에게 반환하는 스키마 진단의 고정 문구다. 오류 코드 하나에 여러 원인별 문구가 대응할 수 있다. */
export const schemaDiagnosticMessages = {
  /** JSON 숫자가 NaN 또는 무한대일 때 사용한다. */
  nonFiniteNumber: 'JSON 숫자는 유한해야 합니다.',
  /** undefined·함수 등 JSON 값이 아닌 입력에 사용한다. */
  jsonValueRequired: 'JSON 값이어야 합니다.',
  /** 현재 탐색 경로에서 같은 객체를 다시 발견했을 때 사용한다. */
  cyclicReference: '순환 참조는 JSON 값이 아닙니다.',
  /** 일반 JSON 객체가 아닌 특수 객체에 사용한다. */
  jsonObjectRequired: 'JSON 객체이어야 합니다.',
  /** 접근자·심벌 키·비열거 속성 등 JSON 데이터 속성이 아닌 경우에 사용한다. */
  jsonDataPropertyRequired: '문자열 키의 JSON 데이터 속성이어야 합니다.',
  /** 희소 배열에서 값이 없는 원소를 발견했을 때 사용한다. */
  missingArrayElement: '빈 배열 원소는 JSON 값이 아닙니다.',
  /** 작성된 문자열이 비었거나 공백뿐일 때 사용한다. */
  blankString: '빈 문자열이나 공백뿐인 문자열은 허용하지 않습니다.',
  /** ID가 소문자·숫자·하이픈 규칙에 맞지 않을 때 사용한다. */
  invalidId: 'ID는 소문자·숫자를 하이픈으로 연결해야 합니다.',
  /** 업무 스키마에 없는 사용자 속성을 보존하며 경고할 때 사용한다. */
  unknownField: '알려지지 않은 사용자 속성을 보존합니다.',
} as const;

/** 코드 정의에서 도출한 스키마 진단 코드 타입이다. */
export type SchemaDiagnosticCode =
  (typeof schemaDiagnosticCodes)[keyof typeof schemaDiagnosticCodes];
/** core의 파서와 스키마 검증이 반환하는 진단 코드다. */
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
/** 각 계층이 코드 타입을 지정하는 공통 진단이다. 기본 코드는 core 진단이며 미확인 메타데이터는 생략한다. */
export interface Diagnostic<Code extends string = DiagnosticCode> {
  code: Code;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  fieldPath?: FieldPath;
  range?: SourceRange;
}
