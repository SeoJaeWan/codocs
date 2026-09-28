# 개발 도구

| 위치                  | 역할                                        |
| --------------------- | ------------------------------------------- |
| `build/build.mjs`     | 빌드·번들·타입 검사                         |
| `build/check/`        | 최종 제품 구성·MCP 시작/등록 확인           |
| `test/runtime/`       | 최종 CI 후보 준비·실제 읽기 제한 fixture    |
| `test/support/`       | 여러 패키지 테스트가 공유하는 보조 코드     |
| `toolchain.mjs`       | 저장소 루트와 고정 Node·pnpm 실행 환경 확인 |
| `development-checks/` | 자체 ESLint 규칙과 인접 회귀 검사           |

각 도구의 테스트는 구현과 같은 폴더에 둔다. 패키지 전용 보조 코드와 mock은 해당 패키지의 `test-support`에서 관리한다.

- `pnpm test`: Vitest와 Node의 표준 glob으로 제품 로직 및 자체 도구 테스트를 실행한다. `pnpm test:unit --watch`는 Vitest 검사를 감시한다. 파일·이름 선택은 `pnpm exec vitest run <파일>` 또는 `node --test --test-name-pattern=<이름> <파일>`을 사용한다.
- `pnpm check`: package.json에서 타입·린트·읽기 전용 서식·빌드·인접 테스트·최종 제품 검사를 순서대로 실행한다.
- `pnpm test:vscode --version <exact-stable> --vsix <absolute-candidate.vsix> --output <absolute-new-evidence-directory>`: GitHub Actions의 Windows·macOS에서 [UI 실행기](../packages/vscode/test-runner/ui/run.mjs)로 같은 고정 버전과 최종 VSIX의 설치·활성화·실제 Hover·링크 클릭을 검사한다. 준비는 공식 helper로 실행별 임시 경로에서 순서대로 진행한다. 인자와 결과 계약은 [검증 안내](../packages/vscode/src/integration/verification.md)에 있다.

실제 VS Code UI 검사는 GitHub Actions에서 실행하며 커밋 훅에 포함하지 않는다.

커밋 훅은 `pnpm exec lint-staged` 다음 `pnpm test`를 실행한다. lint-staged가 부분 스테이징을 보존하며, 테스트는 현재 작업 트리를 읽는다.

MCP의 도구 입력·결과 계산은 `packages/mcp/src/tool-input`과 `query`에서, 실제 파일 저장·조회·목록 cursor는 `packages/workspace/src/write`와 `query`에서 검사한다. `packages/mcp/src/server/server.test.ts`는 SDK 도구 등록·응답 포장, 큰 JSON-RPC 전송, 프로세스별 프로젝트 선택, stdout·EOF·실패 정리에 집중한다. 소스 CLI는 실행별 임시 번들로 준비하므로 제품 `dist`를 미리 빌드하지 않는다. 실제 작성 절차와 저장 후 복구는 `authoring.test.ts`와 `state.test.ts`, 독립 프로세스의 겹치는 저장과 동일 ID 충돌은 `write-race.test.ts`에 유지한다.

Node glob은 도구의 `.mjs`·`.cjs`, 패키지 실행기의 인접 테스트와 중첩 `test-support` 테스트를 포함한다. 실제 ExtensionHost 진입점 `extension.test.cjs`는 `pnpm test:vscode`에서 실행한다. 최종 산출물 검사는 `vitest.checks.config.mjs`의 별도 구성으로 유지한다.

최종 배포물은 MCP tarball 하나와 VSIX 하나다. `vitest.checks.config.mjs`는 이미 빌드한 결과를 포장하고 `verify-release.mjs`로 manifest·진입점·가이드·예제·메타데이터·notice·서버 번들을 검사한다. 저장소 밖 MCP 설치는 SDK 연결과 `listTools`의 여섯 도구 등록까지만 확인하며 설치 fixture는 종료 뒤 제거한다. 로컬 VS Code 창을 실행하지 않는다. [제거 검사 대응표](build/check/README.md)는 상세 기능과 자체 릴리스 판단의 최종 소유자를 기록한다.
