# COD-41 통합 검증 결과 (macOS 로컬)

이 문서는 `.github/workplans/COD-41.md`의 "실행 및 검증 계획" 4단계(최종 상태 검증)를 macOS 로컬에서 실행한 기록이다. 실행하지 않은 검증은 통과로 표기하지 않는다. 원본 로그는 저장소에 넣지 않았고 워크트리 밖 `evidence/INT-001/`에 있다. 기계 판독 요약은 `summary.json`이다.

## 판정 요약

- 1라운드(`452b021`): 전체 Vitest 10회 중 9회 통과, 7회차 실패.
- 원인 파악 후 테스트 한 곳(`code-navigation.test.ts`의 B2 사례)만 고쳤다. 제품 코드는 수정하지 않았다.
- 2라운드(수정 후): 전체 Vitest 10회 모두 통과, 단일 파일 20회 모두 통과, typecheck·lint·prettier·`pnpm test` 통과.
- 그러나 수락 조건과 별개로 돌린 진단용 50회 반복에서 수정 전후 모두 다른 테스트가 간헐 실패했다(아래 "진단 반복"). 이 때문에 이 결과는 로컬 PR head로 전달하지 않고 보류했다.
- 3라운드: 제품 코드를 고쳤다. 클릭 확인이 세대 변화만으로 거부하던 설계를 기존 "원문 열기" 링크와 같은 방식으로 바꾸고 테스트의 "토큰이 확인될 때까지 기다리는" 우회를 없앴다. 사용자 결정에 따라 각 검사는 1회만 실행했고 모두 통과했다(아래 "3라운드").
- 미완료: Windows, 실제 VS Code UI 시나리오 19개, `required-ci` (아래 "미완료").

## 검증 대상과 환경

- 1라운드 검증 commit: `452b021f45c9d3de5c54c239e1df1d85c5ea285d` (기준 `6c64ce4ef27350c50c1bb72b10e9d9e13c86ba0a` 위에 선형 통합: `c49fe2e`, `a7e9615`, `0c6477c`, `df6334f`, `452b021`)
- 그 위 commit: `778a21d`(1라운드 기록), 테스트 수정 commit(아래 "수정"), 이 문서를 갱신한 commit. 2라운드는 테스트 수정 commit에서 실행했다.
- 1·2라운드에는 제품 코드 변경이 없었다. 수정한 파일은 테스트 1개뿐이다. 3라운드에서 제품 코드를 바꿨다(아래).
- run `wb-cod41-mac-r2-6c64ce4-0f556e`, task `INT-001`, intent revision 4(revision 3에서 이어짐). 3라운드는 intent revision 5
- macOS 26.5.1 (Darwin 25.5.0), arm64, Node v24.21.0, pnpm 10.34.5, Vitest v5.0.0
- 실행일 2026-09-30 (1라운드 UTC 04:45–04:48, 이후 작업 UTC 04:5x–05:1x)
- 이전에 남아 있던 `install.log`, `typecheck.log`는 중단된 탐색 실행의 잔여물이라 사용하지 않았다.

## 1라운드: `452b021`

| 명령                           | 종료 코드    | 소요         | 결과                                                                               |
| ------------------------------ | ------------ | ------------ | ---------------------------------------------------------------------------------- |
| `pnpm typecheck`               | 0            | 11초         | 통과                                                                               |
| `pnpm lint`                    | 0            | 10초         | 통과 (`--max-warnings=0`)                                                          |
| `pnpm exec prettier . --check` | 0            | 18초         | 통과                                                                               |
| `pnpm exec vitest run` ×10     | 9회 0, 1회 1 | 회차별 6~8초 | 아래 표                                                                            |
| `pnpm test`                    | 0            | 11초         | Vitest 60 files / 1121 tests 통과(1 file, 11 tests skipped), `node --test` 39 통과 |
| `pnpm build`                   | 0            | 5초          | 통과                                                                               |
| `pnpm run release:pack`        | 0            | 6초          | `codocs-0.0.2.vsix`(21 files, 900.84 KB), `co-documentation-0.0.2.tgz` 생성        |
| `pnpm run release:verify`      | 0            | 2초          | `result.json`의 `passed: true` (darwin, arm64, node 24.21.0)                       |

