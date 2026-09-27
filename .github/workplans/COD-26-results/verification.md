# COD-26 구현과 검증 기록

- 실행: wb-cod26-486f634-8c4a21 / TASK-001 / intent/3 (초기 구현 intent/1, 원인 조사 intent/2)
- 기준 커밋: 486f634d7df88ad0e2e79e681e1fbc21f3609229
- 환경: Windows, Node 24.21.0, pnpm 10.34.5
- 계획/요청 worker: gpt-6-sol / high. 호스트가 노출한 실제 모델·effort는 unknown.
- Source plan SHA-256: f674067054adf03f4faf1bfed9f816ecc2e7434cb8509b8a727c1f0290a17989
- Source task SHA-256: aef5f4fa467dc35cd2410b335b5e5b0732bb985ce3d9612be00890c6dc6df196
- 최초 Runtime binding SHA-256: 157f2e8e9315f04ee6e2af9cc68ef370a142bc01086a639b4bd6391a4ab33944
- 현재 Runtime binding SHA-256: 93b3a7e26bc6fbf239231feac517f643a725cffe5666e38b364e0bb5278a2bb4
- 현재 revision SHA-256: 74eb3b143d038e30227f6d76b59b2700268f14d67f732948d49a5f188bdf4b61

현재 실행은 사용자 요청에 따라 watcher 최소 수정과 기존 PR23 브랜치 반영을 포함한다. 아래 intent/1 실패·보류 기록은 당시 결과로 보존하며, 최신 수정과 검증은 다음 판정과 마지막 절에서 확인한다.

## 현재 판정 — intent/3

구현과 필수 로컬 검증은 **PASS**다. watcher 종료 후 등록 결함을 최소 guard로 수정했으며 새 회귀는 수정 전 실패·수정 후 자연 종료를 확인했다. 전체 check는 Vitest 961개·도구 45개·개발/패키지 117개, 실제 설치 Windows VS Code는 51개, lifecycle은 4모드 모두 통과했다. PR23 브랜치 전달은 승인되어 있으며 정상 결과 커밋과 원격 ancestry 확인 뒤 진행한다. 커밋 SHA·훅·전달 결과는 인계 보고서에서 식별한다. 아래 intent/1의 FAIL/NEEDS_INPUT은 해결 전 과거 기록이다.

## 변경 범위

배포 가이드 여섯 주제를 단일 원문으로 제공하는 독립 handler를 추가했다. 프로젝트 색인과 작업 디렉터리에 의존하지 않으며 읽기 실패를 명시한다.
네 가상 YAML은 용어·정책·절차·다른 이름의 사용 맥락을 연결한다. 정책은 한 문서가 소유하며 폐기 참조 경고 한 건은 의도된 예시다.
README 여섯 도구와 담당 계약을 갱신하고 실제 MCP 작성·복구·refresh와 배포 검사를 보완했다.

## 수락 기준과 실행 증거

| 기준 | 검사 위치와 관측                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | guide/guide.test.ts, server/server.test.ts: 생략·6 topic·잘못된 topic·알 수 없는 속성, SDK text/structuredContent/isError 동등성                                                                                       |
| AC2  | server/state.test.ts: 실제 초기화/refresh 파일 읽기를 제어해 대기 중 guide 응답·추가 읽기 없음, 실패 세션 독립성. guide.test.ts: 없는 배포 파일은 file_access_failed                                                   |
| AC3  | guide-assets/index.ts: 원본/배포 전체 목록·바이트, 모든 YAML의 공개 파서·스키마·위치·입력 보존, 독립적으로 정한 4문서 정/역참조·등장 수, 의도된 폐기 경고                                                              |
| AC4  | build-checks.test.ts: 저장소 밖 설치 tarball CLI의 생략·6 topic·오류 호출, 실제 VSIX 추출본 전체 자산·상대 링크 검사                                                                                                   |
| AC5  | server/authoring.test.ts: 실제 stdio set/unset·최신 revision·validate, A→B→A 파일과 양방향 관계, stale revision 거부 후 재조회·검토하여 타인 변경 보존                                                                 |
| AC6  | server/state.test.ts: beforeIndexUpdate에서 두 실제 관측 오류를 재현, saved/indexUpdated/revision·파일 바이트 보존과 MCP refresh 복구. 첫/추가 관측의 실제 도달을 확인한 뒤 1초 초과 대기, create 호출 1회와 늦은 성공 |
| AC7  | server/state.test.ts: 파일4/항목1과 진단 수, complete/partial의 countsComplete, 제어한 동시 refresh가 session.refresh 한 번 공유, 양쪽의 기존 cursor 만료, failed→complete 및 partial→complete 복구                    |
| AC8  | README 등록 목록, pnpm check, 실제 설치 VS Code, lifecycle 검사. 제품 파서/검증기/카탈로그와 index 도달성: 76문서·진단0·도달76                                                                                         |

