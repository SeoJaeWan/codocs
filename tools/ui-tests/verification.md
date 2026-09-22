# 공식 VS Code 검사와 Mac 인수

`pnpm test:ui`는 `pnpm test:vscode`와 같은 공식 Extension Host 기능 검사를 실행한다. VSIX나 수동 VS Code 설치 경로는 필요하지 않다. [기능 대응표](../vscode-tests/coverage.md), [기존 화면 인수 잔여 항목](../vscode-tests/legacy-coverage.md), [격리 계약](../test-runtime/README.md)을 함께 확인한다. API 기능 통과를 화면 렌더링이나 마우스 제스처 통과로 보고하지 않는다. 기존 12개 화면·제어 상태 인수 묶음은 아직 미검증이다.

## Mac에서 같은 변경본 받기

전달 메시지의 **40자리 delivery SHA**를 사용한다. 아래 `<전달받은-40자리-SHA>`는 실제 해시로 바꿔야 한다. 브랜치 최신 상태나 이전 Windows 시험 SHA로 대체하지 않는다. 작업 중인 저장소와 분리한 새 디렉터리에서 받는다.

```sh
git clone https://github.com/SeoJaeWan/codocs.git codocs-cod19-mac
cd codocs-cod19-mac
DELIVERY_SHA='<전달받은-40자리-SHA>'
git checkout --detach "$DELIVERY_SHA"
test "$(git rev-parse HEAD)" = "$DELIVERY_SHA"
```

Node **24.21.0**과 pnpm **10.34.5**를 활성화한 뒤 실행한다. `.node-version`과 `packageManager`가 기준이다. 새 checkout의 로그·fixture·프로필만 사용한다. 다음 명령은 macOS의 zsh/bash 터미널용이다. `pipefail`은 `tee`가 검사 실패를 가리지 않도록 한다. 각 `.exit`의 `0`만 성공이다.

```sh
set -o pipefail
EVIDENCE=".workbench/mac-acceptance/$DELIVERY_SHA"
mkdir -p "$EVIDENCE"
{
  git rev-parse HEAD
  git status --porcelain
  sw_vers
  uname -m
  sysctl -n machdep.cpu.brand_string
  sysctl -n hw.memsize
  node --version
  pnpm --version
} > "$EVIDENCE/environment.txt" 2>&1
pnpm install --frozen-lockfile 2>&1 | tee "$EVIDENCE/install.log"
echo $? > "$EVIDENCE/install.exit"
pnpm test:run 2>&1 | tee "$EVIDENCE/functional.log"
echo $? > "$EVIDENCE/functional.exit"
pnpm typecheck 2>&1 | tee "$EVIDENCE/typecheck.log"
echo $? > "$EVIDENCE/typecheck.exit"
pnpm build 2>&1 | tee "$EVIDENCE/build.log"
echo $? > "$EVIDENCE/build.exit"
```

설치 실패 시 뒤 검사의 결과를 신뢰하지 않고 준비 실패 원인을 함께 전달한다. 기능 검사에는 OS 사유 skip을 허용하지 않는다. 실제 OS 환경 계약은 CI에서만 실행하며 로컬에서 `CI=true`를 설정해 CI 결과를 만들지 않는다.

## 코어 성능

빌드 성공 뒤 다른 측정과 겹치지 않게 다음 명령을 실행한다. Windows와 같은 seed·문서 수·반복 횟수다. 장비 차이는 결과에 남기며 시간 목표 초과만으로 실패 판정하지 않는다. 중단·자식 실패 시에도 JSONL과 부분 JSON/Markdown 보고서를 보존한다.

```sh
pnpm performance:cod14 --documents 1000 --seed cod14-fixed-seed-v1 --startup-runs 10 --warmup-runs 100 --query-runs 1000 --propagation-runs 100 --output "$EVIDENCE/core-performance" --fixture-root ".workbench/mac-performance-fixtures/$DELIVERY_SHA" 2>&1 | tee "$EVIDENCE/core-performance.log"
echo $? > "$EVIDENCE/core-performance.exit"
```

`core-performance/cod14-performance.json`, `cod14-performance.md`, 진행 JSONL이 원시 결과다. 초기 준비·상세 1/10/20·외부 변경 반영을 검사한다. 목록·필터·커서·MCP 통신·쓰기 전체 성능은 이 결과에 포함되지 않는다.

## 현재 Mac의 실제 VS Code 제한

**Mac GUI 격리 어댑터는 미구현이다.** 단순히 아직 실행하지 않은 상태가 아니다. 사용자 GUI 세션과 분리된 실행 방식 및 외부 화면·포커스 관측을 구현하기 전에는 `pnpm test:vscode`, 실제 Hover 성능, 새 커밋 훅이 준비 실패한다. 일반 창을 열거나 포커스를 되돌리는 방식, 검사 skip, 훅 우회를 합격으로 인정하지 않는다. 향후 별도 GUI 세션/VM 선택과 구현은 [Mac 격리 검토](../test-runtime/macos-isolation.md)를 따른다.

현재 명령의 준비 실패 증거는 안전하게 수집할 수 있다. 창을 열기 전에 실패하며 이를 Mac 기능 통과로 기록하지 않는다.

```sh
pnpm test:vscode 2>&1 | tee "$EVIDENCE/vscode.log"
echo $? > "$EVIDENCE/vscode.exit"
```

`.workbench/vscode-tests/<실행 ID>/result.json`의 platform·phase·error·passed를 전달한다. 향후 어댑터 구현 뒤에는 **새로운 동일 SHA**에서 Windows와 Mac 모두 재검사하고 `functional.json`, `isolation.json`, VS Code 로그를 수집한다. 기능 결과와 외부 foreground/input desktop 또는 Mac 동등 관측, 창 노출 없음, 잔여 프로세스 0, 정리 완료를 각각 확인해야 한다. 현재 Mac에서는 이 포커스 증거가 존재하지 않는다.

실제 설치 VS Code Hover 성능의 빌드·VSIX 패키징·명령은 [성능 재현 안내](../performance/README.md)를 따른다. 현재 Mac에서는 같은 GUI 격리 미구현으로 미측정이며 코어 성능으로 대체하지 않는다.

## 결과 전달과 판정

`environment.txt`, 각 `.log`/`.exit`, 코어 성능 JSON/Markdown/JSONL, VS Code 결과 디렉터리를 전달한다. 작업 후 `git status --porcelain`도 저장해 시험한 변경본이 delivery SHA와 달라졌는지 확인한다. 로컬 파일에 개인정보가 추가됐다면 공유 전에 검토한다.

Windows 로컬 결과, 사용자 Mac 로컬 결과, CI Windows 계약, CI macOS 계약을 서로 다른 행으로 기록한다. CI 아티팩트는 `native-<OS>-<SHA>`이며 `execution.json`의 실제 SHA와 workflow 이벤트 SHA가 같아야 한다. 같은 SHA에서 두 OS 계약이 모두 통과하기 전까지 OS 환경 검증 완료가 아니다. Mac/CI 미실행과 Mac GUI 미구현은 그대로 남긴다.
