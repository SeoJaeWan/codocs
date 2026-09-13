# COD-20 — [17] 실제 VSIX 기능·IDE 응답성·지원 하한 검증

h2. 목표

IDE 단계가 실제 설치물에서 작동하고 색인 부하가 편집을 방해하지 않는지 확인한다.

h2. 작업 순서와 선행 조건

권장 순서 17/25 · 2단계 · 상위 COD-2

* [COD-19|https://seojaewan.atlassian.net/browse/COD-19] — IDE 진단·오류 문서·외부 변경 회귀 검증

h2. 구현 범위

* 최소 후보1.100.0과 검증 시 최신 정식 VS Code에 VSIX 설치.
* Hover/자동완성 p95·초기 색인·변경 반영·편집 응답성·다중 창 메모리 측정.
* 서버/확장 수명·원문 이동/링크/진단·외부 변경 통합 회귀.
* 실제 검증 버전·OS·아키텍처·의존성과 지원 하한 조정 근거 기록.

h2. 검증 시나리오와 기대 결과

* 1,000개 기준 Hover/자동완성 요청95% 100ms 목표를 측정하고 색인 중 편집 반응 확인.
* 코어 측정과 IDE 종단 측정을 구분하고 새 설치 환경에서 번들 누락을 확인한다.
* 한글/공백 경로·LF/CRLF·다중 VS Code 창의 독립 색인 동작을 확인한다.

h2. 완료 기준과 산출물

* VSIX 실행 증거·기능 결과·성능 기록이 있고 미검증 환경을 지원 완료로 표시하지 않는다.
* 구현·테스트·공개 함수 JSDoc·해당 패키지 README를 함께 갱신한다.
* typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

* 전체 의존성 요구가 후보보다 높으면 근거와 함께 하한을 조정한다.

h2. 기준 Wiki와 추적 근거

* Codocs 배포와 지원 환경 검증 (codocs-release-support)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-9851-7a49-abd4-0c44fb8a51a5","revision":"01a09980-9851-7e92-b590-297955d7ce38"}}}
* Codocs 구현 순서와 성능·완료 기준 (codocs-delivery-plan)
** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-a00c-7263-977a-c0ef6c2b5eda","revision":"01a09980-a00c-777e-936d-bf6a5de49d88"}}}

2026-09-13 확정 명세의 실행 작업이다. Wiki는 현재 계약을 소유하며 이슈는 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-20
