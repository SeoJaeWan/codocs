/** 명시 표기의 문법 판단이다. @domainValues */
export const codeReferenceSyntaxes = {
  /** 이름과 행 표기를 모두 해석했다. */
  valid: 'valid',
  /** 닫힘 또는 이름 문법이 올바르지 않다. */
  invalid: 'invalid',
} as const;
/** 표기가 지정한 저장 대상 영역이다. @domainValues */
export const codeReferenceDestinationKinds = {
  /** 문서 전체를 가리킨다. */
  document: 'document',
  /** 끝 행을 포함하는 실제 행 번호를 가리킨다. */
  rows: 'rows',
} as const;
/** 저장 색인과 실제 행으로 판단한 연결 결과다. @domainValues */
export const codeReferenceStatuses = {
  /** 하나의 저장 문서와 실제 범위를 확인했다. */
  resolved: 'resolved',
  /** 이름 또는 전체 표기 문법을 해석하지 못했다. */
  invalid: 'invalid',
  /** 행 접미사가 올바른 양의 정수가 아니다. */
  invalidRows: 'invalid_rows',
  /** 끝 행이 시작 행보다 앞선다. */
  reversedRows: 'reversed_rows',
  /** 저장 원문에 지정한 행이 없다. */
  outOfBounds: 'out_of_bounds',
  /** 완료 색인에 대상 이름이 없다. */
  missing: 'missing',
  /** 같은 이름·도메인의 후보가 여러 개다. */
  ambiguous: 'ambiguous',
  /** 저장 대상 탐색이 불완전하다. */
  unconfirmed: 'unconfirmed',
} as const;