## intent/1 명령 결과

전체 check의 실패와 독립 검증을 분리해서 기록한다. 재현된 종료 결함은 통과한 독립 검사로 면제하지 않는다.

| 명령                              | 결과                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| pnpm install --frozen-lockfile    | PASS, task-local 신규 설치 44.7초                                                                |
| pnpm build                        | PASS                                                                                             |
| 집중 Vitest (MCP/write/query)     | 최초 170개 중 169 PASS, 기대 코드 오류 1개는 아래와 같이 수정 후 authoring/guide/state 24개 PASS |
| pnpm typecheck                    | PASS                                                                                             |
| 변경 범위 ESLint                  | PASS                                                                                             |
| state.test.ts 추가 실패 복구 포함 | 10 PASS                                                                                          |
| .workbench/validate-codocs.mjs    | PASS: 제품 파서/스키마/카탈로그 76문서, 진단0, 목차 도달76                                       |

## intent/1 구현 중 발견과 처리

| 후속 명령                                      | 결과                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 가이드/자산 패키지 집중 검사                   | 3 PASS, 선택 제외 31, 71.81초                                                                                        |
| pnpm check 첫 실행                             | FAIL, 4분38.7초. 타입·lint·서식·빌드 PASS, Vitest 959 PASS/1 FAIL (watcher-registration 종료). 이후 단계는 별도 실행 |
| pnpm test:vscode                               | PASS, Windows VS Code 1.100.0 설치 VSIX 51/51, 6분57.8초, 종료·정리 완료                                             |
| node packages/vscode/test-runner/lifecycle.mjs | PASS, 1분36.7초. 시작 실패·기능 실패·시간 제한·취소 4모드, 각 잔류 프로세스 0                                        |

- resolved_in_task: 처음 worktree checkout이 기존 긴 COD-18 증거 경로에서 실패했다. 같은 작업의 새 브랜치가 정확한 base를 가리키고 경로가 자동 정리된 것을 확인한 뒤 명령 단위 core.longpaths=true로 같은 경로를 생성했다.
- resolved_in_task: 오래된 revision은 후보 계산 단계에서 change_revision_mismatch이며 디스크 직전 충돌은 revision_conflict다. 가이드는 두 코드 모두 재조회·검토로 안내하고 실제 stdio 기대값을 단계에 맞췄다.
- resolved_in_task: 패키지 검사 교체 스크립트가 CRLF와 내장 문자열의 함수 경계를 잘못 잡아 중간 파일을 손상했다. 기준 원문에서 정확한 주석 경계로 재구성했다. 기존 테스트 선언은 그대로이며 새 외부 CLI/VSIX 검사 2개만 추가했다. 파서 위치·원문 및 입력 보존 검사도 유지했다.
- resolved_in_task: 외부 CLI 검사 스크립트의 Windows 절대 import 경로는 file URL이어야 했다. pathToFileURL로 변환했다. tarball/VSIX 자산 검사와 구별한 실행기 문제다.
- resolved_in_task: ES2022 타입 환경에 없는 Promise.withResolvers를 테스트에서 사용했다. 명시적인 deferred helper로 바꾸고 타입·lint를 통과했다.

## 검토와 남은 범위

### 최초 재현한 watcher 종료 경합 — intent/1의 action_required 기록

