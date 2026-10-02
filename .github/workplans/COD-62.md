# COD-62 — @codocs name:section 기반 코드·문서 양방향 참조

h2. 배경

기존 {{@codocs [[문서]]#Lx-Ly}}는 문서 행 번호에 연결되어 문서 편집 시 링크를 계속 보정해야 한다. 코드와 문서를 연결하는 목적은 유지하되, reference identity를 행이 아닌 의미 있는 section으로 변경한다.

h2. 새 표기

{noformat}@codocs 환불:환불정책{noformat}

h2. 범위

h3. 코드 → 문서

* {{@codocs name:section}} 표기 추출
* name:section resolver 연결
* 클릭/이동 시 대상 .codocs section으로 이동
* 존재하지 않는 대상에 diagnostics 제공

h3. 문서 → 코드 역참조

* 프로젝트 코드에서 {{@codocs name:section}} 출현 위치 색인
* section 기준으로 현재 코드 위치 역참조 계산
* 참조가 1개여도 항상 Hover 목록으로 표시
* 여러 참조도 동일한 Hover UI로 표시
* 각 항목에서 정확한 코드 위치로 이동

h2. 설계 원칙

* line 번호는 reference identity가 아니라 현재 발견 위치 정보다.
* 문서가 이동·편집되어도 section 주소가 유지되는 한 코드 참조는 유지된다.
* 기존 {{#Lx}}, {{#Lx-Ly}} 표기와 관련 영향 분석 로직은 제거한다.
* 코드 수집/감시는 새 참조에 필요한 최소 범위로 단순화한다.

h2. 범위 밖

* 일반 코드 identifier Hover
* 문서 간 {{[[ ]]}} 참조 구현
* MCP write API

h2. 검증

* 코드 참조에서 정확한 문서 section으로 이동한다.
* 문서 section에서 현재 참조 코드 위치를 Hover로 확인한다.
* 1개/여러 개의 역참조가 같은 UX를 사용한다.
* 코드가 이동하면 재색인 후 위치만 갱신되고 reference identity는 유지된다.
* typecheck, lint, test, format check 및 VS Code UI 테스트를 통과한다.

h2. 완료 기준

* line 기반 코드 참조 없이 section 의미 단위로 코드와 문서를 양방향 탐색할 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-62
