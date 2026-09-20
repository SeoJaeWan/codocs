# COD-14 — [11] 코어 통합 회귀와 1,000개 문서 성능 검증

## 목표

언어 선택과 1단계 완료를 실제 동작·측정 증거로 판단한다.

## 작업 순서와 선행 조건

권장 순서 11/25 · 1단계 · 상위 COD-1

- [COD-9](https://seojaewan.atlassian.net/browse/COD-9) — 목록·복수 상세 조회·필터·커서 엔진 구현
- [COD-10](https://seojaewan.atlassian.net/browse/COD-10) — 영어 식별자 분리·복합 용어·복수형 매칭 구현
- [COD-11](https://seojaewan.atlassian.net/browse/COD-11) — 단일 문서 변경 계획·revision·YAML 부분 수정 구현
- [COD-13](https://seojaewan.atlassian.net/browse/COD-13) — 파일 변경 감지·증분 색인·refresh 준비 상태 구현

COD-12의 저장 후 동명 문서 후보 안내는 취소되어 선행 조건에서 제외한다. 저장 전 ID·이름 충돌 검증과 변경 계획 계산은 검증 대상에 유지한다.

## 구현 범위

- 100/1,000/5,000/10,000개 fixture 생성. 긴 knowledge·복수 참조·충돌/오류·정상 용어를 혼합.
- 초기 캐시 없는 준비·조회 p95·변경 계획 계산·실제 파일 변경 후 watcher를 거쳐 조회 결과에 반영되기까지의 시간·메모리·이벤트 루프 응답을 측정.
- 목록 경계·복수 get·참조/역참조·매칭·무변경·변경/삭제/이동을 잇는 회귀 시나리오 구성.
- 병목 분석 후 TS 내 개선부터 적용하고 미달이면 대안 언어 검토 근거만 기록.

## 검증 시나리오와 기대 결과

- 1,000개 초기 준비2초/조회p95 100ms/반영500ms 목표와 실제 결과를 비교한다.
- 장비·Node·OS·파일 캐시·바이트/문서 길이/참조수·프로세스수·측정 경계를 재현 가능하게 기록한다.
- 변경 계획 계산 시간과 실제 파일 변경 후 조회 결과 반영 시간을 구분해 측정한다. 변경 계획 계산에 조회100ms 목표를 임의 적용하지 않는다.
- 실제 MCP write 전체 시간 측정은 파일 저장을 통합하는 COD-25에서 수행한다. 이번 작업의 파일 변경·watcher 검증을 MCP 저장 종단 검증으로 간주하지 않는다.

## 완료 기준과 산출물

- 재실행 명령·데이터 생성 조건·측정 결과·미달/개선 내역이 있다.
- 코어 동작과 성능을 확인하고 다음 IDE 단계 착수 근거를 남긴다.
- 구현·테스트·공개 함수 JSDoc·관련 `.codocs` 문서를 함께 갱신한다. 내부 패키지 README는 별도로 만들지 않는다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

## 구현 중 확인할 사항

- 파일/중첩/응답 한계와 기준 장비를 측정 근거로 구체화한다.

## 현재 계약과 과거 추적 근거

현재 계약은 저장소의 `.codocs`에서 관리한다. Wiki는 현재 계약을 소유하지 않으며, 아래 Wiki revision은 최초 작업 계획의 과거 참고 근거로만 남긴다.

- `.codocs/development/release.yaml` — 성능 목표와 검증 범위
- `.codocs/development/test-convention.yaml` — 테스트·회귀 검증 기준
- `.codocs/development/documentation-convention.yaml` — 문서 역할과 갱신 기준
- `.codocs/index.yaml` — 기능별 현재 계약을 찾는 진입점

과거 Wiki 참고:

- Codocs 구현 순서와 성능·완료 기준 (codocs-delivery-plan)
  조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-a00c-7263-977a-c0ef6c2b5eda","revision":"01a09980-a00c-777e-936d-bf6a5de49d88"}}}
- Codocs 개발 환경과 코드·테스트 컨벤션 (codocs-development-conventions)
  조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-937a-7757-adda-29dfac9b8d39","revision":"01a09980-937a-7e7d-ad2d-6bf9ec3795f1"}}}

2026-09-13 최초 계획을 현재 `.codocs` 계약과 합의한 작업 범위에 맞춰 갱신한다. 이슈와 PR은 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-14
