# COD-5 — [02] YAML 파서·허용 구문·원문 위치 모델 구현

h2. 목표

YAML 원문과 위치를 잃지 않고 해석하여 검증·링크·부분 수정의 공통 기반을 제공한다.

h2. 작업 순서와 선행 조건

권장 순서 02/25 · 1단계 · 상위 COD-1

- [COD-4|https://seojaewan.atlassian.net/browse/COD-4] — 개발 환경·모노레포·공개 패키지 경계 구성

h2. 구현 범위

- npm yaml로 단일 문서·매핑을 해석하고 토큰/범위·원문을 보존하는 core parser 구현.
- 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 매핑 키를 거부하되 단일 ---·블록 문자열·주석·flow 구조 허용.
- 0 기반 UTF-16 start/end(끝 제외)와 fieldPath를 연결하는 진단 모델 구성. 실제 위치가 없으면 range 생략.
- 파싱 실패를 정상 빈 문서로 바꾸거나 원문 임의 검색으로 ID/참조를 추출하지 않는다.

h2. 검증 시나리오와 기대 결과

- 정상 term/knowledge·CRLF/LF·따옴표·블록 끝 개행·한글/이모지의 원문 위치가 정확하다.
- 금지 구문마다 구분된 오류가 나오고 중복 키의 임의 값 선택이 없다.
- 잘린 YAML·비매핑 최상위·파싱 실패에서도 원문/파일 진단을 보존한다.

h2. 완료 기준과 산출물

- IO 없는 파서 API와 원문 위치 조회 계약을 후속 모듈에서 재사용할 수 있다.
- 정상·오류 fixture와 진단 좌표 기대값을 저장한다.
- 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 검증 결과를 기록한다. 실제 IO·프로세스·IDE가 필요한 시나리오는 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- yaml 실제 버전과 원문 토큰 API를 검증한다.

h2. 기준 Wiki와 추적 근거

- Codocs YAML 문서 형식과 식별자 (codocs-document-schema)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-ca16-74c4-92f7-3f2c8dcc6199","revision":"01a0997a-ca16-7c4a-b028-963afd1e9393"}}}
- Codocs 진단 코드와 좌표 계약 (codocs-diagnostics)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d7e7-7702-bae7-9fd9cdb92a75","revision":"01a0997a-d7e7-7658-923f-c18caf415695"}}}
- Codocs 패키지 책임과 서버 실행 구조 (codocs-runtime-architecture)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8dfd-7e81-b523-f955026a53ad","revision":"01a09980-8dfd-73f8-8cb0-3cc3be8368b8"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-5
