# COD-10 — [07] 영어 식별자 분리·복합 용어·복수형 매칭 구현

h2. 목표

언어·IDE와 무관하게 코드 식별자의 모든 유효 용어 후보와 위치를 계산한다.

h2. 작업 순서와 선행 조건

권장 순서 07/25 · 1단계 · 상위 COD-1

* [COD-8|https://seojaewan.atlassian.net/browse/COD-8] — ID 색인·참조 해석·역참조·충돌 진단 구현

h2. 구현 범위

* camel/Pascal/snake/kebab·공백 분리와 원본 위치 보존. 대문자 연속 뒤 소문자는 마지막 대문자 전 분리.
* 문자/숫자 경계 보존과 연속 토큰 매칭. name/deprecatedAliases 인식, ID·aliases 사용자 속성은 매칭 제외.
* 표기 정규화 일치 후 마지막 단어의 pluralize 단수화 일치를 추가. 등록/코드 양쪽 동일 적용.
* 긴 복합 용어 우선·짧은 용어 유지·동명이의 후보 전체·현재/이전 명칭 근거 분리. 코드 경로나 도메인 scope 금지.

h2. 검증 시나리오와 기대 결과

* HTTPServer/HTTPSServer/getURLValue/zone2Count의 토큰과 위치를 확인한다.
* reservationReturnZoneId·selectedReturnZones·returnOldZone·중간 숫자에 대해 기대 매칭/비매칭을 검증한다.
* 표기/단수화·복합/짧은 용어 순위, 동명이의 도메인과 현재/이전 이름 충돌을 확인한다.

h2. 완료 기준과 산출물

* 독립 코어 API·대표 fixture와 위치/순위 기대 결과를 제공한다.
* pluralize가 모든 영어 형태나 의미를 판단한다고 가정하지 않는다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 나머지 동률·영어 예외는 범위를 명시하고 테스트로 결정한다.

h2. 기준 Wiki와 추적 근거

* Codocs 영어 용어 매칭과 VS Code 동작 (codocs-ide-matching)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0425-7e2a-9a7c-380db665ffad","revision":"01a0997d-0425-79ae-bce6-e554aa653abf"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-10
