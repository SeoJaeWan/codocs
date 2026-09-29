# COD-39 — PR CI에서 Draft 실행이 리뷰 준비 실행을 취소하는 문제 수정

Draft PR에 push한 직후 리뷰 준비로 전환하면 CI가 synchronize와 ready_for_review에 한 번씩 반응한다. 두 실행은 같은 concurrency 그룹(CI-<PR 번호>)에 들어가고 cancel-in-progress가 켜져 있어, synchronize 이벤트가 늦게 도착하면 진행 중인 리뷰 준비 실행을 취소한다. synchronize 실행은 push 시점의 payload(draft: true)를 가지므로 모든 job이 생략되어, 결과적으로 검사한 실행이 남지 않는다.

ready_for_review만 trigger로 남기면 리뷰 준비 PR의 추가 push와 Action의 Version PR 갱신(synchronize)을 검사하지 못하므로 trigger는 유지한다. GitHub Actions에는 draft 여부로 실행 생성을 거르는 trigger 필터나 workflow 단위 조건이 없으므로, Draft 실행을 취소 그룹에서 분리한다.

## 범위

- `.github/workflows/ci.yml`의 concurrency group을 이벤트 payload의 draft가 true이면 run_id, 아니면 PR 번호로 정한다. 수동 실행은 지금처럼 run_id를 쓴다. trigger, cancel-in-progress, 정적 job 조건은 바꾸지 않는다.
- `required-ci`는 draft 실행에서 skip되지 않고 실패로 끝나며, 원인과 복구 방법을 출력한다. 늦은 draft 실행으로 merge가 막히면 PR을 draft→ready로 재전환하거나 새 push로 새 실행을 만든다.
- `.codocs` 「개발 환경」「배포」는 이미 commit 478a2c1에서 반영됨.
- 도구 변경이므로 changeset은 추가하지 않는다.

## 진행 기준

- main을 대상으로 PR을 보내고 merge commit으로 병합한다.

## 검증

- ci.yml YAML 파싱과 prettier로 형식 확인.
- CI 통과.
- PR #51: draft push 후 즉시 ready 전환 시 ready run이 끝까지 실행되고 취소되지 않음.
- draft run에서 required-ci는 failure이고 원인·복구 메시지가 출력되며 판정은 BLOCKED.
- 성공/실패 후 늦은 draft run(draft 전환→닫기→다시 열기)이 생겨도 판정은 BLOCKED.
- ready 재전환으로 새 run이 생기면 통과 후 CLEAN.
- ready 상태에서 추가 push하면 진행 중인 이전 run이 취소되고 새 커밋이 검사됨.

## 완료 기준

- Draft 상태에서 시작한 CI 실행이 리뷰 준비 실행을 취소하지 않는다.
- draft run에서 required-ci가 원인·복구 메시지와 함께 실패한다.
- 리뷰 준비 이후 같은 PR의 추가 push는 진행 중인 이전 실행을 취소한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-39
