# COD-20 Windows 구현 검증 결과 — 2026-09-24

## 판정

같은 구현 소스에서 생성한 VSIX를 Windows의 VS Code 1.100.0과 검증 시작 시 고정한 정식 버전 1.139.0에 설치했다. 기능 검사는 각각 **51/51 통과**, **45/51 통과**였다. 두 버전의 대표 성능 시나리오와 네 종류의 실행 수명·정리는 모두 통과했다. 사용자는 현재 **구현 작업의 완료와 PR #17 병합을 승인**했다. 다만 1.139.0의 잠금 파일 조건 기능 실패 6건과 현재 호스트의 실제 symlink 생성 `EPERM` 때문에 전체 검사와 최신 버전 지원 검증은 **통과로 판정하지 않는다**.

사용자 지시에 따라 API 100회 예열·1000회 측정 등 **정식 설정은 그대로 유지**하되, 이 구현 작업에서 통계 오차를 줄이기 위한 전체 반복 벤치마크는 수행하지 않았다. 시작했던 1.100.0 정식 설정 실행은 지원되는 취소 요청으로 종료했고, 완료된 212개 API 표본과 1개 취소 표본을 원본 그대로 보존했다. 이 실행은 **취소된 부분 진단**이며 200회짜리 완료 벤치마크가 아니다. 두 버전의 대표 smoke는 구현 경로 검증이며, 표본 수가 달라 버전 간 성능 우열이나 p95 목표 충족을 결론 내릴 수 없다.

## 실행 계보와 환경

| 항목           | 기록                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 작업/계획      | `wb-cod20-dom-20260924`, `INT-001`; 계획 `wb-cod20-dom-20260924/plan/1`, SHA-256 `f8d0eb194b1fa504639b625ab2bba76e0967e405aac558c642dc81474efc0f34`                                                                                                    |
| 실행 packet    | 원본 task packet SHA-256 `19db47b54f9c8a4313f615fe3c7b9442600893f546aa72a3518769353de1a6a5`; 최종 intent/4 binding은 아래 기록                                                                                                                         |
| Shape 입력     | artifact `01a0cf1f-ea9b-744a-847e-0f1d8ad61e86`, Gateway LF UTF-8 SHA-256 `0d68aeb6741ded695e5cbd321f6213d99e27e1a4c511cbc663035f8711ea748c`                                                                                                           |
| 직렬 구현 계보 | TASK-001 `642208878e18285c88934147b4f1d07195b36525` → TASK-002 `ac90f36b4ed793418ac16a229a51459ffbdecc98` → TASK-003 `21eabb2d14490491357b73715825dc3c8285e386` → REPAIR-001 `e720db92b4430f3d6fee59bfbf8555c8cd445ef9`                                |
| 측정 소스      | `e720db92b4430f3d6fee59bfbf8555c8cd445ef9`, tracked diff 없음; 두 대표 실행의 source SHA-256 `af819c687af42e2cf7333289378c3ee31ad849e3c4d17414daf9a0c29095646a`                                                                                        |
| INT 작업 공간  | `codex/wb-cod20-dom-20260924/int-001`, `C:/Users/sjw73/OneDrive/Desktop/dev/codocs-worktrees/wb-cod20-dom-20260924-int-001`                                                                                                                            |
| 실행 프로필    | 계획·요청 `gpt-6-sol / high`; 호스트가 실제 model/effort 메타데이터를 노출하지 않아 **effective profile은 unknown**                                                                                                                                    |
| Intent/binding | intent/2 `c402d2dcd5e0b5fd26729b3bbc795581decc9effd995bb3d1e2dcb0068a3e3e1`; intent/3 `d2db664fd36f0a5bfe2bde5dd6b0f26f13147aba5e8178e51ffeb90e1079e397`; 사용자 범위 수정 intent/4 `78f69fdc517c38914c76c1bd3685f0c5ffd1cf757951012f34de5f6c66a8d179` |
| OS/도구        | Windows `win32-x64`; 실행기 Node 24.21.0, pnpm 10.34.5, `pnpm install --frozen-lockfile`; VS Code 내장 Node/Electron은 1.100.0의 20.19.0/34.5.1, 1.139.0의 24.20.0/43.6.0                                                                              |
| 버전 고정      | 2026-09-24 10:23:32.7802894 KST에 공식 stable resolver가 `1.139.0` 반환. [원본 영수증](raw/checks/stable-resolution.json.raw). 이 실행 중 latest를 다시 해석하지 않았다.                                                                               |

