# 2026-09-21 성능 관찰 실행

이 디렉터리는 기존 COD-14 코어와 COD-16 설치형 VS Code Hover 측정기의 새 실행 결과를 보존한다. 이전 결과 파일은 수정하지 않았다. 정확성, 실제 완료 시간, 실행 완결성은 별도로 판단하며 1,000개 문서의 2초·100ms·500ms는 참고 기준이다.

## 실행 환경과 출처

- 작업 기준 커밋: `1c07daf547de71fe143484a347db5a3108bce3f4`. 측정기 변경은 실행 중인 워크트리의 미커밋 파일에서 시작했다.
- macOS Darwin 25.5.0, arm64, Apple M1 Pro, 메모리 16 GiB. OS 파일 캐시는 강제로 비우지 않았다.
- 저장소 `.node-version`과 `tools/check/runtime.mjs`가 정확히 요구하는 Node는 `v24.21.0`이다. 빌드·패키지·Hover 실측은 이 버전을 PATH 앞에 두고 실행했고 pnpm은 `10.34.5`였다. 새 워크트리에서 `pnpm install --frozen-lockfile`을 수행했지만 설치 시의 Node 버전은 별도 캡처하지 않아 검증 실행 버전으로 주장하지 않는다.
- 설치형 VSIX: `.workbench/artifacts/codocs-perf-001.vsix`, SHA-256 `0b87dde191785f49113d604ff9cc09f737d6accd1257bc16d218f202bf856c4f`. `pnpm build` 후 `@vscode/vsce@3.6.2 package --no-dependencies`로 작성했다. 패키지의 제품 코드는 기준 커밋에서 변경하지 않았다.
- 바인딩 YAML은 ignored `.workbench/perf-001-packet.yaml`에 보존했고 빈 digest 값으로 재계산한 SHA-256은 `4c05595f45e5ed0f2ee2160926484dea85a4d110ea340a15611741c91c9dfea0`이다.

최종 측정 도구 SHA-256은 코어 `runner.mjs` `728e1f44767399c6e820e17420b233e86b15b66e38eb909b9a75e8d55e6b4e3a`, `worker.mjs` `41f9c8b710bb13ec5c32997625b1e04680af4a01579f9e50df859451e1a904d6`, `reporter.mjs` `c495a0ebfcd5718ce93844aa066a1a2b0307d3d5c9cc0da3afcffe7a01ea505d`, Hover `run.mjs` `9b8d4ab493b274ef8c3b769558c8a0b75816b6317ac52c4f5147283ee815f0a5`, `extension-test.cjs` `5180952f77a55b9299f1c703bbe414a46cbc36b148d010c464384c6300a5138b`이다. 이는 최종 소스의 해시이며 전체 측정 이후의 보고 문구·중단 처리 보완이 반영돼 있다. 전체 Hover 시작 시점의 `extension-test.cjs` 해시는 아래에 별도 재구성 근거로 표시했다. 코어 측정의 `worker.mjs`는 전체 실측 동안 변경되지 않았다.

## 재실행

아래 명령은 이 워크트리의 루트에서 Node `v24.21.0`이 먼저 잡히는 `PATH`로 실행한다. 일반 셸 기본값 `v22.22.0`으로는 저장소의 `check:*` 버전 검사를 통과할 수 없다. 결과 경로와 fixture 경로는 재실행마다 새 이름으로 지정한다.

```sh
pnpm install --frozen-lockfile
pnpm build
cd packages/vscode
pnpm dlx @vscode/vsce@3.6.2 package --no-dependencies --out ../../.workbench/artifacts/codocs-perf-001.vsix
cd ../..
node tools/performance/runner.mjs --documents 1000 --startup-runs 10 --warmup-runs 100 --query-runs 1000 --propagation-runs 100 --output .github/workplans/COD-16-results/performance-observation-20260921/core-1000 --fixture-root .workbench/fixtures/perf-001-core-1000
node tools/extension-host/run.mjs --vsix .workbench/artifacts/codocs-perf-001.vsix --hover-performance --documents 1000 --warmup-runs 100 --query-runs 1000 --output .github/workplans/COD-16-results/performance-observation-20260921/hover-full
```