기존 watcher-registration 자식 종료 실패가 전체 check에서 재발했다. 전달과 close 완료는 994ms에 기록됐지만 프로세스가 남아 15초에 종료됐다. 단독 원래 테스트는 2.27초에 통과했다.
제품 파일을 바꾸지 않고 진단 번들에서 실제 resolveWorkspacePath 결과의 반환만 대기시켰다.
새 하위 폴더의 경로 확인 도달 → watcher.close 완료 → 반환 대기 해제 순서에서 종료 뒤 watcher-connection-ready가 발생했다.
프로세스가 자연 종료하지 않아 진단의 5초 관리 제한으로 정리했다. 이것은 제품의 복구 제한이나 성공 검사로 사용하지 않았다.

기대는 종료 뒤 새 감시 연결이 생기지 않는 것이고 실제 결과는 lateConnectionAfterClose:true다.
#prepareDirectory가 await 전만 세대를 검사하고, 두 경로 확인 await 뒤 #connect 전에 검사하지 않는 경로가 원인이다.
최소 수정 후보는 watcher/index.ts의 연결 직전 현재 세대 확인과 watcher-registration.test.ts·test-support/registration-child.mjs의 실제 종료 경합 회귀다.
intent/1 실행 packet은 watcher 경로를 금지했으므로 당시에는 수정하지 않았다. 이후 실제 IO 원인 조사와 사용자 지시에 따라 intent/3에서 최소 수정 범위를 승인받았다.

원시 증거: [첫 전체 check 실패](check-initial-failure.txt), [제어 재현 결과](watcher-close-diagnosis.json), [재현 스크립트](watcher-close-reproduction.txt).
실제 IDE 증거: [51개 기능](vscode-functional.json), [실행·정리](vscode-result.json), [설치 VSIX SHA-256](vscode-installation.json), [lifecycle](vscode-lifecycle.json).

### intent/1 기능 검토와 당시 미실행 범위

원문 접근은 고정 topic 매핑만 사용해 경로 입력을 받지 않는다. guide는 세션을 전달받지 않으며 실패를 빈 성공이나 index_not_ready로 숨기지 않는다.
저장·revision·색인 복구·refresh 제품 구현을 변경하지 않았다. 잠금·FIFO·고정 복구 제한·자동 rollback·create 재시도를 추가하지 않았다.
intent/1에서는 macOS·성능 측정·공개 게시·push·PR·사용자 브랜치 병합을 검증하거나 수행하지 않았다. intent/3에서는 기존 PR23 브랜치 전달이 승인됐다. 실제 IDE API 검사는 화면 픽셀·마우스 검사가 아니다.

### intent/1 독립 후속 검사와 당시 후보 상태

- 전체 developer/package checks: `pnpm exec vitest run --config vitest.checks.config.mjs` PASS, 3 files / 117 tests, 502.49초. 별도 frozen 설치 fixture 구간은 출력 없이 진행되었으나 정상 완료했다. [원시 출력](package-checks.txt)
- 도구 회귀: 기존 tools/test/run.mjs와 동일한 glob의 node:test만 별도 실행, 45/45 PASS, 54.39초. 첫 check에서 실행되지 않았던 후속 단계를 보충했다. [원시 출력](tool-tests.txt)
- 최종 self-review: 변경은 허용 경로 안에 있으며 담당 계약, 고정 주제 목록, 본문 원본, 예시 그래프, 외부 설치 링크를 대조했다. 기존 패키지 검사는 유지했고 신규 외부 CLI·VSIX 검사만 2개 추가했다. `git diff --check` PASS.
- 구현 범위는 완료했으나 전체 검증 판정은 **FAIL / action_required**다. 재현한 watcher 종료 경합은 별도 승인이 필요한 범위로 보존했다. 정상 Git 훅이 허용하더라도 이 변경의 로컬 커밋은 **provisional_candidate**이며 COMPLETE/verified 결과가 아니다.
- 공개 게시·push·PR·다른 브랜치 통합은 하지 않는다. 후보 커밋의 실제 SHA와 훅 실행 결과는 인계 보고서에서 식별한다.

