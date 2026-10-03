# COD-46 — 문서 속성을 필수 5개로 정리: kind·status·examples 제거, deprecatedAliases 필수화

## 배경

COD-43에서 `.codocs` 문서를 정리하면서 선택 속성 `kind`·`status`·`examples`가 실제로 쓰이지 않는다는 점을 확인했다.

- COD-43 정리 후 이 저장소 문서 41개 중 `kind`는 3개, `status`는 2개에만 있고 `examples`는 쓰는 문서가 없다. `status`는 모두 `confirmed`라 구분 정보가 없다.
- 규칙·절차 같은 성격은 본문에서 드러나고, 합의·진행 상태는 이슈·PR에서 관리한다.
- 필요한 프로젝트는 사용자 속성으로 직접 넣어 쓸 수 있다.

따라서 제품이 아는 문서 속성을 필수 5개(`id`·`name`·`definition`·`domains`·`deprecatedAliases`)로 정리한다. 알려진 속성이 모두 필수가 되면 속성 이름을 잘못 쓴 경우 필수 속성 누락 오류로 드러난다.

「문서 속성」·「문서 참조」·「codocs_list」·「codocs_write」 개념 문서는 이미 이 기준으로 작성되어 있으며, 이 작업은 코드·가이드·예시를 개념 문서에 맞춘다.

## 범위

- `kind`·`status`·`examples` 제거
  - core: validator의 속성 정의·허용 값(`documentKinds`·`documentStatuses`) 제거, 조회의 `kind`·`status` 필터 제거
  - core: 참조 해석과 중복 비교에서 `examples` 문자열 원소를 대상에서 제거하고 `definition`만 대상으로 한다
  - workspace: 조회 커서의 필터 구성에서 `kind`·`status` 제거
  - mcp: `codocs_list` 입력 스키마에서 `kind`·`status` 제거
- 폐기 경고 제거
  - `status: deprecated` 문서를 참조할 때 내던 `deprecated_reference` 경고를 제거한다. 진단 코드·메시지, catalog 계산과 테스트를 함께 정리한다.
- `deprecatedAliases` 필수화
  - YAML 문서에 `deprecatedAliases`가 없으면 필수 속성 누락 오류다. 이전 ID가 없으면 빈 배열 `[]`을 쓴다.
  - MCP create 요청에서 `deprecatedAliases`를 생략하면 `[]`로 채워 저장한다. 「codocs_write」에 이미 정의된 동작이다.
- 위 항목의 테스트 정리
- 사용 가이드(`docs/guide`, MCP `codocs_guide`가 제공하는 내용) 갱신
  - `schema.md`: `kind`·`status`·`examples` 설명과 예시 제거, `deprecatedAliases` 필수 안내
  - `README.md`: `status: confirmed` 설명 제거
  - `examples.md`: `kind` 사용과 폐기 문서 시연 설명 제거
  - `updating.md`: `status`로 상태를 표현하는 설명, `examples` unset 예시, create 예시의 `kind`, 폐기 절차 제거
- 예시 문서 정리: `examples/.codocs` 4개에서 `kind`·`status`·`examples` 제거, `deprecatedAliases: []` 추가
- 저장소 문서 정리(완료): `.codocs` 문서 3개에서 `kind`·`status` 제거, 41개 모두에 `deprecatedAliases: []` 추가, 「문서 참조」의 쓰는 위치에서 `examples` 제거
- changeset: 영향받는 npm·확장 대상을 patch로 기록하고, changelog에 호환되지 않는 변경과 이전 방법을 적는다
  - 모든 문서에 `deprecatedAliases: []` 추가
  - `kind`·`status`·`examples`는 사용자 속성으로 보존되며 필요 없으면 삭제
  - `codocs_list`의 `kind`·`status` 입력과 `deprecated_reference` 경고 제거

## 범위 밖

- 사용자 속성의 `unknown_field` 경고 제거는 COD-48(PR #62)에서 처리한다.
- `_codocs` 메타데이터와 section 기반 문서 모델은 COD-59(PR #73)에서 처리한다. 이 작업은 현재 문서 모델 기준으로 진행한다.

## 검증

- `kind`·`status`·`examples`가 있는 문서는 사용자 속성으로 보존되며, 이 작업에서는 `unknown_field` 경고가 남는다(COD-48에서 제거).
- `examples` 안의 `[[이름]]`은 참조로 해석하지 않고 중복 비교 대상도 아니다.
- `status: deprecated`가 있는 문서를 참조해도 `deprecated_reference` 경고가 생기지 않는다.
- `deprecatedAliases`가 없는 YAML 문서는 필수 속성 누락 오류가 난다.
- MCP create에서 `deprecatedAliases`를 생략하면 저장된 문서에 `deprecatedAliases: []`가 있다.
- `codocs_list`에 `kind`·`status`를 넣으면 알 수 없는 입력으로 거부된다.
- `codocs_validate`로 저장소와 예시 문서에 진단이 없는지 확인한다.
- 커밋 훅의 타입 검사, lint, 테스트, 포맷 검사를 통과한다.

## 완료 기준

- 코드·테스트·사용자 가이드에서 `kind`·`status`·`examples`와 `deprecated_reference`가 제품 동작으로 남아 있지 않다.
- `deprecatedAliases`가 필수 속성으로 검증되고, create의 생략 시 `[]` 보충이 동작한다.
- 저장소와 예시의 모든 문서가 필수 5개 속성을 갖는다.
- changeset에 호환되지 않는 변경과 이전 방법이 기록되어 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-46
