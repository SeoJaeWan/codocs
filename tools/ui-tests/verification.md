# 실제 VS Code UI 테스트

Playwright로 설치된 Codocs VSIX의 화면과 입력 경로를 검증한다.
일반 Vitest 및 Extension Host 테스트를 대체하지 않는다.

## 실행

저장소의 Node·pnpm 버전으로 의존성을 설치한 뒤 실제 GUI 실행 파일과 검사할 VSIX를 지정한다.
macOS는 .app, Windows는 Code.exe, Linux는 resources/app 옆의 GUI 실행 파일을 사용한다.
PATH의 code 셸 wrapper가 아니라 설치 위치를 명시한다.

```sh
pnpm test:ui --vsix /absolute/path/codocs.vsix \
  --code-path "/absolute/path/VS Code 1.95.0/Visual Studio Code.app" \
  --code-path "/absolute/path/VS Code comparison/Visual Studio Code.app"
```

앱 다운로드·VSIX 빌드는 이 명령의 범위가 아니다. 지정한 산출물의 해시와 앱 버전을 기록한다.
Playwright용 별도 Chromium 다운로드는 필요 없다. 실제 VS Code의 Electron을 사용한다.
Linux에서는 GUI 세션 또는 가상 디스플레이가 필요하다. OS 보안 설정이나 Electron fuse를 변경하지 않는다.

선택 실행은 `-- --grep '검색어'`, 반복 검증은 `-- --repeat-each=2`를 덧붙인다.
기본 실행은 전체 테스트 재시도 없이 한 worker로 직렬 실행한다.
최소 지원 버전과 비교 버전은 각각 별도 project로 집계한다.

실행기·백그라운드 복구·실패 증거 검사는 `node --test tools/ui-tests/*.test.mjs`로 수행한다.
이 검사의 Linux·Windows 경로 fixture 통과는 해당 OS에서의 실제 UI 통과를 뜻하지 않는다.

## 격리와 관측

각 테스트는 짧은 OS 임시 경로에 독립 workspace·프로필·확장 설치 디렉터리를 만들고 종료 후 정리한다.
사용자 프로필·열린 편집 내용·일반 설치 확장에는 접근하지 않는다.
VSIX 설치는 worker별로 한 번 수행하고 테스트별 설치 디렉터리에 복사한다.
테스트 창은 생성 시 투명화하고 OS 포커스·마우스 입력을 차단해 백그라운드에서 실행한다.
첫 창 준비 후 숨김 상태를 재확인하고 이후 생성되는 창에도 적용한다. 테스트 창을 전면으로 가져오지 않는다.
Playwright의 페이지 입력으로 조작하므로 일반 데스크톱 작업을 병행할 수 있다.
현재 백그라운드 동작을 실제 검증한 OS는 macOS다. 다른 OS의 창 API·투명도 지원은 별도 검증이 필요하며 경로 검사 통과가 이를 보장하지 않는다.
초기화의 특정 Promise 수거 오류는 적용 상태를 먼저 읽고 미완료일 때만 중복 없이 복구한다.
복구는 최대 3회·5초로 제한하며 다른 오류를 무시하거나 전체 UI 테스트를 재실행하지 않는다.
창의 네이티브 visible 상태와 불투명 화면 노출·포커스 관측치를 구분해 기록한다.

호버는 실제 마우스 이동, 링크는 렌더링된 링크 클릭, 본문 이동은 Cmd/Ctrl+클릭으로 수행한다.
파일 선택과 미저장 편집도 UI 입력을 사용한다. 외부 파일 변경은 watcher 입력을 만들기 위한 fixture 조작이다.
observer는 VS Code API로 활성 URI·선택·미저장 원문·탭·진단을 읽기만 한다.
Hover provider, 정의 이동 provider, codocs.openSource를 직접 호출해 UI 행동을 대신하지 않는다.
준비용 sentinel의 호버를 제한 시간 안에 확인한 뒤 각 테스트를 시작한다.
호버를 다시 여는 제한된 polling은 준비·변경 반영을 기다리는 것이며 이미 열린 호버의 즉시 갱신을 요구하지 않는다.
남아 있는 링크의 본문 변경 사례는 LSP trace에서 codocs/snapshotChanged 완료 통지를 읽어 기다린다.
이때 새 Hover 요청이나 강제 재스캔 명령으로 이전 링크를 교체하지 않는다.
완료 관측 뒤의 이동 성공과 반영 도중 클릭의 안전성은 별도 사례다.
아직 대상을 확인할 수 없는 클릭이 열리지 않는 것을 완료 관측 뒤의 정상 이동 성공으로 집계하지 않는다.

## 결과와 범위

.workbench/ui-tests/run-*에 JSON/HTML 결과와 환경·VSIX 해시를 남긴다.
성공에는 스크린샷·trace 파일을 남기지 않는다. 실패할 때만 가능한 화면·Playwright trace를 저장한다.
각 테스트에는 편집기 관측·VS Code 로그·background.json의 초기화/복구/창 상태를 남긴다.
준비·정리 단계 오류도 직접 보존하며 캡처 실패가 원래 오류를 덮지 않는다.
창 생성 전 실패에는 화면이 없으므로 오류·단계·초기화 기록·수집 가능한 프로세스 로그를 남긴다.
앱 종료 후에만 발생한 정리 오류는 화면을 새로 만들 수 없으며 정리 오류 기록으로 구분한다.
execution-phase는 environment(기동·초기 준비), test(본문), teardown(최종 상태 검사·정리)을 구분한다.
symlink를 만들 수 없는 OS에서는 부분 관측 사례만 명시적인 capability 사유와 함께 skip한다.

대표 UI 범위는 코드 호버 정보·보조/직접/역참조 링크, 현재/이전 ID와 오류·부분 관측,
YAML definition/examples·메타데이터 제외·반복 위치·단일/복수 후보,
새 조회·오래된 링크·이동/삭제·탭 재사용과 미저장 보존,
폐기 참조/없는 참조/중복 이전 ID 진단, 중첩 workspace 및 TypeScript 정의 이동이다.

모든 파싱 조합·UTF-16 좌표·취소/경쟁 상태는 인접 단위·Extension Host 테스트의 책임이다.
본문 편집으로 이미 사라진 호버의 옛 토큰을 인위적으로 다시 클릭시키는 검사는 UI 경로로 만들지 않는다.
실행하지 않은 OS·버전·시나리오를 성공으로 보고하지 않는다.