### intent/1 커밋 시도 — 실패, 작업 보존

정상 Git pre-commit을 한 번 실행했으나 같은 watcher 자식 종료 실패로 거부됐다(명령 4분54초, Vitest 959 PASS / 1 FAIL, 58.40초). 자식은 close 완료를 985ms에 기록한 뒤 자연 종료하지 않았다. 재시도·훅 우회·watcher 경로 수정은 하지 않았다.

결과 커밋과 후보 커밋은 없고 HEAD는 기준 커밋 그대로다. 작업 파일과 staged 변경을 보존했다. 훅이 검사한 tree는 `0d6040bd2f1fec74ca3a744fa8499e556853aec2`이며 이후 변경은 이 실패 기록과 증거 추가뿐이다.
상태는 **NEEDS_INPUT**, 구현 **COMPLETE**, 검증 **FAIL**, continuation **NOT_POSSIBLE**이다. watcher 최소 범위 확장에 대한 사용자 판단과 그 범위의 수정·재검증이 필요하다.

- [최종 훅 원시 출력](commit-hook-failure.txt)
- [훅 result.json](commit-hook-result.json)
- 원래 실행 증거 위치: `.workbench/commit-check/run-Onq5xq/result.json`
- 실패 보존 snapshot: `C:/Users/sjw73/AppData/Local/Temp/codocs-staged-4kKMMu`

## intent/3 수정과 최종 검증

사용자가 watcher 결함 수정, 기존 작업 완료와 PR23 브랜치 반영을 지시했다. 기준 HEAD와 staged tree 및 42파일 raw digest manifest를 확인한 뒤 재개했다. 수정 소유권은 watcher 구현·실제 child 회귀·담당 계약에만 추가했다.

- resolved_in_task: 종료 후 하위 폴더 등록으로 OS 감시가 남는 경합. 실제 IO 원인과 A/B/A는 [원인·수정 기록](watcher-cause.md)에 보존했다. 비동기 경로 확인 뒤 active(epoch)를 재검사한다.
- AC9: 새 실제 child 회귀가 수정 전15초 timeout으로 실패했다. 수정 후에는 watcher/MCP/write/query 집중 검사204개가 통과했다(20.08초). 기존 child 기본 시나리오와15초 제한은 유지했다.
- AC1–AC8: 최종 `pnpm check` PASS (7분36.4초): 타입·lint·서식·빌드, Vitest 961개, 도구 45개, 개발/패키지 117개. 외부 tarball CLI 6주제와 실제 VSIX 전체 자산 검사를 포함한다. [원시 출력](intent3-check.txt)
- AC8·AC9: 실제 설치 Windows VS Code 1.100.0의 51개 기능 PASS (3분3.3초), 종료 코드 0·잔류 프로세스 0. VSIX SHA-256은 e1ac012131ab690163e296f5d5073c8044ed673de26ed813b5308fe5b82c3865. [기능](intent3-vscode-functional.json), [설치](intent3-vscode-installation.json), [실행·정리](intent3-vscode-result.json)
- AC8·AC9: lifecycle 시작 실패·기능 실패·시간 제한·취소 4모드 PASS (48.0초), 모두 잔류 프로세스 0. [결과](intent3-lifecycle.json)
- 담당 문서 검사: 제품 파서·스키마·카탈로그 진단 0, 76문서 모두 index에서 도달. macOS는 실행하지 않았으며 IDE 검사는 API 관측으로 픽셀·마우스 검사를 주장하지 않는다.
- self-review: 최소 active(epoch) 재검사와 실제 child 회귀, 기존 기본 시나리오 보존을 확인했다. 새 회귀는 IO 반환 경계를 제어하며 timeout 증가·강제 process.exit·제품 지연을 사용하지 않는다. 가이드/패키지 검사를 유지하고 변경은 승인된 소유 경로에 한정했다.
- PR23 기존 원격 CI는 검사 시작 전 계정 결제/사용 한도 사유로 실패해 있었다. 로컬 제품 검사 결과와 분리하며 workflow를 바꾸지 않는다.
