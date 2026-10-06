/** 명시 표기의 문법 판단이다. @domainValues */
export const codeReferenceSyntaxes = {
  /** 이름과 섹션 표기를 해석했다. */
  valid: 'valid',
  /** 닫힘 또는 이름 문법이 올바르지 않다. */
  invalid: 'invalid',
} as const;
/** 표기가 지정한 저장 대상 영역이다. @domainValues */
export const codeReferenceDestinationKinds = {
  /** 문서 전체를 가리킨다. */
  document: 'document',
  /** 문서의 섹션 키를 가리킨다. */
  section: 'section',
} as const;
/** 저장 색인으로 판단한 연결 결과다. @domainValues */
export const codeReferenceStatuses = {
  /** 하나의 저장 문서(와 섹션)를 확인했다. */
  resolved: 'resolved',
  /** 이름 또는 전체 표기 문법을 해석하지 못했다. */
  invalid: 'invalid',
  /** 완료 색인에 대상 이름이 없다. */
  missing: 'missing',
  /** 대상 문서는 하나로 확정됐지만 그 문서에 적은 섹션이 없다. */
  missingSection: 'missing_section',
  /** 같은 이름·도메인의 후보가 여러 개다. */
  ambiguous: 'ambiguous',
  /** 저장 대상 탐색이 불완전하다. */
  unconfirmed: 'unconfirmed',
} as const;
/** 코드 참조 진단의 고정 코드다. 상태 이름을 그대로 접미사로 쓴다. @domainValues */
export const codeReferenceDiagnosticCodes = {
  /** 이름 또는 전체 표기를 해석하지 못했다. */
  [codeReferenceStatuses.invalid]: 'codocs.codeReference.invalid',
  /** 대상 이름이 없다. */
  [codeReferenceStatuses.missing]: 'codocs.codeReference.missing',
  /** 대상 문서에 적은 섹션이 없다. */
  [codeReferenceStatuses.missingSection]:
    'codocs.codeReference.missing_section',
  /** 대상 후보가 여러 개다. */
  [codeReferenceStatuses.ambiguous]: 'codocs.codeReference.ambiguous',
  /** 대상 탐색이 불완전하다. */
  [codeReferenceStatuses.unconfirmed]: 'codocs.codeReference.unconfirmed',
} as const;
/** 코드 참조 진단의 고정 안내다. MCP와 VS Code가 같은 문구를 쓴다. @domainValues */
export const codeReferenceDiagnosticMessages = {
  /** 이름 또는 전체 표기를 해석하지 못했다. */
  [codeReferenceStatuses.invalid]:
    '명시적 코드 참조의 이름 또는 표기 형식이 올바르지 않습니다.',
  /** 대상 이름이 없다. */
  [codeReferenceStatuses.missing]: '선택한 프로젝트에 대상 문서가 없습니다.',
  /** 대상 문서에 적은 섹션이 없다. */
  [codeReferenceStatuses.missingSection]: '대상 문서에 해당 섹션이 없습니다.',
  /** 대상 후보가 여러 개다. */
  [codeReferenceStatuses.ambiguous]:
    '이름과 도메인에 해당하는 문서가 여러 개입니다.',
  /** 대상 탐색이 불완전하다. */
  [codeReferenceStatuses.unconfirmed]: '대상 문서를 아직 확인하지 못했습니다.',
} as const;
