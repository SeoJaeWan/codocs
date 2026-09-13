# COD-9 — [06] 목록·복수 상세 조회·필터·커서 엔진 구현

h2. 목표

MCP·IDE가 재사용할 결정적인 목록/상세 조회를 만든다.

h2. 작업 순서와 선행 조건

권장 순서 06/25 · 1단계 · 상위 COD-1

* [COD-8|https://seojaewan.atlassian.net/browse/COD-8] — ID 색인·참조 해석·역참조·충돌 진단 구현

h2. 구현 범위

* 50개 고정 list, AND 필터, 단일 domain의 term/domain·knowledge/domains 매칭, ID 오름차순·totalCount/returnedCount/nextCursor.
* 필터 유지 커서·조건 불일치 오류·목록에 영향을 주는 변경만 만료·refresh 전체 만료 훅 구현.
* get ids 첫 등장 순서 중복 제거 후 최대20·빈/초과 오류·부분 not_found 결과.
* 오류 문서 목록 포함·속성 생략·충돌 ID 하나 집계와 같은 파일의 모든 필터 충족 규칙.
* get 원래 document·전체 참조·source/revision 정보, JSON 불가능 문서 rawYaml 분기·임의 변환/절단 금지.

h2. 검증 시나리오와 기대 결과

* 0/1/49/50/51/100개 페이지와 필터·등록되지 않은 domain·불가능한 조합을 검증한다.
* 본문만 변경한 커서는 유지, hasErrors/표시/멤버십 변경은 만료하며 새 첫 페이지를 자동 대신하지 않는다.
* [A,B,A]·20/21개·일부 없음·중복 ID·.inf rawYaml·목록 불가능 문서 제외를 각각 확인한다.

h2. 완료 기준과 산출물

* 목록·상세 계약을 프로토콜 없이 직접 테스트할 수 있다.
* 응답 한계 확인 시 명시적 오류 경로가 있고 연결 문서 자동 확장은 없다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 검증 결과를 기록한다. 실제 IO·프로세스·IDE가 필요한 시나리오는 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 커서 내부 표현·필터별 변경 판정 비용·응답 크기 한계는 구현/성능 시험으로 정한다.

h2. 기준 Wiki와 추적 근거

* Codocs MCP 공통 응답과 조회 계약 (codocs-mcp-read-contract)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0948-7890-a34d-e8aa7400e7fe","revision":"01a0997d-0948-73d8-9442-676c800ebd6c"}}}
* Codocs 검증과 오류 문서 조회 (codocs-validation)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d2a7-7e98-9c44-ed4c5c374b9e","revision":"01a0997a-d2a7-79ac-9fd1-8ccb5829eb0f"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-9
