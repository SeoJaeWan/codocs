# COD-25 — [22] MCP write 실행·후보 안내·저장 후 색인 복구 통합

h2. 목표

한 문서 쓰기를 검증·잠금·안전한 반영·색인·정확한 응답까지 완성한다.

h2. 작업 순서와 선행 조건

권장 순서 22/25 · 3단계 · 상위 COD-3

- [COD-24|https://seojaewan.atlassian.net/browse/COD-24] — 파일 기반 공유 대기열·proper-lockfile·5초 취소 구현
- [COD-12|https://seojaewan.atlassian.net/browse/COD-12] — 저장 후 이름·제목 일치 후보 계산 구현
- [COD-13|https://seojaewan.atlassian.net/browse/COD-13] — 파일 변경 감지·증분 색인·refresh 준비 상태 구현
- [COD-21|https://seojaewan.atlassian.net/browse/COD-21] — 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결

h2. 구현 범위

- create/update 단일 요청을 대기열→최신 검사→변경 계획→파일 반영→직접 색인 갱신에 연결.
- 검증 오류/충돌 미저장·경고 저장·유효 무변경 성공·오류 무변경 실패를 실제 파일 기준으로 구현.
- 문서용 name 후보 계산의 조건·최대3/총수·실패 경고·비차단 연결.
- 색인 실패 후 단일 파일/영향 참조 자동 복구 추가1회·인위적 대기 없음·초기1초 제한·늦은 결과 폐기.
- saved/indexUpdated/revision/진단·복구 안내를 보존하고 create 재요청·자동 롤백·무한 복구 금지.

h2. 검증 시나리오와 기대 결과

- 실제 write의 set/unset 변경·필수 삭제·중복 ID/경로·revision·무변경 모든 분기를 검증한다.
- 저장 성공/색인 실패를 강제해 success:true saved:true indexUpdated:false와 refresh 안내를 확인한다.
- 복구 성공·실패·시간초과 뒤 늦은 결과가 새 색인을 덮지 않는지 검증한다.
- 후보 검사 실패에도 저장 결과를 유지하며 후보0개와 검사실패가 구분된다.

h2. 완료 기준과 산출물

- indexUpdated:true 직후 같은 서버 get/list가 새 결과를 반환한다.
- 원본 미변경·저장 완료·색인 상태가 응답과 일치하며 내부 임시 파일로 AI 재전송을 요구하지 않는다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 잠금 보유 범위와 후보 검사/복구의 정확한 실행 순서를 검증한다.

## 문서 기준

현재 계약의 기준 원문은 로컬 `.codocs`다. 문서 역할과 갱신은 [문서 컨벤션](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/development/documentation-convention.yaml)을 따른다.

구현·테스트·공개 함수 JSDoc와 해당 기능의 `.codocs` 담당 문서를 함께 갱신한다. 내부 패키지·기능별 README는 만들지 않으며, 루트 README와 사용자 가이드는 사용자 안내에 영향이 있을 때 갱신한다.

과거 Wiki revision은 당시 결정·계획의 참고 근거이며 현재 계약을 소유하지 않는다. 구현 범위·진행·검증 증거는 이슈와 PR에서 추적한다.

### 과거 Wiki와 추적 근거

- Codocs 단일 문서 쓰기와 revision 계약 (codocs-write-revision)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0d6a-754a-a977-077ed169524b","revision":"01a0997d-0d6a-7582-acb0-203c7ea2450c"}}}
- Codocs 저장 후 이름 일치 후보 안내 (codocs-name-match-candidates)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-129c-7cdf-9811-2c2d98a6c635","revision":"01a0997d-129c-7028-ab57-0395e5531fe3"}}}
- Codocs 파일 감지와 색인 복구 (codocs-index-lifecycle)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8466-7f3b-b7ae-bcbc54e1d66e","revision":"01a09980-8466-7222-97c6-4a9d5bbf97cf"}}}

2026-09-13 최초 계획을 바탕으로 현재 로컬 `.codocs` 계약에 따라 진행하는 실행 작업이다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-25

위 Wiki revision은 최초 작업 계획의 추적 근거다. 이번 PR의 변경 범위는 아래 2026-09-16 사용자 합의를 반영하며, 상충하는 이전 매칭·ID 유지 계약은 아래 합의로 대체한다. 구현 착수 시 현재 로컬 `.codocs` 담당 문서와 아래 합의의 정합성을 확인하고 함께 갱신한다. 과거 Wiki revision을 현재 계약의 기준으로 사용하지 않는다.

## 2026-09-16 합의: MCP ID 변경 실행

### 추가 구현 범위

- #8 / COD-11의 ID 변경 계획을 MCP write update에 연결한다. 현재 ID 변경과 이전 ID 목록 조정을 동일 문서의 한 번의 저장으로 반영한다.
- 직전 ID 자동 추가, 기존 항목·message 보존, 중복 추가 방지, 새 현재 ID의 이전 목록 제거 규칙을 적용한다.
- 직접 YAML 편집은 자동 이력 추가 대상으로 삼지 않는다. MCP를 통한 명시적 ID 변경과 파일 변경 감지를 구분한다.
- 쓰기 순서 획득 후 최신 revision·ID 충돌을 다시 검사하고 검증 실패 시 원본을 보존한다.
- 저장 후 새 현재 ID와 이전 ID가 #7의 규칙으로 매칭되도록 색인을 갱신한다. 이전 ID 자동 관리는 코드 자동 변경을 의미하지 않는다.

### 추가 완료 조건

- 실제 MCP 요청과 파일 IO로 ID 변경 후 이전 ID 추가, 중복 방지·message 보존, 과거 ID 재사용을 검증한다.
- 새 현재 ID 충돌·revision 불일치·저장 실패 시 ID 또는 이전 목록만 부분 반영되지 않는지 확인한다.
- 저장 성공 후 최신 get/list와 매칭 색인을 확인한다. 색인 실패 시 기존 saved/indexUpdated·복구 계약을 유지한다.
