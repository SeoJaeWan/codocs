# 문서 수정

[전체 순서와 주제](README.md)

## 내용 갱신과 이름 변경

개발 진행만 바뀌면 문서를 수정하지 않는다. 설명하는 의미·동작·정책이 바뀌면 담당 원문에 합의한 조건·근거·예외를 반영한다.
원문을 갱신한 뒤 그 내용을 사용하는 문서의 설명과 참조도 확인한다.
코드에서 문서의 섹션을 참조하는 경우, 섹션을 지우거나 이름을 바꾸기 전에 아래 섹션 이름 변경을 쓰고 코드 링크가 의도한 섹션을 여는지 확인한다.

문서의 `name`은 `codocs_write`의 update로 바꾸지 않는다. `set._codocs`의 `name`이 현재 이름과 다르면 `name_change_not_allowed`로 저장하지 않고 `codocs_rename`을 안내한다.
이름 변경은 미리보기와 반영 두 단계이며, 다른 문서의 `_codocs.parent`에 적힌 이전 이름도 함께 새 이름으로 고친다. 이전 이름의 문서가 둘 이상이면 `parent`는 고치지 않는다. MCP에서는 `codocs_rename`을 쓰고, VS Code에서는 문서의 `_codocs.name` 값이나 참조의 이름 부분에서 이름 바꾸기(F2)를 쓴다.
`[[환불:환불정책]]`처럼 섹션이 붙은 참조도 이름 부분만 고치며 `:환불정책`은 그대로 둔다. 문서 안의 자기 섹션 참조와 섹션이 없는 참조도 이름 부분은 고친다.
코드 파일의 `@codocs [[환불]]`과 `@codocs [[환불:환불정책]]`도 같은 규칙으로 함께 고친다. 코드 파일은 이름 변경을 반영할 때만 고쳐지며 `codocs_write`는 코드 파일을 고치지 않는다.
이미 코드 색인이 있는 세션이 코드 파일을 수집하는 중이면 바로 `blocked`(`blockingReason`은 `unconfirmed`)이고 반영은 `rename_blocked`로 실패한다. 코드 색인이 아직 없는 세션의 첫 이름 변경은 처음 수집이 끝나기를 기다린다. 수집은 끝났지만 일부 코드 파일을 읽지 못했으면 읽은 파일만 고치고, 읽지 못한 경로는 `reason`이 `unconfirmed`인 영향으로 알리며 `status`는 `unresolved`다. 응답에서 코드 파일의 `changes`·`impacts`·`files` 항목은 `fileKind: "code"`를 가지며 `revisions`에도 코드 파일 경로가 들어간다.

1. 먼저 `codocs_rename({"mode":"preview","id":"sample-order","newName":"새 주문"})`로 미리본다. 파일은 바뀌지 않는다.
2. 응답의 `status`를 확인한다. `ready`는 고칠 내용을 모두 계산했다는 뜻이며 저장해도 된다는 허가가 아니다.
3. `unresolved`이면 `impacts`에서 `reason`이 `selection_required`인 참조의 후보(`before.candidates`)를 사용자에게 보여주고 대상을 고르게 한다.
   고른 결과는 `selections`에 담아 preview를 다시 요청한다. 항목은 `sourcePath`, `occurrenceIndex`, 고른 후보의 `targetPath`이며 preview 응답의 값을 그대로 쓴다.
   고르지 않은 모호한 참조는 고치지 않고 미해결로 남는다.
4. `blocked`이면 `blockingReason`을 확인한다. 새 이름의 문서가 이미 있거나(`name_conflict`) 이름 변경으로 `parent_not_found`·`parent_cycle`이 새로 생기거나 프로젝트 탐색이 끝나지 않았거나 선택이 잘못된 경우 등이며, 이 상태에서는 반영할 수 없다.
5. 반영은 같은 `id`·`newName`·`selections`에 preview 응답의 `revisions`를 고치지 않고 더해 `{"mode":"apply", ...}`로 보낸다. `revisions`가 없으면 `invalid_input`이다.