| 회차   | 종료 코드 | 파일 통과/실패/skip | 테스트 통과/실패/skip | Vitest Duration |
| ------ | --------- | ------------------- | --------------------- | --------------- |
| 01     | 0         | 60/0/1              | 1121/0/11             | 5.68초          |
| 02     | 0         | 60/0/1              | 1121/0/11             | 5.89초          |
| 03     | 0         | 60/0/1              | 1121/0/11             | 7.17초          |
| 04     | 0         | 60/0/1              | 1121/0/11             | 6.50초          |
| 05     | 0         | 60/0/1              | 1121/0/11             | 7.63초          |
| 06     | 0         | 60/0/1              | 1121/0/11             | 6.09초          |
| **07** | **1**     | **59/1/1**          | **1120/1/11**         | 5.80초          |
| 08     | 0         | 60/0/1              | 1121/0/11             | 5.95초          |
| 09     | 0         | 60/0/1              | 1121/0/11             | 5.80초          |
| 10     | 0         | 60/0/1              | 1121/0/11             | 6.08초          |

### 7회차 실패

- 실패 테스트: `packages/language-server/src/server-session/code-navigation.test.ts` > `정확한 역참조와 문서 전체 Hint` > `같은 행 복수 출현의 겹친 행 범위는 열이 다른 개별 링크를 반환한다`
- 실패 위치: 같은 파일 157행. Hover가 `연결된 코드 · 2곳`과 링크 2개를 보여 준 뒤 두 번째 링크의 `session.confirmSource(...)`가 기대한 이동 대상 대신 `null`을 반환했다. 로그 원문: `AssertionError: expected null to deeply equal { …(2) }`. 원본 `vitest-07.log`.
- 이 실패는 재실행으로 지우지 않고 그대로 기록했다.

### 원인 (코드에서 확인한 것)

- `packages/workspace/src/code-reference/index.ts`에서 `capture()`는 토큰에 `codeGeneration`과 `documentGeneration`을 저장하고, `confirm()`은 둘 중 하나라도 현재 값과 다르면 거부한다. 파일 감시 이벤트(`#changed()`)와 `refresh()`는 `codeGeneration`을 올린다.
- 따라서 Hover가 토큰을 발급한 뒤 확인하기 전에 감시 이벤트가 들어오면, 발급 시점에는 유효했던 토큰이 거부된다. 이는 설계된 동작이며 이 작업에서 바꾸지 않았다.
- 실패한 테스트는 `open()`으로 파일 2개를 쓴 뒤 Hover가 발급한 토큰을 한 번만 확인하고, 확인 가능한 토큰이 발급될 때까지 기다리지 않았다. 같은 파일의 B1(100행)과 B3(251행) 테스트는 이미 새로 발급된 토큰이 확인될 때까지 기다린다. B2는 "Hover 완료"까지만 기다리던 절반짜리 대기였다.

### 진단 반복 (수락 근거가 아님)

수정 전 `778a21d`에서 `pnpm exec vitest run` 50회 (`diag-prefix-50.log`): **실패 2회 / 50회**.

- 10회차: `code-navigation.test.ts` > `이전 서버 세션이 발급한 코드 참조 링크를 새 세션에서 확인하면 이동 대상을 반환하지 않는다` (B3 사례; 이 테스트는 초기 대기 이후 268행에서 대기 없이 한 번 더 확인한다)
- 21회차: `packages/workspace/src/query/query-initialization.test.ts` > `실제 감시와 초기 열거·대상 준비 경계 > 첫 폴더 readdir 반환 뒤 폴더 재생성하면 최종 목록을 반영한다`
- 이번 50회에서는 B2 테스트(수정 대상)가 실패하지 않았다. B2 실패 증거는 1라운드 7회차 1건뿐이며, 그 비율은 50회 관찰로 재현·측정하지 못했다.
- 위 두 실패 테스트는 이번 작업에서 고치지 않았다.

## 수정

