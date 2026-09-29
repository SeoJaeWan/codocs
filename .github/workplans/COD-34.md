# COD-34 — PR CI를 GitHub Actions 기능 중심으로 교체

현재 PR CI는 job 결과 집계, PR 결과 댓글, OS 간 후보 검증을 tools/ci와 tools/test/runtime의 자체 스크립트가 GitHub API를 직접 호출해 재구성한다. 워크플로의 job 표시 이름을 스크립트에 복제하고 이를 GitHub 응답 mock 테스트로 검사하는 구조라, GitHub 동작과 어긋나면 CI에서만 문제가 드러난다. 같은 run에서 패키징이 3번, 설치 검증이 4번 중복 실행되고 있다.

합의한 기준은 .codocs의 「개발 환경」「배포」에 기록했다(PR #41). CI의 흐름 제어는 GitHub Actions가, 스크립트는 제품 빌드·검증만 담당한다.

h2. 범위

새 ci.yml

- 워크플로 이름은 "CI"로 한다. 기본 브랜치(main)의 ci-report.yml이 "Tests" 워크플로 완료에 반응하므로, develop → main 머지 전까지 이름이 겹치지 않게 한다.
- 트리거는 PR opened·synchronize·reopened·ready_for_review와 수동 실행만 받는다. Draft면 job을 생략하고, 같은 PR의 새 push는 concurrency로 이전 실행을 취소한다.
- static(Ubuntu): typecheck, lint, prettier --check를 step별로 실행한다. 릴리스 관리 테스트(pnpm test:release-management)는 COD-35에서 삭제될 때까지 이 job에서 실행한다.
- pack: release:pack을 한 번 실행해 tgz·VSIX만 artifact로 올린다.
- Windows·macOS matrix: 지금과 같은 검사 명령을 실행한다. pnpm check:runtime:os, 전달받은 tgz·VSIX의 release:verify, test:vscode 순서다. VS Code 검사 버전은 1.139.1로 workflow에 고정한다. UI 실패 시 로그·화면 artifact 업로드는 유지한다.
- required-ci: needs 결과만으로 집계한다. develop·main 보호 규칙이 요구하는 이름이므로 job 이름을 required-ci로 유지한다.
- 실패하면 실패한 job·step과 실행 링크를 PR 댓글 하나로 남기고, 이후 성공하면 그 댓글을 "해결됨"으로 수정한다. 기존 결과 댓글과 다른 표식을 사용하고, 쓰기 권한이 없는 fork PR에서는 댓글 단계를 건너뛴다.

공통 준비

- Node·pnpm 설정과 의존성 설치를 composite action으로 공유한다.

삭제

- .github/workflows/test.yml, ci-report.yml
- tools/ci/pr-ci.mjs, pr-report.mjs, ui-evidence.mjs와 테스트
- tools/test/runtime/release-ci.mjs와 테스트

임시 조치

- tools/ci/release-flow.mjs가 가져다 쓰는 assertReleaseProtection을 release-flow.mjs로 옮긴다. COD-35에서 함께 삭제된다.

문서

- tools/README.md, tools/test/runtime/README.md, tools/build/check/README.md, packages/vscode/src/integration/verification.md에서 삭제한 스크립트·검증 설명을 갱신한다.

이 작업에서 하지 않는 것

- OS job 검사 명령의 정리와 build-checks 중복 제거는 COD-36에서 한다.
- 릴리스 관리 코드·테스트 삭제는 COD-35에서 한다.

h2. 진행 기준

- develop을 대상으로 PR을 보내고 merge commit으로 머지한다.
- COD-34 → COD-35 → COD-36 순서로 develop에 머지한 뒤, develop → main PR 하나(merge commit)로 main에 옮긴다. COD-33도 이때 main에 들어간다.
- 기존 배포 워크플로를 멈추기 위해 CODOCS_RELEASE_ENABLED를 false로 바꿨다(2026-09-29).

h2. 완료 기준

- ready PR에서 새 CI가 통과하고, Draft PR에서는 job이 생략된다.
- 실제 PR에서 실패 댓글 작성과 이후 성공 시 "해결됨" 수정이 동작한다.
- pnpm test가 통과한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-34
