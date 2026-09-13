# COD-18 — [15] 용어 원문 이동·YAML 참조 링크 구현

h2. 목표

식별한 용어와 [[id]]에서 정확한 YAML 원문으로 이동한다.

h2. 작업 순서와 선행 조건

권장 순서 15/25 · 2단계 · 상위 COD-2

* [COD-15|https://seojaewan.atlassian.net/browse/COD-15] — VS Code 확장·별도 언어 서버·문서 동기화 연결
* [COD-8|https://seojaewan.atlassian.net/browse/COD-8] — ID 색인·참조 해석·역참조·충돌 진단 구현

h2. 구현 범위

* 용어 원문 이동을 코드의 기존 정의 이동과 구분하여 연결.
* 허용 필드에서 해석한 참조 위치만 DocumentLink로 노출. 열린 탭 재사용·IDE 제스처 준수.
* 이름/파일 이동 후 ID 기반 재해석 및 UTF-16 정확한 좌표 사용.
* 없는/중복 ID는 임의 파일로 이동하지 않고 진단·충돌 경로 안내.

h2. 검증 시나리오와 기대 결과

* 새 탭 열기·기존 탭 이동·파일 이름 변경/이동 후 링크 유지 확인.
* 리터럴 참조·미지원 필드·반복 링크·순환 링크·잘못된 참조를 각각 검사.
* 복수 충돌 대상 중 임의 선택이 없고 한글/이모지 위치가 정확하다.

h2. 완료 기준과 산출물

* 용어 코드 위치와 YAML 참조에서 원문 탐색이 실제 IDE에서 동작한다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* IDE 기본 정의 이동과 구분하는 구체 명령/제공 방식을 검증한다.

h2. 기준 Wiki와 추적 근거

* Codocs 영어 용어 매칭과 VS Code 동작 (codocs-ide-matching)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0425-7e2a-9a7c-380db665ffad","revision":"01a0997d-0425-79ae-bce6-e554aa653abf"}}}
* Codocs 참조와 원문 소유 원칙 (codocs-references)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-cdbc-7c02-ad2e-ebeee3599e54","revision":"01a0997a-cdbc-7d95-a0ea-d4db05c9a7f5"}}}
* Codocs 진단 코드와 좌표 계약 (codocs-diagnostics)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d7e7-7702-bae7-9fd9cdb92a75","revision":"01a0997a-d7e7-7658-923f-c18caf415695"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-18
