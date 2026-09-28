# 실제 VS Code 기능 검사 대응표

`extension.test.cjs`의 각 `id`는 `functional.json`에 독립 결과로 기록된다. 모든 사례는 현재 소스로 패키징·설치한 VSIX의 실제 확장·언어 서버와 등록된 `vscode.executeHoverProvider` / `vscode.executeLinkProvider`를 사용한다. URI 인수와 토큰을 만들어 제품 명령을 직접 흉내내지 않고 provider가 반환한 명령을 실행한다.

이전 Playwright 시나리오와 전용 실행기·도우미는 제거했다. 원래 구현은 Git 이력에서 확인하며 아래 대응표는 이전 기능 목표의 추적 근거로 유지한다. 자동 기능 검사 진입점은 `pnpm test:vscode`다.

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
| 부분 탐색                         | partial-scan                                                          | 현재 OS의 실제 읽기 제한으로 실패, 부분 안내·확인된 대상 이동 |
| 부분 탐색의 미확정 참조           | unconfirmed-reference                                                 | 미확정 진단·폐기 경고와 이동 링크 부재                        |
| 폐기 참조와 이동 공존             | deprecated-link                                                       | 실제 Warning 진단·링크 이동                                   |
| 폐기 해제                         | clear-deprecated                                                      | 게시된 경고 제거                                              |
| 현재 ID와 같은 이전 ID            | same-previous-id                                                      | YAML 진단·코드 이전 ID 안내 부재                              |
| 없는 이름 참조                    | missing-reference                                                     | 실제 진단·링크 부재                                           |
| 중첩 작업 공간                    | nested-workspace                                                      | 가장 가까운 workspace의 내용·원문                             |
| TypeScript 정의 기능              | native-definition                                                     | 내장 definition provider의 같은 TS 파일·정의 위치             |
| 추가: 서버 재시작                 | restart-unsaved                                                       | 실제 restart 명령 후 dirty 코드 재동기화·링크 이동            |

위 기존 ID·YAML 사례는 화면 렌더링, 물리적 hover/수정 키 클릭/F12, 알림 토스트·Quick Pick·Problems 패널의 픽셀/DOM을 검사하지 않는다. 예를 들어 링크 부재는 직접 이동 대상이 제공되지 않음을 입증하며 임의 클릭 후 팝업이 없다는 화면 증거를 만들지는 않는다. 아래 `whole-code-inlay` 사례는 전용 renderer에서 실제 Inlay 화면·설정·이동 제스처를 별도로 관찰한다. Markdown은 원문과 표시용 텍스트를 구분하고 URI 토큰은 원형 그대로 사용한다. 변경 직후 사례는 실제 변경과 명령의 순서를 검사하지만 제품 내부 경합 구간 도달을 강제했다고 주장하지 않는다.

각 사례는 실제 편집기에서 이전 dirty 문서를 되돌리고 fixture를 복원한 뒤 서버를 재시작한다. 준비 sentinel의 실제 Hover를 확인한 다음 사례를 시작한다. 부분 관측은 Windows의 독점 공유 잠금 또는 macOS의 파일 권한 제한으로 실제 읽기 실패를 확인한 뒤 시작하고 종료 시 접근 상태를 복원한다. 관리자·symlink 권한이 필요하지 않다. 같은 사례를 Windows·macOS에서 실행하며 실제 창 표시를 허용한다.

## 진단과 재검사 상태

`extension.test.cjs`는 실제 `languages.getDiagnostics`와 등록된 `codocs.showDiagnosticStatus` 명령을 사용한다.

- `diagnostics-closed-catalog`: 한 번도 열지 않은 파일의 저장 진단과 UTF-16 위치.
- `diagnostics-live-create`, `diagnostics-live-resolve`: 미저장 중복 생성·해소와 다른 문서의 저장 색인 보존.
- `diagnostics-save`, `diagnostics-delete`: 저장 후 다른 문서의 진단 갱신과 확인된 삭제의 진단 제거. 닫힌 탭이 문서 모델의 종료를 보장하지 않으므로 삭제 사례는 한 번도 열지 않은 파일임을 확인한다.
- `diagnostics-recheck-recovery`: 전용 파일을 실제 잠근 뒤 실패·파일·이유·과거 결과·현재 확인 불가 안내, 편집 후 이전 밑줄 제거, 잠금 해제 후 복구, 다른 workspace 실패의 독립 유지.
- `rapid-edit-restart-diagnostics`: 연속 편집 직후 수동 재시작의 최신 원문·위치.
- `restart-budget-recovery`: 각 workspace의 실제 응답을 확인하며 서버를 반복 종료한다. 자동 재시작 3회 이후 4번째 종료에서 중단 상태를 확인하고 수동 명령으로 복구한 뒤 모든 workspace의 Hover·미저장 문서 진단·버전·원문·디스크 보존을 검사한다.
- `unexpected-server-exit`: 시험 Extension Host의 직접 자식이며 전용 확장 경로를 실행하는 서버만 종료한 뒤 새 PID·자동 복구·미저장 진단·실제 Hover를 확인한다.

상태 표시줄의 실제 Host 객체에 설정된 텍스트와 상세 명령의 안내를 검사하며 픽셀 렌더링 검사로 보고하지 않는다. EACCES·EPERM, 전체 읽기 실패, 늦은 편집·색인·세션 응답은 인접 기능 테스트에서 결정적으로 재현한다.

이름 중복 회귀: duplicate-name-open, duplicate-name-edit-name, duplicate-name-edit-domain, duplicate-name-save는 파일 열기·미저장 이름/도메인 편집·저장 후 상대 문서 진단 갱신을 확인한다.

## 명시 코드 참조의 제품 연결

| 계약                                                                                                  | 실제 설치 시나리오                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 전체 명시 span, 유효 링크·오류 이유, UTF-16/CRLF, dirty 숫자 행과 두 끝 검사                          | explicit-code-reference                               |
| 정확한 출현·열, 겹친 행 합집합, YAML 이름 링크 우선                                                   | reverse-code-reference                                |
| whole-only 2→1→0, Inlay 설정 off/on, 화면 표시·Meta/Ctrl 이동, 원문/dirty 불변                        | whole-code-inlay                                      |
| 편집·재시작·경로 재사용 이후 오래된 command 거부                                                      | stale-code-reference                                  |
| 추적 ignored·미추적 ignored·하위 ignore/reinclude·binary/UTF-16·링크/정션·프로젝트 범위, IDE/MCP 비교 | code-reference-eligibility + standalone installed-mcp |
| 저장 전 출현, 내부/앞/뒤/삭제/whole/name/domain/repeated, 계산·수집·색인·저장 실패 보존               | standalone installed-mcp                              |

`whole-code-inlay`는 실제 읽기 실패에 따른 incomplete의 확인 1개/0개에서 단일 이동·완료 부재를 제공하지 않고 실패 이유·개별 링크를 유지하며 복구되는지 검사한다. collecting과 저장 문서 partial, 실제 source 토큰·최신성 및 consumer 경합은 인접 LS/VS Code 테스트로 추가 확인한다. standalone installed-mcp는 같은 살아 있는 MCP의 Git 추적 제거·ignore 제거 뒤 저장 영향 수집도 검사한다. 실제 설치 자료가 없는 OS·버전을 이 표만으로 통과 처리하지 않는다.
