# COD-35 — 배포를 main 단일 브랜치와 Changesets Version PR로 교체

develop·main 이중 브랜치를 쓰면서 release-prepare·release-sync·release-publish 세 워크플로와 release-flow·release-sync·release-publish 스크립트가 필요해졌다. 테스트한 바이트를 그대로 게시하기 위해 run·artifact·check를 API로 추적하는 코드도 들어갔다.

CODOCS_RELEASE_ENABLED를 켠 뒤 release-prepare가 자체 사전 검사에서 두 번 연속 실패했다(App 권한 판별, 로컬 develop 브랜치 없음). 그래서 COD-33이 들어간 릴리스 PR이 만들어지지 않았다.

합의한 기준은 .codocs의 「배포」「개발 환경」「테스트 컨벤션」에 기록했다(PR #41, 이 브랜치의 2026-09-29 문서 커밋).

h2. 범위

release.yml (main push, workflow_dispatch)

- version: 공식 changesets version Action(v2.1.2 SHA 고정)으로 Draft Version PR을 만들고 갱신한다. pr-draft create, pr-base-branch main. PR은 GitHub App 토큰으로 만들어 그 PR에서 CI가 시작되게 한다. 토큰은 create-github-app-token에 client-id(CODOCS_RELEASE_APP_CLIENT_ID)와 CODOCS_RELEASE_APP_PRIVATE_KEY를 넘겨 발급한다.
- publish(release environment, Ubuntu): main에서 build, release:pack, release:verify를 거친 뒤 별도 스크립트 없이 step에서 도구 기능으로 게시한다.
  - npm: `npm view co-documentation@버전`이 없을 때만 `npm publish <tgz>`
  - Marketplace: `vsce publish --packagePath <vsix> --skip-duplicate`
  - 게시한 제품마다 gh release로 `co-documentation@버전`·`codocs@버전` 태그와 Release를 만들고, 이미 있으면 건너뛴다. 본문은 해당 제품 CHANGELOG의 그 버전 항목과 설치 안내 한 줄, 첨부는 배포 파일과 SHA-256만.
- workflow_dispatch는 항상 dry-run이다. 게시하지 않고 게시 예정 대상만 출력한다.
- 게시 토큰은 publish job에만 제공하고 concurrency로 동시 실행을 막는다.

Changesets

- .changeset/config.json의 baseBranch를 main으로 바꾸고 .changeset/README.md를 갱신한다.
- 대기 중인 cod33-navigation·dynamic-product-versions를 영어 문단, 빈 줄, 같은 내용의 한국어 문단 형식으로 바꾼다. 새 changeset은 추가하지 않는다(배포 파일 변경 없음).

삭제

- .github/workflows/release-prepare.yml, release-sync.yml, release-publish.yml
- tools/ci의 나머지(release-flow, release-sync, release-publish, release-fixture, release-contract.test)와 테스트
- CI의 test:release-management step은 COD-35에서 유지하고, COD-36에서 OS job이 pnpm test로 바뀔 때 제거한다. 그동안 tools/build의 node 테스트가 CI에서 계속 실행된다.
- tools/build/release-contract.mjs의 CI 전용 부분(job·workflow 이름, 후보·증거·보고서 스키마). products·assertVersion·artifactName·readProductVersions는 유지한다.
- tools/build/release.mjs의 packageRelease·sourceIdentity, release-source.test.mjs
- tools/test/git-config.mjs와 테스트

문서

- .codocs 갱신은 이 브랜치에 반영했다. 구현에 따라 바뀐 tools/README.md 등 문서를 함께 갱신한다.

h2. 선행

- COD-34 develop 머지(완료)

h2. 진행 기준

- develop을 대상으로 PR을 보내고 merge commit으로 머지한다. COD-36보다 먼저 머지한다.
- COD-34 → COD-35 → COD-36을 develop에 머지한 뒤 develop → main PR 하나(merge commit)로 main에 옮긴다. release.yml은 main push에서 동작하므로 실제 동작은 이 머지 뒤에 확인한다.

h2. develop → main 머지 후 (전환)

1. release.yml 첫 실행에서 co-documentation 0.0.2·codocs 0.0.2 Draft Version PR이 생기고 publish 단계가 0.0.1 건너뛰기로 끝나는지 확인한다.
2. main Ruleset: PR 필수, required-ci, 최신 main 반영, merge commit만 허용, 관리자·App 포함 우회 없음, force push·삭제 금지. 적용을 확인한 뒤 main의 classic 보호를 제거한다.
3. 태그 Ruleset: `co-documentation@*`, `codocs@*`, `v*` 태그의 수정·삭제 금지, 생성 허용.
4. develop 대상 draft PR #36, #29, #27의 base를 main으로 바꾼다.
5. develop의 classic 보호를 해제하고 develop 브랜치를 삭제한다.
6. 쓰이지 않게 된 CODOCS_RELEASE_ENABLED·CODOCS_RELEASE_APP_ID 변수를 삭제한다.

h2. 검증

- PR 안: 새 CI 통과, release.yml YAML 파싱, 버전·태그 건너뛰기 조건 검토, 변경 후 changeset의 두 언어 형식.
- develop → main 머지 후: Draft Version PR 생성과 publish 건너뛰기 확인.
- Version PR 머지 전: Actions에서 workflow_dispatch dry-run으로 두 제품 게시 예정을 확인.
- Version PR 머지 후: npm·Marketplace 0.0.2, 제품별 태그·Release와 본문을 확인하고, 실패 시 실패 job 재실행이 중복 게시 없이 동작하는지 확인.

h2. 완료 기준

- develop → main 머지 후 main push로 Draft Version PR이 생성되고, ready로 바꾸면 CI가 시작된다.
- Version PR을 머지하면 두 제품이 게시되고, 재실행해도 중복 게시되지 않는다.
- pnpm test가 통과한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-35
