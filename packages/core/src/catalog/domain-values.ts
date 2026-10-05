/** ScanStatus의 원본 값과 의미다. @domainValues */
export const scanStatuses = {
  /** 확인 대상 탐색을 완료했다. */
  complete: 'complete',
  /** 일부 범위를 확인하지 못했다. */
  partial: 'partial',
  /** 탐색 루트 자체를 확인하지 못했다. */
  failed: 'failed',
} as const;
/** 원본 상수에서 도출한 ScanStatus 타입이다. */
export type ScanStatus = (typeof scanStatuses)[keyof typeof scanStatuses];

/** CatalogConfirmation의 원본 값과 의미다. @domainValues */
export const catalogConfirmations = {
  /** 현재 스캔에서 확인한 문서다. */
  confirmed: 'confirmed',
  /** 현재 확인하지 못해 이전 관측을 보존한 문서다. */
  unconfirmed: 'unconfirmed',
} as const;
/** 원본 상수에서 도출한 CatalogConfirmation 타입이다. */
export type CatalogConfirmation =
  (typeof catalogConfirmations)[keyof typeof catalogConfirmations];

/** ReferenceResolutionStatus의 원본 값과 의미다. @domainValues */
export const referenceResolutionStatuses = {
  /** 참조 문법 오류로 해석할 수 없다. */
  invalid: 'invalid',
  /** 완전한 탐색에서 대상이 없다. */
  missing: 'missing',
  /** 후보가 여러 개라 대상을 확정할 수 없다. */
  ambiguous: 'ambiguous',
  /** 참조 대상이 작성 문서 자신이다. 섹션을 적었고 그 섹션이 있으면 링크만 되는 같은 문서 섹션 참조다. */
  self: 'self',
  /** 탐색이나 후보 확인이 불완전하다. */
  unconfirmed: 'unconfirmed',
  /** 문서 하나로 확정되었지만 참조한 섹션이 그 문서에 없다. 같은 문서의 섹션 참조도 포함한다. */
  missingSection: 'missing_section',
  /** 다른 문서 하나로 확정되었다. 섹션을 적었다면 그 섹션도 대상 문서에 있다. */
  resolved: 'resolved',
} as const;
/** 원본 상수에서 도출한 ReferenceResolutionStatus 타입이다. */
export type ReferenceResolutionStatus =
  (typeof referenceResolutionStatuses)[keyof typeof referenceResolutionStatuses];

/** RenamePlanStatus의 원본 값과 의미다. @domainValues */
export const renamePlanStatuses = {
  /** 수정안 계산이 완료되었다. 저장 허용은 별도 확인한다. */
  ready: 'ready',
  /** 추가 선택이나 해결이 필요한 영향이 있다. */
  unresolved: 'unresolved',
  /** 이름 변경 계획을 진행할 수 없다. */
  blocked: 'blocked',
} as const;
/** 원본 상수에서 도출한 RenamePlanStatus 타입이다. */
export type RenamePlanStatus =
  (typeof renamePlanStatuses)[keyof typeof renamePlanStatuses];

/** RenameImpactReason의 원본 값과 의미다. @domainValues */
export const renameImpactReasons = {
  /** 참조 대상을 명시적으로 선택해야 한다. */
  selectionRequired: 'selection_required',
  /** 선택한 대상이나 참조가 유효하지 않다. */
  invalidSelection: 'invalid_selection',
  /** 참조 수정이 비활성화되어 있다. */
  referencesDisabled: 'references_disabled',
  /** 대상이나 해석을 현재 확정할 수 없다. */
  unconfirmed: 'unconfirmed',
  /** 새 이름을 지원하는 참조 문법으로 하나의 문서로 확정해 표현할 수 없다. */
  unrepresentable: 'unrepresentable',
  /** 이름 변경 후 참조 해석 결과가 달라진다. */
  changedResolution: 'changed_resolution',
} as const;
/** 원본 상수에서 도출한 RenameImpactReason 타입이다. */
export type RenameImpactReason =
  (typeof renameImpactReasons)[keyof typeof renameImpactReasons];

/** RenameBlockingReason의 원본 값과 의미다. @domainValues */
export const renameBlockingReasons = {
  /** 변경 대상이나 원문 위치를 사용할 수 없다. */
  targetUnavailable: 'target_unavailable',
  /** 새 이름이 유효하지 않다. */
  invalidName: 'invalid_name',
  /** 프로젝트의 다른 문서가 새 이름을 이미 쓴다. */
  nameConflict: 'name_conflict',
  /** 스캔이나 대상을 확정하지 못했거나 코드 파일 수집이 진행 중(collecting)이다. */
  unconfirmed: 'unconfirmed',
  /** 참조 선택 입력이 유효하지 않다. */
  invalidSelection: 'invalid_selection',
  /** 바꿀 파일의 원본 UTF-8 바이트를 손실 없이 보존할 수 없다. */
  sourceNotLossless: 'source_not_lossless',
  /** 바꿀 위치의 YAML 표기 형식으로 새 값을 안전하게 쓸 수 없다. */
  unrepresentable: 'unrepresentable',
  /** 섹션 이름 변경에서 같은 이름의 섹션이 대상 문서에 이미 있다. */
  sectionConflict: 'section_conflict',
  /** 섹션 이름 변경의 대상 섹션이 문서에 없다. */
  sectionNotFound: 'section_not_found',
} as const;
/** 원본 상수에서 도출한 RenameBlockingReason 타입이다. */
export type RenameBlockingReason =
  (typeof renameBlockingReasons)[keyof typeof renameBlockingReasons];

/** CatalogFailureKind의 원본 값과 의미다. @domainValues */
export const catalogFailureKinds = {
  /** 해당 파일의 관측에 실패했다. */
  file: 'file',
  /** 해당 폴더 범위의 관측에 실패했다. */
  folder: 'folder',
  /** 실패 범위를 확인하지 못했다. */
  unknown: 'unknown',
} as const;
/** 원본 상수에서 도출한 CatalogFailureKind 타입이다. */
export type CatalogFailureKind =
  (typeof catalogFailureKinds)[keyof typeof catalogFailureKinds];

/** RenameChangeKind의 원본 값과 의미다. 본문 값 수정에는 kind를 적지 않는다. @domainValues */
export const renameChangeKinds = {
  /** 문서 최상위 섹션 키 이름을 바꾸는 수정이다. 따옴표 형식은 유지한다. */
  key: 'key',
} as const;
/** 원본 상수에서 도출한 RenameChangeKind 타입이다. */
export type RenameChangeKind =
  (typeof renameChangeKinds)[keyof typeof renameChangeKinds];