- 파일: `packages/language-server/src/server-session/code-navigation.test.ts` (이것만)
- 내용: B2 테스트에서 `vi.waitFor` 안에서 Hover를 다시 요청하고, 기존 단정(`collecting` 없음, `연결된 코드 · 2곳`, `수집 중` 없음, `implementation:1:1`, `implementation:1:22`, 링크 정확히 2개)과 두 번째 링크의 `toEqual({ uri, destination: { kind: 'occurrence', markerText, range } })`를 모두 같은 대기 안에서 통과할 때까지 기다린다. 새로 발급된 토큰을 확인하므로 세대가 바뀌어도 다음 시도에서 회복한다. 고정 sleep, skip, 완화된 matcher, 5000ms 초과 timeout은 없다. 마지막 `documentLinks` 대기는 그대로다.

## 2라운드: 수정 후

| 명령                               | 종료 코드   | 소요         | 결과                                                                            |
| ---------------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------- |
| `code-navigation.test.ts` 단독 ×20 | 20회 모두 0 | 회당 1~2초   | 매회 10 tests 통과 (`single-file-20.log`)                                       |
| `pnpm typecheck`                   | 0           | 10초         | 통과                                                                            |
| `pnpm lint`                        | 0           | 10초         | 통과                                                                            |
| `pnpm exec prettier . --check`     | 0           | 18초         | 통과                                                                            |
| `pnpm exec vitest run` ×10         | 10회 모두 0 | 회차별 6~7초 | 아래 표                                                                         |
| `pnpm test`                        | 0           | 13초         | Vitest 60 files / 1121 tests 통과(1 file, 11 tests skipped), `node --test` 통과 |

`pnpm build`, `pnpm run release:pack`, `pnpm run release:verify`는 테스트 파일 1개만 바뀌었으므로 2라운드에서 다시 실행하지 않았다. 위 1라운드 결과가 유지된다고 가정할 뿐, 2라운드 실행 결과는 아니다.

| 회차 | 종료 코드 | 파일 통과/실패/skip | 테스트 통과/실패/skip | Vitest Duration |
| ---- | --------- | ------------------- | --------------------- | --------------- |
| 01   | 0         | 60/0/1              | 1121/0/11             | 5.83초          |
| 02   | 0         | 60/0/1              | 1121/0/11             | 5.70초          |
| 03   | 0         | 60/0/1              | 1121/0/11             | 5.88초          |
| 04   | 0         | 60/0/1              | 1121/0/11             | 5.90초          |
| 05   | 0         | 60/0/1              | 1121/0/11             | 5.74초          |
| 06   | 0         | 60/0/1              | 1121/0/11             | 5.71초          |
| 07   | 0         | 60/0/1              | 1121/0/11             | 5.85초          |
| 08   | 0         | 60/0/1              | 1121/0/11             | 5.83초          |
| 09   | 0         | 60/0/1              | 1121/0/11             | 5.91초          |
| 10   | 0         | 60/0/1              | 1121/0/11             | 6.08초          |

### 수정 후 진단 반복 (수락 근거가 아님)

수정 후 트리에서 `pnpm exec vitest run` 50회 (`diag-postfix-50.log`): **실패 2회 / 50회**.

- 8회차: `code-navigation.test.ts` > `이전 서버 세션이 발급한 코드 참조 링크를 새 세션에서 확인하면 이동 대상을 반환하지 않는다` (수정 전 10회차와 같은 테스트)
- 46회차: `packages/workspace/src/query/query.test.ts` > `live 참조와 선택 최신 확인 > undefined 표시 후 발생하면 오래된 파일을 열 후보를 반환하지 않는다`
- 수정한 B2 테스트는 수정 후 50회에서 실패하지 않았다. 다만 수정 전 50회에서도 실패하지 않았으므로 이 관찰만으로 수정의 효과를 입증하지는 못한다.
- 이 두 테스트도 이번 작업에서 고치지 않았다. 수정 범위는 지정된 B2 테스트 하나로 제한했다.

## 3라운드: 클릭 확인을 "원문 열기"와 같게 바꿈

### 이유

