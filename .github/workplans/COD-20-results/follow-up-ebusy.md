# 후속 등록 준비 — VS Code 1.139.0 잠금 파일 감시 오류

- 상태: **외부 이슈/PR 등록 대기**. 이번 통합 작업의 전달 정책은 로컬 보고서와 커밋까지이며, 제품 수정이나 게시를 포함하지 않는다.
- 재현 소스: `e720db92b4430f3d6fee59bfbf8555c8cd445ef9`의 동일한 26개 VSIX payload 파일. [payload 대조 원본](vsix-payload-manifest.json).
- 실행: Windows에서 Node 24.21.0, pnpm 10.34.5로 `pnpm test:vscode --mode functional --vscode-version 1.139.0`.
- 자극: `partial/.codocs/unreadable.yaml`을 `read-denial.cjs` fixture가 읽기 잠금한 상태에서 부분 탐색과 후속 복구 검사를 실행한다.
- 예상: 잠긴 문서를 부분 탐색으로 처리하고, 이후 문서의 Hover·참조·서버 재시작·진단 검사가 정상 복구된다.
- 실제: `EBUSY: resource busy or locked, watch '.../partial/.codocs/unreadable.yaml'`가 나타나 파일 감시가 중단된다. `partial-scan`, `unconfirmed-reference`, `unexpected-server-exit`, `restart-budget-recovery`, `diagnostics-recheck-recovery`, `rapid-edit-restart-diagnostics`의 6개 검사가 실패한다. 같은 최종 소스의 1.100.0은 51/51 통과했고 1.139.0은 45/51 통과했다.
- 증거: [1.139.0 기능 원본](raw/1790219067924-10968/functional.json.raw), [프로세스 로그](raw/1790219067924-10968/process.log), [1.100.0 기능 원본](raw/1790218927821-7256/functional.json.raw). 1.139.0의 앞선 두 진단 실행에서도 동일한 6개 ID가 실패했다.
- 다음 작업: 잠긴 파일에 대한 Windows watcher 등록 실패와 언어 서버 복구 경로를 제품 소유자가 별도 작업에서 조사·수정하고, 두 버전 설치 VSIX 기능 검사를 재실행한다. 이번 대표 성능 smoke가 통과한 사실로 이 기능 실패나 최신 버전의 지원 검증을 통과 처리하지 않는다.

로컬 환경의 별도 검증 장애도 남아 있다. 현재 Windows 호스트는 실제 symlink 생성 시 `EPERM`을 반환해 `pnpm check`의 45개 기존 테스트와 별도 build-consumer 검사 1개가 실패한다. [집계 로그](raw/checks/check-intent-3.log)와 [build-consumer 로그](raw/checks/vitest-checks-intent-3.log)를 보존했다. Developer Mode나 권한 설정은 변경하지 않았으며 링크를 mock/junction으로 대체하지 않았다. 이 장애는 제품 기능 실패와 구분한다.
