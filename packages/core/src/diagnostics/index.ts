import { type DiagnosticSeverity } from './domain-values.js';
export * from './domain-values.js';
/** YAML 파서가 반환하는 오류 코드와 발생 조건이다. @domainValues */
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

/** 문서 스키마 검증이 반환하는 진단 코드와 발생 조건이다. @domainValues */
export const schemaDiagnosticCodes = {
  /** 필수 속성이 입력에 없으면 반환한다. */
  missingRequiredField: 'missing_required_field',
  /** 속성이나 배열 원소의 자료형이 계약과 다르면 반환한다. */
  invalidFieldType: 'invalid_field_type',
  /** 문자열·ID·열거 값·배열 길이 또는 JSON 값이 계약과 다르면 반환한다. */
  invalidFieldValue: 'invalid_field_value',
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
  /** `_codocs` 안에 id·name·parent 외의 키가 있을 때 사용한다. */
  unknownMetadataKey: '`_codocs`에는 id, name, parent만 쓸 수 있습니다.',
  /** `_codocs` 외에 밑줄로 시작하는 루트 키가 있을 때 사용한다. */
  reservedRootKey: '밑줄(_)로 시작하는 루트 키는 `_codocs`만 쓸 수 있습니다.',
  /** `_codocs` 외에 section이 하나도 없을 때 사용한다. */
  sectionRequired: '문자열 section이 하나 이상 필요합니다.',
} as const;

/** 코드 정의에서 도출한 스키마 진단 코드 타입이다. */
export type SchemaDiagnosticCode =
  (typeof schemaDiagnosticCodes)[keyof typeof schemaDiagnosticCodes];
/** 본문 참조 문법의 진단 코드다. 이름·ID 의미 해석은 별도 계층이 담당한다. @domainValues */
export const referenceDiagnosticCodes = {
  /** 빈 이름·섹션, 잘못된 구성, 닫히지 않은 참조 또는 중첩 시작이면 반환한다. */
  invalidReference: 'invalid_reference',
} as const;
/** 참조 문법 계층의 고정 진단 문구다. */
export const referenceDiagnosticMessages = {
  /** 잘못된 구성이나 미완성 참조에서 사용한다. */
  invalidReference: '참조 구문이 올바르지 않습니다.',
} as const;
/** 코드 상수에서 도출한 참조 문법 진단 코드다. */
export type ReferenceDiagnosticCode =
  (typeof referenceDiagnosticCodes)[keyof typeof referenceDiagnosticCodes];
/** 경로 색인·참조 의미 해석의 코드다. IO 실패 코드는 포함하지 않는다. @domainValues */
export const catalogDiagnosticCodes = {
  /** 문자열 ID가 여러 발견 경로에 존재하면 모든 경로에 반환한다. */
  duplicateId: 'duplicate_id',
  /** 프로젝트 전체의 이름 공간에 같은 이름의 경로가 여러 개 있으면 반환한다. */
  duplicateName: 'duplicate_name',
  /** `_codocs.parent`의 이름에 해당하는 문서가 없으면 반환한다. */
  parentNotFound: 'parent_not_found',
  /** `_codocs.parent` 관계가 순환하면 순환에 속한 문서에 반환한다. 자기 자신을 parent로 지정한 경우도 포함한다. */
  parentCycle: 'parent_cycle',
  /** 완전한 색인에 이름 후보가 없을 때 반환한다. */
  missingReference: 'missing_reference',
  /** 완전한 색인에 이름 후보 경로가 여러 개일 때 반환한다. */
  ambiguousReference: 'ambiguous_reference',
  /** 문서 하나로 확정된 참조의 섹션이 대상 문서의 루트 키에 없으면 반환한다. 같은 문서 안의 섹션 참조도 포함한다. */
  missingSectionReference: 'missing_section_reference',
  /** 단일 참조 대상이 출처의 발견 경로와 같으면 반환한다. */
  selfReference: 'self_reference',
  /** 스캔·후보가 미확인이라 부재·단일 대상을 확정할 수 없으면 반환한다. */
  unconfirmedReference: 'unconfirmed_reference',
  /** 확정 경로 대상에 문서 오류가 있을 때 연결을 유지하며 경고한다. */
  referenceTargetError: 'reference_target_error',
} as const;
/** 색인 계층이 소유하는 고정 문구다. */
export const catalogDiagnosticMessages = {
  duplicateId: '같은 ID를 가진 발견 경로가 여러 개입니다.',
  duplicateName: '같은 이름을 가진 문서가 여러 개입니다.',
  parentNotFound: 'parent 이름에 해당하는 문서가 없습니다.',
  parentCycle: 'parent 관계가 순환합니다.',
  missingReference: '참조 이름에 해당하는 문서가 없습니다.',
  ambiguousReference: '참조 이름에 해당하는 문서가 여러 개입니다.',
  missingSectionReference: '참조한 문서에 해당 섹션이 없습니다.',
  selfReference: '같은 발견 문서를 자기 참조할 수 없습니다.',
  unconfirmedReference: '스캔이 불완전하여 참조 대상을 확정할 수 없습니다.',
  referenceTargetError: '확정 참조 대상에 문서 오류가 있습니다.',
} as const;
/** 상수에서 도출한 색인 진단 코드다. */
export type CatalogDiagnosticCode =
  (typeof catalogDiagnosticCodes)[keyof typeof catalogDiagnosticCodes];
