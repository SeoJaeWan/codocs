/** 이름 변경이 파일을 바꾸기 전에 중단된 이유다. @domainValues */
export const renameAbortReasons = {
  /** 이름을 바꿀 수 있는 위치가 아니다. */
  notRenamable: 'not_renamable',
  /** 영향받는 파일 중 저장하지 않은 수정이 있다. */
  dirtyFiles: 'dirty_files',
  /** 서버가 요청을 계산하지 못했다. */
  planFailed: 'plan_failed',
  /** 이름 변경을 진행할 수 없는 상태(blocked)다. */
  blocked: 'blocked',
  /** 사용자가 이름 바꾸기를 취소했다. */
  cancelled: 'cancelled',
} as const;

/** 원본 상수에서 도출한 이름 변경 중단 이유다. */
export type RenameAbortReason =
  (typeof renameAbortReasons)[keyof typeof renameAbortReasons];

/** 영향 참조 중 사용자가 대상을 골라야 하는 이유다. @domainValues */
export const renameChoiceReasons = {
  /** 후보 여럿 중 대상을 골라야 한다. */
  selectionRequired: 'selection_required',
  /** 이름 변경으로 모호한 참조가 다른 후보로 확정되어 대상을 골라야 한다. */
  changedResolution: 'changed_resolution',
} as const;

/** 서버가 반영을 거절하거나 실패했을 때 알리는 오류 코드다. @domainValues */
export const renameApplyErrorCodes = {
  /** 진행할 수 없는 상태라 파일을 바꾸지 않았다. */
  renameBlocked: 'rename_blocked',
  /** 영향받는 파일이 미리보기 때와 달라졌다. */
  affectedFilesChanged: 'rename_affected_files_changed',
  /** 파일의 revision이 미리보기 때와 달라졌다. */
  revisionConflict: 'revision_conflict',
  /** 쓰는 도중 실패했고 일부 파일을 되돌리지 못했다. */
  restoreFailed: 'rename_restore_failed',
} as const;

/** 파일별 반영 상태다. @domainValues */
export const renameFileStates = {
  /** 새 내용으로 교체했다. */
  changed: 'changed',
  /** 실패 뒤 원래 내용으로 되돌렸다. */
  restored: 'restored',
  /** 실패 뒤 원래 내용으로 되돌리지 못했다. */
  restoreFailed: 'restore_failed',
  /** 바꾸지 않았다. */
  unchanged: 'unchanged',
} as const;

/** 이름 변경을 진행할 수 없는 상태(blocked)의 이유다. @domainValues */
export const renameBlockingReasons = {
  /** 변경 대상이나 원문 위치를 사용할 수 없다. */
  targetUnavailable: 'target_unavailable',
  /** 새 이름이 유효하지 않다. */
  invalidName: 'invalid_name',
  /** 프로젝트의 다른 문서가 새 이름을 이미 쓴다. */
  nameConflict: 'name_conflict',
  /** 스캔이나 대상을 확정하지 못했다. */
  unconfirmed: 'unconfirmed',
  /** 참조 선택 입력이 유효하지 않다. */
  invalidSelection: 'invalid_selection',
  /** 바꿀 파일의 원본을 UTF-8 손실 없이 보존할 수 없다. */
  sourceNotLossless: 'source_not_lossless',
  /** 바꿀 위치의 표기로 새 이름을 안전하게 적을 수 없다. */
  unrepresentable: 'unrepresentable',
} as const;

/** 참조 해석 상태 중 후보가 여럿이라 대상을 확정하지 못한 상태다. @domainValues */
export const renameAmbiguousStatus = 'ambiguous';
