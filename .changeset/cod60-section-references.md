---
'@codocs/core': patch
'@codocs/workspace': patch
'@codocs/mcp': patch
'@codocs/language-server': patch
'codocs': patch
---

Add section references. `[[name]]` still points to a document, and `[[name:section]]` now points to a top-level section of that document; the first unescaped colon splits the two parts and `\:` writes a literal colon in either part. When the document is confirmed but the section is missing, the reference is reported as the `missing_section_reference` error in the editor and as `section_reference_not_found` in MCP, with no link. A section reference to the same document links to that section without a diagnostic and is not counted in `references` or `referencedBy`, which are unchanged. The document index now records section-level backlinks; MCP does not expose them yet. In VS Code, section references open the section key. Renaming a document keeps the `:section` part of its references. `codocs_rename` accepts an optional `section` (the current section name); when present, `newName` is the new section name and the result adds `targetSection`, with the new blocking reasons `section_conflict` and `section_not_found`. In VS Code, rename (F2) on a section key or on the section part of a reference renames the section. `[[a:b]]` used to look for a document named `a:b` as a whole; write `[[a\:b]]` for such a name.

섹션 참조를 추가한다. `[[이름]]`은 지금처럼 문서를, `[[이름:섹션]]`은 그 문서의 최상위 섹션을 가리킨다. 첫 번째 escape되지 않은 콜론이 두 부분을 나누며 어느 쪽에서든 `\:`로 글자 그대로의 콜론을 쓴다. 문서는 확정됐지만 섹션이 없으면 링크 없이 편집기에서는 `missing_section_reference`, MCP에서는 `section_reference_not_found` 오류로 알린다. 같은 문서의 섹션 참조는 진단 없이 그 섹션으로 이동하는 링크가 되며 문서 ID 목록인 `references`·`referencedBy`(변경 없음)에는 넣지 않는다. 문서 색인은 섹션 단위 역참조를 기록하지만 MCP는 아직 보여주지 않는다. VS Code에서는 섹션 참조가 섹션 키 위치를 연다. 문서 이름을 바꾸면 참조의 `:섹션`은 그대로 둔다. `codocs_rename`은 선택 입력 `section`(현재 섹션 이름)을 받으며, 주면 `newName`은 새 섹션 이름이고 결과에 `targetSection`이 더해지고 새 blocked 이유 `section_conflict`·`section_not_found`가 생긴다. VS Code에서는 섹션 키나 참조의 섹션 부분에서 이름 바꾸기(F2)로 섹션 이름을 바꾼다. 이전에는 `[[a:b]]`를 이름이 `a:b`인 문서 하나로 찾았으므로, 그런 이름은 `[[a\:b]]`로 쓴다.
