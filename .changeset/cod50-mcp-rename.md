---
'@codocs/mcp': patch
'codocs': patch
---

Add the `codocs_rename` MCP tool. `mode: "preview"` returns the rename status, changes, ambiguous-reference candidates, conflicts and per-file revisions without touching files or the index; `mode: "apply"` takes the same `id`, `newName`, `selections` plus the previewed `revisions`, recomputes, and rejects with no writes when the revisions or the affected file set changed. The tool takes the current document ID and resolves its file path itself, and `selections` use the paths returned by preview as-is.

`codocs_rename` MCP 도구를 추가한다. `mode: "preview"`는 파일과 색인을 바꾸지 않고 상태·변경 목록·모호한 참조의 후보·충돌·파일별 revision을 반환한다. `mode: "apply"`는 같은 `id`·`newName`·`selections`와 미리보기의 `revisions`를 받아 다시 계산하고, revision이나 영향받는 파일 집합이 달라졌으면 아무 파일도 쓰지 않고 거절한다. 도구는 현재 문서 ID를 받아 파일 경로로 변환하며, `selections`는 미리보기가 돌려준 경로를 그대로 쓴다.
