---
'@codocs/core': patch
'@codocs/workspace': patch
'@codocs/mcp': patch
'@codocs/language-server': patch
'codocs': patch
---

Hovering a plain code identifier no longer shows Codocs documents. Documents now connect to code only through explicit `@codocs [[Name]]` references and `[[Name]]` document references. The `deprecatedAliases` field is removed: required fields are `id`, `name`, `definition`, and `domains`, and changing an ID keeps no previous ID. If a document still has `deprecatedAliases`, Codocs removes it whenever it saves that document (`codocs_write` create/update, `codocs_rename`, and VS Code F2 rename); requests that change nothing are not saved and do not remove it.

일반 코드 식별자에 마우스를 올려도 더 이상 Codocs 문서가 표시되지 않는다. 문서는 명시적인 `@codocs [[이름]]` 참조와 `[[이름]]` 문서 참조로만 코드와 연결된다. `deprecatedAliases` 필드는 제거되어 필수 필드는 `id`, `name`, `definition`, `domains`이며, ID를 바꿔도 이전 ID를 남기지 않는다. 문서에 `deprecatedAliases`가 남아 있으면 Codocs가 그 문서를 저장할 때(`codocs_write` create/update, `codocs_rename`, VS Code F2 이름 바꾸기) 이 필드를 지우며, 바뀌는 내용이 없어 저장하지 않는 요청은 지우지 않는다.
