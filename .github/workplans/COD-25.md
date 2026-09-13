# COD-25 — [22] MCP write 실행·후보 안내·저장 후 색인 복구 통합

h2. 목표

한 문서 쓰기를 검증·잠금·안전한 반영·색인·정확한 응답까지 완성한다.

h2. 작업 순서와 선행 조건

권장 순서 22/25 · 3단계 · 상위 COD-3

* [COD-24|https://seojaewan.atlassian.net/browse/COD-24] — 파일 기반 공유 대기열·proper-lockfile·5초 취소 구현
* [COD-12|https://seojaewan.atlassian.net/browse/COD-12] — 저장 후 이름·제목 일치 후보 계산 구현
* [COD-13|https://seojaewan.atlassian.net/browse/COD-13] — 파일 변경 감지·증분 색인·refresh 준비 상태 구현
* [COD-21|https://seojaewan.atlassian.net/browse/COD-21] — 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결

h2. 구현 범위

* create/update 단일 요청을 대기열→최신 검사→변경 계획→파일 반영→직접 색인 갱신에 연결.
* 검증 오류/충돌 미저장·경고 저장·유효 무변경 성공·오류 무변경 실패를 실제 파일 기준으로 구현.
* name/title 후보 계산의 조건·최대3/총수·실패 경고·비차단 연결.
* 색인 실패 후 단일 파일/영향 참조 자동 복구 추가1회·인위적 대기 없음·초기1초 제한·늦은 결과 폐기.
* saved/indexUpdated/revision/진단·복구 안내를 보존하고 create 재요청·자동 롤백·무한 복구 금지.

h2. 검증 시나리오와 기대 결과

* 실제 write의 set/unset 변경·필수 삭제·중복 ID/경로·revision·무변경 모든 분기를 검증한다.
* 저장 성공/색인 실패를 강제해 success:true saved:true indexUpdated:false와 refresh 안내를 확인한다.
* 복구 성공·실패·시간초과 뒤 늦은 결과가 새 색인을 덮지 않는지 검증한다.
* 후보 검사 실패에도 저장 결과를 유지하며 후보0개와 검사실패가 구분된다.

h2. 완료 기준과 산출물

* indexUpdated:true 직후 같은 서버 get/list가 새 결과를 반환한다.
* 원본 미변경·저장 완료·색인 상태가 응답과 일치하며 내부 임시 파일로 AI 재전송을 요구하지 않는다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 잠금 보유 범위와 후보 검사/복구의 정확한 실행 순서를 검증한다.

h2. 기준 Wiki와 추적 근거

* Codocs 단일 문서 쓰기와 revision 계약 (codocs-write-revision)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0d6a-754a-a977-077ed169524b","revision":"01a0997d-0d6a-7582-acb0-203c7ea2450c"}}}
* Codocs 저장 후 이름 일치 후보 안내 (codocs-name-match-candidates)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-129c-7cdf-9811-2c2d98a6c635","revision":"01a0997d-129c-7028-ab57-0395e5531fe3"}}}
* Codocs 파일 감지와 색인 복구 (codocs-index-lifecycle)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8466-7f3b-b7ae-bcbc54e1d66e","revision":"01a09980-8466-7222-97c6-4a9d5bbf97cf"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-25
