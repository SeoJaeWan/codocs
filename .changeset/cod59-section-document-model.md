---
'@codocs/core': patch
'@codocs/workspace': patch
'@codocs/mcp': patch
'@codocs/language-server': patch
'codocs': patch
---

Incompatible change: a document is now a `_codocs` object (`id`, `name`, and an optional `parent` list of parent document names) plus one or more sections. Every other top-level key is a section whose value is a non-empty string, and `[[name]]` references are read from every section. `definition`, `domains`, and user-defined attributes no longer exist, and `codocs_list` no longer accepts `domain`. Document names must now be unique across the whole project (`duplicate_name`), and a `parent` that names a missing document or forms a cycle is reported as an error. Renaming a document also rewrites the matching `parent` entries in other documents. Move each document's `id` and `name` into `_codocs`, split `definition` into named sections, and delete `domains`.

호환되지 않는 변경: 문서는 이제 `_codocs` 객체(`id`, `name`, 선택 항목인 상위 문서 이름 목록 `parent`)와 하나 이상의 섹션으로 구성한다. 그 밖의 최상위 키는 모두 섹션이며 값은 비어 있지 않은 문자열이고, `[[이름]]` 참조는 모든 섹션에서 찾는다. `definition`, `domains`와 사용자 정의 속성은 없어졌고 `codocs_list`는 `domain`을 받지 않는다. 문서 이름은 프로젝트 전체에서 유일해야 하며(`duplicate_name`), 없는 문서를 가리키거나 순환하는 `parent`는 오류로 보고한다. 문서 이름을 바꾸면 다른 문서의 `parent`에 적힌 같은 이름도 함께 고친다. 각 문서의 `id`와 `name`을 `_codocs`로 옮기고 `definition`을 이름 있는 섹션으로 나누며 `domains`를 삭제한다.