Intent/3은 API 요청별 내구 진행과 전체 실행 취소·부분 보고서 정리를 보완했다. Intent/4는 사용자 지시로 구현 검증 범위만 축소했다. [최종 실행 packet 원본](raw/intent/runtime-packet-intent-4.yaml.raw)과 [범위 수정 원본](raw/intent/revision-intent-4.yaml.raw)을 보존했으며, source 기본 설정은 바꾸지 않았다. 이전 구현 결과는 각각 잠정 후보였고 symlink 환경 실패를 숨기지 않았다.

사용자의 완료·게시·병합 지시는 [intent/5 수정 기록](raw/intent/revision-intent-5.yaml.raw)과 [전달 packet](raw/intent/runtime-packet-intent-5.yaml.raw)에, 중단 후 같은 작업 공간에서 이어서 진행한 사실은 [intent/6 수정 기록](raw/intent/revision-intent-6.yaml.raw)과 [재개 packet](raw/intent/runtime-packet-intent-6.yaml.raw)에 남겼다. 두 수정은 앞선 원시 검증 결과를 통과로 재분류하지 않는다.

두 대표 실행의 일반 corpus SHA-256은 모두 `45775d59c8d078e8a5150557d7d7720ef94db79ac19a7981171f284a793ea4f6`이고 API 전용 고정 corpus SHA-256은 모두 `67e8ae46a8034eebfad927957b14d957c4006809afce60f6ede638dec1c12023`이다. 각 시나리오의 독립 가변 fixture 해시는 원본 `performance.json`의 `hashes.corpora`에 남는다. VSIX ZIP SHA-256은 패키징마다 다르지만, 기능 두 실행·취소 실행·대표 두 실행의 **추출 payload 26개 파일 경로와 내용 SHA-256이 전부 같다**. [VSIX payload 대조](vsix-payload-manifest.json). VSIX 바이너리, 임시 프로필, 사용자 데이터는 결과 커밋에 넣지 않았다.

## 실행 명령과 결과

`pnpm install --frozen-lockfile`은 통과했다. 최종 소스에서 `pnpm check`의 typecheck·lint·Prettier·build까지 통과했으나, 다음 `pnpm test`가 실제 symlink `EPERM`으로 846 통과/45 실패하여 집계 명령은 실패했다. 도달하지 못한 검사 단계는 `pnpm exec vitest run --config vitest.checks.config.mjs`로 별도 실행했고 114 통과/1 symlink `EPERM` 실패했다. API 진행·취소·UI 판정의 focused Node 검사는 21/21 통과했다. [전체 검사 로그](raw/checks/check-intent-3.log), [별도 검사 로그](raw/checks/vitest-checks-intent-3.log), [focused 로그](raw/checks/focused-intent-3.log).

통상 커밋 훅도 한 번 실행했다. 격리된 스테이징 복사본에서 의존성 설치·타입 검사·lint를 통과한 뒤 테스트 845 통과/46 실패로 종료했고, 46개 오류 모두 실제 symlink 생성 `EPERM`이었다. 해당 로그는 이 통합 작업 공간의 `.workbench/commit-hook-int-001.log`에 보존했다. 훅 실패를 통과로 표시하지 않고 결과 커밋만 `HUSKY=0`으로 만들었다.

