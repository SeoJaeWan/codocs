---
'@codocs/mcp': minor
'@codocs/core': minor
---

`codocs_write` update can now change part of a section and place sections. `edit: [{ section, old, new }]` replaces `old` with `new` inside a section's value without resending the whole section; `old` must appear exactly once in the value returned by `codocs_get`, otherwise the request fails with `edit_text_not_found` or `edit_text_ambiguous`, and several edits are applied in order. `position: { section: { after: other } }` (or `before`) puts a new section added with `set`, or moves an existing one, next to another section; moves apply in the order given, a comment directly above a section moves with it, and a missing section is `change_section_not_found`. New sections without a position are still added at the end, and section order can only be changed with `position`.

`codocs_write` update로 섹션의 일부를 고치고 섹션 위치를 정할 수 있다. `edit: [{ section, old, new }]`는 섹션 전체를 다시 보내지 않고 섹션 값 안의 `old`를 `new`로 바꾼다. `old`는 `codocs_get`이 돌려준 값에서 정확히 한 번 나와야 하며 아니면 `edit_text_not_found`나 `edit_text_ambiguous`로 실패하고, 여러 edit은 적은 순서대로 적용한다. `position: { 섹션: { after: 기준 } }`(또는 `before`)은 `set`으로 더한 새 섹션을 원하는 자리에 넣거나 기존 섹션을 옮긴다. 적은 순서대로 옮기고 섹션 바로 위 주석도 함께 옮기며, 없는 섹션은 `change_section_not_found`다. 위치를 정하지 않은 새 섹션은 지금처럼 끝에 들어가며 섹션 순서는 `position`으로만 바꾼다.