- 링크의 불투명 토큰은 클릭 시 서버가 다시 확인한다. 기존에는 COD-41 링크의 재확인이 토큰 발급 때의 코드·문서 세대와 현재 값이 다르면 거부했고, language server는 세대가 바뀔 때마다 COD-41 토큰을 모두 삭제했다. 세대는 내용이 같은 파일의 감시 이벤트나 저장소 git index 변경에도 오른다. 그래서 방금까지 유효하던 링크가 사용자에게 보이는 이유 없이 거부되었다.
- 100회 전체 스위트 진단(사용자가 전달한 수치)에서 통합 브랜치는 총 12회 실패했고 main 코드는 1회 실패했다. `code-navigation.test.ts`가 6회 실패했으며 268행에서 같은 토큰이 직전에 확인되었는데도 다음 확인이 `null`을 반환했다. 1·2라운드의 B2·B3 실패도 같은 원인이다.
- 2026-09-30 사용자 결정: COD-41 링크의 클릭 확인을 기존 코드 식별자 Hover "원문 열기" 링크와 같은 방식으로 만든다. 기존 링크의 동작은 바꾸지 않는다.

### 변경

- `packages/workspace/src/code-reference/index.ts` `confirm()`: 세대·`#epoch` 차이만으로 거부하지 않는다. 진행 중이거나 예약된 수집은 기다린 뒤 최신 관측에서 확인하고, 확인 중 관측이 교체되면 최대 3회·2초 안에서 다시 확인한 뒤 실패하면 `undefined`를 반환한다. source 소유 경로·버전, source 파일 정체·revision(또는 열린 buffer의 revision·문서 버전), 같은 위치·같은 표기의 marker, 해석된 대상 경로, 대상 파일 정체·revision, 닫힘, 토큰의 등록 여부 검사는 그대로다. `capture()`는 바꾸지 않았다.
- `packages/language-server/src/code-navigation/index.ts`와 `server-session/index.ts`: 코드 세대가 바뀌면 토큰을 삭제하던 `invalidate`와 호출을 제거했다. 토큰은 source 편집·닫기·서버 종료에서만 해제한다.
- VS Code client(`packages/vscode`, 변경 없음)를 읽어 확인했다: snapshot 알림은 provider 재등록만 하고 `confirmSource`는 알림 세대가 아니라 client 재시작(`#sessionGeneration`)·출처 문서 닫힘·버전 변경만 본다. 세대 알림 때문에 클릭을 거부하는 코드는 없다.
- 테스트: workspace 4건 추가(관련 없는 파일이 바뀌고 재수집되어도 확인, 수집 중 클릭은 기다린 뒤 확인, 표기 위치 이동 거부, 대상 문서 실변경 거부). 기존 거부 사례는 모두 실제 변경(source 표기 삭제, 대상 변경, 버전, 닫기, catalog 문서 제거, 재시작, 파일 대체, 다른 owner)이라 그대로 두었다. language server 테스트의 "새 토큰이 확인될 때까지 기다리는" 우회 4곳을 없애고 링크·Hover 완료만 기다린 뒤 한 번 확인해 정확한 값을 단정한다. 편집·닫기 뒤 거부와 이전 서버 세션 토큰 거부 단정은 유지했다.
- `.codocs`: `code-reference-index.yaml`의 "관측과 안전한 확인"의 클릭 선택 문단과 `language-server.yaml` 마지막 줄을 새 동작에 맞췄다.

### 검사 (각 1회, 사용자 결정)

이 라운드의 모든 검사는 한 번만 실행했다. 반복은 하지 않았다. 검사 대상은 commit `19c7742aae88be6343e7515ae5ce3720ea569e52`의 내용과 같은 작업 트리다.

| 명령                           | 종료 코드 | 소요 | 결과                                                                               |
| ------------------------------ | --------- | ---- | ---------------------------------------------------------------------------------- |
| `pnpm typecheck`               | 0         | 10초 | 통과                                                                               |
| `pnpm lint`                    | 0         | 9초  | 통과                                                                               |
| `pnpm exec prettier . --check` | 0         | 18초 | 통과                                                                               |
| `pnpm test`                    | 0         | 10초 | Vitest 60 files / 1125 tests 통과(1 file, 11 tests skipped), `node --test` 39 통과 |
| `pnpm build`                   | 0         | 5초  | 통과                                                                               |
| `pnpm run release:pack`        | 0         | 5초  | 통과                                                                               |
| `pnpm run release:verify`      | 0         | 2초  | `result.json`의 `passed: true`                                                     |