진단으로 코어 100문서의 1/1/1/1회와 Hover 20문서의 워밍업 1회·측정 1회를 실행했다. 이 축소 실행은 전체 Hover 작업량의 근거로 사용하지 않는다. 전체 Hover 실행은 기존 데이터 생성 조건인 seed `16018`, 문서 1,000개(조회 가능 980개, 무효 10개, 충돌 10개), 참조 10개, 긴 정의 10개를 사용한다.

현재 측정 구현은 코어 초기 준비·상세 조회 1/10/20개·잘못된 21개 요청·외부 파일 변경 반영·자원 관찰과 설치형 VS Code Hover다. 목록/필터/커서, 변경 계획 계산, MCP wire, 쓰기 전체, 삭제·이동·다중 클라이언트 자원 시나리오는 이 실행에서 측정하지 않았다. 현재 제공 범위 밖인 자동완성은 성능 판정 대상에서 제외한다. 코어 준비 경계는 독립 Node 실행 직전부터 실제 watcher 준비 확인까지이며, Hover 요청 경계는 `vscode.executeHoverProvider` 호출부터 Promise 완료까지다. 보고 IO와 메모리 표본 수집은 요청 시간 밖에 둔다.

자원 관찰의 코어 `process.memoryUsage()`와 이벤트 루프 값은 독립 측정 worker 프로세스에 속한다. Hover의 같은 값은 VS Code Extension Host 프로세스에 속하며 별도 language server나 VS Code 전체 프로세스 합계가 아니다.

실행 중 진행 파일 `hover-full-progress-live.json`은 기존 배열형 checkpoint의 완전한 snapshot만 별도 감시 프로세스로 원자 복사한다. 전체 실행이 시작된 뒤 도구의 내구성 기록 방식을 JSONL로 변경했으므로 이 전체 실행 자체는 시작 당시 배열 checkpoint를 사용한다. Hover 측정의 요청 선택·호출·정확성 판정 로직과 VSIX는 변경하지 않았다. 새 JSONL 방식은 별도 짧은 진단과 중단 검사로 검증한다.

전체 Hover 프로세스가 시작된 뒤 진행 파일 손상 감지, 30초 한국어 CLI 진행 표시, 단계별 이벤트 루프 구분 및 한국어 보고서 표시도 도구 소스에 추가했다. 실행 중인 VS Code 프로세스는 시작 당시 모듈을 메모리에 로드한 상태이므로 이번 전체 결과의 이벤트 루프 값은 준비·웜업·본 요청을 포함하는 **누적값**이며 단계별 값은 이후 진단 실행에서만 관찰한다. 전체 실행의 요청·정확성·지연 측정 경계는 변경되지 않았다.

실행 시작 당시의 `extension-test.cjs` 파일 SHA를 미리 캡처하지 못했다. 실행 후 변경한 두 부분(checkpoint 출력 형식과 readiness 기록의 `hoverCount`)을 현재 파일에서 역적용해 ignored `.workbench/extension-test-full-launch-reconstructed.cjs`를 만들었고, 재구성 SHA-256은 `521f7db3f94307016b294473a9fc7a64bb4d0a734df25771fe5360d7fbbff848`이다. 이는 실측 시점에 직접 기록한 해시가 아닌 재구성 근거로 취급한다.

전체 실행을 시작한 기존 `run.mjs`는 VS Code user-data/extensions를 macOS 임시 디렉터리 `/var/folders/.../c16-runtime-*`에 만들었다. 측정 fixture는 지정 워크트리 안에 있다. 한때 프로필도 워크트리 아래로 옮기는 수정을 검토했으나 이 워크트리의 `user-data` 경로만 136바이트여서 macOS Unix socket 경로 한계에 걸릴 수 있다. 짧은 OS 임시 경로를 유지하고 매 실행 `mkdtemp`로 분리하며 자신이 만든 디렉터리만 정리한다. 원래 체크아웃과 기존 사용자 프로필은 건드리지 않는다.

