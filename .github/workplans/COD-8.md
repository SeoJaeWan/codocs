# COD-8 — [05] ID 색인·참조 해석·역참조·충돌 진단 구현

h2. 목표

원문을 복제하지 않고 문서 사이의 직접 연결과 충돌을 조회한다.

h2. 작업 순서와 선행 조건

권장 순서 05/25 · 1단계 · 상위 COD-1

* [COD-7|https://seojaewan.atlassian.net/browse/COD-7] — 프로젝트 루트·문서 탐색·파일 로더 구현

h2. 구현 범위

* definition/examples/body에서만 [[id]] 추출, 리터럴 이스케이프·잘못된 참조 문법 판정.
* references/referencedBy ID 중복 제거·오름차순, 반복 원문 위치 유지, 순환 허용·전이 확장 금지.
* ID 중복은 충돌 묶음으로 보관하고 대상 없음/reference_ambiguous를 구분.
* 오류 문서의 유효 참조는 유지하고 잘못된 타입 필드는 강제 변환 없이 제외. 출처 ID 없으면 경로 진단만 제공.
* 파일 이동/삭제/ID 변경으로 영향을 받는 참조·역참조·진단을 갱신할 계산 API 제공.

h2. 검증 시나리오와 기대 결과

* A←정책X를 역참조로 발견하고 A에 X 본문을 적지 않아도 연결된다.
* 중복 링크·순환·대상 삭제·모호한 대상·출처 ID 충돌의 기대 결과를 검사한다.
* 이스케이프, 빈 ID, 닫히지 않은 참조, 잘못된 ID 및 일부 오류와 정상 참조 공존을 검증한다.

h2. 완료 기준과 산출물

* 임의 충돌 파일 선택과 본문 자동 확장이 없다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 검증 결과를 기록한다. 실제 IO·프로세스·IDE가 필요한 시나리오는 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 연속 백슬래시·중첩 괄호 경계의 기대 동작을 테스트로 구체화한다.

h2. 기준 Wiki와 추적 근거

* Codocs 참조와 원문 소유 원칙 (codocs-references)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-cdbc-7c02-ad2e-ebeee3599e54","revision":"01a0997a-cdbc-7d95-a0ea-d4db05c9a7f5"}}}
* Codocs 검증과 오류 문서 조회 (codocs-validation)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d2a7-7e98-9c44-ed4c5c374b9e","revision":"01a0997a-d2a7-79ac-9fd1-8ccb5829eb0f"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-8
