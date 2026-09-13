# COD-21 — [18] 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결

h2. 목표

VS Code 없이 실행할 수 있는 로컬 MCP 프로토콜 진입점을 제공한다.

h2. 작업 순서와 선행 조건

권장 순서 18/25 · 3단계 · 상위 COD-3

* [COD-20|https://seojaewan.atlassian.net/browse/COD-20] — 실제 VSIX 기능·IDE 응답성·지원 하한 검증

h2. 구현 범위

* 공식 TS SDK로 초기화·도구 등록·JSON-RPC stdio 연결. stdout 프로토콜 전용, 로그 stderr.
* 여섯 도구의 입력 schema와 Codocs 공통 success/error 결과·MCP 래퍼 매핑을 명확히 정의.
* 프로세스 시작 cwd/--project 고정·프로젝트별 프로세스·종료 정리 연결.
* 알 수 없는 요청 필드 거부와 write document/set 사용자 속성 예외를 문서 스키마와 구분.
* 빌드된 JS 명령으로 실행하며 SDK/Node/Zod 정확한 호환 버전을 기록.

h2. 검증 시나리오와 기대 결과

* 실제 클라이언트/테스트 프로세스로 초기화→도구 목록→잘못된 입력 응답을 확인한다.
* stdout에 일반 로그가 섞이지 않고 stderr 로그가 있어도 프로토콜이 정상이다.
* A/B 루트의 별도 프로세스가 서로 다른 문서만 읽고 시작 후 루트를 바꾸지 않는다.

h2. 완료 기준과 산출물

* 각 도구의 최종 요청/응답 타입과 진단 오류 매핑이 검증된다.
* 설치 후 MCP 클라이언트 설정에서 실행할 명령/인자 예시를 제공한다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* SDK 래퍼와 Codocs success/부분 결과의 정확한 매핑을 계약 테스트로 고정한다.

h2. 기준 Wiki와 추적 근거

* Codocs 패키지 책임과 서버 실행 구조 (codocs-runtime-architecture)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8dfd-7e81-b523-f955026a53ad","revision":"01a09980-8dfd-73f8-8cb0-3cc3be8368b8"}}}
* Codocs MCP 공통 응답과 조회 계약 (codocs-mcp-read-contract)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0948-7890-a34d-e8aa7400e7fe","revision":"01a0997d-0948-73d8-9442-676c800ebd6c"}}}
* Codocs 진단 코드와 좌표 계약 (codocs-diagnostics)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d7e7-7702-bae7-9fd9cdb92a75","revision":"01a0997a-d7e7-7658-923f-c18caf415695"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-21
