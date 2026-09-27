# COD-25 TASK-001 실행 결과

- 실행 패킷: `wb-cod25-06e0ff4-73f914/intent/1`, `TASK-001`
- 기준 커밋: `06e0ff431450b84805794e15fdd1cfa334edc6fa`
- 실행 환경: Windows, Node.js 24.21.0, pnpm 10.34.5, VS Code 1.100.0
- 작업 트리: `C:/Users/sjw73/OneDrive/Desktop/dev/codocs-worktrees/wb-cod25-06e0ff4-73f914/task-001`
- 소스 plan digest: `8ec5bdc06e8dbf04576cc0b75193d6ab51ed0e9037684b77f7298697f5ba5840`; packet digest: `d1371ed2c7b580a7530ac8040ad2419a07c85066a185cc353d5016b865929fa2`; binding digest: `bfc70c4871843073723e19a8f10438adce28c249b6ebe7fd029d226b976f0bd4`.
- shape artifact SHA-256: `54e985f1612513cd2df0f7d693c857fbb85f37d5b5606b4443bf6158ded27815`. 패킷의 `.codocs` 입력 10개 SHA-256은 exact base 파일과 일치했다.

## 구현과 계약 증거

| 계약                                      | 확인한 결과와 근거                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001, AC-001, INV-003                  | `WorkspaceQuerySession.write`가 기존 저장 계층을 호출하고 동일 세션의 대상 경로 관측을 게시한 뒤 성공을 반환한다. `packages/workspace/src/write/write.test.ts`의 실제 mkdtemp IO와 `packages/mcp/src/server/server.test.ts`의 빌드 CLI stdio SDK create/update/get/list가 저장 바이트 revision과 즉시 조회 결과를 비교한다.        |
| REQ-002, AC-003, INV-001                  | 실제 IO 테스트가 필수 삭제, 현재 ID·경로 충돌, 같은 도메인 동명, stale revision, 쓰기 오류에서 원본 보존·진단을 확인한다. 다른 도메인 동명은 별도 후보 없이 저장된다. 저장 직전 전체 충돌 검사는 기존 storage를 사용한다.                                                                                                          |
| REQ-003, AC-004, AC-005, INV-002, INV-005 | 최초 색인 오류에는 대상 경로를 추가 1회만 복구한다. 두 오류 뒤에도 `saved:true`, 저장 revision, `index_update_failed`와 refresh 안내를 보존한다. 제어 가능한 hook으로 최초 갱신과 복구 각각 1초 초과에도 pending 후 실제 완료를 확인한다. 제품 timeout, 파일 재저장, 자동 전체 refresh를 도입하지 않았다.                          |
| REQ-004, AC-007, INV-006                  | 실제 파일에서 `set.id`와 `deprecatedAliases`의 동시 저장, 직전 ID 추가, 기존 message 유지, 중복 방지, 과거 ID 재사용 시 새 현재 ID 제거를 확인한다. MCP stdio에서 ID 변경 뒤 현재 ID get과 저장 바이트를 확인하고, workspace 코드 매칭에서 이전 ID가 새 현재 ID를 찾는지 확인한다.                                                 |
| REQ-005, AC-008                           | direct handler와 SDK가 입력 형태 오류 및 문서 의미 검증 오류에서 상세 diagnostics를 같은 구조로 반환한다. `query-reconciliation.test.ts`가 초기화 중 저장 대기, 초기 실패·부분 탐색·감시 실패·명시 refresh 중 `write` 미저장을 직접 확인한다. 저장 후 임시 파일 정리 실패는 저장·색인 성공을 유지한다.                             |
| AC-006, INV-004                           | `query-reconciliation.test.ts`가 오래된 읽기, 후속 watcher 배치, close 후 늦은 결과 미게시를 검증한다. 추가 회귀는 첫 저장 경로 관측을 실제 오류로 만들고 직전에 다른 경로에서 게시한 최신 문서를 보존하면서 저장 경로만 복구하는지 확인한다. 저장 계층의 저장 전 전체 검사 1회와 query의 저장 후 scoped 재관측을 구분해 계수했다. |
| DEC-001~004                               | 계획대로 잠금·공유 FIFO·5초 취소와 저장 후 동명 후보 안내를 추가하지 않았다. 기존 core의 명시적 ID 변경 규칙을 MCP까지 연결했다.                                                                                                                                                                                                   |