## 짧은 측정기 검증

- 2026-09-21 08:07 UTC(17:07 KST): Node `v24.21.0`에서 `node --test tools/performance/reporter.test.mjs tools/extension-host/progress.test.mjs` 실행, 4/4 통과, 약 0.49초. 느린 정확한 완료 표본, 오류·미완료 p95 제외, 한국어 부분 보고서, 잘린 JSONL 마지막 줄 복구 및 기존 배열 기록 읽기를 확인했다.
- 이후 같은 Node에서 `node --test tools/performance/progress.test.mjs` 실행, 1/1 통과, 약 0.58초. 동일 번호의 이전 완료 기록과 잘린 마지막 줄이 있어도 최신 대기 요청 및 이미 완료한 12초 표본을 구분해 복원했다.
- 외부 변경 준비 중 SIGINT 회귀를 추가해 같은 테스트를 다시 실행했고 2/2 통과, 약 0.38초였다. `node --test tools/extension-host/report.test.mjs`는 완료·정확성 실패·중단된 보고서의 한국어 제목, 상태, 첫 웜업 시간과 오류 이유를 검사해 1/1 통과, 약 0.43초였다.
- 같은 시각에 수정한 `runner.mjs`, `worker.mjs`, `reporter.mjs`, `run.mjs`, `extension-test.cjs`, `progress.mjs`를 `node --check`로 검사했고 모두 통과했다(약 0.57초).
- 실제 중단 신호·자식 종료, 설치형 기능 Host, 전체 저장소 검사는 전체 Hover 실측 종료 뒤 직렬 실행한다.
- 2026-09-21 08:49 UTC(17:49 KST): 중간 손상 기록을 조용히 버리지 않는 회귀, CLI 완료 수·대기 시간 요약, 단계별 이벤트 루프 보고 문구를 보강했다. Node 집중 테스트 `node --test tools/extension-host/progress.test.mjs tools/extension-host/report.test.mjs tools/performance/progress.test.mjs tools/performance/reporter.test.mjs`는 9/9 통과(약 0.44초), 수정 JavaScript `node --check` 모두 통과, 대상 파일 ESLint 통과, Prettier로 정렬 후 다시 확인했다. 전체 Hover 실측과 겹치지 않는 짧은 검사만 수행했다.
- Node 이벤트 루프 계측 시작 직후 `count=0`인데 `min=9223372036854776000`, `p95=511`인 sentinel을 확인했다. 새 코어·Hover 계측은 표본 수를 함께 기록하고 `count=0`인 단계의 지연 통계를 `null`로 남긴다. 한국어 보고서의 무표본 표시는 집중 보고서 테스트로 확인했고 실제 계측값은 전체 Hover 종료 후 짧은 진단에서 확인한다. 현재 전체 Hover 프로세스는 이 보정 전에 시작했으므로 시작 단계의 자원 기록과 구분한다.

## 실제 전체 Hover 측정

`hover-full.json`의 설치형 VS Code `1.136.1` 결과는 `completed`, 정확성 통과이며 문서 1,000개, 준비 1/1회, 워밍업 100/100회, 본 요청 1,000/1,000회가 모두 완료됐다. 정확성 실패와 미완료 요청은 각각 0개다. 첫 준비 확인은 **12,012.373ms**, 첫 워밍업은 **11,617.754ms**로, 기존 10초 제한이 있으면 첫 워밍업부터 중단됐을 실제 시간을 보존했다. 정확한 본 요청 1,000개의 중앙값은 **10,871.210ms**, p95는 **11,785.786ms**, 최댓값은 **13,220.678ms**다. 워밍업 중앙값은 11,704.151ms, 최댓값은 12,129.093ms다. 100ms 참고선 초과는 정확성 통과를 변경하지 않았다. 전체 측정이 로드한 당시 코드의 자원 관찰은 준비·워밍업·본 요청을 포함하는 Extension Host 누적값이며, 그 뒤 구현한 단계별 자원 기록은 `hover-progress-diagnostic`의 실제 진단에서 검증했다.

