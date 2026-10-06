/** 이름 변경 반영에서 파일별로 보고하는 실제 상태다. @domainValues */
export const workspaceRenameFileStates = {
  /** 새 내용으로 교체했고 그대로 남아 있다. */
  changed: 'changed',
  /** 중간 실패 뒤 원래 내용으로 되돌렸다. */
  restored: 'restored',
  /** 중간 실패 뒤 원래 내용으로 되돌리지 못해 새 내용이 남아 있을 수 있다. */
  restoreFailed: 'restore_failed',
  /** 이 요청이 바꾸지 않았다. */
  unchanged: 'unchanged',
} as const;
/** 원본 상수에서 도출한 이름 변경 파일 상태 타입이다. */
export type WorkspaceRenameFileState =
  (typeof workspaceRenameFileStates)[keyof typeof workspaceRenameFileStates];

/** 이름 변경 변경·영향·파일 결과가 .codocs 문서가 아닌 파일일 때 붙이는 구분이다. 문서(YAML) 항목에는 붙이지 않는다. @domainValues */
export const workspaceRenameFileKinds = {
  /** 코드 파일의 `@codocs [[ ]]` 표기이다. 이름 변경 반영 경로에서만 쓰기를 허용한다. */
  code: 'code',
} as const;
/** 원본 상수에서 도출한 이름 변경 파일 구분 타입이다. */
export type WorkspaceRenameFileKind =
  (typeof workspaceRenameFileKinds)[keyof typeof workspaceRenameFileKinds];

/** 코드 수집에서 특정 파일로 좁힐 수 없는 실패(감시 손상·Git 확인 실패 등)를 미확인 영향으로 보고할 때 쓰는 경로다. */
export const workspaceRenameUnknownCodePath = '.';
/** 파일을 읽지 못해 표기를 확인하지 못한 코드 영향에 쓰는 occurrenceIndex다. 표기 순번이 없다는 뜻이다. */
export const workspaceRenameUnreadOccurrenceIndex = -1;
