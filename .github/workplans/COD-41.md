# COD-41 — 명시 코드 참조와 문서↔코드 탐색

코드·테스트의 `@codocs [[문서]]`, `#L11`, `#L11-L12` 표기로 `.codocs` 문서 전체·행·행 범위를 열고, 문서에서 연결된 코드 위치로 돌아가는 기능을 구현한다. COD-29의 승인된 동작과 요구를 이어가되 과거 구현을 통째로 병합하지 않고, 현재 기준 `6c64ce4ef27350c50c1bb72b10e9d9e13c86ba0a`에서 선택한 결과만 옮긴다.

과거 구현의 정확한 참고 원본은 `d09fc4cedcd661cc6b88cb9168d2a8f8ba7ebc68` (`origin/codex/COD-29--wb-prepare-20260929T141019Z-e3b056d0bd37-972334-INT-001`)이다. 이 원본의 COD-29 계획·결과·Inlay 시제품 파일은 당시 계획과 관찰을 보존하는 역사 자료이며, 현재 브랜치의 구현이나 검증 결과로 해석하지 않는다. 특히 과거 MCP 구현과 Windows 실행 결과는 현재 기능·검증의 증거가 아니다.

## 범위

### 1층: core

표기 추출, 문서 이름·도메인 해석, 행·범위 해석과 오류 구분을 구현한다. 기존 참조 추출과 진단 체계에 맞춘다.

### 2층: workspace 코드 참조 색인

프로젝트 코드 참조 수집, 열린 버퍼 반영, 역참조와 감시 갱신을 구현한다. IDE 조회용 API만 추가하며 MCP 저장·workspace `storage` 경로는 수정하지 않는다.

### 3층: language server와 VS Code

명시 링크와 잘못된 표기의 이유 Hover, 문서 행에서 코드로 돌아가는 단일 직접 이동·복수 Hover 링크, 문서 전체 Inlay Hint를 구현한다. 기존 YAML 이름 링크와 공존시키고 dirty buffer 및 명시 행의 이동 계약을 지킨다. UI 검증은 기존 A1-A5, B1-B3, C1-C2 등 19개 실제 VS Code 시나리오를 CI에서 실행한다.

### 문서와 변경 이력

README·가이드·예시에는 명시 문서 링크와 역방향 코드 탐색, Hover, Inlay Hint만 설명한다. COD-29 계획과 결과, header prototype은 역사 자료로 보존한다. 현재 작업의 변경 요약은 codocs 패키지 patch changeset 하나로 기록한다.

### 제외 범위

MCP `codocs_write` 영향 안내, 저장 결과 계약, write-impact/change-impact 구현, query write 동작, workspace 저장소와 MCP 소스는 이 작업에서 제외한다. 과거 문서나 MCP 계약 파일에 관련 내용이 있어도 현재 공개 가이드에 옮기거나 새 기능처럼 설명하지 않는다.

## 실행 및 검증 계획

작업은 macOS의 독립 Git worktree에서 실행한다. 로컬 작업 부모 디렉터리는 `/Users/seojaewan/Desktop/dev/codocs-worktrees/wb-cod41-mac-r2-6c64ce4-0f556e`이며 TASK-001..005와 INT-001은 각각 별도 worktree를 사용한다. primary checkout은 COD-40에 둔다. 원격 `origin/codex/COD-29--wb-prepare-20260929T141019Z-e3b056d0bd37-972334-INT-001`의 정확한 commit `d09fc4cedcd661cc6b88cb9168d2a8f8ba7ebc68`은 선택적 문서·이력 참고로만 사용한다.

검증은 의존 순서에 따라 진행하며 아래 반복 횟수를 적용한다. 횟수는 테스트가 통과하기 전까지 매 반복 결과를 기록한다.

1. 각 층의 정적 검사와 전체 테스트를 1회씩 실행한다: `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier . --check`, `pnpm test`.
2. workspace MCP 검증은 `authoring`과 `write-race`를 함께 골라 10회 실행한다. 이는 MCP 저장 경로를 변경하지 않았고 기존 동작이 유지되는지 확인하기 위한 회귀 검사다.
3. IDE UI를 실행하기 전에 B1-B3 역참조 UI 사례의 기존 진단·실행 로그를 먼저 확인하고 원인을 기록한다. 진단을 마친 뒤 code-navigation/server-session 관련 회귀 테스트를 20회 실행한다. 실제 UI 시나리오 19개는 이후 Windows·macOS 고정 VS Code 버전 CI에서 실행한다.
4. 최종 상태에서 전체 Vitest를 10회 실행하고 `pnpm test`, `pnpm build`, `pnpm run release:pack`, `pnpm run release:verify`를 실행한다. 실제 명령과 결과를 구현 결과에 기록한다.
5. Windows·macOS CI의 `required-ci`와 19개 실제 UI 시나리오가 통과해야 최종 완료로 본다. macOS 로컬 결과만으로 두 운영체제의 CI 완료를 주장하지 않는다.

기본 formatter 설정을 유지하고 base에서 확인된 단일 Prettier 경고를 수정한다. 커밋 훅은 정상 실행하며 우회하지 않는다. 현재 단계에서 실행되지 않은 검증은 미완료로 남긴다.

## 과거 기록과 현재 증거

`.github/workplans/COD-29.md`, `.github/workplans/COD-29-results/implementation.md`, `.github/workplans/COD-29-results/header-prototype.md` 및 `header-prototype/`의 바이트는 지정한 과거 원본에서 그대로 보존한다. 여기 담긴 PR 구현 내용, MCP 영향 처리, Windows 검증과 시제품 결과는 역사적 증거로만 취급한다.

현재 구현·검증 기록은 이 COD-41 계획의 후속 결과 문서나 CI 링크에 추가한다. 기능 구현, 정적 검사, 반복 테스트, 실제 UI 실행을 서로 구분하고 아직 수행하지 않은 결과를 통과로 표기하지 않는다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-41