전체 Hover 실행의 출력 `hover-full.json` SHA-256은 `e6afb5e92c326d0629f5728c386059b946f8074054d67e70397a0d4a9cfa8884`이다. 실행 중 진행 snapshot은 `hover-full-progress-live.json`에 보존했다. VSIX SHA-256은 위의 `0b87...`이며 확장 번들 SHA-256은 `59d7275545238dbc7b7006a16ecdbc1467a9506bb862d00931f0c4a154d06955`, 서버 번들은 `3757ca4e63e20fedd80d64c5d3c59a7686bfc60c847d739db4fe44affdf87d0c`이다. 장시간 실행 뒤 더한 중단 분류·진행 내구성·보고서 수정은 원래 로드된 전체 측정 코드와 구분한다. 성능 명령은 Node `v24.21.0`으로 실행했다.

## 코어 측정

`core-1000/cod14-performance.json`은 독립 준비 10/10회, 유형별 워밍업 각 1,000/1,000회, 조회 1·10·20개 각 10,000/10,000회, 잘못된 21개 요청 10,000/10,000회, 외부 변경 1,000/1,000회를 기록한다. 상태는 완료, 정확성 통과, 기능 실패 0개다. 준비 전체 p95는 **611.126ms**, 첫 준비 확인 요청 p95는 **474.040ms**, 조회 20개 p95는 **0.065ms**, 변경 반영 p95는 **276.467ms**다. 변경 반영 최대 **576.732ms**는 500ms 참고선을 넘었지만 정확한 완료 결과로 보존했다. 실행은 약 4분 40초 걸렸다. 메모리·이벤트 루프는 독립 worker별로 준비 이전부터 단계 경계마다 기록했다.

비교 실행 `core-comparison/cod14-performance.json`은 문서 100·5,000·10,000개를 각각 독립 준비 **1회**, 유형별 워밍업 **100회**, 조회와 잘못된 21개 요청 **1,000회**, 외부 변경 **10회**로 실행했다. 세 규모 모두 완료·정확성 통과·기능 실패 0개다. 준비 p95(단일 완료 표본)는 각각 236.321/1,750.094/3,270.807ms, 조회 20개 p95는 0.057/0.082/0.076ms, 변경 반영 p95는 78.049/1,262.054/2,814.115ms다. 준비 1회 값을 반복 추정치로 해석하지 않는다. 참고 속도 목표는 명세대로 1,000개 문서 결과에만 비교한다. 비교 실행도 Node `v24.21.0`으로 수행했다.

```sh
node tools/performance/runner.mjs --documents 100,5000,10000 --startup-runs 1 --warmup-runs 100 --query-runs 1000 --propagation-runs 10 --output .github/workplans/COD-16-results/performance-observation-20260921/core-comparison --fixture-root .workbench/fixtures/perf-001-core-comparison
```

코어 JSON은 생성 후 저장소의 `format:check`에 맞게 Prettier로 **공백만** 정렬했다. 정렬 전후 7개 JSON 파일의 키·값을 정규화한 SHA-256 동등성을 검사했고 모두 일치했다. 최종 `core-1000/cod14-performance.json` SHA-256은 `1faaec989a02ffd7b3f03d37ab35d0b508a86690aecd87ddbdf1f7c496c81d7e`, `core-comparison/cod14-performance.json`은 `a176a288e80e4f4bf84b93a1f467d73c73a26662a07ba22921a3320277b06a8f`이다.

## 부분 복구와 기능 Host

