# COD-46 — 문서 속성을 필수 5개로 정리: kind·status·examples 제거, deprecatedAliases 필수화

## 배경

COD-43에서 `.codocs` 문서를 정리하면서 선택 속성 `kind`·`status`·`examples`가 실제로 쓰이지 않는다는 점을 확인했다.

- 이 저장소 문서 81개 중 `kind`는 17개, `status`는 15개에만 있고 `examples`는 쓰는 문서가 없다. `status`는 모두 `confirmed`라 구분 정보가 없다.
- 규칙·절차 같은 성격은 본문에서 드러나고, 합의·진행 상태는 이슈·PR에서 관리한다.
- 필요한 프로젝트는 사용자 속성으로 직접 넣어 쓸 수 있다.

따라서 제품이 아는 문서 속성을 필수 5개(`id`·`name`·`definition`·`domains`·`deprecatedAliases`)로 정리한다. 알려진 속성이 모두 필수가 되면 속성 이름을 잘못 쓴 경우 필수 속성 누락 오류로 드러난다.

## 범위

- `kind`·`status`·`examples` 제거
  - core: validator의 속성 정의·허용 값 제거, 조회 투영의 `kind`·`status` 필터 제거
  - workspace: 조회 커서의 필터 구성에서 `kind`·`status` 제거
  - mcp: `codocs_list` 입력 스키마에서 `kind`·`status` 제거
- `deprecatedAliases` 필수화
  - YAML 문서에 `deprecatedAliases`가 없으면 필수 속성 누락 오류다. 이전 ID가 없으면 빈 배열 `[]`을 쓴다.
  - MCP create 요청에서 `deprecatedAliases`를 생략하면 `[]`로 채워 저장한다. 새 문서에는 이전 ID가 없기 때문이며, "생략한 값을 자동 보충하지 않는다" 원칙의 예외로 명시한다.
- 위 항목의 테스트 정리
- 계약 문서 갱신: 문서 검증, 문서 변경 계획, 조회 투영, MCP 조회, 조회 커서, 사용 가이드(`docs/guide`)
- 저장소 문서 정리
  - `.codocs` 문서에서 `kind:`·`status:` 줄 제거, `deprecatedAliases`가 없는 문서 69개에 `deprecatedAliases: []` 추가
  - `examples/.codocs` 예시 문서와 `docs/guide/schema.md`의 `examples` 사용 제거

## 범위 밖

- 「문서 속성」 개념 문서의 정리와 「문서 컨벤션」·`index.yaml`의 status 문장 정리는 COD-43에서 처리한다.
- 사용자 속성의 `unknown_field` 경고 제거는 별도 이슈에서 처리한다.

## 검증

- `kind`·`status`·`examples`가 있는 문서는 사용자 속성으로 보존된다.
- `deprecatedAliases`가 없는 YAML 문서는 필수 속성 누락 오류가 난다.
- MCP create에서 `deprecatedAliases`를 생략하면 저장된 문서에 `deprecatedAliases: []`가 있다.
- `codocs_list`에 `kind`·`status`를 넣으면 알 수 없는 입력으로 거부된다.
- `codocs_validate`로 저장소 문서에 새 진단이 없는지 확인한다.
- 커밋 훅의 타입 검사, lint, 테스트, 포맷 검사를 통과한다.

## 완료 기준

- 코드·테스트·계약 문서·사용자 가이드에서 `kind`·`status`·`examples`가 제품 속성으로 남아 있지 않다.
- `deprecatedAliases`가 필수 속성으로 검증되고, create의 생략 시 `[]` 보충이 동작한다.
- 저장소와 예시의 모든 문서가 필수 5개 속성을 갖는다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-46
