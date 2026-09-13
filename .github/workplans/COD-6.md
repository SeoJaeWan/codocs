# COD-6 — [03] Zod 문서 스키마·사용자 정의 속성·검증 진단 구현

h2. 목표

확정 term/knowledge 속성과 입력 값을 자동 변환 없이 검사한다.

h2. 작업 순서와 선행 조건

권장 순서 03/25 · 1단계 · 상위 COD-1

* [COD-5|https://seojaewan.atlassian.net/browse/COD-5] — YAML 파서·허용 구문·원문 위치 모델 구현

h2. 구현 범위

* term 필수 type/id/name/definition/domain, 선택 deprecatedAliases/examples 구현. deprecatedAliases.message는 선택.
* knowledge 필수 type/id/title/body/domains(하나 이상), 선택 kind/status 열거 구현. status 생략에 confirmed 기본값 금지.
* ID 패턴·빈/공백 문자열·배열 원소·알려진 속성 null을 검증하고 Zod에서 TS 타입 추출.
* 사용자 정의 속성을 제거하지 않고 JSON 호환 값만 보존하며 unknown_field 경고. .nan/.inf 등 거부.
* 진단 code/severity/message 및 조건부 fieldPath/range/path를 파서 위치에 연결.

h2. 검증 시나리오와 기대 결과

* term 단일 domain·knowledge 복수 domains, 대소문자 보존과 타입 오류를 각각 검사한다.
* 선택 배열 []와 message 생략은 성공, 빈 message·잘못된 null·잘못된 kind/status는 실패한다.
* 사용자 속성의 중첩 null/배열/객체는 보존, 비유한 숫자는 오류, aliases는 unknown_field이며 매칭용 속성으로 승격하지 않는다.

h2. 완료 기준과 산출물

* 검증 결과에 데이터·오류·경고를 구분하고 coercion/default/unknown 필드 삭제가 없다.
* 속성별 최대 길이 제한을 임의 추가하지 않는다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 검증 결과를 기록한다. 실제 IO·프로세스·IDE가 필요한 시나리오는 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 중첩/파일 크기 실행 한계는 성능 측정에서 결정한다.

h2. 기준 Wiki와 추적 근거

* Codocs YAML 문서 형식과 식별자 (codocs-document-schema)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-ca16-74c4-92f7-3f2c8dcc6199","revision":"01a0997a-ca16-7c4a-b028-963afd1e9393"}}}
* Codocs 검증과 오류 문서 조회 (codocs-validation)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d2a7-7e98-9c44-ed4c5c374b9e","revision":"01a0997a-d2a7-79ac-9fd1-8ccb5829eb0f"}}}
* Codocs 진단 코드와 좌표 계약 (codocs-diagnostics)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d7e7-7702-bae7-9fd9cdb92a75","revision":"01a0997a-d7e7-7658-923f-c18caf415695"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-6
