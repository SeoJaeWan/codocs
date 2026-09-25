# COD-25 — [22] MCP write 실행·저장 후 색인 복구 통합

h2. 목표

한 문서 쓰기를 검증·저장 직전 최신 상태 확인·안전한 반영·색인·정확한 응답까지 완성한다.

h2. 작업 순서와 선행 조건

권장 순서 22/25 · 3단계 · 상위 COD-3

- [COD-23|https://seojaewan.atlassian.net/browse/COD-23] — 단일 문서 파일 반영·저장 직전 revision·ID·경로 검사
- [COD-13|https://seojaewan.atlassian.net/browse/COD-13] — 파일 변경 감지·증분 색인·refresh 준비 상태 구현
- [COD-21|https://seojaewan.atlassian.net/browse/COD-21] — 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결

h2. 구현 범위

- create/update 단일 요청을 기존 변경 계획→저장 직전 최신 revision·ID·경로 검사→파일 반영→직접 색인 갱신에 연결.
- revision 불일치는 revision_conflict와 success:false·saved:false로 반환하고 최신 문서 재조회와 수정안 재검토를 안내한다. 서버가 revision만 바꿔 기존 수정안을 자동 재적용하지 않는다.
- 검증 오류/충돌 미저장·경고 저장·유효 무변경 성공·오류 무변경 실패를 실제 파일 기준으로 구현.
- 색인 실패 후 단일 파일/영향 참조 자동 복구 추가 1회·인위적 대기 없음. 최초 갱신과 복구는 고정 시간 제한 없이 완료 또는 실제 오류까지 기다리고, 오래된 관측과 종료된 세션의 늦은 결과는 폐기한다.
- saved/indexUpdated/revision/진단·복구 안내를 보존하고 create 재요청·자동 롤백·무한 복구 금지.

h2. 검증 시나리오와 기대 결과

- 실제 write의 set/unset 변경·필수 삭제·중복 ID/경로·revision·무변경 모든 분기를 검증한다.
- 저장 성공/색인 실패를 강제해 success:true saved:true indexUpdated:false와 refresh 안내를 확인한다.
- 최초 갱신과 복구가 각각 1초 이상 걸려도 완료를 기다려 indexUpdated:true를 반환하고, 실제 복구 오류에는 저장 결과를 보존하며 indexUpdated:false와 refresh 안내를 반환하는지 검증한다.
- 오래된 관측이 늦게 완료되어도 최신 색인을 덮지 않으며 세션 종료 뒤 결과를 게시하지 않는지 검증한다.
- 현재 ID 중복과 공통 도메인의 완전히 같은 name은 저장 전 검증에서 차단하고, 도메인이 겹치지 않는 동명 문서는 저장을 허용하며 별도 후보 안내를 반환하지 않는지 확인한다.

h2. 완료 기준과 산출물

- indexUpdated:true 직후 같은 서버 get/list가 새 결과를 반환한다.
- 원본 미변경·저장 완료·색인 상태가 응답과 일치하며 내부 임시 파일로 AI 재전송을 요구하지 않는다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 저장 직전 최신 상태 검사와 파일 반영, 직접 색인 갱신/복구의 정확한 실행 순서를 검증한다.

## 2026-09-25 합의: 기존 저장 검사로 MCP write 연결

- #21 / COD-24의 잠금·공유 대기열 구현 보류 결정을 적용한다. 해당 구현 완료를 이번 작업의 선행 조건으로 요구하지 않는다.
- proper-lockfile, 프로세스 간 공유 FIFO 대기열, 실행 순서 보장, 등록 후 5초 대기 취소는 이번 구현 범위에 포함하지 않는다.
- revision 검사와 파일 교체 사이의 동시 수정 경쟁은 현재 단계에서 수용하며, 이번 작업의 구현·완료 조건으로 해결을 요구하지 않는다.
- 기존 저장 직전 revision·ID·경로 검사, create 비덮어쓰기, 안전한 파일 반영과 저장 후 색인 갱신·복구는 유지한다. 현재 계약은 main의 `.codocs/workspace/storage/write-coordination.yaml`과 `.codocs/workspace/storage/storage.yaml`을 따른다.

## 2026-09-25 합의: 저장 후 동명 후보 안내 제외

- #9 / COD-12의 취소 결정을 유지한다. COD-12를 선행 조건에서 제거하고, 저장 후 동명 후보 계산·최대 3개와 총수 제공·검사 실패 경고를 구현하지 않는다.
- 현재 ID 중복과 공통 도메인의 완전히 같은 name은 기존 저장 전 검증에서 차단한다. 도메인이 겹치지 않는 동명 문서는 저장을 허용하며 별도 후보 안내를 제공하지 않는다.
- 본문 중복 검사는 이번 결정에 포함하지 않는다. 기존 저장 검증의 기준은 main의 `.codocs/core/change-plan/document-change-plan.yaml`과 `.codocs/workspace/storage/storage.yaml`을 따른다.

## 2026-09-25 합의: 색인 복구의 고정 시간 제한 제거

- 색인 갱신이 1초 이상 걸린다는 이유로 실패로 처리하지 않는다. 최초 갱신과 추가 복구는 완료 또는 실제 오류가 확인될 때까지 기다린다.
- 추가 복구는 기존대로 1회만 시도한다. 실제 오류로 복구가 실패하면 success:true·saved:true·indexUpdated:false와 저장 revision·진단을 보존하고 refresh를 안내한다.
- 고정 시간 제한을 제거해도 오래된 관측의 폐기와 세션 종료 후 게시 방지는 유지한다. 담당 계약은 `.codocs/workspace/storage/saved-index-recovery.yaml`에 반영한다.

## 문서 기준

현재 계약의 기준 원문은 로컬 `.codocs`다. 문서 역할과 갱신은 [문서 컨벤션](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/development/documentation-convention.yaml)을 따른다.

구현·테스트·공개 함수 JSDoc와 해당 기능의 `.codocs` 담당 문서를 함께 갱신한다. 내부 패키지·기능별 README는 만들지 않으며, 루트 README와 사용자 가이드는 사용자 안내에 영향이 있을 때 갱신한다.

과거 Wiki revision은 당시 결정·계획의 참고 근거이며 현재 계약을 소유하지 않는다. 구현 범위·진행·검증 증거는 이슈와 PR에서 추적한다.

### 과거 Wiki와 추적 근거

- Codocs 단일 문서 쓰기와 revision 계약 (codocs-write-revision)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0d6a-754a-a977-077ed169524b","revision":"01a0997d-0d6a-7582-acb0-203c7ea2450c"}}}
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
- 저장 직전 최신 revision·ID 충돌을 다시 검사하고 검증 실패 시 원본을 보존한다.
- 저장 후 새 현재 ID와 이전 ID가 #7의 규칙으로 매칭되도록 색인을 갱신한다. 이전 ID 자동 관리는 코드 자동 변경을 의미하지 않는다.

### 추가 완료 조건

- 실제 MCP 요청과 파일 IO로 ID 변경 후 이전 ID 추가, 중복 방지·message 보존, 과거 ID 재사용을 검증한다.
- 새 현재 ID 충돌·revision 불일치·저장 실패 시 ID 또는 이전 목록만 부분 반영되지 않는지 확인한다.
- 저장 성공 후 최신 get/list와 매칭 색인을 확인한다. 색인 실패 시 기존 saved/indexUpdated·복구 계약을 유지한다.
