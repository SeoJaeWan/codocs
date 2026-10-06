---
'@codocs/workspace': patch
'@codocs/mcp': patch
'@codocs/language-server': patch
'codocs': patch
---

A `.codocsignore` file in the project root (gitignore syntax) now excludes matching paths from code reference collection, even when Git tracks them. The rule applies to validate and refresh, the editor, write protection, and rename.

프로젝트 루트의 `.codocsignore` 파일(gitignore 문법)에 맞는 경로는 Git이 추적하는 파일이어도 코드 참조 수집에서 제외한다. 이 규칙은 validate·refresh, 에디터, 쓰기 보호, 이름 변경에 모두 적용된다.
