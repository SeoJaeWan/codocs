/** 저장된 근거를 다시 확인해야 하는 사유다. @domainValues */
export const changeImpactReasons = {
  /** 지정 구간의 원문 또는 구간 내부 행 구성이 달라졌다. */
  regionChanged: 'region_changed',
  /** 지정 구간보다 앞의 행 증감으로 명시 번호가 달라질 수 있다. */
  precedingLineShift: 'preceding_line_shift',
  /** 문서 전체 참조의 저장 원문이 달라졌다. */
  documentChanged: 'document_changed',
  /** 기존 이름 표기로 저장 문서를 찾는 해석이 달라졌다. */
  nameChanged: 'name_changed',
  /** 기존 도메인 한정 표기로 저장 문서를 찾는 해석이 달라졌다. */
  domainChanged: 'domain_changed',
  /** 반복 원문의 최적 행 대응이 여러 가지여서 영향 여부를 확정하지 못했다. */
  ambiguousCorrespondence: 'ambiguous_correspondence',
} as const;
/** 안내의 확실성은 행 대응의 불확실성과 구분한다. @domainValues */
export const changeImpactCertainties = {
  /** 원문 또는 해석에 대한 확인 사유가 확정됐다. */
  confirmed: 'confirmed',
  /** 반복 원문의 대응에 따라 영향이 달라질 수 있다. */
  possible: 'possible',
} as const;
/** 영향 계산의 완료 여부다. @domainValues */
export const changeImpactStatuses = {
  /** 전달한 출현의 모든 영향 판단을 마쳤다. */
  complete: 'complete',
  /** 일부 또는 모든 행 대응을 계산하지 못했다. */
  incomplete: 'incomplete',
} as const;