/** 변경 후보 계산이 반환하는 오류 코드다. @domainValues */
export const changePlanDiagnosticCodes = {
  /** 요청 형태·속성 지정이 유효하지 않다. */
  invalidRequest: 'invalid_change_request',
  /** 현재 ID가 없거나 여러 경로와 충돌한다. */
  targetUnavailable: 'change_target_unavailable',
  /** 생성 경로가 이미 관측되었다. */
  pathExists: 'change_path_exists',
  /** 요청 revision과 읽은 원문 revision이 다르다. */
  revisionMismatch: 'change_revision_mismatch',
  /** 불완전한 관측으로 충돌을 확정할 수 없다. */
  incompleteCatalog: 'change_incomplete_catalog',
  /** UTF-8 디코딩 손실로 원문 보존 후보를 만들 수 없다. */
  sourceNotLossless: 'source_not_lossless',
  /** 후보의 재파싱 데이터가 기대 데이터와 다르다. */
  candidateMismatch: 'candidate_mismatch',
  /** 수정 요청의 name이 현재 이름과 달라 이름 변경이 필요하다. */
  nameChangeNotAllowed: 'name_change_not_allowed',
} as const;
/** 후보 계산의 고정 진단 문구다. */
export const changePlanDiagnosticMessages = {
  invalidRequest: '변경 요청이 올바르지 않습니다.',
  targetUnavailable: '현재 ID로 확인한 수정 대상이 없습니다.',
  pathExists: '생성 경로에 이미 문서가 있습니다.',
  revisionMismatch: '요청한 원문 버전이 현재 읽은 버전과 다릅니다.',
  incompleteCatalog: '불완전한 관측에서 변경 후보의 충돌을 확정할 수 없습니다.',
  sourceNotLossless: '원본 UTF-8 바이트를 손실 없이 보존할 수 없습니다.',
  candidateMismatch: '후보를 다시 읽은 데이터가 요청한 데이터와 다릅니다.',
  nameChangeNotAllowed:
    '문서 이름은 수정 요청으로 바꿀 수 없습니다. 이름 변경은 codocs_rename으로 참조와 함께 바꾸세요.',
} as const;
/** 변경 후보 계산의 오류 코드다. */
export type ChangePlanDiagnosticCode =
  (typeof changePlanDiagnosticCodes)[keyof typeof changePlanDiagnosticCodes];
/** 이름 변경 반영이 반환하는 오류 코드다. @domainValues */
export const renameDiagnosticCodes = {
  /** 이름 변경을 진행할 수 없는 상태라 아무 파일도 바꾸지 않았다. */
  blocked: 'rename_blocked',
  /** 반영 때 다시 계산한 영향 파일이 미리보기에서 받은 파일 집합을 벗어난다. */
  affectedFilesChanged: 'rename_affected_files_changed',
  /** 중간 실패 뒤 이미 바꾼 파일을 원래 내용으로 되돌리지 못했다. */
  restoreFailed: 'rename_restore_failed',
} as const;
/** 이름 변경 진단의 고정 문구다. */
export const renameDiagnosticMessages = {
  blocked: '이름 변경을 진행할 수 없어 파일을 바꾸지 않았습니다.',
  affectedFilesChanged:
    '미리보기 이후 영향받는 파일이 달라져 파일을 바꾸지 않았습니다. 미리보기를 다시 요청하세요.',
  restoreFailed: '이미 바꾼 파일을 원래 내용으로 되돌리지 못했습니다.',
} as const;
/** 이름 변경 진단 코드의 원본 값에서 도출한 타입이다. */
export type RenameDiagnosticCode =
  (typeof renameDiagnosticCodes)[keyof typeof renameDiagnosticCodes];