- 커밋 훅(lint-staged, typecheck, `pnpm test`)도 통과했다: Vitest 60 files / 1125 tests 통과, `node --test` 39 통과.
- 이 결과가 없앤 것은 반복 실패의 원인이지 반복 실패가 없다는 통계적 증거가 아니다. 3라운드에서는 반복 진단을 하지 않았다.
- 로그는 워크트리 밖 `evidence/INT-001/r5-*.log`에 있다.

## 제외한 알려진 간헐 테스트

사용자가 이 작업에서 제외했다. main 코드에서도 가끔 실패하거나 main과 같은 테스트라 조사·수정하지 않았다.

- `packages/workspace/src/query/query.test.ts` > "…표시 후 발생하면 오래된 파일을 열 후보를 반환하지 않는다"
- `packages/workspace/src/query/query-initialization.test.ts` > "첫 폴더 readdir 반환 뒤 …하면 최종 목록을 반영한다"
- `packages/mcp/src/server/write-race.test.ts` (모든 사례)
- `packages/mcp/src/server/authoring.test.ts` > "최신 get revision으로 선택 속성을 unset하면…"

3라운드 검사에서 이 테스트들은 실패하지 않았다.

## 이전 태스크 단위 증거 (이번 실행이 아님)

- TASK-002 (`a7e9615d7204866e021485ab4bec42b9a2dde915`): `evidence/TASK-002/terminal-result.json` — verification PASS, 커밋 훅 Vitest 58 files / 1096 tests 통과, `node --test` 29 통과, workspace MCP 10회 반복 기록, 보호 경로 diff 없음.
- TASK-003 (`0c6477c50ba8df0711452067331c76516cd6c6c3`): `evidence/TASK-003/terminal-result.json` — verification PASS, 고정 회귀 20회 × 10개 테스트 = 200 통과.
- TASK-001(`c49fe2e`), TASK-004(`df6334f`), TASK-005(`cf0750b`)는 종료 결과 파일이 없어 통합 입력으로만 사용했고 검증 완료로 표시하지 않는다. TASK-005 내용은 `452b021`로 다시 적용되었다.

## 발견 사항

- 1라운드 7회차 실패와 그 원인은 위와 같다. 테스트 대기 보강으로 처리했다.
- 전체 Vitest를 반복하면 B3 사례(`code-navigation.test.ts`)와 workspace `query` 테스트 2건이 수정 전후 모두 간헐적으로 실패한다(각 50회 중 2회 안팎). 이번 작업에서 고치지 않았고 원인도 판별하지 않았다.
- 어떤 세대 증가 뒤에도 탐색 토큰이 거부되던 동작은 열린 제품 질문이었고, 2026-09-30 사용자가 결정했다. COD-41 링크의 클릭 확인을 기존 "원문 열기" 링크와 같은 방식으로 바꾼다(아래 3라운드).
- `query.test.ts`·`query-initialization.test.ts`의 간헐 실패 2건과 MCP `write-race`·`authoring`의 간헐 실패는 사용자가 이 작업에서 제외했다(아래 "제외한 알려진 간헐 테스트").

## 미완료

- **Windows**: 실행하지 않았다. macOS 로컬 결과는 Windows 증거가 아니다.
- **실제 VS Code UI 시나리오 19개**: 실행하지 않았다. `pnpm test:vscode`는 프로젝트 규칙상 CI 전용이다.
- **`required-ci`** (Windows·macOS): 실행하지 않았다. push 이전이라 아직 존재하지 않는다.
- 반복 실행(전체 Vitest 10회, 단일 파일 반복, MCP 10회)은 2026-09-30 사용자 결정으로 최종 검증 기준에서 뺐다. 미완료가 아니라 기준 변경이다. push 이후 양 OS CI가 최종 확인이다.
- 1·2라운드의 위 진단 반복에서 나온 간헐 실패 중 `query`·`query-initialization` 2건은 제외 목록으로 이관했다.
