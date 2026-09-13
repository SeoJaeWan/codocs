# COD-12 — [09] 저장 후 이름·제목 일치 후보 계산 구현

h2. 목표

중복을 추측하지 않고 확인 가능한 일치 후보만 비차단 정보로 계산한다.

h2. 작업 순서와 선행 조건

권장 순서 09/25 · 1단계 · 상위 COD-1

* [COD-10|https://seojaewan.atlassian.net/browse/COD-10] — 영어 식별자 분리·복합 용어·복수형 매칭 구현
* [COD-11|https://seojaewan.atlassian.net/browse/COD-11] — 단일 문서 변경 계획·revision·YAML 부분 수정 구현

h2. 구현 범위

* term name/이전 명칭 간 원문·정규화/단수화 일치, knowledge title 원문·공백/영문 대소문자 정규화 구현.
* 자기 자신·종류 간 교차·ID 철자/본문 의미/도메인만으로 생긴 후보 제외.
* 원문→정규화→같은 도메인→ID 순서, knowledge 공통 domains 판정. 문서 단위 dedup·총수·최대3개.
* 생성/이름/이전 명칭/제목/도메인 변경 시 검사. 본문·예문·상태만 변경하면 생략. 실패는 별도 경고.

h2. 검증 시나리오와 기대 결과

* 한 문서에 여러 일치 근거가 있어도 similarCount는 하나로 센다.
* 0/1/3/4개 후보·같은 도메인 순위·knowledge 다중 도메인·의미만 유사한 비후보를 검증한다.
* 검사 완료 0개, 정상 생략, 검사 실패를 distinct 응답으로 확인하고 실패 자동 재시도/저장 차단이 없다.

h2. 완료 기준과 산출물

* 후보 본문·자동 병합 없이 ID/표시명/도메인/일치 근거만 제공한다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 버전별 pluralize 동작은 코어 매칭 fixture와 동일하게 검증한다.

h2. 기준 Wiki와 추적 근거

* Codocs 저장 후 이름 일치 후보 안내 (codocs-name-match-candidates)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-129c-7cdf-9811-2c2d98a6c635","revision":"01a0997d-129c-7028-ab57-0395e5531fe3"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-12
