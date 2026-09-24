# 후속 조사 — VS Code 1.139.0 잠금 파일 조건의 기능 실패

- 상태: **PR #17에 기록, 원인 조사·수정·재검증 대기**. 사용자는 현재 측정 실행기 구현의 완료와 병합을 승인했다. 별도 수정 이슈나 PR을 이미 만들었다고 표시하지 않는다.
- 재현 소스: `e720db92b4430f3d6fee59bfbf8555c8cd445ef9`의 동일한 26개 VSIX payload 파일. [payload 대조](vsix-payload-manifest.json).
- 실행: Windows에서 Node 24.21.0, pnpm 10.34.5로 `pnpm test:vscode --mode functional --vscode-version 1.139.0`.
- 조건: `partial/.codocs/unreadable.yaml`을 `read-denial.cjs` fixture가 읽기 잠금한 상태에서 부분 탐색과 후속 복구 검사를 실행한다.
- 기대: 잠긴 문서를 부분 탐색으로 처리하고, 이후 문서의 Hover·참조·서버 재시작·진단 검사가 정상 복구된다.
- 관측: `EBUSY: resource busy or locked, watch '.../partial/.codocs/unreadable.yaml'`가 나타난다. `partial-scan`, `unconfirmed-reference`, `unexpected-server-exit`, `restart-budget-recovery`, `diagnostics-recheck-recovery`, `rapid-edit-restart-diagnostics` 6개 검사가 실패한다. 1.139.0은 45/51, 같은 최종 소스의 1.100.0은 51/51이었다. 일반 Hover·원문 링크 검사는 통과했다.
- 증거: [1.139.0 기능 원본](raw/1790219067924-10968/functional.json.raw), [프로세스 로그](raw/1790219067924-10968/process.log), [1.100.0 기능 원본](raw/1790218927821-7256/functional.json.raw). 1.139.0의 앞선 두 진단 실행에서도 같은 실패 ID가 관측됐다.

## 분리할 원인과 다음 검사

1. 변경 전 기준 소스와 같은 1.139.0 버전·Windows 잠금 fixture를 실행해 이번 변경의 회귀 여부를 확인한다. 소스·VSIX·입력과 검사 결과를 각각 보존한다.
2. fixture의 읽기 잠금과 watcher 등록 실패의 관계를 최소 재현으로 분리하고, 잠금이 없는 동일 조건과 비교한다. 제품의 감시·복구 처리와 VS Code/Node 런타임의 동작을 구분한다.
3. 여섯 검사 각각의 첫 실패와 상태 전이를 추적한다. 모두 하나의 `EBUSY` 연쇄라고 가정하지 않는다. 확인된 원인에 맞춰 별도 수정 작업을 진행하고 1.100.0·1.139.0 설치 VSIX 기능 검사를 다시 실행한다.

원인은 아직 확정되지 않았다. 잠금 fixture, 제품·런타임 호환성, 변경 회귀가 모두 가능한 가설이며, 일반 Hover·링크의 근본 결함이라고 판정하지 않는다. 대표 성능 smoke의 통과는 이 조건의 기능 실패나 최신 버전 지원 검증을 통과로 바꾸지 않는다.

별도 검증 장애는 현재 Windows 호스트의 실제 symlink 생성 `EPERM`이다. `pnpm check`의 테스트 45건과 별도 build-consumer 검사 1건이 실패했다. [집계 로그](raw/checks/check-intent-3.log)와 [build-consumer 로그](raw/checks/vitest-checks-intent-3.log)를 보존했다. symlink를 만들 수 있는 환경에서 같은 소스의 전체 검사를 재실행해야 한다. 현재 호스트 설정이나 CI 요구 조건은 변경하지 않았다.
