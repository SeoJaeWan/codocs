# COD-35 — 배포를 main 단일 브랜치와 Changesets Version PR로 교체

develop·main 이중 브랜치를 쓰면서 release-prepare·release-sync·release-publish 세 워크플로와 release-flow·release-sync·release-publish 스크립트가 필요해졌다. 테스트한 바이트를 그대로 게시하기 위해 run·artifact·check를 API로 추적하는 코드도 들어갔다.

CODOCS_RELEASE_ENABLED를 켠 뒤 release-prepare가 자체 사전 검사에서 두 번 연속 실패했다(App 권한 판별, 로컬 develop 브랜치 없음). 그래서 COD-33이 들어간 릴리스 PR이 만들어지지 않았다.

합의한 기준은 .codocs의 「배포」에 기록했다(PR #41).

h2. 범위

release.yml (main push)

* 공식 changesets version Action으로 Draft Version PR을 만들고 갱신한다. PR은 GitHub App 토큰으로 만들어 그 PR에서 CI가 시작되게 한다.
* Version PR이 머지되면 main에서 build, release:pack, release:verify를 거쳐 게시한다.

tools/build/publish.mjs

* npm·Marketplace에 이미 게시된 버전은 건너뛴다. 실패 job을 다시 실행해도 중복 게시되지 않는다.
* 게시한 제품마다 co-documentation@버전, codocs@버전 형식의 태그와 GitHub Release를 만든다. Release에는 배포 파일과 SHA-256만 첨부한다.
* package.json 스크립트로 두지 않고 워크플로에서만 호출한다.

Changesets 설정

* .changeset/config.json의 baseBranch를 main으로 바꾸고 .changeset/README.md를 갱신한다.

삭제

* .github/workflows/release-prepare.yml, release-sync.yml, release-publish.yml
* tools/ci의 나머지(release-flow, release-sync, release-publish, release-fixture, release-contract.test)와 테스트
* tools/build/release-contract.mjs의 CI 전용 부분(job·workflow 이름, 후보·증거·보고서 스키마). products·assertVersion·artifactName·readProductVersions는 유지한다.
* tools/build/release.mjs의 packageRelease·sourceIdentity, release-source.test.mjs
* tools/test/git-config.mjs와 테스트

h2. 선행

* PR CI 교체 작업(COD-34) 머지

h2. 머지 후

* co-documentation 0.0.2, codocs 0.0.2가 담긴 Draft Version PR이 만들어졌는지 확인한다.
* develop 브랜치를 삭제하고, main에 Rulesets(PR 필수, required-ci, 최신 main 반영, 관리자 포함 우회 금지)를 설정한다.
* 쓰이지 않게 된 CODOCS_RELEASE_ENABLED 변수를 삭제한다.

h2. 완료 기준

* main push로 Draft Version PR이 생성되고, ready로 바꾸면 CI가 시작된다.
* Version PR을 머지하면 두 제품이 게시되고, 재실행해도 중복 게시되지 않는다.
* pnpm test가 통과한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-35
