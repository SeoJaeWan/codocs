---
'@codocs/mcp': patch
'codocs': patch
---

Add explicit `@codocs [[Document]]`, `#L11`, and `#L11-L12` references from any project text to a document, its line, or its line range, with reverse navigation from documents back to the referencing code through direct links, hovers, and a whole-document Inlay Hint. `codocs_write` now reports code references that may need review after a saved change.

프로젝트의 모든 텍스트에서 `@codocs [[문서]]`, `#L11`, `#L11-L12` 표기로 문서·특정 행·행 범위를 참조하고, 문서에서 참조한 코드로 직접 링크·호버·문서 전체 Inlay Hint를 통해 돌아갈 수 있다. `codocs_write`는 저장된 변경 뒤 확인이 필요한 코드 참조를 함께 안내한다.
