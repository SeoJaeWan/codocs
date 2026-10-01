# COD-46 — 문서 속성 kind·status 제거

h2. 배경

COD-43에서 {{.codocs}} 문서를 정리하면서 문서의 선택 속성 {{kind}}·{{status}}가 실제로 쓰이지 않는다는 점을 확인했다.

* 이 저장소 문서 75개 중 {{kind}}는 17개, {{status}}는 15개에만 있다. {{status}}는 15개 모두 {{confirmed}}라 구분 정보가 없다.
* 규칙·절차 같은 성격은 본문에서 드러나고, 합의·진행 상태는 이슈·PR에서 관리한다.
* 필요한 프로젝트는 사용자 속성으로 직접 넣어 쓸 수 있다.

따라서 {{kind}}·{{status}}를 제품이 아는 문서 속성에서 제거한다.

h2. 범위

* core: validator의 {{kind}}·{{status}} 허용 값 정의 제거, 조회 투영의 {{kind}}·{{status}} 필터 제거
* workspace: 조회 커서의 필터 구성에서 {{kind}}·{{status}} 제거
* mcp: {{codocs_list}} 입력 스키마에서 {{kind}}·{{status}} 제거
* 위 항목의 테스트 정리
* 계약 문서 갱신: 조회 투영, MCP 조회, 조회 커서, 사용 가이드({{docs/guide}})
* 기존 {{.codocs}} 문서 32개에서 {{kind:}}·{{status:}} 줄 제거 (제거 후 사용자 속성 경고가 생기지 않도록)

h2. 범위 밖

* 「문서」 개념 문서의 {{kind}}·{{status}} 설명 제거와 「문서 컨벤션」·{{index.yaml}}의 status 문장 정리는 COD-43에서 처리한다.

h2. 검증

* {{kind}}·{{status}}가 있는 문서는 다른 사용자 속성과 같이 보존되고 {{unknown_field}} 경고를 받는다.
* {{codocs_list}}에 {{kind}}·{{status}}를 넣으면 알 수 없는 입력으로 거부된다.
* {{codocs_validate}}로 저장소 문서에 새 진단이 없는지 확인한다.
* 커밋 훅의 타입 검사, lint, 테스트, 포맷 검사를 통과한다.

h2. 완료 기준

* 코드·테스트·계약 문서·사용자 가이드에서 {{kind}}·{{status}}가 제품 속성으로 남아 있지 않다.
* 저장소 {{.codocs}} 문서에 {{kind}}·{{status}} 속성이 없다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-46
