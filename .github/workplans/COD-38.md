# COD-38 — Release workflow의 dry-run 제거

Release workflow의 수동 실행(workflow_dispatch)은 게시하지 않고 계획만 출력하는 dry-run이다. 계획은 main의 현재 manifest 버전으로 계산하므로 병합 전 Version PR의 새 버전을 보여 주지 못하고(run 36564052293), 같은 계획표는 main push 실행마다 로그와 step summary에 이미 남는다.

h2. 범위

- .github/workflows/release.yml에서 workflow_dispatch trigger와 dry-run 분기를 제거한다. version job과 각 step의 github.event_name == 'push' 조건도 함께 제거하고, 게시 여부는 계획 결과로만 정한다.
- .codocs 「배포」의 수동 dry-run 설명과 병합 전 수동 dry-run 확인 문장을 현재 동작에 맞게 고친다.
- 도구 변경이므로 changeset은 추가하지 않는다.

h2. 진행 기준

- main을 대상으로 PR을 보내고 merge commit으로 병합한다.

h2. 검증

- PR 안: release.yml YAML 파싱과 trigger 확인, bash step 구문 검사, Codocs validate, CI 통과.
- 병합 후: main push의 Release 실행이 계획 단계를 거쳐 정상 종료되는지 확인한다.

h2. 완료 기준

- release.yml에 workflow_dispatch와 dry-run 분기가 없다.
- 「배포」 문서에 수동 dry-run 설명이 남아 있지 않다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-38
