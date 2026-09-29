# COD-36 — package.json 스크립트와 커밋 훅 정리

루트 package.json에 스크립트가 20개 있다. 상당수는 CI 전용 조합(check:static, check:runtime:os, test:release-management, test:os)이거나 사용처가 없다(bundle). 또 CI의 각 OS job에서 build-checks.test.ts와 release:verify가 같은 배포 파일 검사를 두 번 실행한다.

빠른 검사는 커밋 훅이, 전체 검사는 PR CI가 맡으므로 여러 검사를 묶는 check 스크립트도 필요 없다. 합의한 기준은 .codocs의 「개발 환경」「배포」에 기록했다(PR #41).

h2. 범위

package.json 스크립트 20개 → 10개

* 유지: prepare, build, typecheck, lint, format, test, test:vscode, changeset, release:pack, release:verify
* test는 test:unit과 test:node의 내용을 직접 포함한다. watch는 pnpm exec vitest를 사용한다.
* 삭제: check, check:static, check:runtime, check:runtime:os, test:unit, test:node, test:os, test:release-management, bundle, release:version

커밋 훅

* .husky/pre-commit을 lint-staged → pnpm typecheck → pnpm test 순서로 바꾼다.
* 추가 전후 커밋 소요 시간을 측정해 PR에 기록한다.

배포 파일 검사

* release:pack의 출력 위치를 고정하고, release:verify는 인자가 없으면 그 결과를 검사한다.
* build-checks.test.ts와 vitest.checks.config.mjs에서 release:verify와 겹치는 패키징·설치 검증을 없앤다. dist 출력 검사(테스트 파일 제외, 서버 번들 동일성)는 release:verify로 옮길 수 있는지 확인한다.

그 밖

* 워크플로의 스크립트 호출을 새 이름으로 바꾼다.
* 각 패키지 package.json의 typecheck·build 스크립트 사용처를 확인하고, 쓰이지 않으면 정리한다.
* 삭제된 스크립트를 언급하는 tools/README.md, tools/build/check/README.md, packages/vscode/src/integration 문서를 갱신한다.

h2. 선행

* PR CI 교체 작업(COD-34) 머지. 배포 플로우 교체 작업(COD-35)과는 순서를 바꿔도 된다.

h2. 완료 기준

* 루트 스크립트가 위 10개이고, 문서에 삭제된 스크립트 언급이 남아 있지 않다.
* 커밋 훅이 typecheck를 실행하고 통과한다.
* CI가 새 스크립트 이름으로 통과한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-36
