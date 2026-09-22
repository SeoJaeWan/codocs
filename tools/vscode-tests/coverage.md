# 실제 VS Code 기능 검사 대응표

`navigation.cjs`의 각 `id`는 `functional.json`에 독립 결과로 기록된다. 모든 사례는 현재 빌드의 실제 확장·언어 서버와 등록된 `vscode.executeHoverProvider` / `vscode.executeLinkProvider`를 사용한다. URI 인수와 토큰을 만들어 제품 명령을 직접 흉내내지 않고 provider가 반환한 명령을 실행한다.

원래 `tools/ui-tests/navigation.ui.spec.mjs`는 이력과 비교용으로 보존한다. `pnpm test:ui`는 새 공식 검사로 위임한다. 원래 파일을 Playwright로 직접 실행하는 방법은 자동 검증 진입점이 아니다.

| 원래 Playwright 기능 목표         | 새 검사 ID                                                            | 실제 관측                                                     |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| 미저장 코드 식별자 변경           | unsaved-code                                                          | WorkspaceEdit, 새 Hover, dirty 및 디스크                      |
| 미저장 참조 변경과 경고 제거      | unsaved-reference                                                     | diagnostics 제거, 새 DocumentLink 실행                        |
| 변경 직후 남은 링크 실행          | in-flight-link                                                        | 명령 실행 중 활성 문서 이벤트의 URI·최신 내용                 |
| 본문·현재 ID·도메인·세 관계       | hover-content                                                         | Markdown 내용과 관계별 반환 명령                              |
| 원문·함께 매칭·정방향·역방향 링크 | relation-zone, relation-auxiliary, relation-direct, relation-referrer | 실제 활성 문서·(0,0) 빈 선택                                  |
| 중복 ID 후보와 보조 링크          | duplicate-id                                                          | 두 후보 경로 및 Auxiliary 링크                                |
| 이전 ID 안내                      | previous-id                                                           | 현재 ID·본문·안내                                             |
| 다른 출현의 이전 ID 안내          | other-occurrence                                                      | 다른 위치 안내                                                |
| 필수 필드 누락 문서               | broken-document                                                       | 오류 내용·원문 링크                                           |
| 잘못된 현재 ID의 이전 ID 호버     | invalid-id                                                            | 본문·ID 오류·원문 이동                                        |
| 매칭 부재                         | no-match                                                              | 준비 완료 후 Codocs Hover 부재                                |
| 본문·예시 세 출현의 단일 링크     | yaml-occurrence-0, yaml-occurrence-1, yaml-occurrence-2               | 각각의 실제 범위·명령·대상 상단                               |
| 메타데이터 동일 표기              | metadata                                                              | 해당 범위에 DocumentLink 부재                                 |
| 복수 후보 본문 직접 이동 없음     | ambiguous-body                                                        | 직접 DocumentLink 부재·대상 탭 부재                           |
| 복수 후보 각각 선택               | ambiguous-a, ambiguous-b                                              | 선택한 후보만 열림·다른 탭 부재                               |
| 잘못된 현재 ID의 이름 참조        | invalid-name-link                                                     | 이름으로 확정한 실제 링크 이동                                |
| 미저장 본문 참조 위치 변경        | unsaved-yaml                                                          | 새 UTF-16 행·대상·dirty·디스크 보존                           |
| 대상 변경 후 새 호버              | fresh-hover                                                           | 새 설명·반환 명령 이동                                        |
| 완료 관측 뒤 남은 링크            | stale-link                                                            | 새 조회로 완료 관측 후 기존 토큰 실행·최신 편집기 내용        |
| 대상 이동 후 새 링크              | moved-target                                                          | 새 경로·상단                                                  |
| 삭제 후 같은 경로의 다른 문서     | replaced-target                                                       | 기존 토큰 실행 후 활성 문서·탭 유지                           |
| 삭제 뒤 새 호버                   | deleted-fresh-hover                                                   | 설명·연결 제거                                                |
| 기존 dirty 탭 재사용              | dirty-target-tab                                                      | 탭 수·빈 선택·미저장 내용·디스크 보존                         |
| 부분 탐색                         | partial-scan                                                          | 실제 파일 공유 잠금으로 읽기 실패, 부분 안내·확인된 대상 이동 |
| 폐기 참조와 이동 공존             | deprecated-link                                                       | 실제 Warning 진단·링크 이동                                   |
| 폐기 해제                         | clear-deprecated                                                      | 게시된 경고 제거                                              |
| 현재 ID와 같은 이전 ID            | same-previous-id                                                      | YAML 진단·코드 이전 ID 안내 부재                              |
| 없는 이름 참조                    | missing-reference                                                     | 실제 진단·링크 부재                                           |
| 중첩 작업 공간                    | nested-workspace                                                      | 가장 가까운 workspace의 내용·원문                             |
| TypeScript 정의 기능              | native-definition                                                     | 내장 definition provider의 같은 TS 파일·정의 위치             |
| 추가: 서버 재시작                 | restart-unsaved                                                       | 실제 restart 명령 후 dirty 코드 재동기화·링크 이동            |