## 검증 로그

| 명령/검사                                                                                             | 결과                                                | 로그 또는 근거                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                      | PASS                                                | 작업 트리 전용 의존성 설치, 다른 checkout 산출물 복사 없음                  |
| baseline `pnpm build`                                                                                 | PASS                                                | 실행 전 기준 빌드                                                           |
| baseline `pnpm exec vitest run packages/core/src/change-plan packages/workspace/src packages/mcp/src` | PASS                                                | 25 files, 408 tests                                                         |
| 구현 후 `pnpm build` 및 관련 Vitest                                                                   | PASS                                                | scoped 복구 수정 뒤 3 files, 46 tests; 전체 suite는 최종 check에 포함       |
| 변경 후 `pnpm check`                                                                                  | 제품 926/926·runner 45/45 PASS, 저장소 검사 109/115 | `pnpm-check-concurrent-failure.log`; 동시 VS Code 빌드와 dist 충돌          |
| 변경 파일 집중 검사                                                                                   | PASS                                                | typecheck, MCP·write lint/format, 2 files/30 tests                          |
| `pnpm test:vscode`                                                                                    | PASS                                                | `test-vscode-final.log`; installed VSIX/Extension Host 50/50, 종료 완료     |
| VS Code 종료 뒤 `pnpm build`                                                                          | PASS                                                | `build-after-vscode.log`                                                    |
| 단독 저장소 검사 `pnpm exec vitest run --config vitest.checks.config.mjs`                             | PASS, 3 files/115 tests                             | `repository-check-final.log`                                                |
| `node packages/vscode/test-runner/lifecycle.mjs`                                                      | PASS                                                | `lifecycle.log`; startup-failure/failure/timeout/cancelled, 잔여 프로세스 0 |
| `.codocs` 제품 파서/catalog 및 목차 도달성                                                            | PASS                                                | `catalog-validation.log`; 76/76 문서, 오류·경고·미도달 0                    |
| `git diff --check`                                                                                    | PASS                                                | 변경 파일 공백 검사                                                         |

초기 전체 `pnpm check` 한 번은 storage 임시 파일 `.codocs-write-*.tmp`의 삭제 감시 신호가 사라진 파일을 partial scan으로 만들며 1/920 테스트 실패했다(`pnpm-check.log`). query가 해당 저장 계층 소유 임시 파일 신호만 제외하도록 수정하고, 일반 YAML 생성·삭제 감시는 그대로 동작하는 결정적 회귀를 추가했다. 다음 실행은 921/921 통과했다(`pnpm-check-final.log`). 이후 scoped 복구와 수락 단언을 보강한 코드의 검사 결과는 위의 분리된 로그에 기록한다. 이 실패를 baseline 실패로 취급하지 않는다.

추가 수락 단언 뒤의 전체 `pnpm check`는 제품 926/926와 runner 45/45를 통과했다. 마지막 저장소 검사와 VS Code 기능 검사를 동시에 실행한 탓에 VS Code runner가 공유 `dist`를 재구성하는 동안 asset 존재 검사 6개가 실패했다(`pnpm-check-concurrent-failure.log`). 이 실행 충돌은 검증 절차의 문제다. VS Code runner 종료와 50/50 성공을 확인한 뒤 `pnpm build`를 통과했고, 저장소 검사도 단독 실행에서 3파일/115개 모두 통과했다(`build-after-vscode.log`, `repository-check-final.log`).

GitHub의 기준 커밋 Windows/macOS 원격 CI 작업은 계정 결제 또는 spending limit 사유로 시작되지 않아 검증 결과가 없다. 로컬 Windows 검사는 위와 같이 수행했고 macOS 검사는 실행하지 않았다. CI 설정이나 결제 상태를 변경하지 않았다.

## 한계와 전달

revision 검사와 파일 교체 사이의 동시 변경 경쟁은 합의된 no-lock 결정에 따라 남아 있다. 전체 수동 refresh는 호출자가 선택할 때만 실행한다. 결과는 작업 브랜치의 로컬 단일 커밋으로 전달하며 push·merge·PR 변경은 수행하지 않는다.
