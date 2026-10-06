/** 코드 수집은 문서 탐색과 독립적으로 진행한다. @domainValues */
export const codeCollectionStatuses = {
  /** 초기 수집 또는 변경 재확인이 진행 중이다. */
  collecting: 'collecting',
  /** 검색 범위와 모든 적격 원문을 확인했다. */
  complete: 'complete',
  /** Git·탐색·읽기·감시 전제 중 하나 이상을 확인하지 못했다. */
  incomplete: 'incomplete',
} as const;
/** 출현 원문을 제공하는 관측 계층이다. @domainValues */
export const codeObservationKinds = {
  /** 현재 저장 파일의 UTF-8 원문이다. */
  disk: 'disk',
  /** 적격 파일의 현재 IDE 편집 텍스트다. */
  buffer: 'buffer',
} as const;
/** 파일 제외와 실제 수집 실패를 구분한다. @domainValues */
export const codeFileReasons = {
  /** 프로젝트 또는 파일 경계를 벗어나거나 연결을 사용한다. */
  boundary: 'boundary',
  /** 미추적 경로에 프로젝트 ignore 규칙이 적용된다. */
  ignored: 'ignored',
  /** NUL 바이트 또는 UTF-8로 해석 불가능한 바이트가 있다. */
  binary: 'binary',
  /** Git 추적 상태를 확인할 수 없다. */
  git: 'git',
  /** 경로·디렉터리·원문 읽기를 확인할 수 없다. */
  read: 'read',
  /** 감시 등록 또는 실행이 실패했다. */
  watch: 'watch',
  /** 파일 정체 또는 원문이 읽기 도중 바뀌었다. */
  changed: 'changed',
} as const;
/** Git 추적을 확인한 저장소 유형이다. @domainValues */
export const codeRepositoryKinds = {
  /** Git 명령으로 추적 파일 집합을 확인했다. */
  git: 'git',
  /** Git이 명시적으로 저장소 부재를 확인했다. */
  nonGit: 'non_git',
  /** Git 실행 전제 또는 상태를 확인하지 못했다. */
  unknown: 'unknown',
} as const;
/** 저장 보호가 코드 참조 영향을 증명하지 못했을 때 쓰는 진단 코드다. @domainValues */
export const workspaceCodeEvidenceDiagnosticCodes = {
  /** 섹션 삭제가 코드 참조를 끊는지 완전한 코드 수집으로 확인하지 못하면 반환한다. */
  incomplete: 'code_evidence_incomplete',
} as const;
