# COD-34 — PR CI를 GitHub Actions 기능 중심으로 교체

현재 PR CI는 job 결과 집계, PR 결과 댓글, OS 간 후보 검증을 tools/ci와 tools/test/runtime의 자체 스크립트가 GitHub API를 직접 호출해 재구성한다. 워크플로의 job 표시 이름을 스크립트에 복제하고 이를 GitHub 응답 mock 테스트로 검사하는 구조라, GitHub 동작과 어긋나면 CI에서만 문제가 드러난다. 같은 run에서 패키징이 3번, 설치 검증이 4번 중복 실행되고 있다.

합의한 기준은 .codocs의 「개발 환경」「배포」에 기록했다(PR #41). CI의 흐름 제어는 GitHub Actions가, 스크립트는 제품 빌드·검증만 담당한다.

h2. 범위

새 ci.yml

* 트리거는 PR opened·synchronize·reopened·ready_for_review와 수동 실행만 받는다. Draft면 job을 생략하고, 같은 PR의 새 push는 concurrency로 이전 실행을 취소한다.
* static(Ubuntu): typecheck, lint, prettier --check를 step별로 실행한다.
* pack: release:pack을 한 번 실행해 tgz·VSIX를 artifact로 올린다.
* Windows·macOS matrix: build, pnpm test, release:verify, test:vscode를 실행한다. VS Code 검사 버전은 workflow에 고정한다.
* required-ci: needs 결과만으로 집계한다.
* 실패하면 실패한 job·step과 실행 링크를 PR 댓글 하나로 남기고, 이후 성공하면 그 댓글을 "해결됨"으로 수정한다.

공통 준비

* Node·pnpm 설정과 의존성 설치를 composite action으로 공유한다.

삭제

* .github/workflows/test.yml, ci-report.yml
* tools/ci/pr-ci.mjs, pr-report.mjs, ui-evidence.mjs와 테스트
* tools/test/runtime/release-ci.mjs와 테스트

임시 조치

* tools/ci/release-flow.mjs가 가져다 쓰는 assertReleaseProtection을 release-flow.mjs로 옮긴다. 배포 플로우 교체 작업에서 함께 삭제된다.

이 작업이 바꾼 부분의 tools/README.md 등 문서를 함께 갱신한다.

h2. 진행 기준

* develop 기준 브랜치에서 main으로 PR을 보내고 merge commit으로 머지한다. COD-33을 포함한 develop 내용이 이때 main에 들어간다.
* 머지 전에 CODOCS_RELEASE_ENABLED를 false로 바꿔 기존 배포 워크플로를 멈춘다.
* 머지 후 develop 대상 draft PR #36, #29, #27의 base를 main으로 바꾼다.

h2. 완료 기준

* ready PR에서 새 CI가 통과하고, Draft PR에서는 job이 생략된다.
* 실제 PR에서 실패 댓글 작성과 이후 성공 시 "해결됨" 수정이 동작한다.
* pnpm test가 통과한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-34
