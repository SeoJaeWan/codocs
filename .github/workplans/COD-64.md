# COD-64 — 여러 Codocs 문서 및 section 일괄 변경 지원

## 배경

여러 문서를 함께 변경해야 하는 작업에서는 문서별 write를 반복하면 중간 상태에서 참조 오류가 발생하고 검증도 반복된다. 새 section/write 모델을 기반으로 여러 변경을 최종 상태 기준으로 한 번 검증하고 저장할 수 있게 한다. 문서 삭제·이동 수단이 없던 COD-53의 범위도 이 작업에 포함한다.

## 범위

- `codocs_write`에 `{changes: [...]}` 입력을 추가한다. 각 항목은 단일 요청과 같은 형태(create/update/replace/delete/move)이며 기존 단일 요청은 그대로 유지한다.
- 문서 delete(`id`, `revision`)와 move(`id`, `revision`, `path`)를 단일 요청과 `changes` 항목 양쪽에서 지원한다. move는 내용·ID·이름을 바꾸지 않고 기존 파일을 덮어쓰지 않는다.
- 문서 metadata와 section 변경을 같은 요청에 포함한다.
- 모든 변경을 적용한 가상 최종 상태에서 한 번만 검증하고, 오류가 남으면 아무것도 저장하지 않는다.
- 문서 삭제로 다른 문서나 코드 파일의 참조가 새로 끊기면 `reference_broken`으로 거부한다. 같은 요청에서 참조를 함께 고치면 저장한다.
- 삭제·이동으로 건드리지 않은 문서의 `_codocs.parent`가 새로 끊기면 거부한다. 같은 요청에서 자식의 parent를 고치거나 자식도 삭제하면 저장한다.
- `changes` 안에서도 name 변경은 `name_change_not_allowed`로 막고 `codocs_rename`을 안내한다.
- 같은 문서 ID나 같은 경로(원래 경로와 move의 새 경로)가 두 번 이상 나오거나 `changes`가 비어 있으면 `invalid_input`으로 전체를 거부한다.
- 저장 전에 모든 항목의 revision을 확인하고 충돌한 문서를 모두 진단으로 반환한다.
- 저장 도중 실패하면 반영한 항목을 역순으로 되돌린다(만든 파일 삭제, 지운 파일 재생성, 옮긴 파일 원위치, 지운 폴더 재생성). 항목별 `state`(`changed`/`restored`/`restore_failed`/`unchanged`)로 알리고 되돌리지 못하면 `write_restore_failed`를 반환한다.
- delete·move로 비게 된 폴더는 `.codocs` 바로 아래까지 제거한다. `.codocs` 자체, 요청 전부터 비어 있던 폴더, 다른 파일이 남은 폴더는 제거하지 않는다.
- 결과는 입력 순서의 `changes[]`(`index`, `mode`, `id`, `path`, `previousPath`, `state`, `revision`)와 전체 `saved`·`changed`·`indexUpdated`로 반환한다.
- MCP 도구 설명, `.codocs` 소유 문서, 사용자 가이드, README, changeset을 구현과 맞춘다.

## 범위 밖

- semantic search
- 자동 문서 병합
- 중복 의미 판정
- `changes` 안의 name 변경
- 코드 파일 수정
- 서버 전체 동시성(worker)과 프로세스 간 잠금

## 검증

- 새 문서 생성과 기존 문서/section 수정을 한 요청에서 처리한다.
- batch 내부 참조는 최종 상태 기준으로 정상 해석된다.
- 한 변경이라도 검증에 실패하면 저장 전 전체 요청을 거부하고 파일을 바꾸지 않는다.
- revision 충돌 시 충돌한 문서를 모두 반환한다.
- 참조된 문서의 삭제는 거부하고, 같은 요청에서 참조를 고치면 저장한다. parent가 끊기는 삭제도 같다.
- move 뒤에도 같은 ID·이름으로 조회되고 참조가 유지된다.
- 중복 ID·경로, 빈 `changes`, name 변경은 거부한다.
- 반영 도중 실패하면 되돌리고 항목별 상태를 반환한다.
- 실제 stdio MCP 프로세스로 위 흐름을 확인한다.
- typecheck, lint, test, format check, build, release:pack, release:verify를 통과한다.

## 완료 기준

- AI가 여러 문서와 section에 걸친 변경과 문서 삭제·이동을 한 번의 MCP 요청으로 검증하고 저장할 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-64
