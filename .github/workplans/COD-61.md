# COD-61 — MCP list/get 기반 계층 탐색 및 section 조회

h2. 배경

현재 MCP 조회는 ID를 알아야 하는 흐름과 평면적인 목록에 의존한다. 새 문서 모델에서는 parent 구조와 {{name[:section]}} 주소를 이용해 AI가 필요한 지식만 단계적으로 탐색할 수 있게 한다.

h2. 범위

h3. codocs_list

- 인자 없음: parent가 없는 root 문서만 반환
- parent name 지정: 해당 문서의 direct children만 반환
- 본문은 반환하지 않고 탐색에 필요한 최소 metadata만 제공
- 응답에 section 본문을 포함하지 않는다
- 항목: {{name}}·{{id}}·{{hasErrors}}·{{sections}}(섹션 이름 목록)·{{childCount}}
- cursor 페이지 없이 전부 이름 순으로 반환한다. {{cursor}}·{{nextCursor}}·{{totalCount}}·{{returnedCount}}와 목록의 {{cursor_expired}}를 제거한다.
- 인자 없는 결과의 {{unreachable}}에 parent 오류({{parent_not_found}}·{{parent_cycle}})로 root에서 닿을 수 없는 문서를 모은다.
- 없는 parent 이름은 {{success:false}}·{{not_found}}로 실패한다. 자식이 없으면 빈 {{items}}다.

h3. codocs_get

- {{get("name")}}: 해당 문서 전체 반환
- {{get("name:section")}}: 해당 section만 반환
- 사용자-facing 조회 주소는 internal id가 아니라 name 기반
- 잘못된 name/section에 명확한 오류 반환
- 입력은 {{addresses}} 배열(1~20개, 중복 제거)이며 ID 조회는 없다. 주소마다 결과를 돌려주고 잘못된 주소는 그 항목에만 {{invalid_input}}·{{not_found}}·{{section_not_found}}로 표시한다.
- {{references}}·{{referencedBy}}는 문서 ID 대신 문서 이름을 담는다.
- section 결과: 문서 {{name}}·{{id}}·{{source.path}}·문서 {{revision}}·{{section}}(name·content). {{references}}는 그 섹션 안의 참조만 담고 {{referencedBy}}는 담지 않는다.
- 같은 이름 문서가 여럿이면 {{conflict}}·{{paths}}·{{duplicate_name}}, 찾은 문서의 ID가 중복이면 {{duplicate_id}}와 함께 revision을 만들지 않는다.
- write·rename은 계속 id·revision을 받으며 get 결과에 id·revision을 유지한다(개편은 COD-63).

h3. 함께 고칠 안내

- {{codocs_guide}} 안내문과 MCP 서버의 도구 설명
- README·README.ko의 MCP 도구 안내

h2. 설계 원칙

- list = 구조 탐색
- get = 실제 지식 조회
- 별도 sections/outline 도구는 만들지 않는다
- 별도 search 도구는 우선 도입하지 않고 실사용 후 필요성을 판단한다

h2. 범위 밖

- fuzzy/semantic search
- write/validate/refresh 재설계
- 코드 역참조 조회
- 섹션 단위 역참조(어느 섹션이 이 섹션을 가리키는지) 조회

h2. 검증

- list()가 root 문서만 반환한다.
- list(parent)가 direct children만 반환한다.
- get(name)가 문서 전체를 반환한다.
- get(name:section)가 section만 반환한다.
- 불필요한 본문을 list 응답에 포함하지 않는다.
- list() 결과의 unreachable에 parent 오류 문서가 나온다.
- 없는 parent는 not_found로 실패한다.
- get이 여러 주소를 받고 잘못된 주소가 다른 결과를 막지 않는다.
- .codocs의 codocs_list·codocs_get·MCP 도구·도구 결과·진단 계약과 구현·테스트가 일치한다.
- typecheck, lint, test, format check를 통과한다.

h2. 완료 기준

- AI가 list로 지식 구조를 탐색하고 get으로 필요한 문서 또는 section만 읽을 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-61