반영은 미리보기 결과를 보관하지 않고 다시 계산한다. 미리본 뒤 영향받는 파일이 바뀌어 `revision_conflict`가 오거나 영향받는 파일이 달라져 `rename_affected_files_changed`가 오면 아무 파일도 바뀌지 않았으므로 preview부터 다시 한다.
결과는 파일마다 `files[].state`(`changed`·`restored`·`restore_failed`·`unchanged`)로 알린다. 여러 파일을 한 번에 바꾸는 원자성은 보장하지 않으며, `rename_restore_failed`가 오면 알려준 파일을 직접 확인한다.
`indexUpdated: false`이면 `codocs_write`와 같이 파일을 다시 저장하지 않고 [색인 복구](validation.md#저장-후-색인-복구)를 따른다.
VS Code에서는 영향받는 문서나 코드 파일에 저장하지 않은 수정이 있으면 시작 전에 중단한다.

ID를 바꿔도 과거 ID는 남기지 않는다. 이후 조회·수정은 새 ID로 하며, 다른 문서의 참조는 자동으로 고쳐지지 않는다. 문서의 `name`이나 섹션 이름을 바꿀 때만 코드 파일의 `@codocs` 표기를 함께 고친다.

## 섹션 이름 변경

문서의 섹션 이름도 같은 미리보기·반영 흐름으로 바꾼다. `codocs_rename`에 현재 섹션 이름을 `section`으로 더하면 `newName`은 새 섹션 이름이 된다.

`codocs_rename({"mode":"preview","id":"refund","section":"환불정책","newName":"환불 규정"})`

- 응답에 바꿀 섹션을 나타내는 `targetSection`이 더해지며 `oldName`·`newName`은 섹션 이름이다.
- 그 문서의 섹션 키와, 그 섹션으로 확정된 모든 `[[환불:환불정책]]`의 섹션 부분을 함께 고친다. 같은 문서 안의 참조와 코드 파일의 `@codocs [[환불:환불정책]]`도 포함한다.
- `blockingReason`이 `section_conflict`이면 같은 이름의 섹션이 이미 있고, `section_not_found`이면 바꿀 섹션이 문서에 없다. 새 이름이 비었거나 `_`로 시작하거나 대괄호를 포함하거나 현재 섹션 이름과 같으면 `invalid_name`, 키의 현재 형식이나 참조로 안전하게 적을 수 없으면 `unrepresentable`이다.
- 선택·반영·`revisions`·복구는 문서 이름 변경과 같다.
- VS Code에서는 섹션 키나 참조의 섹션 부분에서 이름 바꾸기(F2)를 시작하며 입력 상자에 현재 섹션 이름이 채워진다.

## get에서 set/unset과 validate까지

먼저 `codocs_get({"addresses":["주문"]})`로 문서와 `revision`을 읽고(섹션 하나만 볼 때는 `{"addresses":["주문:개요"]}`처럼 `이름:섹션`을 쓴다) 수정할 설명과 연결을 검토한다.
아래의 `읽은 revision`은 실제 응답의 값으로 바꾼다.

```json
{
  "mode": "update",
  "id": "sample-order",
  "revision": "읽은 revision",
  "set": { "개요": "가상 주문의 검토한 새 설명이다." },
  "unset": ["검토 메모"]
}
```

`codocs_write`의 set·unset은 최상위 키 단위로 동작한다. `set`에 섹션 이름을 쓰면 그 섹션만 바꾸고 나머지 섹션은 원문 그대로 둔다. `unset`에 섹션 이름을 쓰면 그 섹션을 삭제하며, 마지막 섹션을 삭제하면 검증 오류다.
`set._codocs`는 `_codocs` 객체 전체를 교체한다. 일부 키만 병합하지 않으므로 `id`와 `name`을 포함해 전달하며, `id`·`parent`는 이 값으로 바뀌고 `name`이 현재 이름과 다르면 `name_change_not_allowed`다.
`unset`에 `_codocs`를 지정하면 MCP는 `invalid_input`으로 거절한다. `_codocs`는 지울 수 없고 `set._codocs`로 교체만 할 수 있다. 같은 키를 set과 unset에 함께 지정하지 않는다.
`set.id`는 `_codocs.id`를 바꾸지 않고 `id`라는 이름의 섹션을 만든다. ID를 바꾸려면 `set._codocs`를 쓴다.
저장 뒤 `codocs_validate({"path":".codocs/order.yaml"})` 또는 `codocs_validate({})`로 진단을 읽는다.
경고는 저장을 막지 않을 수 있으므로 성공 여부와 별도로 확인한다.

`saved: true`는 파일 반영 완료다. `indexUpdated: false`여도 파일을 다시 저장하지 않고 [색인 복구](validation.md#저장-후-색인-복구)를 따른다.
무변경이면 `saved: false`, `changed: false`이며 `indexUpdated`는 생략된다.

## 문서 전체 교체와 참조 보호

섹션을 여러 개 지우거나 문서를 크게 고쳐 쓸 때는 `mode: "replace"`로 문서 전체를 보낸다. `_codocs`를 포함한 새 문서 전체를 `document`에 넣으며 없는 최상위 섹션은 삭제된다.

```json
{
  "mode": "replace",
  "id": "sample-order",
  "revision": "읽은 revision",
  "document": {
    "_codocs": { "id": "sample-order", "name": "주문" },
    "개요": "가상 주문의 검토한 새 설명이다."
  }
}
```

- replace에는 `set`·`unset`을 섞지 않는다. 섞거나 알 수 없는 속성이 있으면 `invalid_input`이다.
- `_codocs.name`은 바꿀 수 없다. 다르면 `name_change_not_allowed`이며 `codocs_rename`을 쓴다. `id`는 바꿀 수 있다.
- 값이 같은 최상위 키와 문서 최상위 주석의 원문은 그대로 두며 내용이 같으면 `saved: false`, `changed: false`다.
- update·replace·delete는 변경 뒤 다른 문서의 `[[이름]]`·`[[이름:섹션]]`이나 코드 파일의 `@codocs` 표기가 새로 깨지면 `reference_broken`으로 저장하지 않는다. 진단의 `path`·`range`가 참조를 쓴 곳이다. 이전부터 깨져 있던 참조는 막지 않는다.
- 확인해야 하는 코드 파일을 아직 수집하지 못했거나 읽지 못했으면 `code_evidence_incomplete`로 저장하지 않는다. 깨지지 않았다는 뜻이 아니므로 코드 수집이 끝난 뒤 다시 요청한다. 같은 요청을 revision만 바꿔 반복하지 않는다.
- 거절한 요청은 파일을 바꾸지 않는다. 지우려는 섹션을 가리키는 참조를 먼저 고친 뒤 다시 요청한다.

## 문서 삭제와 이동

문서 파일을 지우거나 다른 경로로 옮길 때도 `codocs_get`으로 읽은 `revision`을 보낸다.

- 삭제: `codocs_write({"mode":"delete","id":"sample-order","revision":"읽은 revision"})`
- 이동: `codocs_write({"mode":"move","id":"sample-order","revision":"읽은 revision","path":".codocs/orders/order.yaml"})`

- 이동은 내용·`id`·`name`을 바꾸지 않으므로 같은 이름으로 조회되고 참조가 유지된다. 새 경로에 이미 파일이 있으면 `file_exists`로 거절한다.
- 삭제한 문서를 다른 문서나 코드 파일의 `@codocs` 표기가 참조하면 `reference_broken`으로 거절한다. 참조를 먼저 고치거나 아래 changes로 함께 보낸다.
- 삭제나 이동 때문에 건드리지 않은 문서의 `_codocs.parent`가 새로 끊기면 `reference_broken`으로 거절하며 진단에 자식 문서의 경로와 `parent` 항목 위치가 담긴다.
- 삭제나 이동으로 비게 된 폴더는 `.codocs` 바로 아래 폴더까지 제거한다. `.codocs` 자체와 요청 전부터 비어 있던 폴더, 다른 파일이 남은 폴더는 그대로 둔다.
- 같은 ID의 파일이 여럿이면 그 ID로 삭제하거나 옮기지 않는다.

## 여러 문서를 한 번에 변경

여러 문서를 함께 고쳐야 중간 상태에서 참조 오류가 나지 않을 때는 `changes`로 한 요청에 보낸다. 항목은 create·update·replace·delete·move 단일 요청과 같은 형태이고 최소 1개다.

```json
{
  "changes": [
    {
      "mode": "create",
      "path": ".codocs/a.yaml",
      "document": {
        "_codocs": { "id": "a", "name": "가상 A" },
        "개요": "가상 A의 의미다."
      }
    },
    {
      "mode": "update",
      "id": "b",
      "revision": "B의 읽은 revision",
      "set": { "개요": "[[가상 A]]를 사용하는 절차다." }
    },
    { "mode": "delete", "id": "old", "revision": "old의 읽은 revision" }
  ]
}
```

- 모든 항목을 반영한 최종 상태를 한 번 검증하고 전부 저장하거나 아무것도 저장하지 않는다. 한 항목의 오류가 전체의 실패이며 이때 파일은 바뀌지 않는다.
- `changes`와 같은 층에 다른 속성을 두거나 `changes`가 비어 있으면 `invalid_input`이다. 같은 문서 `id`나 같은 경로(기존 경로와 move·create의 새 경로)가 두 항목에 나와도 `invalid_input`이며, 새 문서의 최종 내용은 create 하나에 담는다.
- 항목에서도 `name`은 바꿀 수 없다(`name_change_not_allowed`, `codocs_rename` 사용). 코드 파일은 고치지 않는다.
- revision이 오래된 문서가 여럿이면 문서마다 진단(`change_revision_mismatch`)을 돌려주고 저장하지 않는다.
- 응답의 `changes[]`는 입력 순서로 `index`·`mode`·`id`·`path`·`state`와 있으면 `revision`을 담고 move는 `previousPath`도 담는다. `path`는 반영한 뒤의 경로다. `state`는 `changed`·`restored`·`restore_failed`·`unchanged`이며 계획·사전 검사 단계에서 실패하면 `changes`는 빈 배열이다.
- 반영 도중 실패하면 반영한 항목을 역순으로 되돌려 `restored`로 알린다. 되돌리지 못하면 `restore_failed`와 `write_restore_failed` 진단이 오고 `saved: true`이므로 알려준 파일을 직접 확인한다.
- 파일을 한 번에 바꾸는 원자적 연산은 아니며 프로세스 간 잠금이 없으므로 아래 충돌 한계가 같이 적용된다.

## 충돌 후 재조회와 검토

요청을 계획하는 시점에 revision이 다르면 `change_revision_mismatch`, 저장 직전 재확인에서 다르면 `revision_conflict`이며 둘 다 저장되지 않은 요청이다.
최신 문서를 다시 get하고 다른 작성자의 변경과 내 수정 의도를 비교한다. 그 내용을 보존하거나 합의한 수정안을 만든 뒤 최신 revision으로 요청한다.
revision 값만 바꿔 이전 set을 자동 재적용하지 않는다.

저장 직전 revision 검사와 파일 교체는 별도 연산이다. 프로세스 간 잠금·공유 FIFO가 없으므로 검사 뒤 발생한 경쟁을 완전히 막지 못한다.
충돌 오류가 없다는 사실만으로 동시 변경이 모두 보존됐다고 판단하지 않는다.

## 상호 참조를 처음 만드는 순서

1. `codocs_write({"mode":"create","path":".codocs/a.yaml","document":{"_codocs":{"id":"a","name":"가상 A"},"개요":"가상 A의 의미다."}})`
2. `codocs_write({"mode":"create","path":".codocs/b.yaml","document":{"_codocs":{"id":"b","name":"가상 B"},"개요":"[[가상 A]]를 사용하는 절차다."}})`
3. `codocs_get({"addresses":["가상 A"]})`로 A의 최신 원문과 revision을 읽는다.
4. 검토한 A의 섹션에 B를 연결한다: `codocs_write({"mode":"update","id":"a","revision":"A의 최신 revision","set":{"개요":"가상 A의 의미다. 사용 절차는 [[가상 B]]에서 확인한다."}})`
5. `codocs_validate({})`로 양쪽 참조를 확인한다.

create 경로가 이미 있으면 덮어쓰지 않는다. 실패를 update로 자동 전환하거나 처리 지연 때문에 create를 반복하지 않는다.