| 버전    | 설치 VSIX 기능            | 수명·정리                                                      | 대표 `all` smoke                                                    | 원본                                                                                                                                                                      |
| ------- | ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.100.0 | 51/51 통과                | startup-failure/failure/timeout/cancelled 4/4, 잔여 프로세스 0 | 9개 시나리오 모두 완료, 오류 0, 정리 완료·잔여 0                    | [기능](raw/1790218927821-7256/functional.json.raw), [수명](raw/lifecycle-1790219586538-18180/result.json.raw), [대표 결과](raw/1790223888736-19064/performance.json.raw)  |
| 1.139.0 | 45/51 통과, 아래 6개 실패 | 같은 4/4, 잔여 프로세스 0                                      | API 35/35와 다른 8개 시나리오 각 1/1 완료, 오류 0, 정리 완료·잔여 0 | [기능](raw/1790219067924-10968/functional.json.raw), [수명](raw/lifecycle-1790219653769-22616/result.json.raw), [대표 결과](raw/1790224305493-25376/performance.json.raw) |

기능 실행 명령은 각 버전에 `pnpm test:vscode --mode functional --vscode-version <고정 버전>`, 수명 검사는 `node packages/vscode/test-runner/lifecycle.mjs --vscode-version <고정 버전>`이었다. 대표 실행은 아래처럼 **무시되는 실행별 설정 파일**을 사용했다. 이 파일은 `.workbench`에 있으며 재현 시 같은 JSON으로 만들면 된다.

```powershell
pnpm test:vscode --mode performance --scenario all --vscode-version 1.100.0 --config .workbench/implementation-smoke-min.json
pnpm test:vscode --mode performance --scenario all --vscode-version 1.139.0 --config .workbench/implementation-smoke-latest.json
```

두 설정은 `seed: 20260924`, `apiWarmup: 0`, `propagationPollMs: 50`이다. 1.100.0은 `targets`의 9개 시나리오를 각각 1로, 1.139.0은 API만 35로 하고 나머지 8개를 각각 1로 설정했다. 35는 고정 섞기 순서의 첫 35개가 normal 26, references 4, duplicate 2, long 2, errors 1을 포함하며 마지막 errors가 index 34에 있기 때문에 택한 **범주 경로 검증용 최소 prefix**이다. 통계 반복 목표가 아니다. [두 원본 실행 설정](raw/1790223888736-19064/config.json.raw), [최신 원본 실행 설정](raw/1790224305493-25376/config.json.raw). 기본 소스는 여전히 startup 10, first-ui 10, reentry-ui 30, API 예열 100/측정 1000, save/external/edit-indexing/edit-ready 각 30, multiwindow 1이다. 성능 모드는 명시적으로만 실행되고 일반 `pnpm test:vscode`의 기능 동작과 CI/hook 기본 경로를 바꾸지 않는다.

두 버전에서 startup, first-ui, reentry-ui, save, external, edit-indexing, edit-ready, multiwindow가 각각 **attempted 1/completed 1/incorrect 0/failed 0/cancelled 0/incomplete 0/missing 0**이었다. API는 1.100.0에서 1/1, 1.139.0에서 35/35로 같은 완료 분류였다. 별도 세션·프로필·가변 fixture를 사용했고, 실제 동일 프로젝트 두 창 전파와 다른 프로젝트 두 창 격리를 검증했다. VS Code 재시작·강제 새로고침·인위적 색인 지연으로 표본을 만들지 않았다. [집계 JSON](metrics.json)과 각 실행의 `scenario-samples-*.jsonl`, `performance.json.raw`에 개별 요청·정답·ID·창·PID·시계가 있다.

## 관측값의 범위

API는 `executeHoverProvider` 호출 직전부터 반환까지 측정하고, 반환 후 ID·본문·원문 링크 또는 오류 문서 부재를 따로 검증했다. 아래 값은 **실행별 진단값**이다. p95는 완료 표본의 nearest-rank로 산출했다.

