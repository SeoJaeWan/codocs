---
'@codocs/core': patch
'@codocs/workspace': patch
'@codocs/mcp': patch
'@codocs/language-server': patch
'codocs': patch
---

User attributes (top-level fields and extra keys in `deprecatedAliases` items) are now preserved without the `unknown_field` warning, and the `unknown_field` diagnostic code is removed.

사용자 속성(최상위 필드와 `deprecatedAliases` 항목의 추가 키)은 `unknown_field` 경고 없이 보존되며, `unknown_field` 진단 코드는 제거된다.
