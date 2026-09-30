# codocs

## 0.0.3

### Patch Changes

- 5419f69: Add the `codocs_duplicates` MCP tool that reviews repeated passages across the project or in a draft before saving, with paged results and cancellation support.

  저장 전 초안이나 프로젝트 전체의 반복 구절을 검토하는 `codocs_duplicates` MCP 도구를 추가하고, 페이지 결과와 취소를 지원한다.

- 452b021: Add explicit `@codocs [[Document]]`, `#L11`, and `#L11-L12` references to navigate from project text to a document, line, or line range, and reverse navigation with hover links and whole-document Inlay Hints.

  프로젝트 텍스트의 `@codocs [[문서]]`, `#L11`, `#L11-L12` 표기로 문서·행·행 범위로 이동하고, 호버 링크와 문서 전체 Inlay Hint로 코드 위치를 역탐색한다.

## 0.0.2

### Patch Changes

- 73df889: Preserve Windows source URIs through Hover and YAML reference link clicks, and record deduplicated navigation failure reasons in Codocs Output.

  Normalize bundled Markdown and YAML guides and examples to UTF-8 LF in MCP and VSIX packages while preserving other asset bytes.

  Hover와 YAML 참조 링크 클릭에서 Windows 원본 URI를 보존하고, 중복을 제거한 이동 실패 이유를 Codocs 출력에 기록한다.

  MCP·VSIX 패키지에 포함된 Markdown·YAML 가이드와 예시를 UTF-8 LF로 정규화하고 그 밖의 자산 바이트는 보존한다.

- 816093e: Reflect each product manifest's independent version in MCP responses, install verification, and release file names.

  제품 manifest의 독립 버전을 MCP 응답과 설치 검증·배포 파일명에 반영한다.
