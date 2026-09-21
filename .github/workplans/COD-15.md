# COD-15 — [12] VS Code 확장·별도 언어 서버·문서 동기화 연결

h2. 목표

실제 VS Code가 독립 언어 서버와 공통 코어를 사용하도록 연결한다.

h2. 작업 순서와 선행 조건

권장 순서 12/25 · 2단계 · 상위 COD-2

- [COD-14|https://seojaewan.atlassian.net/browse/COD-14] — 코어 통합 회귀와 1,000개 문서 성능 검증

### 2026-09-20 착수 결정

- COD-14의 성능 목표 미달은 후속 개선 과제로 남기고, 이번 작업은 VS Code 확장·별도 언어 서버·문서 동기화의 기능 구현과 실제 동작 검증을 우선한다.
- 성능 목표 달성을 이번 작업의 착수 조건으로 두지 않는다. 기존 목표는 유지하며, 미달 결과를 성능 검증 통과로 처리하지 않는다.
- 색인 성능 개선은 이번 구현 범위에 추가하지 않는다. 기존 측정 결과와 한계는 COD-14 결과 기록에서 추적한다.

h2. 구현 범위

- vscode-languageclient와 vscode-languageserver/textdocument 정식 SDK 연결, LSP·Node IPC로 별도 서버 실행.
- 확장과 서버의 시작·준비·종료·오류·workspace/core 수명 관리.
- 코드의 저장 전 내용/버전/위치 동기화와 저장된 .codocs 색인을 분리.
- VS Code 내장 런타임용 esbuild 결과물을 VSIX에 포함하고 정확한 의존성·target·모듈 형식 검증.

h2. 검증 시나리오와 기대 결과

- 실제 Extension Host에서 서버 실행·문서 열기/편집/닫기와 버전 갱신을 확인한다.
- 확장 비활성화/서버 종료 시 watcher·자원 정리와 재시작 동작을 확인한다.
- MCP stdio 로그/프로토콜과 언어 서버 IPC를 혼용하지 않는다.

h2. 완료 기준과 산출물

- 별도 Node 설치 없이 지원 VS Code 환경에서 서버가 시작하고 통신한다.
- 관련 .codocs 담당 문서에 실행·메시지·오류 흐름을 설명한다.
- 구현·테스트·공개 함수 JSDoc·관련 .codocs 문서를 함께 갱신한다. 내부 패키지 README는 별도로 만들지 않는다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 최소 VS Code 후보1.100.0·실제 번들 의존성 호환성을 검증한다.

h2. 현재 계약과 과거 추적 근거

현재 계약의 기준 원문은 저장소의 .codocs다. Wiki는 현재 계약을 소유하지 않으며, 아래 Wiki revision은 최초 작업 계획의 과거 참고 근거로만 남긴다.

- `.codocs/development/documentation-convention.yaml` — 문서 역할과 갱신 기준
- `.codocs/development/runtime-architecture.yaml` — 패키지 책임과 서버 실행 구조
- `.codocs/development/development-environment.yaml` — 개발 도구와 실행 런타임·빌드 기준
- `.codocs/development/test-convention.yaml` — 테스트·회귀 검증 기준
- `.codocs/vscode/server-connection.yaml` — 확장과 언어 서버 연결
- `.codocs/language-server/document-sync.yaml` — 편집 중 코드·버전·식별자 위치 동기화
- `.codocs/index.yaml` — 기능별 현재 계약을 찾는 진입점

과거 Wiki 참고:

- Codocs 패키지 책임과 서버 실행 구조 (codocs-runtime-architecture)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8dfd-7e81-b523-f955026a53ad","revision":"01a09980-8dfd-73f8-8cb0-3cc3be8368b8"}}}
- Codocs 개발 환경과 코드·테스트 컨벤션 (codocs-development-conventions)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-937a-7757-adda-29dfac9b8d39","revision":"01a09980-937a-7e7d-ad2d-6bf9ec3795f1"}}}

2026-09-13 최초 작업 계획을 현재 .codocs 계약에 맞춰 갱신한다. 이슈와 PR은 구현 범위·검증·증거를 추적한다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-15

위 Wiki revision은 최초 작업 계획의 추적 근거다. 이번 PR의 변경 범위는 아래 2026-09-20 사용자 합의를 반영하며, 상충하는 이전 언어별 추출 계획은 아래 합의로 대체한다. 현재 계약은 .codocs를 기준으로 확인하고, 구현 중 계약 변경이 필요하면 관련 .codocs 담당 문서를 함께 갱신한다.

## 2026-09-20 합의: 언어 공통 텍스트 매칭과 기존 기능 연결

이 합의는 이전 언어별 어댑터 계획과 TS·TSX·JS·JSX 제한, 주석·문자열 제외 조건을 대체한다.

### 구현 범위

- 프로젝트에 연결된 텍스트 문서는 프로그래밍 언어나 확장자 구분 없이 같은 규칙으로 매칭한다. Java 등도 특정 언어 지원 목록으로 제한하지 않는다.
- 주석·문자열·JSX 화면 텍스트를 포함한다. 언어별 파서와 문법 검사·진단 기능은 추가하지 않으며, 문법 오류 여부로 매칭을 차단하지 않는다.
- 기존 core의 문자·토큰 경계와 비교 규칙을 재사용한다. 언어 공통 처리를 이유로 모든 문자 체계 지원이나 매칭 규칙 확대를 가정하지 않는다.
- 단어 경계 규칙을 유지한다. user-name은 userName·UserName·user_name·user-name·user name과 매칭하지만 user.name을 하나의 복합 용어로 연결하거나 userOldName의 중간 단어를 건너뛰지 않는다. 주석·문자열에도 같은 규칙을 적용하며, 매칭된 텍스트 범위의 커서에 대응하는 결과를 후속 Hover에 제공한다.
- workspace 조회 세션에 매칭 API를 추가하여 기존 색인 관리와 core 매칭을 연결한다. 외부에는 매칭 결과와 색인 상태·버전을 제공한다.
- 같은 문서에서 추출한 문자열은 같은 시점의 색인으로 처리하고, core에는 매칭 문자열을 하나씩 전달한다.
- 언어 서버는 공통 텍스트 추출·파일 좌표 변환·코드 버전 확인을 담당한다. core가 반환한 UTF-16 범위 [시작, 끝)를 원본 위치로 변환한다.
- 저장 전 내용과 버전으로 계산하며 이전 버전의 결과를 새 내용에 적용하지 않는다. .codocs 변경 시에도 결과를 갱신한다. 목록 커서용 generation을 매칭 최신성 기준으로 그대로 사용하지 않는다.
- 모든 발생 위치의 결과를 #13의 커서 기준 Hover와 #15의 원문 이동에 연결할 수 있게 제공한다.

### 검증과 문서

- 여러 언어의 코드·주석·문자열에 같은 텍스트를 두어 같은 매칭 규칙과 정확한 원본 위치를 검증한다.
- UTF-16, LF/CRLF, 저장 전 편집·버전 변경, 문법 오류가 있는 텍스트의 매칭을 검증한다.
- 관련 계약은 .codocs/language-server/document-sync.yaml과 .codocs/core/matcher/identifier-matching.yaml을 기준으로 관리한다. 구현·검증 범위 확정을 지원 완료로 간주하지 않는다.

### 프로젝트 연결

- VS Code에서 연 workspace 폴더를 프로젝트 루트로 사용하고 해당 폴더 아래 .codocs에 연결한다.
- 여러 workspace 폴더는 폴더별 별도 언어 서버와 색인으로 관리한다.
- 중첩된 workspace 폴더에서는 파일을 포함하는 가장 가까운 workspace 폴더에 연결한다.
- 폴더 없이 연 파일과 workspace 밖 파일은 매칭하지 않으며, 상위 디렉터리의 .codocs를 자동 탐색하지 않는다.
- 관련 계약은 .codocs/vscode/server-connection.yaml에서 관리한다. 실제 Extension Host에서 폴더별 분리와 중첩 폴더의 연결 대상을 검증한다.
- 프로젝트에 .codocs가 없으면 자동 생성하지 않고 매칭 없이 대기한다. 사용자가 생성하면 자동 감지하여 색인 준비 후 매칭을 시작한다. 실제 폴더 생성으로 자동 전환을 검증한다.

### 예기치 않은 서버 종료

- 언어 서버가 예기치 않게 종료되면 자동 재시작을 시도한다. 반복 실패 시 자동 재시작을 중단하고 오류와 수동 재시작 방법을 안내한다.
- 재시작 후에는 해당 서버에 연결된 열린 코드 문서의 현재 내용·버전을 다시 동기화한다. 저장하지 않은 편집 내용도 포함하며 파일을 자동 저장하지 않는다.
- 실제 서버 프로세스 종료와 반복 실패, 수동 재시작, 저장 전 편집 내용의 재동기화를 검증한다.
