# COD-38 — CI trigger 정리와 Release dry-run 제거

PR #44에서 push와 Ready 전환이 1초 안에 겹쳐 Ready 이벤트는 옛 커밋을, push 이벤트는 Draft 상태를 기록했다. 새 커밋은 검사되지 않았고, 조건으로 건너뛴 required-ci는 GitHub에서 성공으로 처리된다. 또 Release workflow의 수동 dry-run은 main의 현재 버전만 보여 병합 전 Version PR의 게시 예정을 확인할 수 없다.

h2. 범위

CI (ci.yml)

* 기능 PR은 Ready로 열 때와 Ready PR에 push할 때 전체 CI를 실행한다. Draft PR에서는 실행하지 않는다.
* ready_for_review trigger를 제거한다. Draft → Ready 전환만으로는 CI를 실행하지 않으며, 기능 PR은 구현 push 전에 Ready로 전환한다.
* 같은 PR의 새 push는 진행 중인 실행을 취소하고 새로 실행한다. 수동 실행(workflow_dispatch)은 유지한다.

Version PR과 배포 (release.yml)

* Version PR을 Ready로 생성한다(pr-draft create 제거). 생성과 갱신마다 기능 PR과 같은 전체 CI를 실행한다.
* workflow_dispatch dry-run을 제거한다. 게시는 main push에서만 일어나며 계획표는 매 실행의 로그와 요약에 남는다.

문서

* .codocs 「개발 환경」: PR 검사 조건(Draft 제외, Ready 열기·push 실행, ready_for_review 없음, 구현 push 전 Ready 전환).
* .codocs 「배포」: Version PR Ready 생성과 갱신마다 CI, dry-run 제거, 미출시 changeset이 없을 때 Version PR 작업 생략, 패키징 job의 게시 환경 release:verify.

h2. 진행 기준

* main을 대상으로 PR을 보내고 merge commit으로 병합한다.

h2. 검증

* PR 안: Draft 상태 push에서 CI job이 실행되지 않고, Ready 상태 push에서 전체 CI가 실행되며, Draft → Ready 전환에서 실행이 생기지 않는지 확인한다.
* 병합 후: 다음 changeset이 main에 병합될 때 Version PR이 Ready로 생성되고 CI가 실행되는지 확인한다.

h2. 완료 기준

* CI trigger와 조건이 위 기준과 같다.
* release.yml에 workflow_dispatch가 없고 Version PR이 Ready로 생성된다.
* 문서가 새 기준을 설명한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-38
