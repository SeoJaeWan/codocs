# COD-29 제품 구현과 설치 검증

TASK-001의 명시 표기·검색 정책·source token, TASK-002의 저장 영향 안내를 TASK-003의 IDE 표현과 연결한다. 승인된 첫 행 Inlay Hint와 명시 숫자 행 이동을 유지한다.

## 구현

- 정상 명시 span을 직접 문서 링크로 연결하고 잘못된 span은 기존 ID 설명 대신 구별 가능한 밑줄·이유를 제공한다.
- 문서 행 역참조는 정확한 출현 합집합과 경로·행·열별 개별 링크를 제공한다. 완료 단일 연결은 직접 이동하고 기존 YAML 이름 링크의 정확한 영역은 유지한다.
- 문서 전체 출현만 첫 행 앞 Inlay Hint에 집계한다. 완료 1곳은 IDE 이동 제스처, 복수는 개별 tooltip 링크, 완료 0곳은 제거한다. collecting/incomplete는 완료 단일·부재와 구분하며 원문·dirty·행 수와 editor 설정을 보존한다.
- 출처 소유 client와 opaque token의 서버·버전·현재 표기·파일 정체를 확인한다. dirty 대상은 현재 buffer의 명시 숫자 시작·끝 행을 모두 확인하고 정확한 marker 이동은 현재 text도 확인한다.
- 한국어 담당 `.codocs`, 영문·국문 README, 작성·갱신 가이드와 언어 공통 예시를 동기화했다. 미결이던 상단 표시는 승인된 Inlay Hint로 기록했다.

## 검증

실제 VS Code 양방향 탐색·MCP 변경 영향 안내 시나리오의 대표 UI 케이스와 인접 테스트는 다음과 같다.

### 인접 테스트

- core: code-reference, change-impact
- workspace: code-reference, code-file-access, write-impact, code-reference-watcher
- language-server: code-navigation, server-session/code-navigation
- mcp: server write-impact
- vscode: open-source, vscode-client

### 대표 UI 케이스

- A1-A5, B1-B3, C1-C2는 CI test:vscode로 검증한다.

### PR CI 실행

- 링크: TBD
