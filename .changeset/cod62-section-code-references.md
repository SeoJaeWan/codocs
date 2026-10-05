---
'@codocs/core': patch
'@codocs/workspace': patch
'@codocs/mcp': patch
'@codocs/language-server': patch
'codocs': patch
---

Make code references section-based. `@codocs [[name]]` points to a document and `@codocs [[name:section]]` to one of its sections; the `#L` row notation is removed, so text after the closing `]]` such as `#L11` is plain text and not part of the reference. A section that is missing in the target document is reported as `codocs.codeReference.missing_section` ("대상 문서에 해당 섹션이 없습니다."). In VS Code, hovering a section key or the `_codocs.name` value lists the code that references it, and a `코드 N곳` hint shows only the count. Renaming a document or a section now also updates the `@codocs` markers in code files, in MCP (`codocs_rename`) and in VS Code (F2). Code-file entries in `changes`, `impacts` and `files` carry `fileKind: "code"`, `revisions` include code file paths, and `selections[].sourcePath` may be a code path. While code files are being collected again the preview is `blocked` with `blockingReason: "unconfirmed"` and apply fails with `rename_blocked`; the first rename in a session without a code index waits for the initial collection. A code file that could not be read is reported as an `unconfirmed` impact and the status is `unresolved`; an ambiguous code marker is a `selection_required` impact.

코드 참조를 섹션 기반으로 바꿉니다. `@codocs [[이름]]`은 문서를, `@codocs [[이름:섹션]]`은 문서의 섹션을 가리키며, `#L` 행 표기는 없어졌으므로 닫는 `]]` 뒤의 `#L11` 같은 글자는 참조에 포함되지 않는 일반 글자입니다. 대상 문서에 섹션이 없으면 `codocs.codeReference.missing_section`("대상 문서에 해당 섹션이 없습니다.")으로 알립니다. VS Code에서는 섹션 키나 `_codocs.name` 값에 커서를 두면 그것을 가리키는 코드 목록을 보여주고, `코드 N곳` Hint는 개수만 표시합니다. 문서나 섹션의 이름을 바꾸면 이제 MCP(`codocs_rename`)와 VS Code(F2) 모두 코드 파일의 `@codocs` 표기도 함께 고칩니다. 코드 파일 항목은 `changes`·`impacts`·`files`에서 `fileKind: "code"`를 가지고, `revisions`에 코드 파일 경로가 포함되며, `selections[].sourcePath`에 코드 경로를 쓸 수 있습니다. 코드 파일을 다시 수집하는 중에는 미리보기가 `blockingReason: "unconfirmed"`인 `blocked`이고 반영은 `rename_blocked`로 실패하며, 코드 색인이 아직 없는 세션의 첫 이름 변경은 처음 수집이 끝나기를 기다립니다. 읽지 못한 코드 파일은 `unconfirmed` 영향으로, 모호한 코드 표기는 `selection_required` 영향으로 알리고 상태는 `unresolved`입니다.