초기 `hover-interrupt-diagnostic`은 SIGINT 뒤 가짜 `Canceled` 요청을 계속 시도하던 결함을 실제로 보여 준 실패 증거로 보존한다. 수정 후 `hover-sigint-diagnostic-v2`와 `hover-sigterm-diagnostic-v2`에서는 첫 워밍업 정상 완료 약 11.6초와 두 번째 취소 완료 시간을 따로 남겼고, 추가 요청을 시작하지 않았다. `hover-child-crash-diagnostic-v2`에서는 첫 웜업만 완료하고 두 번째 요청은 대기로 남겨 미완료 시간을 p95에 합성하지 않았다. 코어 `core-sigint-diagnostic`과 `core-child-crash-diagnostic`도 외부 변경 첫 완료 표본을 보존하고 두 번째 시도만 미완료로 남겼다. JSON/JSONL에는 완료 표본·현재 대기·실패 이유가 있고, `console.log`에는 측정기 출력이 있다. child crash 콘솔의 원본 바이트는 `hover-child-crash-diagnostic-v2.console.raw.gz`에도 보존했다.

실제 진단은 워크트리 루트에서 ignored `.workbench/signal-diagnostic.py`에 `sigint`, `sigterm`, `child-crash` 인자를 각각 전달해 실행했다(예: `python3 .workbench/signal-diagnostic.py sigint`). 첫 웜업 완료 뒤 둘째 워밍업의 시작 기록이 나타나면 부모 측정기에 SIGINT/SIGTERM 또는 그 부모가 시작한 VS Code 자식에 SIGKILL을 보낸다. 코어는 ignored `.workbench/core-signal-diagnostic.py`에 `sigint` 또는 `child-crash`를 전달했다(예: `python3 .workbench/core-signal-diagnostic.py child-crash`). 첫 외부 변경 완료 뒤 둘째 변경 시작 기록이 나타나면 부모 측정기에 SIGINT 또는 worker 자식에 SIGKILL을 보냈다. 스크립트는 실행한 워크트리의 `.workbench`에 남기고 커밋하지 않으며, 위의 JSON/JSONL이 기록된 결과 증거다.

설치형 일반 기능 Host는 동일 VSIX로 현재 VS Code `1.136.1`과 최소 지원 `1.95.0`에서 각각 종료 코드 0으로 통과했다. `functional-current.json`과 `functional-minimum.json`에 실제 버전, 재시작·충돌 복구·Hover/원문 열기 증거가 있다. 최소 버전 런타임은 이번 실행에서 task 전용 `.workbench/vscode/1.95.0`에 확보했고 원래 사용자 설치본은 변경하지 않았다.

```sh
node tools/extension-host/run.mjs --vsix .workbench/artifacts/codocs-perf-001.vsix --report .github/workplans/COD-16-results/performance-observation-20260921/functional-current.json
node tools/extension-host/run.mjs --vsix .workbench/artifacts/codocs-perf-001.vsix --code-version 1.95.0 --report .github/workplans/COD-16-results/performance-observation-20260921/functional-minimum.json
```

## 저장소 검증과 통합 주의

Node `v24.21.0`, pnpm `10.34.5`에서 `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test:run`, `pnpm check:development`, `pnpm check:build`를 각각 독립 실행했다. `test:run`은 27파일·675테스트, 개발 검사는 2파일·81테스트, 빌드 검사는 1파일·32테스트가 통과했다. 첫 `format:check` 실패는 새 생성 증거의 공백 형식과 테스트 파일의 형식 때문이었고 포맷 정렬 뒤 재실행이 통과했다. 검사별 실제 종료 코드, 초 단위 소요 시간, 시작 시각, 원본 로그는 `checks/summary.json`과 같은 디렉터리의 로그에 있다. 포맷 정렬 과정에서 JSDoc 위치가 lint 규칙과 충돌한 테스트 콜백은 이름 있는 함수로 바로잡았고 재검증했다. 최종 `lint`, `format:check`, 집중 테스트와 수정 JavaScript의 `node --check`도 통과했다.

원래 `main`은 다른 작업의 2026-09-21 17:06 KST pull로 `f3e8eb5f270fbcdb6c962eb06df0c299c2f93958`에 갱신됐다. 이 작업은 지정 기준 `1c07daf547de71fe143484a347db5a3108bce3f4`에서만 수행했으며 원래 체크아웃을 수정하거나 새 main을 합치지 않았다. 후속 통합 시 새 main의 자동완성 제공 범위 제외 결정을 유지해야 한다.
