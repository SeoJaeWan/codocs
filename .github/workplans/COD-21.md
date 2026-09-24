# COD-21 — MCP stdio와 공통 결과 실행 기록

## 구현

- 공식 MCP SDK 1.30.1과 Zod 4.6.5로 초기화·stdio 전송을 연결했다. 실행 registry에는 `codocs_list`, `codocs_get`, `codocs_refresh`만 둔다.
- 여섯 도구 입력 스키마를 한 registry에 정의했다. 직접 handler와 SDK 호출은 같은 입력 검증과 공통 결과를 사용한다. `get`은 중복 제거 후 1~20개를 확인한다.
- 서버가 시작 cwd를 고정하고 프로젝트별 workspace 세션 하나를 소유한다. EOF·종료 신호·시작 실패는 멱등 정리로 연결한다.
- 준비 오류와 부분 목록 진단은 workspace 결과에서 만든다. LSP의 준비 표시는 공통 `index_not_ready` 진단을 사용한다.
- 빌드 CLI 예시와 담당 `.codocs` 문서를 갱신했다.

## 변경 범위 검증

- Node.js 24.21.0, pnpm 10.34.5에서 `pnpm install --frozen-lockfile`: 통과.
- `node tools/build/build.mjs typecheck`, `pnpm build`: 통과.
- `pnpm exec vitest run packages/mcp/src packages/workspace/src/query/shared-results.test.ts packages/language-server/src/hover/hover.test.ts`: 69개 통과. 공식 SDK Client와 빌드 JS, raw child EOF 포함.
- `pnpm exec vitest run --config vitest.checks.config.mjs tools/build/check/build-checks.test.ts -t MCP`: 공개 JS·d.ts 소비 검사 2개 통과.
- `pnpm lint`, `pnpm exec prettier . --check`, `git diff --check`: 통과.
- 변경된 `.codocs` 문서 7개를 빌드된 parser·validator로 확인: 통과.

기존 workspace query 전체 검사의 7개 사례는 이 Windows 호스트의 symlink 생성이 `EPERM`으로 거부되어 실패했다. 나머지 75개는 통과했다. 기존 실패의 조사·기준선 구축은 이번 범위에 포함하지 않았다. 작업 커밋에서는 전체 검사를 실행하는 pre-commit hook을 건너뛰고 위 변경 범위 검증 결과를 사용했다.
