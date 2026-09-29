# COD-36 — package.json 스크립트와 커밋 훅 정리

루트 package.json에 스크립트가 20개 있다. 상당수는 CI 전용 조합(check:static, check:runtime:os, test:release-management, test:os)이거나 사용처가 없다(bundle). 또 CI의 각 OS job에서 build-checks.test.ts와 release:verify가 같은 배포 파일 검사를 두 번 실행한다.

빠른 검사는 커밋 훅이, 전체 검사는 PR CI가 맡으므로 여러 검사를 묶는 check 스크립트도 필요 없다. 합의한 기준은 .codocs의 「개발 환경」「배포」에 기록했다(PR #41).

h2. 범위

package.json 스크립트 20개 → 10개

- 유지: prepare, build, typecheck, lint, format, test, test:vscode, changeset, release:pack, release:verify
- test는 test:unit과 test:node의 내용을 직접 포함한다. watch는 pnpm exec vitest를 사용한다.
- 삭제: check, check:static, check:runtime, check:runtime:os, test:unit, test:node, test:os, test:release-management, bundle, release:version

커밋 훅

- .husky/pre-commit을 lint-staged → pnpm typecheck → pnpm test 순서로 바꾼다.
- 추가 전후 커밋 소요 시간을 측정해 PR에 기록한다.

배포 파일 검사

- release:pack은 출력을 .workbench/release/로 고정하고 실행 때마다 비운 뒤 co-documentation tgz와 codocs VSIX만 남긴다. 임시 작업 폴더는 .workbench/release-staging/에 두고 끝나면 지운다.
- release:verify는 인자가 없으면 .workbench/release/의 tgz와 VSIX를 하나씩 골라 검사한다. 개수가 맞지 않으면 개수를 밝히고 실패하며, 두 경로를 직접 주는 방식도 유지한다.
- build-checks.test.ts와 vitest.checks.config.mjs는 release:verify가 이미 같은 검사를 하므로 옮기지 않고 삭제한다. tools/build/check/README.md도 함께 삭제해 tools/build/check/ 폴더를 없앤다.

CI 명령

- ci.yml: static job에서 test:release-management 단계를 없애고, pack job은 release:pack 결과인 .workbench/release/를 artifact(release-<run_id>-<run_attempt>)로 올린다. Windows·macOS job은 그 artifact를 같은 위치로 내려받아 build → pnpm test → release:verify → test:vscode 순서로 실행한다.
- release.yml: candidate 폴더 탐색을 없애고 release:pack 뒤에 인자 없는 release:verify를 실행한다. collect 단계는 게시와 Release 단계가 쓸 파일 경로 출력과 .sha256 생성만 맡는다.

그 밖

- 각 패키지 package.json의 typecheck·build 스크립트 5개는 사용처가 없어 삭제한다.
- 문서 범위는 삭제된 스크립트와 파일을 언급하는 tools/README.md와 Codocs 가이드의 배포 파일 검사 링크다. packages/vscode/src/integration 문서는 이 작업의 범위가 아니다.

h2. 선행

- COD-34와 COD-35의 develop 머지. COD-35가 릴리스 관리 테스트를 지운 뒤여야 OS job의 pnpm test가 그 테스트를 Windows에서 실행하지 않는다.

h2. 진행 기준

- develop을 대상으로 PR을 보내고 merge commit으로 머지한다.
- 이 작업까지 develop에 머지한 뒤 develop → main PR 하나(merge commit)로 COD-34~36을 main에 옮긴다.

h2. 완료 기준

- 루트 스크립트가 위 10개이고, 문서에 삭제된 스크립트 언급이 남아 있지 않다.
- 커밋 훅이 typecheck를 실행하고 통과한다.
- CI가 새 스크립트 이름으로 통과한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-36
