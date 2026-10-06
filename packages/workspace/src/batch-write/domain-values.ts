/** 세션 write 입력을 처리 경로별로 나눈 종류다. @domainValues */
export const workspaceWriteInputKinds = {
  /** create·update·replace 단일 요청이며 기존 단일 저장 경로를 쓴다. */
  single: 'single',
  /** delete·move 단일 요청이며 항목 하나의 다중 계획 경로를 쓴다. */
  singleBatch: 'single_batch',
  /** `{changes: [...]}` 요청이다. */
  batch: 'batch',
} as const;
/** 원본 상수에서 도출한 write 입력 종류 타입이다. */
export type WorkspaceWriteInputKind =
  (typeof workspaceWriteInputKinds)[keyof typeof workspaceWriteInputKinds];

/** 여러 항목 저장 요청의 최상위 속성 이름이다. @domainValues */
export const workspaceBatchInputKeys = {
  /** 항목 배열을 담는 유일한 최상위 속성이다. */
  changes: 'changes',
} as const;

/** 단일 요청으로도 받는 문서 삭제·이동 종류다. @domainValues */
export const workspaceDocumentMoveModes = {
  /** 문서 파일을 지운다. */
  delete: 'delete',
  /** 문서 파일을 없는 경로로 옮긴다. */
  move: 'move',
} as const;
