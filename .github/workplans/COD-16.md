# COD-16 — [13] Hover에서 확인한 문서 원문 열기

## 목표

현재 코드의 커서에서 확인한 문서 후보를 Hover로 보여 주고, 확인된 원문 링크를 통해 정확한 YAML 범위로 이동한다. 확정되지 않은 ID·경로·좌표는 만들지 않으며, 기존 탭과 저장 전 편집 내용을 보존한다.

## 구현 범위

- 현재 ID가 유효할 때만 `id`·`documentId`를 제공하고, 이전 ID 근거·문서 경로·후보·진단은 보존한다.
- 커서의 현재 ID, 연속 토큰 수, exact 근거 순으로 우선순위를 계산한다. 최상위 동률은 모두 본문으로 표시하고 같은 식별자 안의 나머지 후보는 링크로 표시한다.
- 이름·정의 뒤에 확인된 현재 ID·도메인·원문 링크를 표시한다. 함께 매칭된 용어, 이 문서가 참조, 이 문서를 참조를 구분하며 빈 항목은 생략한다.
- 표준 LSP Hover와 VS Code 전용 `codocs.openSource` 명령을 사용한다. 명령 인자는 확인된 URI·범위·catalogVersion·원문 revision을 포함한다.
- 원문 열기는 같은 URI의 기존 탭을 재사용하고 미저장 내용을 보존한다. 현재 buffer와 원문 revision이 다르거나 범위를 확인할 수 없으면 selection을 옮기지 않는다.

## 선행 조건과 경계

- TASK-004의 언어 서버·VS Code 연결 결과를 선행 조건으로 사용한다.
- Core 매칭·Workspace 색인·LSP 좌표·VS Code 탭/명령 책임을 각 계층에 유지한다.
- 실제 GitHub 이슈·PR 수정은 이 문서의 수동 전달 경계에 남긴다.

## 검증 기준

- `userName`, `user_name`, `user-name` 복합 매칭과 공백·탭 개별 단어 매칭.
- 현재 ID 누락·형식 오류·중복 ID, 이전 ID 검색, current/previous·토큰 길이·exact/singular·최상위 동률.
- `reservationReturnZones` 양쪽 Hover, 직접/역참조 구분, 부분 결과·준비·실패 진단.
- UTF-16, 한글·공백 경로, LF/CRLF 원문, dirty YAML, 기존 탭 재사용, 기본 JavaScript 정의 이동.
- 다중·중첩 workspace에서 가장 가까운 프로젝트만 선택.
- 실제 설치 VSIX의 VS Code 1.136.1과 1.95.0 Extension Host 실행.
- 1,000개 문서·100회 warmup·1,000회 요청의 p95 100ms 목표는 실제 측정값으로 판정하며, 미측정·미달을 통과로 처리하지 않는다.

## 결과 전달

- 실제 기능 Host 검증: `COD-16-results/host-functional.md`.
- 실제 성능 원시 JSON·Markdown: `COD-16-results/hover-performance.json` 및 `.md`.
- 성능 실행은 1,000개 workload를 유지했으나 index 준비 뒤 warmup 요청이 bounded timeout으로 실패해 p95는 `NOT_MEASURED`다.
- VS Code 1.136.1·1.95.0 기능 Host는 PASS이며, 성능 목표는 `ACTION_REQUIRED`로 전달한다.
