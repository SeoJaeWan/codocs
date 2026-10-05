import { codeReferenceStatuses } from '@codocs/core';
/** 명시 표기 진단의 구별 가능한 안내다. @domainValues */
export const codeReferenceMessages = {
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
/** 코드 수집 상태 표시의 고정 안내다. @domainValues */
export const codeCollectionMessages = {
  /** 최초 수집 중에는 링크 없이 이 안내만 보인다. */
  initialLabel: '코드 연결 수집 중',
  /** 완료 뒤 재수집이 문턱을 넘겨 이전 결과를 유지하며 덧붙이는 표시다. */
  collectingLabel: '수집 중',
  /** 수집을 마쳤지만 일부 실패가 있는 상태의 표시다. */
  incompleteLabel: '수집 불완전',
  /** 감시 실패만 있어 재연결이 진행 중인 상태의 상단 표시다. */
  reconnectingLabel: '감시 재연결 중',
  /** 감시 재연결 진행 중임을 알리는 호버 안내다. */
  reconnectingGuidance:
    '코드 변경 감시를 다시 연결하고 있습니다. 완료되면 자동으로 갱신됩니다.',
} as const;
