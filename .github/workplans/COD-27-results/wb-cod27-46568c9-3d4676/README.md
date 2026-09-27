# COD-27 Windows 실행 증거

이 결과는 Windows 구현 후보다. macOS의 같은 후보 실행이 없으므로 전체 검증 완료 또는 verified result가 아니다.

- 기준 커밋: `46568c9feda16739604096b738a915632f58c697`
- IDE 실행 소스 tree: `0419cba0a8c51cca56a67a64fe3e99273362bdf9`. 이후 변경은 이 증거/작업 기록과 IDE 시험의 한국어 JSDoc·서식 보완뿐이다. 최종 후보는 이 보고서를 포함한 task-local commit이며 `implementation-files.json`의 실행/최종 Git blob ID로 추적한다. 주석 보완 파일은 TypeScript 구문 트리(위치·주석 제외)의 직렬화가 실행 시와 바이트 단위로 같음을 확인하고 구문 트리 SHA-256도 기록했다.
- Windows x64, Node 24.21.0, pnpm 10.34.5. 실제 설치 VS Code 1.100.0의 Extension Host는 Node 20.19.0/Electron 34.5.1이다. MCP에는 외부 Node 실행 경로를 전달했다.
- MCP CLI SHA-256: `720244a970d03b1d9c60f679bc76ec8365d6bf95984cc0d442ef2a4ba02644a6`. 전체 MCP 산출물과 VSIX 식별자는 별도 manifest와 installation 증거에 보존한다.

## 수행한 검사

| 명령                                                                                                                                                                                     | Windows 결과                                       | 증거                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                         | PASS, 11.4초                                       | 실행 세션 preflight, Node/pnpm 고정 버전        |
| `pnpm build`                                                                                                                                                                             | PASS                                               | 전체 check의 build 및 실제 VSIX 실행기의 재빌드 |
| `pnpm exec vitest run packages/mcp/src/server/server.test.ts packages/mcp/src/server/authoring.test.ts packages/mcp/src/server/state.test.ts packages/mcp/src/server/write-race.test.ts` | 45/45 PASS, 16.25초                                | 기존 공개 계약 + 새 경합 5개                    |
| `node --test packages/vscode/src/integration/test-support/mcp-client.test.mjs packages/vscode/src/integration/test-support/workspace-fixture.test.mjs`                                   | 3/3 PASS, 1.24초                                   | 전체 check에서도 재실행                         |
| `pnpm check`                                                                                                                                                                             | PASS: Vitest 966, node:test 47, 개발/배포 검사 117 | `check.log`                                     |
| `pnpm test:vscode`                                                                                                                                                                       | 58/58 PASS: 기존 51 + 신규 7                       | `vscode-functional.json`, `vscode-result.json`  |
| `node packages/vscode/test-runner/lifecycle.mjs`                                                                                                                                         | 4/4 PASS, 각 잔류 0                                | `lifecycle.json`                                |
| `git -c core.longpaths=true diff --cached --check`                                                                                                                                       | PASS                                               | 최종 stage 검증                                 |

VS Code는 설치된 VSIX에서 실제 provider를 조회했다. rendered UI 또는 성능 측정 결과는 아니다. 감독기의 최종 소유 tree 정리는 `taskkill-tree`이고 잔류 0이다. 이것을 MCP A의 EOF 정상 종료와 혼동하지 않는다. EOF 사례는 직접 소유 child stdin 종료와 실제 `code:0, signal:null`을 별도로 기록했다.

## 조건별 구현과 관측

