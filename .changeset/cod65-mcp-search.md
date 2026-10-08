---
'@codocs/mcp': minor
---

Add `codocs_search`, which finds the sections relevant to one to ten short keyword queries and returns their addresses without content, for reading with `codocs_get`. Results are ranked per query, sections of the same document are grouped under the document address, and queries with no match are listed separately.

`codocs_search`를 추가한다. 짧은 검색어 1~10개로 관련 섹션을 찾아 본문 없이 주소만 돌려주며, 그 주소는 `codocs_get`으로 읽는다. 결과는 검색어별로 순위를 매기고 같은 문서의 섹션은 문서 주소로 묶으며, 걸린 것이 없는 검색어는 따로 알린다.
