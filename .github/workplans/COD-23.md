# COD-23 — [20] 임시 파일·비덮어쓰기 생성·원자적 update 반영 구현

h2. 목표

검증된 변경 후보를 반영할 때 원본 손상과 생성 경로 덮어쓰기를 방지한다.

h2. 작업 순서와 선행 조건

권장 순서 20/25 · 3단계 · 상위 COD-3

- [COD-21|https://seojaewan.atlassian.net/browse/COD-21] — 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결
- [COD-11|https://seojaewan.atlassian.net/browse/COD-11] — 단일 문서 변경 계획·revision·YAML 부분 수정 구현
- [COD-7|https://seojaewan.atlassian.net/browse/COD-7] — 프로젝트 루트·문서 탐색·파일 로더 구현

h2. 구현 범위

- 같은 폴더의 배타적 고유 .tmp 완전 기록/닫기, 색인 제외·해당 요청 임시 파일 정리.
- update 직전 디스크 revision·ID 충돌 재확인 후 rename, 원본 선삭제/비우기 금지.
- create의 조건부 비덮어쓰기 등록 연산 구현. 하드링크 후보의 Windows/macOS 실제 동작 검증 후 결정. Linux는 이번 범위에서 제외한다.
- 반영 전 실패·반영 후 요청 임시 파일 정리 실패를 실제 저장 여부대로 구분. MCP write·저장 후 색인 복구는 #22 범위다.
- Node 기본 API 사용과 권한/동기화 처리, 직접 외부 편집 경쟁 한계 기록.
- 잠금·공유 대기열·취소는 #21 범위다.

h2. 검증 시나리오와 기대 결과

- 임시 기록 중 실패·권한 거부·rename 실패에서 원본이 유지된다.
- 사전 존재 검사 이후 다른 생성이 끼어도 기존 파일을 덮어쓰지 않는다.
- 원문 읽기 이후 공백/주석/줄바꿈 변경은 revision_conflict로 차단한다.
- 반영 후 임시 정리 실패를 저장 실패로 오보고하거나 원본 삭제 재시도로 우회하지 않는다.

h2. 완료 기준과 산출물

- OS별 실제 파일 테스트로 반영/미반영 상태·임시 정리·원본 바이트를 확인한다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 하드링크/비덮어쓰기 연산·권한·교체 원자성과 정전 보존 차이를 검증해 기록한다.

## 문서 기준

현재 계약의 기준 원문은 로컬 `.codocs`다. 문서 역할과 갱신은 [문서 컨벤션](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/development/documentation-convention.yaml)을 따른다.

구현·테스트·공개 함수 JSDoc와 해당 기능의 `.codocs` 담당 문서를 함께 갱신한다. 내부 패키지·기능별 README는 만들지 않으며, 루트 README와 사용자 가이드는 사용자 안내에 영향이 있을 때 갱신한다.

과거 Wiki revision은 당시 결정·계획의 참고 근거이며 현재 계약을 소유하지 않는다. 구현 범위·진행·검증 증거는 이슈와 PR에서 추적한다.

### 과거 Wiki와 추적 근거

- Codocs 파일 반영과 프로세스 간 쓰기 조정 (codocs-file-concurrency)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-88db-73d7-8702-991548b5b8a1","revision":"01a09980-88db-7f76-b6b3-23bb9464346f"}}}
- Codocs 단일 문서 쓰기와 revision 계약 (codocs-write-revision)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0d6a-754a-a977-077ed169524b","revision":"01a0997d-0d6a-7582-acb0-203c7ea2450c"}}}

2026-09-13 최초 계획을 바탕으로 현재 로컬 `.codocs` 계약에 따라 진행하는 실행 작업이다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-23
