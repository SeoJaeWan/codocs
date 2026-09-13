# COD-16 — [13] 용어 Hover·이전 명칭·관련 지식 표시 구현

h2. 목표

코드 위에서 용어의 뜻과 필요한 원문 연결을 확인하게 한다.

h2. 작업 순서와 선행 조건

권장 순서 13/25 · 2단계 · 상위 COD-2

* [COD-15|https://seojaewan.atlassian.net/browse/COD-15] — VS Code 확장·별도 언어 서버·문서 동기화 연결

h2. 구현 범위

* 최신 코드 범위에 코어 매칭을 적용해 정의 우선 Hover 렌더링.
* 복수 용어·동명이의 후보를 도메인/정의로 구분하고 전체 후보를 유지.
* 현재/이전 명칭별 근거·현재 이름·선택 message를 비차단 표시.
* 직접/역참조를 통해 관련 지식 링크를 표시하며 연결 본문/다른 정의 자동 확장 금지.

h2. 검증 시나리오와 기대 결과

* 복합 식별자·복수형·중첩 후보·같은 name의 서로 다른 domain Hover를 확인한다.
* 현재 name과 타 문서 deprecatedAliases 충돌 때 코드 전체를 이전 명칭으로 오표시하지 않는다.
* message 생략·다른 용어를 참조한 definition·오류/준비 상태 표시를 시험한다.

h2. 완료 기준과 산출물

* 실제 VS Code에서 표시 내용·원문 범위가 계약과 일치한다.
* 자동 이름 교체나 코드 범위별 정의 우선순위가 없다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 여러 후보의 화면 구성은 정보를 누락하지 않는 범위에서 구현한다.

h2. 기준 Wiki와 추적 근거

* Codocs 영어 용어 매칭과 VS Code 동작 (codocs-ide-matching)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0425-7e2a-9a7c-380db665ffad","revision":"01a0997d-0425-79ae-bce6-e554aa653abf"}}}
* Codocs 참조와 원문 소유 원칙 (codocs-references)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-cdbc-7c02-ad2e-ebeee3599e54","revision":"01a0997a-cdbc-7d95-a0ea-d4db05c9a7f5"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-16
