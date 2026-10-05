# codocs

## Unreleased

### Patch Changes

- Code references now point to a document or one of its sections with `@codocs [[Document]]` or `@codocs [[Document:Section]]`. The line notation (`#L11`, `#L11-L12`) is removed: text after the closing `]]` is ordinary text and the document is linked as a whole. A section reference opens the section key, a whole-document reference opens the top of the document, and a missing section is reported without a link. In documents, hovering a section key or the `_codocs.name` value lists the referencing code locations, and `코드 N곳` next to the section key or on the first row shows the count only. Renaming a document or a section in VS Code (F2) or with `codocs_rename` also fixes the `@codocs` references in code files; it is blocked while code files are being collected, and when some code files cannot be read it fixes the files that were read and reports the rest as `unconfirmed`.

  코드 참조는 `@codocs [[문서]]`나 `@codocs [[문서:섹션]]`으로 문서 또는 문서의 섹션을 가리킨다. 행 표기(`#L11`, `#L11-L12`)는 없어졌으며 닫는 `]]` 뒤의 글자는 일반 글자로 두고 문서 전체를 연결한다. 섹션 참조는 섹션 키로, 문서 전체 참조는 문서 맨 위로 이동하고 섹션이 없으면 링크 없이 알린다. 문서에서는 섹션 키나 `_codocs.name` 값에 커서를 두면 참조하는 코드 위치 목록을 보여주고, 섹션 키 옆과 첫 행의 `코드 N곳`은 개수만 표시한다. VS Code(F2)와 `codocs_rename`으로 문서나 섹션의 이름을 바꾸면 코드 파일의 `@codocs` 표기도 함께 고치며, 코드 파일을 수집하는 중에는 blocked이고 일부 코드 파일을 읽지 못하면 읽은 파일만 고치고 나머지는 `unconfirmed`로 알린다.

## 0.0.4

### Patch Changes

- fa61fc1: Code reference watching now follows the collection rules (Git-tracked files and the project `.gitignore`) instead of the whole project, rebuilds only when those rules change, and recovers automatically from watch errors such as EPERM when a folder is deleted and recreated, instead of staying incomplete. The IDE shows "감시 재연결 중" while it reconnects.

  코드 참조 감시가 프로젝트 전체 대신 수집 규칙(Git 추적 파일과 프로젝트 `.gitignore`)을 따르고, 해당 규칙이 바뀔 때만 다시 구성하며, 폴더 삭제 후 재생성 시 발생하는 EPERM 같은 감시 오류에서 자동으로 복구되어 "수집 불완전" 상태에 머물지 않는다. 재연결하는 동안 IDE에는 "감시 재연결 중"이 표시된다.

- a4f2418: Code reference links no longer underline whitespace, and code links stay visible and clickable while references are re-collected. Refreshes now check only the changed paths instead of the whole project, and hover no longer re-requests after unrelated changes.

  코드 참조 링크가 공백에 밑줄을 긋지 않고, 코드 연결을 다시 수집하는 동안에도 링크가 계속 보이고 클릭할 수 있다. 갱신은 프로젝트 전체 대신 바뀐 경로만 확인하며, 관련 없는 변경 뒤에는 hover가 다시 요청되지 않는다.

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
