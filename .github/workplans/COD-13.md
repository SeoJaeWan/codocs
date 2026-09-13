# COD-13 — [10] 파일 변경 감지·증분 색인·refresh 준비 상태 구현

h2. 목표

저장·외부 변경을 반영하고 재구성 상태를 빈 결과·오래된 결과와 구분한다.

h2. 작업 순서와 선행 조건

권장 순서 10/25 · 1단계 · 상위 COD-1

* [COD-9|https://seojaewan.atlassian.net/browse/COD-9] — 목록·복수 상세 조회·필터·커서 엔진 구현
* [COD-10|https://seojaewan.atlassian.net/browse/COD-10] — 영어 식별자 분리·복합 용어·복수형 매칭 구현

h2. 구현 범위

* Chokidar를 workspace에 연결하고 .codocs 초기 부재·삭제/재생성·파일 추가/삭제/이동/교체를 처리.
* 같은 경로 알림 병합·실제 파일 재확인·revision dedup, 영향받은 참조/진단/커서 갱신.
* 전체 refresh 계산과 정확한 fileCount/itemCount/errorCount/warningCount. 문서 오류와 전체 구성 실패 분리.
* 초기/refresh 중 list/get/write/validate 차단 상태, guide 가능, 중복 refresh 억제·실패 원인/복구 상태 제공.
* MCP write 직접 갱신에서 재사용할 단일 파일 재처리·오래된 비동기 결과 폐기 기반 제공.

h2. 검증 시나리오와 기대 결과

* 초기 스캔 도중 변경·연속 저장·파일 교체·폴더 이동/재생성·감지 오류 복구를 시험한다.
* 파일 세 개 오류와 한 파일 세 개 진단의 집계, 충돌 ID itemCount1, 목록 불가능 파일 제외를 확인한다.
* 본문만 변경/hasErrors 변경에 따른 커서 유지/만료, refresh 전체 만료를 검증한다.
* 재구성 중에는 오래된 목록·빈 목록을 정상 결과로 반환하지 않는다.

h2. 완료 기준과 산출물

* 실제 파일 기반 통합 테스트와 상태 전환·진단 갱신 증거를 남긴다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* atomic/awaitWriteFinish·병합·재등록/재스캔 값을 500ms 반영 목표와 함께 검증한다.

h2. 기준 Wiki와 추적 근거

* Codocs 파일 감지와 색인 복구 (codocs-index-lifecycle)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8466-7f3b-b7ae-bcbc54e1d66e","revision":"01a09980-8466-7222-97c6-4a9d5bbf97cf"}}}
* Codocs MCP 공통 응답과 조회 계약 (codocs-mcp-read-contract)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0948-7890-a34d-e8aa7400e7fe","revision":"01a0997d-0948-73d8-9442-676c800ebd6c"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-13
