# COD-22 — [19] MCP list·get·validate 도구와 부분 오류 반환 구현

h2. 목표

AI가 토큰 낭비 없이 목록에서 필요한 원문을 선택 조회하고 구조 오류를 검증한다.

h2. 작업 순서와 선행 조건

권장 순서 19/25 · 3단계 · 상위 COD-3

- [COD-21|https://seojaewan.atlassian.net/browse/COD-21] — 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결
- [COD-9|https://seojaewan.atlassian.net/browse/COD-9] — 목록·복수 상세 조회·필터·커서 엔진 구현

h2. 구현 범위

- list/get은 기존 코어·workspace·MCP 구현을 재사용한다. 입력 unknown 검증·필터·커서·집계·partial results의 현재 `.codocs` 계약을 실제 MCP stdio 호출로 검증하고, 누락·오류를 이번 PR에서 보완하여 기능을 완성한다.
- 고정50·ids중복제거후20 계약과 limit 미지원, 일부 없음의 성공/항목 오류를 구현.
- JSON 불가능 문서 rawYaml·진단·id/source/revision을 반환하고 정상 다른 문서를 함께 제공.
- validate는 path 생략 시 프로젝트 전체의 진단을 반환한다. 단일 프로젝트 상대 파일 지정 시에도 전체 ID·참조 색인으로 검사하되, 지정한 파일의 진단과 문제 해결에 필요한 관련 충돌 파일 정보만 반환한다.
- 응답은 크기에 따라 절단·요약하거나 거부하지 않고 전체 반환하며, 초기/refresh 상태를 처리한다.

h2. 검증 시나리오와 기대 결과

- 실제 MCP로 51개 목록과 다음 cursor,20/21개 ID,일부 없음·충돌 ID·틀린 도메인 조건을 검증한다.
- .inf 사용자 직접 편집 문서가 원문+진단으로 나오고 null로 손실 변환되지 않는다.
- validate 경로로 ID 없는/깨진 YAML을 진단하고 절대/외부/폴더/glob/복수 경로는 거부한다.
- 정상 문서 오류 보고 success:true와 요청 자체 실패 success:false를 구분한다.

h2. 완료 기준과 산출물

- 문서 본문/참조 자동 확장·요약·무언 절단 없이 실제 클라이언트 응답을 확인한다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 실제 MCP stdio 전송에서 큰 응답의 문서 본문·rawYaml·참조 목록이 절단·변형 없이 보존되는지 검증한다.
- 별도 응답 크기 제한이나 분할 기능은 추가하지 않는다. 클라이언트별 크기 한계 측정과 대응은 이번 범위에서 제외한다.

## list/get 완료 범위와 후속 작업

- 이번 PR #19는 list/get의 현재 계약을 완성한다. 기존 구현이 있다는 이유로 누락된 기능이나 계약 오류를 후속 PR로 넘기지 않는다.
- [PR #22](https://github.com/SeoJaeWan/codocs/pull/22)는 write 저장·ID 변경 직후 list/get이 새 결과를 반환하는 연결을 구현·검증한다.
- [PR #23](https://github.com/SeoJaeWan/codocs/pull/23)은 refresh 이후 커서 만료·준비 상태·실패 복구와 조회의 연결을 검증한다.
- [PR #24](https://github.com/SeoJaeWan/codocs/pull/24)는 list→get→write→validate→refresh 전체 흐름과 조회 경계·필터·성능 회귀를 검증한다.
- 후속 PR에서는 해당 기능과의 통합 및 회귀 검증에 필요한 list/get 수정을 할 수 있다.

## validate 검사 범위와 진단 반환 범위

- path를 생략하면 프로젝트 전체 `.codocs`의 진단을 반환한다.
- path를 지정해도 프로젝트 전체 색인으로 ID 중복과 참조 존재를 검사한다. 지정한 파일만 고립시켜 검사하지 않는다.
- 단일 파일 요청에서는 지정한 파일의 진단과 관련 충돌 파일 경로 등 문제 해결에 필요한 정보를 반환한다. 요청한 파일과 무관한 다른 파일의 진단은 포함하지 않는다.
- ID가 없거나 YAML 파싱에 실패한 파일도 경로로 지정해 진단받을 수 있다.
- 검증 사례: A와 B의 ID가 중복이고 C에는 별개의 YAML 오류가 있을 때, A의 경로로 요청하면 A의 중복 ID 진단과 B의 경로를 반환하고 C의 오류는 포함하지 않는다. path를 생략한 전체 요청에서는 A·B의 중복 ID 문제와 C의 YAML 오류를 모두 확인한다.

## 문서 기준

현재 계약의 기준 원문은 로컬 `.codocs`다. 문서 역할과 갱신은 [문서 컨벤션](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/development/documentation-convention.yaml)을 따른다.

구현·테스트·공개 함수 JSDoc와 해당 기능의 `.codocs` 담당 문서를 함께 갱신한다. 내부 패키지·기능별 README는 만들지 않으며, 루트 README와 사용자 가이드는 사용자 안내에 영향이 있을 때 갱신한다.

과거 Wiki revision은 당시 결정·계획의 참고 근거이며 현재 계약을 소유하지 않는다. 구현 범위·진행·검증 증거는 이슈와 PR에서 추적한다.

### 과거 Wiki와 추적 근거

- Codocs MCP 공통 응답과 조회 계약 (codocs-mcp-read-contract)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0948-7890-a34d-e8aa7400e7fe","revision":"01a0997d-0948-73d8-9442-676c800ebd6c"}}}
- Codocs 검증과 오류 문서 조회 (codocs-validation)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d2a7-7e98-9c44-ed4c5c374b9e","revision":"01a0997a-d2a7-79ac-9fd1-8ccb5829eb0f"}}}
- Codocs 진단 코드와 좌표 계약 (codocs-diagnostics)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d7e7-7702-bae7-9fd9cdb92a75","revision":"01a0997a-d7e7-7658-923f-c18caf415695"}}}

2026-09-13 최초 계획을 바탕으로 현재 로컬 `.codocs` 계약에 따라 진행하는 실행 작업이다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-22
