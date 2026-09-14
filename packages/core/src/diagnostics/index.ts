/** YAML 파서가 반환하는 오류 코드와 발생 조건이다. */
export const yamlDiagnosticCodes = {
  /** 입력이 문자열이 아니거나, YAML 문법 오류가 있거나, 최상위 값이 매핑이 아니면 반환한다. 빈 문서도 포함한다. */
  invalidYaml: 'invalid_yaml',
  /** 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 매핑 키가 있으면 반환한다. 중첩 매핑과 flow 표기 자체는 허용한다. */
  unsupportedYamlFeature: 'unsupported_yaml_feature',
} as const;

/** 오류 코드 정의에서 도출한 YAML 진단 코드 타입이다. */
export type YamlDiagnosticCode =
  (typeof yamlDiagnosticCodes)[keyof typeof yamlDiagnosticCodes];
