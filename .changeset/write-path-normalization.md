---
'@codocs/mcp': minor
'@codocs/core': patch
'@codocs/workspace': patch
'codocs': patch
---

`codocs_write` (create and move) and `codocs_validate` now take `path` as a project-root-relative path such as `.codocs/orders/order.yaml`. Backslashes and repeated slashes are converted to a single `/` on every OS, and document paths in tool results (`source.path`, `changes[].path`, `previousPath`, diagnostic `path`/`relatedPaths`) always use `/`, so a result path can be passed straight back to `move` or `codocs_validate`. Invalid paths are rejected with a message for each cause (no `.codocs` folder, absolute path, `.`/`..` segment, missing file name, wrong extension) that ends with a correct example. The tool descriptions now state the path rule.

`codocs_write`(create·move)와 `codocs_validate`의 `path`를 `.codocs/orders/order.yaml`처럼 프로젝트 루트 기준 상대 경로로 확정한다. 역슬래시와 연속 슬래시는 모든 OS에서 `/` 하나로 바꿔 받고, 도구 결과의 문서 경로(`source.path`, `changes[].path`, `previousPath`, 진단의 `path`/`relatedPaths`)는 항상 `/`로 내보내므로 결과 경로를 그대로 `move`나 `codocs_validate`에 넣을 수 있다. 잘못된 경로는 원인(`.codocs` 폴더 없음, 절대 경로, `.`·`..` 구간, 파일명 없음, 확장자 불일치)마다 다른 메시지로 거부하며 끝에 올바른 예시를 붙인다. 도구 설명에도 경로 규칙을 적었다.
