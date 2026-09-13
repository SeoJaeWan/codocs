# COD-11 — [08] 단일 문서 변경 계획·revision·YAML 부분 수정 구현

h2. 목표

파일을 반영하기 전에 정확한 변경 후보와 충돌·무변경 결과를 계산한다.

h2. 작업 순서와 선행 조건

권장 순서 08/25 · 1단계 · 상위 COD-1

* [COD-6|https://seojaewan.atlassian.net/browse/COD-6] — Zod 문서 스키마·사용자 정의 속성·검증 진단 구현
* [COD-8|https://seojaewan.atlassian.net/browse/COD-8] — ID 색인·참조 해석·역참조·충돌 진단 구현

h2. 구현 범위

* create/update 입력 구분·set/unset 최상위 변경·배열/객체 전체 교체·기존 ID/type/위치 유지 검증.
* 파일 전체 바이트 SHA-256 revision 계산 API와 조회 시점 원문 연결. 디스크 비교는 workspace 저장 흐름에서 사용.
* 요청·대상·revision·결과 전체 검증 후 무변경 판정. 오류 무변경 실패·경고만 있는 무변경 성공·indexUpdated 생략.
* yaml 위치/토큰을 이용한 부분 교체, 신규 속성 끝 추가, 삭제 주석 범위·독립 앞 주석 유지.
* 후보 재파싱·기대 데이터 비교·Zod/참조 검증. 실제 디스크 최종 반영은 후속 저장 작업으로 분리.

h2. 검증 시나리오와 기대 결과

* 같은 값 set·없는 선택 속성 unset·set/unset 겹침·필수 삭제·ID/type 변경을 각각 검증한다.
* 공백/주석/CRLF 변화가 revision을 바꾸고 같은 바이트는 재시작에도 동일하다.
* 따옴표·블록 문자열 끝 개행·flow 구분자·인접 주석·배열 교체 내부 주석과 비수정 영역 바이트 보존을 확인한다.
* 오류 문서의 무변경은 실패하고 오류를 모두 고친 변경은 유효 후보가 된다.

h2. 완료 기준과 산출물

* 검증 전 무변경 조기 성공이 없고 후보와 원문이 혼동되지 않는다.
* 후속 writer가 사용할 변경 계획·revision·진단 계약을 제공한다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 문자열 표기 변경 시 실제 값 정확성을 우선하며 원문 범위 교체의 세부 경계를 테스트한다.

h2. 기준 Wiki와 추적 근거

* Codocs 단일 문서 쓰기와 revision 계약 (codocs-write-revision)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0d6a-754a-a977-077ed169524b","revision":"01a0997d-0d6a-7582-acb0-203c7ea2450c"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-11
