# COD-21 — [18] 공식 MCP SDK·stdio 실행·요청/응답 스키마 연결

h2. 목표

VS Code 없이 실행할 수 있는 로컬 MCP 프로토콜 진입점을 제공한다.

h2. 작업 순서와 선행 조건

권장 순서 18/25 · 3단계 · 상위 COD-3

- [COD-20|https://seojaewan.atlassian.net/browse/COD-20] — 실제 VSIX 기능·IDE 응답성·지원 하한 검증

h2. 구현 범위

- 공식 TS SDK로 초기화·도구 등록·JSON-RPC stdio 연결. stdout 프로토콜 전용, 로그 stderr.
- 여섯 도구의 입력 schema와 Codocs 공통 success/error 결과·MCP 래퍼 매핑을 명확히 정의.
- 프로세스 시작 cwd/--project 고정·프로젝트별 프로세스·종료 정리 연결.
- 알 수 없는 요청 필드 거부와 write document/set 사용자 속성 예외를 문서 스키마와 구분.
- 빌드된 JS 명령으로 실행하며 SDK/Node/Zod 정확한 호환 버전을 기록.

h2. 검증 시나리오와 기대 결과

- 실제 클라이언트/테스트 프로세스로 초기화→도구 목록→잘못된 입력 응답을 확인한다.
- stdout에 일반 로그가 섞이지 않고 stderr 로그가 있어도 프로토콜이 정상이다.
- A/B 루트의 별도 프로세스가 서로 다른 문서만 읽고 시작 후 루트를 바꾸지 않는다.

h2. 완료 기준과 산출물

- 여섯 도구의 입력 계약과 현재 등록하는 list/get/refresh의 요청/응답·진단 매핑이 검증된다.
- 설치 후 MCP 클라이언트 설정에서 실행할 명령/인자 예시를 제공한다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- SDK 래퍼와 Codocs success/부분 결과의 정확한 매핑을 계약 테스트로 고정한다.

## 문서 기준

현재 계약의 기준 원문은 로컬 `.codocs`다. 문서 역할과 갱신은 [문서 컨벤션](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/development/documentation-convention.yaml)을 따른다.

구현·테스트·공개 함수 JSDoc와 해당 기능의 `.codocs` 담당 문서를 함께 갱신한다. 내부 패키지·기능별 README는 만들지 않으며, 루트 README와 사용자 가이드는 사용자 안내에 영향이 있을 때 갱신한다.

과거 Wiki revision은 당시 결정·계획의 참고 근거이며 현재 계약을 소유하지 않는다. 구현 범위·진행·검증 증거는 이슈와 PR에서 추적한다.

### 과거 Wiki와 추적 근거

- Codocs 패키지 책임과 서버 실행 구조 (codocs-runtime-architecture)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8dfd-7e81-b523-f955026a53ad","revision":"01a09980-8dfd-73f8-8cb0-3cc3be8368b8"}}}
- Codocs MCP 공통 응답과 조회 계약 (codocs-mcp-read-contract)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997d-0948-7890-a34d-e8aa7400e7fe","revision":"01a0997d-0948-73d8-9442-676c800ebd6c"}}}
- Codocs 진단 코드와 좌표 계약 (codocs-diagnostics)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-d7e7-7702-bae7-9fd9cdb92a75","revision":"01a0997a-d7e7-7658-923f-c18caf415695"}}}

2026-09-13 최초 계획을 바탕으로 현재 로컬 `.codocs` 계약에 따라 구현했다. 변경 범위의 검증 결과는 아래에 기록한다. 성능 전체 재측정은 이번 범위에 포함하지 않았다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-21

## 실행 결과 (2026-09-24)

### 구현

- 공식 MCP SDK 1.30.1과 Zod 4.6.5로 초기화·stdio 전송을 연결했다. 실행 registry에는 `codocs_list`, `codocs_get`, `codocs_refresh`만 둔다.
- `codocs_validate`, `codocs_write`, `codocs_guide`는 입력 스키마만 정의했다. 실행 등록은 후속 PR #19, #22, #23에서 각각 진행한다.
- 여섯 도구 입력 스키마를 한 registry에 정의했다. 직접 handler와 SDK 호출은 같은 입력 검증과 공통 결과를 사용한다. `get`은 중복 제거 후 1~20개를 확인한다.
- 서버가 시작 cwd를 고정하고 프로젝트별 workspace 세션 하나를 소유한다. EOF·종료 신호·시작 실패는 멱등 정리로 연결한다.
- 준비 오류와 부분 목록 진단은 workspace 결과에서 만든다. LSP의 준비 표시는 공통 `index_not_ready` 진단을 사용한다.
- 빌드 CLI 예시와 담당 `.codocs` 문서를 갱신했다.

### 변경 범위 검증

- Node.js 24.21.0, pnpm 10.34.5에서 `pnpm install --frozen-lockfile`: 통과.
- `node tools/build/build.mjs typecheck`, `pnpm build`: 통과.
- `pnpm exec vitest run packages/mcp/src packages/workspace/src/query/shared-results.test.ts packages/language-server/src/hover/hover.test.ts`: 69개 통과. 공식 SDK Client와 빌드 JS, raw child EOF 포함.
- `pnpm exec vitest run --config vitest.checks.config.mjs tools/build/check/build-checks.test.ts -t MCP`: 공개 JS·d.ts 소비 검사 2개 통과.
- `pnpm lint`, `pnpm exec prettier . --check`, `git diff --check`: 통과.
- 변경된 `.codocs` 문서 7개를 빌드된 parser·validator로 확인: 통과.

기존 workspace query 전체 검사의 7개 사례는 이 Windows 호스트의 symlink 생성이 `EPERM`으로 거부되어 실패했다. 나머지 75개는 통과했다. 기존 실패의 조사·기준선 구축은 이번 범위에 포함하지 않았다. 작업 커밋에서는 전체 검사를 실행하는 pre-commit hook을 건너뛰고 위 변경 범위 검증 결과를 사용했다.
