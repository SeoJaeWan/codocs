# COD-27 — [24] MCP 종단·동시 실행·복구·성능 회귀 검증

h2. 목표

개별 함수 성공을 넘어 실제 클라이언트와 다중 프로세스에서 전체 계약을 검증한다.

h2. 작업 순서와 선행 조건

권장 순서 24/25 · 3단계 · 상위 COD-3

* [COD-26|https://seojaewan.atlassian.net/browse/COD-26] — MCP refresh·guide와 배포용 작성 가이드·예시 완성

h2. 구현 범위

* 빌드된 서버로 list→복수get→참조조회→write→validate→refresh 전체 흐름 실행.
* 실제 여러 MCP/IDE 프로세스에서 같은/다른 프로젝트·외부 편집·파일 이동·재생성 검증.
* 잘못된 입력·오류문서 rawYaml·중복ID·revision·5초취소·잠금상실·저장후색인실패 fault injection.
* 1,000개 기준 read p95와 초기/변경 반영, 클라이언트별 응답 크기·다중 프로세스 메모리 측정.
* 문서·가이드·MCP schema 및 반환 집계/상태를 회귀 fixture로 고정.

h2. 검증 시나리오와 기대 결과

* 20개 get·50개 list 경계와 상태/도메인 필터, 오래된 cursor 재조회 행동을 검증한다.
* 취소 요청 미실행·저장 실패 원본 보존·저장 성공 후 refresh 복구의 실제 파일 상태를 확인한다.
* stdout 오염·프로세스 비정상 종료·가이드 사용 가능 상태·오래된 결과 미반환을 확인한다.

h2. 완료 기준과 산출물

* 클라이언트·OS·런타임·데이터·측정 경계·결과를 재현 가능하게 기록한다.
* 프로세스 내부 mock 결과만으로 동시성·실제 MCP 완료를 선언하지 않는다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 확인된 클라이언트 응답 한계·실행 한계·write 별도 비용을 기록한다.

h2. 기준 Wiki와 추적 근거

* Codocs 구현 순서와 성능·완료 기준 (codocs-delivery-plan)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-a00c-7263-977a-c0ef6c2b5eda","revision":"01a09980-a00c-777e-936d-bf6a5de49d88"}}}
* Codocs MCP 공통 응답과 조회 계약 (codocs-mcp-read-contract)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0948-7890-a34d-e8aa7400e7fe","revision":"01a0997d-0948-73d8-9442-676c800ebd6c"}}}
* Codocs 파일 반영과 프로세스 간 쓰기 조정 (codocs-file-concurrency)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-88db-73d7-8702-991548b5b8a1","revision":"01a09980-88db-7f76-b6b3-23bb9464346f"}}}
* Codocs 파일 감지와 색인 복구 (codocs-index-lifecycle)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8466-7f3b-b7ae-bcbc54e1d66e","revision":"01a09980-8466-7222-97c6-4a9d5bbf97cf"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-27