- AC-1: MCP 두 개와 IDE의 기준 본문을 확인한 뒤 MCP 저장·외부 편집·이동·삭제/재생성을 독립 실행한다. 각 get의 본문·revision·경로·참조/역참조, 파일 SHA-256, Hover 참조 관계와 실제 원문 이동을 확인했다. 삭제는 양 MCP의 found:false 및 IDE의 본문 부재/참조 진단을 확인한 뒤 재생성했다. 변경 후 refresh/restart는 없다.
- AC-2: root와 nested의 동일 ID/서로 다른 본문을 먼저 읽었다. root만 변경한 뒤 nested get 전체(참조/진단 포함), IDE 진단, 파일 바이트 및 본문을 보존했다. 실제 workspace URI와 MCP PID/project는 기능 관측에 포함한다.
- AC-3: 다른 프로세스 저장 뒤 오래된 revision은 후보 계산의 `change_revision_mismatch`, 후보 계산 이후 디스크 직전 변경은 `revision_conflict`로 거부하며 최신 파일을 보존한다. 두 create가 실제 link 직전에 도달한 뒤 A→B 순서로 해제하면 B는 `file_exists`이며 A 파일을 보존한다.
- AC-4: 두 update가 실제 rename 직전에 도달한 뒤 A 저장/응답→B 저장으로 해제했다. 두 saved/revision, 중간·최종 바이트, 양쪽의 최신 조회를 보존했다. 서로 다른 경로의 같은 ID create는 두 파일 저장과 양 조회의 duplicate_id 충돌을 기록했다. 잠금·FIFO·조건부 원자성은 요구하지 않는다.
- AC-5: A의 EOF/강제 종료를 독립 실행하고 이후 B의 저장/조회와 IDE 새 본문을 확인했다. 시험이 시작한 자식만 닫고 그 후 fixture를 복원한다.
- AC-6: 원본 plan/task/binding digest, 입력 문서 digest, 구현 Git blob, MCP 산출물/VSIX, OS/런타임/클라이언트, 요청·응답·도달/해제·파일/종료/정리 증거를 남겼다. macOS는 NOT_RUN이므로 이 기준은 전체적으로 미완료다.

계측 경합 child는 소스를 임시 bundle로 연결하고 기존 storage의 beforeApply/link/rename만 제어한다. 실제 link/rename을 정확히 한 번 실행한다. 제품 CLI의 전파/종료 증거와 계측 child의 저장 경합 증거를 구분한다. 시험 지원 파일은 제품 산출물에 포함되지 않는다.

## 실행 중 수정과 self-review

- resolved_in_task: 관리형 worktree 생성은 과거 COD-18 증거의 장경로에서 실패했다. 목록과 path/branch 부재를 확인하고 명령별 `core.longpaths=true`로 배정 경로/branch와 exact base에 생성했다. 전역 설정을 변경하지 않았다.
- resolved_in_task: COD-27.md checkout bytes는 CRLF로 달랐지만 LF 정규화 SHA는 입력 digest와 일치했다. 6개 .codocs 및 analysis/plan/task/binding digest는 일치한다.
- resolved_in_task: 초기 경합 fixture의 domains 누락과 초기 IDE 진단 코드 오기를 수정했다. 최종 기대값은 기존 계약에 맞고 파일 보존·저장 경합 기대값을 완화하지 않았다.
- resolved_in_task: update 후 watcher를 기다리는 1초 기본 poll은 충분하지 않았다. 이 사례의 종료 한계를 15초로 명시했다. 고정 sleep으로 경합 순서를 만들지 않으며 제품 성능 기준으로 사용하지 않는다.
- resolved_in_task: 최종 IDE 실행 전 신규 파일을 stage하여 기존 sourceHash가 새 파일을 누락하지 않게 했다. 첫 IDE 탐색 실행은 57/58이며 최종 실행 증거와 별도다.
- self-review: owned 경로만 변경, 제품 구현/의존성/훅/CI/성능 코드는 불변. 실패 시 장벽 해제→child 종료→fixture 정리 순서와 source revision/실제 저장/indexUpdated 구분을 점검했다. 정상 훅은 최종 task-local commit 때 별도 실행된다.
- resolved_in_task: 첫 commit 시도는 최종 IDE callback의 한국어 JSDoc 누락을 lint-staged에서 거부했고 결과 커밋을 만들지 않았다. 정상 복원 뒤 주석·서식만 보완했으며 실행문 동등성을 확인했다. `initial-hook-rejection.log`를 보존한다.
- action_required: 같은 최종 후보를 macOS에서 위 명령들로 실행하고 실제 IDE/프로세스 정리 결과를 추가해야 전체 수락이 가능하다. macOS를 Windows mock 검사로 대신하지 않는다.

push, PR 갱신, merge, 외부 기록 저장은 수행하지 않았다.