/** 조회 투영에서 외부 계약으로 정규화하는 진단 코드다. @domainValues */
export const queryDiagnosticCodes = {
  /** 검증 경로가 프로젝트 상대 .codocs YAML 파일이 아니면 반환한다. */
  invalidPath: 'invalid_path',
  /** 검증 대상 파일이나 배포 가이드 원문에 접근하지 못하면 반환한다. */
  fileAccessFailed: 'file_access_failed',
  /** 전체 요청의 ID 배열이나 크기가 계약과 다르면 반환한다. */
  invalidInput: 'invalid_input',
  /** 완전한 Catalog에 요청한 ID가 없으면 반환한다. */
  notFound: 'not_found',
  /** 직접 참조 이름에 해당하는 대상 경로가 없으면 반환한다. */
  referenceNotFound: 'reference_not_found',
  /** 직접 참조 이름에 해당하는 대상 경로가 여러 개면 반환한다. */
  referenceAmbiguous: 'reference_ambiguous',
  /** 참조가 문서 하나로 확정되었지만 그 문서에 참조한 섹션이 없으면 반환한다. */
  sectionReferenceNotFound: 'section_reference_not_found',
} as const;
/** 조회 투영이 추가하는 고정 진단 문구다. */
export const queryDiagnosticMessages = {
  invalidPath: '프로젝트 상대 .codocs YAML 파일 경로 하나를 지정하세요.',
  fileNotFound: '검증할 파일이 없습니다.',
  fileAccessFailed: '검증할 파일을 읽을 수 없습니다.',
  /** 배포 가이드 파일 접근에 실패한 경우다. 색인 준비 상태와 무관하다. */
  guideFileAccessFailed:
    '배포된 가이드 원문을 읽을 수 없습니다. 패키지 설치 상태를 확인하세요.',
  invalidInput: '조회 입력이 올바르지 않습니다.',
  notFound: '요청한 ID의 문서가 없습니다.',
  referenceNotFound: '참조 이름에 해당하는 문서가 없습니다.',
  referenceAmbiguous: '참조 이름에 해당하는 문서가 여러 개입니다.',
  sectionReferenceNotFound: '참조한 문서에 해당 섹션이 없습니다.',
  referenceTargetMissingId: '확정 참조 대상에 ID가 없습니다.',
  referenceTargetInvalidId: '확정 참조 대상의 ID가 올바르지 않습니다.',
  referenceTargetDuplicateId: '확정 참조 대상의 ID가 중복되었습니다.',
} as const;
/** 상수에서 도출한 조회 진단 코드다. */
export type QueryDiagnosticCode =
  (typeof queryDiagnosticCodes)[keyof typeof queryDiagnosticCodes];
/** 파일 저장에서 실제 반영 여부와 함께 반환하는 진단 코드다. @domainValues */
export const storageDiagnosticCodes = {
  /** 저장 직전 디스크 원문이 요청의 기준 버전과 다르다. */
  revisionConflict: 'revision_conflict',
  /** 생성 대상이 등록 전에 이미 존재하거나 경쟁 중 생성되었다. */
  fileExists: 'file_exists',
  /** 임시 기록·닫기·반영·요청 임시 파일 정리에 실패했다. */
  fileWriteFailed: 'file_write_failed',
  /** 최신 문서 탐색으로 ID 충돌 여부를 확정할 수 없다. */
  fileAccessFailed: 'file_access_failed',
  /** 저장된 파일의 세션 색인 반영 또는 추가 복구가 실패했다. */
  indexUpdateFailed: 'index_update_failed',
} as const;
/** 저장 진단의 고정 문구다. 원인별 후속 안내는 suggestion에 둔다. */
export const storageDiagnosticMessages = {
  revisionConflict: '저장 전 원문이 변경되었습니다.',
  fileExists: '생성 대상 파일이 이미 있습니다.',
  fileWriteFailed: '파일 저장에 실패했습니다.',
  cleanupFailed: '파일은 저장되었지만 요청 임시 파일 정리에 실패했습니다.',
  fileAccessFailed: '저장 전 파일 상태를 확인할 수 없습니다.',
  indexUpdateFailed: '파일은 저장되었지만 문서 색인을 갱신하지 못했습니다.',
} as const;
/** 저장 진단 코드의 원본 값에서 도출한 타입이다. */
export type StorageDiagnosticCode =
  (typeof storageDiagnosticCodes)[keyof typeof storageDiagnosticCodes];
/** core의 파서·스키마 검증·참조 문법·색인이 반환하는 진단 코드다. */
export type DiagnosticCode =
  | YamlDiagnosticCode
  | SchemaDiagnosticCode
  | ReferenceDiagnosticCode
  | CatalogDiagnosticCode
  | ChangePlanDiagnosticCode
  | QueryDiagnosticCode
  | StorageDiagnosticCode
  | RenameDiagnosticCode;
/** 오류와 경고를 구분하는 공통 심각도다. */

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
  suggestion?: string;
  fieldPath?: FieldPath;
  range?: SourceRange;
}

/** 요청 실패는 개별 문서의 진단과 구분하여 공통 error로 전달한다. */
export interface RequestFailure<Code extends string = string> {
  success: false;
  error: Diagnostic<Code>;
}

/** 요청 처리 성공과 실패를 같은 의미의 분기 타입으로 전달한다. */
export type RequestResult<
  Success extends { success: true },
  Failure extends RequestFailure = RequestFailure,
> = Success | Failure;
