# Legacy 설치 Host 검사의 대응 범위

`tools/extension-host/run.mjs`의 기능 경로는 설치된 VSIX에서 COD-18 provider·명령 사례 20개와 다중 workspace 서버 4개, 자동 재시작 3회, restart budget 소진, 수동 복구를 실제로 검사한다. 보고서의 AC-001~012 `skip` 행은 이 기능 사례의 OS 생략이 아니라 옛 렌더링 UI 수락 조건 전체를 아직 증명하지 않았다는 표시다. 현재 API 기반 공식 VS Code 검사는 `pnpm test:vscode`의 실제 Extension Host 사례로 대응한다.

| Legacy AC | 실제 기능 검사 대응                                                                                                     | 수락 조건에 남는 범위                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| AC-001    | legacy CRLF/LF 범위 2건; `yaml-occurrence-0/1/2`, `metadata`                                                            | 렌더링된 UI 범위 전체 조합                                             |
| AC-002    | legacy 미저장 교체; `unsaved-reference`, `unsaved-yaml`, `rapid-edit-restart-diagnostics`                               | 닫기·취소·제어된 비동기 경합의 UI                                      |
| AC-003    | legacy 복수 후보·관계·역관계 3건; `ambiguous-body/a/b`, `relation-referrer`                                             | 실제 링크 클릭과 렌더링 Hover 클릭                                     |
| AC-004    | legacy 본문 변경·이동 2건; `fresh-hover`, `stale-link`, `moved-target`                                                  | 이미 열린 Hover의 즉시 갱신은 승인된 후속 범위                         |
| AC-005    | legacy 삭제·경로 재사용; `replaced-target`                                                                              | 화면에서 오래된 링크 클릭과 팝업 부재                                  |
| AC-006    | legacy 없는 대상과 진단; `deleted-fresh-hover`, `missing-reference`                                                     | 팝업 부재의 화면 관측                                                  |
| AC-007    | legacy 중복 후보; `duplicate-id`, `ambiguous-a/b`                                                                       | 렌더링된 후보 UI                                                       |
| AC-008    | legacy 현재·이전 ID 혼합; `previous-id`, `other-occurrence`                                                             | 렌더링된 출현별 UI 전체 조합                                           |
| AC-009    | legacy alias 진단; `same-previous-id`                                                                                   | 화면에 게시된 진단·Hover                                               |
| AC-010    | legacy dirty 탭과 원문; `dirty-target-tab`, `yaml-occurrence-0/1/2`                                                     | 렌더링된 코드·YAML 링크 클릭                                           |
| AC-011    | legacy 폐기 경고·해제·일반/이전/복수 후보 반례; `deprecated-link`, `clear-deprecated`, `unconfirmed-reference`          | 화면에 표시된 경고·링크                                                |
| AC-012    | legacy 잘못된 ID·부분 탐색·기본 정의; `invalid-id`, `partial-scan`, `diagnostics-recheck-recovery`, `native-definition` | 제어된 Host 준비 상태와 렌더링 UI; 실패·복구 상태는 실제 명령으로 검사 |

Mac GUI 격리 어댑터가 없어서 현재 실제 GUI 시나리오는 Windows에서만 실행했다. 두 OS의 기능 목표와 사례 목록은 같으며 Mac 결과가 생기기 전에는 Mac 검증 통과로 표시하지 않는다.
