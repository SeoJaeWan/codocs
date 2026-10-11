---
'@codocs/language-server': minor
'codocs': minor
---

The VS Code extension and language server now handle documents in nested `.codocs` folders such as `packages/core/.codocs/`. Diagnostics, rename and links treat them like root `.codocs` documents, and creating or deleting a `.codocs` folder at any depth refreshes the index (editing document content still does not). When several reference candidates share a name, a root `.codocs` document shows its path without `.codocs/` as before, while a nested one shows the full project-relative path such as `packages/core/.codocs/a.yaml`. A subfolder that is itself open as a separate workspace folder is left to its own language server session, so the outer folder does not index its `.codocs` and the same document never appears in two indexes.

VS Code 확장과 언어 서버가 `packages/core/.codocs/` 같은 하위 `.codocs` 폴더의 문서를 다룬다. 진단·이름 바꾸기·링크가 루트 `.codocs` 문서와 똑같이 동작하고, 어느 깊이에서든 `.codocs` 폴더를 만들거나 지우면 색인을 갱신한다(문서 내용 편집은 갱신을 요청하지 않는다). 같은 이름의 참조 후보는 루트 `.codocs` 문서면 지금처럼 `.codocs/`를 뺀 경로를, 하위 `.codocs` 문서면 `packages/core/.codocs/a.yaml`처럼 프로젝트 기준 전체 경로를 보여준다. 하위 폴더가 별도 workspace 폴더로 열려 있으면 그 폴더의 `.codocs`는 안쪽 언어 서버 세션만 맡으므로, 바깥 폴더는 그 `.codocs`를 색인하지 않아 같은 문서가 두 색인에 나타나지 않는다.
