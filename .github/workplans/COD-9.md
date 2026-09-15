# COD-9 — [06] 목록·복수 상세 조회·필터·커서 엔진 구현

h2. 목표

MCP·IDE가 재사용할 결정적인 목록/상세 조회를 만든다.

h2. 작업 순서와 선행 조건

권장 순서 06/25 · 1단계 · 상위 COD-1

- [COD-8|https://seojaewan.atlassian.net/browse/COD-8] — ID 색인·참조 해석·역참조·충돌 진단 구현

h2. 구현 범위

- 50개 고정 list, domain/kind/status AND 필터, ID 오름차순·totalCount/returnedCount/nextCursor를 구현한다.
- 필터를 포함한 자체 완결 HMAC 커서, 조건 불일치·변조·재시작 오류, 목록 투영 변경·refresh 만료를 구현한다. 본문만 바뀌고 목록 투영이 같으면 기존 커서를 유지한다.
- get ids는 첫 등장 순서로 중복 제거해 1~20개를 처리한다. 빈 입력과 중복 제거 후 21개 이상은 전체 invalid_input이고, 각 ID의 없음·충돌·문서 오류는 다른 결과를 중단하지 않는다.
- list/get 최상위에 scanStatus: complete | partial | failed를 제공한다. partial에서 현재 scan 문서는 confirmed, 이전 Catalog 보존 문서는 unconfirmed이며 complete에서만 not_found를 확정한다.
- 중복 ID는 모든 paths와 conflict를 반환하되 대표 document/rawYaml/revision을 선택하지 않는다.
- references/referencedBy는 존재하고 전역에서 유일한 직접 참조 ID만 반환한다. 누락 대상의 경로를 추측하지 않고 모호한 대상은 모든 후보 경로를 진단으로 보존한다.
- get은 원래 document·참조·source/revision을 반환하고 JSON 표현이 불가능하면 전체 rawYaml을 제공한다. 응답 크기로 본문이나 참조를 자르거나 response_too_large를 만들지 않는다.

h2. 검증 시나리오와 기대 결과

- 0/1/49/50/51/100개 페이지와 domain/kind/status AND 필터·불가능한 조합을 검증한다.
- 본문만 변경한 커서는 유지하고 hasErrors/표시/충돌/멤버십 변경·refresh·변조·재시작은 만료하며 새 첫 페이지를 자동 반환하지 않는다.
- complete/partial/failed 전환, confirmed/unconfirmed, 확정 not_found와 확인 불가 결과를 실제 파일 scan으로 검증한다.
- [A,B,A]·20/21개·일부 없음·중복 ID·.inf rawYaml·큰 문서와 20개 무절단 응답을 각각 확인한다.
- 없는 참조·복수 후보·대상 문서 ID 누락/중복이 외부 ID 목록에 들어가지 않고 계약된 경로 진단을 보존하는지 확인한다.

h2. 완료 기준과 산출물

- 목록·상세 계약을 프로토콜 없이 직접 테스트할 수 있다.
- 응답 크기 제한이나 연결 문서 자동 확장 없이 원문과 직접 참조를 손실 없이 반환한다.
- 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 검증 결과를 기록한다. 실제 IO·프로세스·IDE가 필요한 시나리오는 mock만으로 통과 처리하지 않는다.

h2. 구현 결정

- 커서는 TTL과 발급 registry 없이 process별 비밀키로 서명한 자체 포함 토큰을 사용한다.
- 목록 투영 fingerprint와 refresh generation으로 커서 수명을 판정한다.
- get 요청은 중복 제거 후 최대 20개로 제한하고 응답 byte 제한은 두지 않는다.

h2. 기준 Wiki와 추적 근거

- Codocs MCP 공통 응답과 조회 계약 (codocs-mcp-read-contract)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0948-7890-a34d-e8aa7400e7fe","revision":"01a0997d-0948-73d8-9442-676c800ebd6c"}}}
- Codocs 검증과 오류 문서 조회 (codocs-validation)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d2a7-7e98-9c44-ed4c5c374b9e","revision":"01a0997a-d2a7-79ac-9fd1-8ccb5829eb0f"}}}

2026-09-15 확정 명세를 구현했다. Wiki와 `.codocs`가 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-9
