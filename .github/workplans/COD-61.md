# COD-61 — MCP list/get 기반 계층 탐색 및 section 조회

h2. 배경

현재 MCP 조회는 ID를 알아야 하는 흐름과 평면적인 목록에 의존한다. 새 문서 모델에서는 parent 구조와 {{name[:section]}} 주소를 이용해 AI가 필요한 지식만 단계적으로 탐색할 수 있게 한다.

h2. 범위

h3. codocs_list

* 인자 없음: parent가 없는 root 문서만 반환
* parent name 지정: 해당 문서의 direct children만 반환
* 본문은 반환하지 않고 탐색에 필요한 최소 metadata만 제공
* 응답에 section 본문을 포함하지 않는다

h3. codocs_get

* {{get("name")}}: 해당 문서 전체 반환
* {{get("name:section")}}: 해당 section만 반환
* 사용자-facing 조회 주소는 internal id가 아니라 name 기반
* 잘못된 name/section에 명확한 오류 반환

h2. 설계 원칙

* list = 구조 탐색
* get = 실제 지식 조회
* 별도 sections/outline 도구는 만들지 않는다
* 별도 search 도구는 우선 도입하지 않고 실사용 후 필요성을 판단한다

h2. 범위 밖

* fuzzy/semantic search
* write/validate/refresh 재설계
* 코드 역참조 조회

h2. 검증

* list()가 root 문서만 반환한다.
* list(parent)가 direct children만 반환한다.
* get(name)가 문서 전체를 반환한다.
* get(name:section)가 section만 반환한다.
* 불필요한 본문을 list 응답에 포함하지 않는다.
* typecheck, lint, test, format check를 통과한다.

h2. 완료 기준

* AI가 list로 지식 구조를 탐색하고 get으로 필요한 문서 또는 section만 읽을 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-61
