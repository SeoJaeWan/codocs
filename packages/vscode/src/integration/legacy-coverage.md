# Legacy 설치 Host 검사의 대응 범위

이전 설치 VSIX 실행기는 제거했다. 현재 `pnpm test:vscode`가 VSIX 패키징·설치와 기능 검사를 함께 수행한다. 반복 장애 후 자동 재시작 중단·수동 복구는 `restart-budget-recovery` 사례로 통합했다. 아래 표는 이전 기능 목표와 현재 API 검사 사이의 대응 기록이며, 화면 렌더링 항목을 현재 자동 검사의 필수 조건으로 요구하지 않는다. 이전 구현은 [고정 커밋의 Git 이력](https://github.com/SeoJaeWan/codocs/tree/fa9d91e6d18094a1e4265dfe0d22dcb811996c7d/tools/extension-host)에서 확인할 수 있다.

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

위 표는 이전 검증과의 대응 기록이다. 현재 실행기는 Windows·Mac의 실제 창을 허용하며, 각 실행의 기능·정리 결과는 별도로 기록한다.