화면 렌더링, 물리적 hover/수정 키 클릭/F12, 알림 토스트·Quick Pick·Problems 패널의 픽셀/DOM은 검사하지 않는다. 예를 들어 링크 부재는 직접 이동 대상이 제공되지 않음을 입증하며 임의 클릭 후 팝업이 없다는 화면 증거를 만들지는 않는다. Markdown은 원문과 표시용 텍스트를 구분하고 URI 토큰은 원형 그대로 사용한다. 변경 직후 사례는 실제 변경과 명령의 순서를 검사하지만 제품 내부 경합 구간 도달을 강제했다고 주장하지 않는다.

각 사례는 실제 편집기에서 이전 dirty 문서를 되돌리고 fixture를 복원한 뒤 서버를 재시작한다. 준비 sentinel의 실제 Hover를 확인한 다음 사례를 시작한다. Windows 부분 관측은 자신이 만든 파일의 독점 공유 잠금을 사용하며 관리자·symlink 권한이 필요하지 않다. 현재 macOS 실행은 격리 준비에서 실패하므로 이 fixture도 Mac 검증 완료로 간주하지 않는다.

## 진단과 재검사 상태

`diagnostics.cjs`는 실제 `languages.getDiagnostics`와 등록된 `codocs.showDiagnosticStatus` 명령을 사용한다.

- `diagnostics-closed-catalog`: 한 번도 열지 않은 파일의 저장 진단과 UTF-16 위치.
- `diagnostics-live-create`, `diagnostics-live-resolve`: 미저장 중복 생성·해소와 다른 문서의 저장 색인 보존.
- `diagnostics-save`, `diagnostics-delete`: 저장 후 다른 문서의 진단 갱신과 확인된 삭제의 진단 제거. 닫힌 탭이 문서 모델의 종료를 보장하지 않으므로 삭제 사례는 한 번도 열지 않은 파일임을 확인한다.
- `diagnostics-recheck-recovery`: 전용 파일을 실제 잠근 뒤 실패·파일·이유·과거 결과·현재 확인 불가 안내, 편집 후 이전 밑줄 제거, 잠금 해제 후 복구, 다른 workspace 실패의 독립 유지.
- `rapid-edit-restart-diagnostics`: 연속 편집 직후 수동 재시작의 최신 원문·위치.
- `unexpected-server-exit`: 시험 Extension Host의 직접 자식이며 전용 확장 경로를 실행하는 서버만 종료한 뒤 새 PID·자동 복구·미저장 진단·실제 Hover를 확인한다.

상태 표시줄의 실제 Host 객체에 설정된 텍스트와 상세 명령의 안내를 검사하며 픽셀 렌더링 검사로 보고하지 않는다. EACCES·EPERM, 전체 읽기 실패, 늦은 편집·색인·세션 응답은 인접 기능 테스트에서 결정적으로 재현한다.
