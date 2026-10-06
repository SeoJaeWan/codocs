# COD-65 — Codocs Preflight 기반 관련 문서 자동 컨텍스트 주입 설계

h2. 배경

Codocs 문서에 제약사항, 조건, 도메인 규칙을 작성하더라도 Codex/Claude가 해당 문서를 조회하지 않으면 실질적인 효과가 없다.

현재 MCP 기반 접근은 Agent가 필요하다고 판단할 때만 {{list/get/section}} 등을 호출하는 구조이므로, 관련 문서가 존재해도 조회가 누락될 수 있다.

이를 보완하기 위해 사용자의 프롬프트가 Agent에 전달되기 전에 관련 Codocs 문서를 자동 탐색하고, 필요한 컨텍스트를 먼저 주입하는 *Codocs Preflight / Context Hook* 개념을 검토한다.

h2. 목표

사용자가 Codex 또는 Claude에 작업 요청을 입력했을 때:

# 사용자 프롬프트를 Hook/Preflight 단계에서 가로챈다.
# 프롬프트와 관련된 Codocs 문서/섹션을 자동 검색한다.
# 관련성이 높은 최소한의 컨텍스트만 Agent에 주입한다.
# Agent는 주입된 Codocs 컨텍스트를 기반으로 작업을 시작한다.
# 필요한 경우 기존 MCP {{get/list/section}}을 통해 추가 탐색할 수 있다.

h2. 기본 흐름

{noformat}User Prompt
  ↓
Codocs Preflight / Context Hook
  ↓
context(query)
  ↓
관련 Codocs 검색
  ↓
관련 section 3~5개 선정
  ↓
User Prompt + Relevant Codocs Context
  ↓
Codex / Claude
  ↓
필요 시 Codocs MCP로 추가 조회{noformat}

h2. 검색 전략 검토

단순 embedding Top-K만으로 구현하지 않고 다음 신호를 결합하는 방향을 검토한다.

* exact name / section match
* keyword / full-text search
* semantic similarity
* {{[[link]]}} 기반 관계 그래프
* 필요 시 query rewriting

개념적으로:

{noformat}Developer Prompt
  ↓
Query rewriting
  ↓
Exact + Keyword + Semantic
  ↓
Reranking
  ↓
[[link]] graph 0~1 depth 확장
  ↓
Top 3~5 sections{noformat}

Codocs의 {{name}}, {{section}}, {{[[link]]}} 정보를 일반 RAG보다 강한 구조적 신호로 활용한다.

h2. 신규 API 후보

{noformat}context(query){noformat}

예시:

{noformat}context("ProductCard에 쿠폰 할인 넣어줘"){noformat}

반환 예시:

{noformat}ProductCard:constraints
ProductPrice:display
CouponPolicy:stacking{noformat}

기존 MCP 역할:

* {{list()}}: 능동 탐색
* {{get(name)}}: 문서 조회
* {{get(name:section)}}: 특정 section 조회
* {{section(name)}}: section 탐색
* {{context(query)}}: 자동 컨텍스트 탐색

h2. 검색 품질 검증

Hook 구현보다 먼저 {{context(query)}}의 검색 품질을 검증할 수 있어야 한다.

테스트 query와 기대 section을 정의하고 아래 지표를 측정하는 방안을 검토한다.

* Precision@K
* Recall@K
* MRR

예시:

{code:yaml}- query: "ProductCard에 쿠폰 할인 넣어줘"
  expected:
    - ProductCard:constraints
    - ProductPrice:display
    - CouponPolicy:stacking{code}

관련 없는 문서를 과도하게 주입하면 Agent 성능과 토큰 효율을 떨어뜨릴 수 있으므로, 초기 목표는 Recall보다 Precision을 우선한다.

h2. 범위

h3. 포함

* {{context(query)}} 인터페이스 설계
* Codocs 문서/section 검색 방식 검토
* exact / keyword / semantic / graph 기반 ranking 설계
* {{[[link]]}} 관계를 검색 ranking에 활용
* Codex / Claude Preflight Hook 연동 가능성 검토
* 검색 품질 benchmark 구성
* 관련 문서가 없는 경우 빈 context 반환

h3. 이번 이슈에서 제외

* Codocs 기반 post-hook / semantic validation
* git diff 기반 규칙 위반 검사
* Codex/Claude 전체 실행을 감싸는 별도 Agent wrapper
* Codocs 규칙을 ESLint 규칙으로 자동 변환

위 항목들은 Preflight의 검색 품질 및 실제 사용성을 확인한 뒤 별도 이슈로 분리한다.

h2. 완료 조건

* [ ] {{context(query)}}의 책임과 반환 형식이 정의되어 있다.
* [ ] 최소 1개의 검색 전략 프로토타입이 구현되어 있다.
* [ ] section 단위 검색이 가능하다.
* [ ] {{[[link]]}} 관계가 ranking 또는 확장 과정에 반영된다.
* [ ] 관련성이 낮은 결과를 제한할 수 있다.
* [ ] benchmark query set으로 retrieval 품질을 측정할 수 있다.
* [ ] Claude/Codex에서 사용자 프롬프트 입력 시 자동 컨텍스트 주입이 가능한 연동 방식을 조사/검증한다.
* [ ] 기존 {{list/get/section}} MCP 흐름과 충돌하지 않는다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-65
