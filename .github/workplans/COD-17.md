# COD-17 — [14] 현재 용어 자동완성·삽입 표기·범위 처리 구현

h2. 목표

현재 입력 표기에 맞게 용어를 완성하면서 기존 앞 단어를 보존한다.

h2. 작업 순서와 선행 조건

권장 순서 14/25 · 2단계 · 상위 COD-2

* [COD-15|https://seojaewan.atlassian.net/browse/COD-15] — VS Code 확장·별도 언어 서버·문서 동기화 연결

h2. 구현 범위

* name만 추천하고 deprecatedAliases 제외. 도메인·정의로 후보 구분.
* camel/Pascal/snake/대문자 snake 판별과 단서 없을 때 camel 기본값.
* changeReturnZ의 앞 단어 보존·완성 범위만 교체, 원문 이름의 단수/복수·대문자 약어 보존.
* 프로젝트 전체 스타일 추론·주변 문맥 복수형 자동 추론·다른 코드 rename 금지.

h2. 검증 시나리오와 기대 결과

* returnZ/ReturnZ/return_z/RETURN_Z의 Return Zone 완성 결과를 검증한다.
* changeReturnZ→changeReturnZone, HTTP Server→HTTPServer/httpServer를 확인한다.
* 동명이의 후보·커서 위치·숫자/약어 경계·입력 중 버전 변경을 시험한다.

h2. 완료 기준과 산출물

* 실제 삽입 결과와 edit range를 검증하고 이전 명칭이 추천되지 않는다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 표기 판별 단서·교체 경계 사례를 fixture로 고정한다.

h2. 기준 Wiki와 추적 근거

* Codocs 영어 용어 매칭과 VS Code 동작 (codocs-ide-matching)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0425-7e2a-9a7c-380db665ffad","revision":"01a0997d-0425-79ae-bce6-e554aa653abf"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-17