| 실행                                            | 설정 및 완료 분류                                                                                                                | API 중앙값 / p95 / 최댓값                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1.100.0 정식 설정 **사용자 범위 수정으로 취소** | 예열 100/100 반환; 측정 target 1000, attempted 213, completed 212, incorrect 0, failed 0, cancelled 1, incomplete 0, missing 788 | 7,696 / 21,896 / 84,158 ms — 완료된 **부분 표본만**의 진단값   |
| 1.100.0 대표 smoke                              | 예열 0, API 1/1 완료                                                                                                             | 11,509 / 11,509 / 11,509 ms — n=1, 백분위 해석 불가            |
| 1.139.0 대표 smoke                              | 예열 0, API 35/35 완료; 다섯 범주 모두 정답                                                                                      | 62,043 / 286,755 / 380,753 ms — 범주 경로 검사, 정식 측정 아님 |

취소 실행은 `run-control.json`의 `cancelRequest`에 `cancel-run.json`을 생성했다. `performance.json`은 `status: cancelled`, `result.json`은 `reason: cancelled`, `cleaned: true`, `residualProcesses: 0`이다. 실행 중이던 `normal0271` 하나만 cancelled이고 이미 완료된 212개는 지우거나 실패로 바꾸지 않았다. [취소 결과](raw/1790219725252-16496/result.json.raw), [부분 성능 원본](raw/1790219725252-16496/performance.json.raw), [예열·측정 요청 시작/반환 JSONL](raw/1790219725252-16496/api-request-progress-0.jsonl). 더 이른 진단 Ctrl-C 실행의 원본도 통합 작업 공간 `.workbench`에 별도 보존했으나, 최종 소스의 정식 완료 증거로 재사용하지 않았다.

실제 Hover UI는 대상 Monaco 편집기에 포인터를 이동하고 **현재 열린 팝업**에 기대 본문이 있으면서 Loading 행이 없는 때에만 완료했다. Loading이 관측되지 않았다면 지속 시간은 `null`이어야 한다. 여기의 네 표본은 모두 Loading 시작·사라짐을 실제 관측했다. Loading 지속 시간은 행이 사라진 관측 시각에서 끝나며, 기대 본문 완료 판정은 별도로 확인했다. 각 표본은 n=1이므로 중앙값과 최댓값이 같은 수치이며 분포 추론은 할 수 없다.

| 버전/시나리오     | 완료/실패 | UI 중앙값 = 최댓값 | Loading 중앙값 = 최댓값 |
| ----------------- | --------- | ------------------ | ----------------------- |
| 1.100.0 최초 UI   | 1/0       | 17,762 ms          | 16,827 ms               |
| 1.100.0 재진입 UI | 1/0       | 4,289 ms           | 3,364 ms                |
| 1.139.0 최초 UI   | 1/0       | 61,728 ms          | 60,792 ms               |
| 1.139.0 재진입 UI | 1/0       | 15,622 ms          | 14,702 ms               |

최초 UI는 readiness 선조회·sentinel Hover·API 예열로 미리 데우지 않았다. 재진입은 자체 새 세션에서 첫 팝업을 닫고 generation 2를 측정했다. 네 표본 모두 완료 시 팝업이 열려 있고 Loading은 false이며 기대 본문을 포함한다. DOM 관측 해상도는 약 0.1 ms였고 로컬 관측 오버헤드는 보존했다. 프로세스 간 발생 시각은 `timeOrigin + monotonicMs`로 대응시키지만 `clockUncertaintyMs: null`이므로 절대 시각 정확도를 임의로 주장하지 않는다. 스크린샷·영상·OCR·수동 판독은 완료 또는 시간 표본으로 사용하지 않았다. [1.100.0 UI 전이](raw/1790223888736-19064/ui-transitions-first-ui-0.jsonl), [1.139.0 UI 전이](raw/1790224305493-25376/ui-transitions-first-ui-0.jsonl); 재진입 전이도 같은 실행 폴더에 있다.

