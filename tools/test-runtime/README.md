# 공유 테스트 실행기

- `prepareVSCode({cacheRoot, version, platform, arch})`: 고정 `vscodeVersion` (1.100.0)을 공식 `@vscode/test-electron`로 다운로드한다. 버전·OS·arch 디렉터리의 동시 다운로드 잠금과 재사용 시 전체 파일 내용 SHA-256을 검사한다. 중단된 다운로드는 영수증이 없는 해당 버전 디렉터리만 다시 준비한다. 죽은 프로세스의 잠금만 회수한다. 살아 있는 소유자 또는 소유자 정보가 불완전한 잠금은 제한 시간 후 명시적으로 실패한다.
- `runIsolated({executable, args, cwd, output, timeout, signal})`: 실제 프로세스와 자식을 전용 Windows 데스크톱·Job Object에 넣고 `reason` (`exit`, `timeout`, `cancelled`, `preparation`), `exitCode`, `residualProcesses`, `samples`, `windows`, `desktopClosed`를 반환한다. 기능과 성능의 실행 진입점을 동일하게 감쌀 수 있다. native 준비·관측·정리 실패는 throw하며 원문 보고서와 감독기 로그를 보존한다.
- `assertSupportedIsolation()`: 안전한 어댑터가 없는 OS는 GUI 실행 전에 실패한다. 현재 macOS는 이 경로다.

`runIsolated`는 Node 실행기까지 별도 데스크톱에서 시작할 수 있어 빌드·fixture 준비도 같은 경계에 포함한다. `CreateProcessW`의 suspended 생성→Job 할당→재개 순서로 자식의 탈출 구간을 막는다. 정상 종료에도 남은 자식을 Job 단위로 종료하고 active process 수가 0이 된 뒤 desktop handle을 닫는다. 감독기 비정상 종료에는 kill-on-job-close가 적용된다. 취소는 AbortSignal과 취소 파일로 전달하고 부모 사망도 감독한다.

25ms 외부 foreground/input desktop 표본은 시작 전부터 준비·실행·정리까지 기록한다. 사용자 자신의 작업 창 이동은 실패로 간주하지 않으며 시험 데스크톱·시험 창이 외부 입력/전경에 나타나면 실패한다. 폴링 사이의 순간 전환을 모두 관측했다고 주장하지 않는다. 실행 중 입력 데스크톱을 바꾸는 API, 창을 뒤로 보내기, 입력 주입, 포커스 복원은 사용하지 않는다.

기능 진입점은 `tools/vscode-tests/run.mjs`, 실제 공식 테스트 호출은 `host.mjs`, 확장 호스트 내부 진입점은 `suite.cjs`다. 새 기능은 독립 `scenarios` 항목과 대응 문서에 추가한다. `context.cjs`의 도우미는 API 준비·반복 조회를 담당하며 핵심 assertion은 사례 본문에 둔다. 성능 실행기는 같은 격리 API로 자기 entrypoint를 실행하고 자신의 측정 시작·완료 경계를 유지한다.

기능 결과 `functional.json`은 실제 VS Code·Node 버전과 각 사례의 성공/실패를 기록한다. 외부 `isolation.json`은 내부 `window.state.focused`와 독립된 관측이다. `result.json`은 HEAD와 tracked diff, 실행·정리 결과를 담는다. 확정 SHA를 검증하려면 clean candidate에서 명령을 실행하고 그 디렉터리 전체를 증거로 전달한다.
