# COD-22 — [19] MCP list·get·validate 도구와 부분 오류 반환 구현

h2. 목표

AI가 토큰 낭비 없이 목록에서 필요한 원문을 선택 조회하고 구조 오류를 검증한다.

h2. 작업 순서와 선행 조건

권장 순서 19/25 · 3단계 · 상위 COD-3

- [COD-21|https://seojaewan.atlassian.net/browse/COD-21] — 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결
- [COD-9|https://seojaewan.atlassian.net/browse/COD-9] — 목록·복수 상세 조회·필터·커서 엔진 구현

h2. 구현 범위

- 코어 list/get 엔진을 공식 도구에 연결하고 입력 unknown 검증·필터·커서·집계·partial results를 보존.
- 고정50·ids중복제거후20 계약과 limit 미지원, 일부 없음의 성공/항목 오류를 구현.
- JSON 불가능 문서 rawYaml·진단·id/source/revision을 반환하고 정상 다른 문서를 함께 제공.
- validate 전체/단일 프로젝트 상대 파일을 지원하고 파일 요청도 전체 ID/참조 색인 검증.
- 응답 전체 반환·크기 초과 명시·분할 ID 조회 안내, 초기/refresh 상태 처리.

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

- 대표 클라이언트에서 응답 크기 한계와 에러 표현을 시험해 기록한다.

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