다중 창 검사는 한 창 baseline, 동일 프로젝트 A/B 전파, 다른 프로젝트 A/B 격리를 각각 실제 프로세스로 수행했다. 1.139.0의 서로 다른 프로젝트 B 창은 `isolated: true`와 예상 프로젝트 ID를 기록한다. 메모리는 각 단계의 Extension Host·server **고유 PID별 마지막 RSS만 한 번씩** 더했다. 1.100.0의 baseline/same/distinct 총 RSS는 각각 315,281,408 / 741,953,536 / 637,775,872 bytes, 1.139.0은 379,592,704 / 691,019,776 / 728,952,832 bytes였다. 이 값은 서로 다른 단계의 단일 관측이며 제품 최적화나 버전 우열을 주장하지 않는다. 원본 `multiwindow-memory` 이벤트와 창별 JSONL은 두 대표 실행 폴더에 있다.

## 실패·미실시와 후속 처리

일반 Hover·원문 링크 기능은 통과했다. 다만 1.139.0에서 잠금 fixture의 `partial/.codocs/unreadable.yaml`을 감시할 때 `EBUSY`가 관측되고 `partial-scan`, `unconfirmed-reference`, `unexpected-server-exit`, `restart-budget-recovery`, `diagnostics-recheck-recovery`, `rapid-edit-restart-diagnostics` 검사가 실패했다. 같은 소스의 1.100.0은 51/51 통과했다. 1.139.0의 이 여섯 실패를 모두 한 원인의 연쇄로 확정할 근거는 아직 없다. fixture 잠금이 감시에 미치는 영향, 제품·런타임 호환성, 이번 변경의 회귀를 분리해야 하며, **변경 전 기준 소스를 같은 1.139.0에서 재현하는 검사**가 필요하다. 일반 Hover·링크의 근본 결함으로 확정하지 않는다. [재현·후속 조사](follow-up-ebusy.md)에 실패 로그, 기대 결과와 분리 절차를 묶었다. 별도 수정은 대기 중이며 외부 작업을 등록했다고 표시하지 않는다.

Windows 호스트의 실제 symlink 생성 `EPERM`은 `pnpm check`의 기존 45개 실패와 별도 build-consumer 1개 실패를 설명한다. 머신 설정을 바꾸거나 mock/junction으로 대체하지 않았다. 따라서 집계 검사를 통과로 기록하지 않는다. 두 버전의 설치 VSIX 대표 시나리오 통과와 전체 저장소 검사 실패를 구분한다.

macOS 실제 VSIX/UI 측정은 PR #34 후속이고 Linux는 PR #25 후속이며, 어느 것도 이번 Windows 작업에서 테스트했다고 표시하지 않는다. 정식 전체 벤치마크는 이번 사용자 지시로 **의도적으로 연기**되었다. 실행할 때는 고정 버전·동일 source/VSIX payload·동일 corpus와 기본 100/1000 등의 목표로 각 환경을 따로 측정해야 한다. 현재 smoke/부분값을 합쳐 정식 표본 수를 채우지 않는다.

`raw/`의 증거 파일 111개는 원본 `.workbench` 파일과 SHA-256이 **111/111 byte-for-byte 일치**한다. 같은 폴더의 `.gitattributes`는 이 증거에 Git 텍스트 줄바꿈 변환이 다시 적용되지 않게 한다. Prettier가 증거를 변경하지 않도록 JSON/YAML/Markdown 원본에는 `.raw` 접미사를 붙였고, JSONL·로그는 원래 이름을 유지했다. 재현·검토용 요약 [metrics.json](metrics.json)은 별도 파생 집계이며 원본을 대체하지 않는다.

커밋 전체의 `git diff --check`는 수집 원본 `process.log`·`supervisor.log`·검사 로그와 stable 영수증의 기존 줄바꿈·끝 공백을 표시한다. 증거 바이트를 바꾸지 않기 위해 이 원시 파일들은 그대로 두었고, 작성한 계획·보고서·파생 JSON의 포맷과 공백은 별도로 통과시켰다.
