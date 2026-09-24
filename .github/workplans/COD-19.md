# COD-19 — [16] IDE 진단·오류 문서·외부 변경 회귀 검증

h2. 목표

저장된 지식의 오류를 정확한 위치에 표시하고 수정·외부 변경 후 제거한다.

h2. 작업 순서와 선행 조건

권장 순서 16/25 · 2단계 · 상위 COD-2

- [COD-16|https://seojaewan.atlassian.net/browse/COD-16] — 용어 Hover·이전 명칭·관련 지식 표시 구현
- [COD-17|https://seojaewan.atlassian.net/browse/COD-17] — 현재 용어 자동완성·삽입 표기·범위 처리 구현
- [COD-18|https://seojaewan.atlassian.net/browse/COD-18] — 용어 원문 이동·YAML 참조 링크 구현

h2. 구현 범위

- 파서/Zod/ID·참조 공통 진단을 LSP Diagnostic에 연결.
- 필수 누락 부모 위치·UTF-16 좌표·없으면 range 미생성 규칙을 반영.
- 외부 저장·삭제·이동·중복 충돌 해결에 따라 Hover/링크/진단을 일관되게 갱신.
- 실제 Extension Host에서 대표 정상·오류·변경 흐름을 통합 테스트.

h2. 검증 시나리오와 기대 결과

- 문법/자료형/ID/참조 오류와 unknown_field·deprecated_reference 경고가 올바른 파일에 표시된다.
- ID 충돌·대상 삭제 후 관련 문서 오류와 해결 후 진단 제거를 확인한다.
- .codocs 부재/재생성·저장 전 코드 편집·색인 준비/실패가 정상 빈 상태로 위장되지 않는다.

h2. 완료 기준과 산출물

- 진단 생성뿐 아니라 오류 해결 후 제거와 최신 범위 반영을 검증한다.
- 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 원문 변경과 저장된 지식 색인의 시점 차이를 사용자에게 오해 없이 표시한다.

h2. 기준 Wiki와 추적 근거

- Codocs 검증과 오류 문서 조회 (codocs-validation)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d2a7-7e98-9c44-ed4c5c374b9e","revision":"01a0997a-d2a7-79ac-9fd1-8ccb5829eb0f"}}}
- Codocs 진단 코드와 좌표 계약 (codocs-diagnostics)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d7e7-7702-bae7-9fd9cdb92a75","revision":"01a0997a-d7e7-7658-923f-c18caf415695"}}}
- Codocs 파일 감지와 색인 복구 (codocs-index-lifecycle)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8466-7f3b-b7ae-bcbc54e1d66e","revision":"01a09980-8466-7222-97c6-4a9d5bbf97cf"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-19
