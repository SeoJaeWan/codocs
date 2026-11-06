# 개발 도구

| 위치                  | 역할                                                            |
| --------------------- | --------------------------------------------------------------- |
| `build/build.mjs`     | 빌드·번들·타입 검사                                             |
| `test/runtime/`       | 최종 CI 후보 준비·실제 읽기 제한 fixture                        |
| `test/support/`       | 여러 패키지 테스트가 공유하는 보조 코드                         |
| `dev/`                | 직접 실행용 개발용 VS Code 창 실행기                            |
| `toolchain.mjs`       | 저장소 루트와 고정 Node·pnpm 실행 환경 확인                     |
| `development-checks/` | 자체 ESLint 규칙(no-raw-domain-value)과 플러그인 설정 회귀 검사 |

`pnpm dev:vscode`·`pnpm dev:mcp`는 사람이 직접 실행하는 진입점이며 CI와 커밋 훅은 실행하지 않는다. 사용법은 `.codocs`의 「직접 실행하기」를 따른다. `dev/open-vscode.mjs`는 `dev:vscode`가 개발용 확장·사용자 데이터 경로를 절대 경로로 바꿔 VS Code CLI(`code`)에 넘기는 일만 한다.

각 도구의 테스트는 구현과 같은 폴더에 둔다. 패키지 전용 보조 코드와 mock은 해당 패키지의 `test-support`에서 관리한다.

- `pnpm test`: Vitest와 Node의 표준 glob으로 제품 로직 및 자체 도구 테스트를 실행한다. `pnpm exec vitest`는 Vitest 검사를 감시한다. 파일·이름 선택은 `pnpm exec vitest run <파일>` 또는 `node --test --test-name-pattern=<이름> <파일>`을 사용한다.

커밋 훅은 `pnpm exec lint-staged` 다음 `pnpm typecheck`와 `pnpm test`를 실행한다. lint-staged가 부분 스테이징을 보존하며, 테스트는 현재 작업 트리를 읽는다.

MCP의 도구 입력·결과 계산은 `packages/mcp/src/tool-input`과 `query`에서, 실제 파일 저장·조회·목록 cursor는 `packages/workspace/src/write`와 `query`에서 검사한다. `packages/mcp/src/server/server.test.ts`는 SDK 도구 등록·응답 포장, 큰 JSON-RPC 전송, 프로세스별 프로젝트 선택, stdout·EOF·실패 정리에 집중한다. 소스 CLI는 실행별 임시 번들로 준비하므로 제품 `dist`를 미리 빌드하지 않는다. 실제 작성 절차와 저장 후 복구는 `authoring.test.ts`와 `state.test.ts`, 독립 프로세스의 겹치는 저장과 동일 ID 충돌은 `write-race.test.ts`에 유지한다.

Node glob은 도구의 `.mjs`·`.cjs`와 중첩 `test-support` 테스트를 포함한다.

CI는 Ubuntu에서 `static`(타입·린트·서식), `pack`, `test` job을 병렬로 실행한다. `pack` job은 `release:pack`으로 `.workbench/release/`에 최종 tgz/VSIX를 만들고 `release:verify`로 확인한 뒤 artifact로 올린다. `test` job은 `build` 다음 `pnpm test`를 실행한다. OS별 동작은 platform을 주입한 테스트로 한 OS에서 비교하며, Ubuntu는 실행 환경이지 Linux 지원 검증이 아니다. VSIX는 구성과 manifest를 확인하고, `CI=true`일 때만 `release:verify`가 푼 확장 폴더를 `@vscode/test-electron`으로 고정 버전(1.141.0)의 실제 VS Code에서 실행해 활성화·명령 등록·Hover 값을 확인한다. 이 단계는 CI의 `pack` job과 배포 workflow에서 `xvfb-run -a pnpm release:verify`로 돌며, 로컬 실행은 건너뛴 사실을 출력하고 `result.json`에 `skipped`로 남긴다.

최종 배포물은 MCP tarball 하나와 VSIX 하나다. `release:pack`은 `.workbench/release/`를 비우고 두 파일만 남기며, `release:verify`는 인자 없이 실행하면 그 위치의 파일을, 두 경로를 주면 그 파일을 검사한다. `verify-release.mjs`가 manifest·진입점·가이드·예제·메타데이터·notice·서버 번들을 검사한다. 저장소 밖 MCP 설치는 SDK 연결과 `listTools`의 여덟 도구 등록까지만 확인하며 설치 fixture는 종료 뒤 제거한다. 로컬 VS Code 창을 실행하지 않는다.
