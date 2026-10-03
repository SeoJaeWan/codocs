# @codocs/workspace

## 0.0.3

### Patch Changes

- 020bc1b: Incompatible change: documents now require five attributes (`id`, `name`, `definition`, `domains`, `deprecatedAliases`). Add `deprecatedAliases: []` to every document. `kind`, `status`, and `examples` are no longer product attributes and are kept as user attributes, so delete them if unused. `codocs_list` no longer accepts `kind` or `status`, and the `deprecated_reference` warning is removed. Existing documents without `deprecatedAliases` now report `missing_required_field`, and references to them report `reference_target_error` until they are fixed.

  호환되지 않는 변경: 문서에 `id`, `name`, `definition`, `domains`, `deprecatedAliases` 다섯 속성이 필수가 된다. 모든 문서에 `deprecatedAliases: []`를 추가한다. `kind`, `status`, `examples`는 더 이상 제품 속성이 아니며 사용자 속성으로 보존되므로 쓰지 않으면 삭제한다. `codocs_list`는 `kind`와 `status`를 받지 않고 `deprecated_reference` 경고는 사라진다. `deprecatedAliases`가 없는 기존 문서는 `missing_required_field`를 보고하고, 그 문서를 참조하면 고칠 때까지 `reference_target_error`를 보고한다.

- adb49f5: User attributes (top-level fields and extra keys in `deprecatedAliases` items) are now preserved without the `unknown_field` warning, and the `unknown_field` diagnostic code is removed.

  사용자 속성(최상위 필드와 `deprecatedAliases` 항목의 추가 키)은 `unknown_field` 경고 없이 보존되며, `unknown_field` 진단 코드는 제거된다.

- Updated dependencies [020bc1b]
- Updated dependencies [adb49f5]
  - @codocs/core@0.0.2

## 0.0.2

### Patch Changes

- fa61fc1: Code reference watching now follows the collection rules (Git-tracked files and the project `.gitignore`) instead of the whole project, rebuilds only when those rules change, and recovers automatically from watch errors such as EPERM when a folder is deleted and recreated, instead of staying incomplete. The IDE shows "감시 재연결 중" while it reconnects.

  코드 참조 감시가 프로젝트 전체 대신 수집 규칙(Git 추적 파일과 프로젝트 `.gitignore`)을 따르고, 해당 규칙이 바뀔 때만 다시 구성하며, 폴더 삭제 후 재생성 시 발생하는 EPERM 같은 감시 오류에서 자동으로 복구되어 "수집 불완전" 상태에 머물지 않는다. 재연결하는 동안 IDE에는 "감시 재연결 중"이 표시된다.

- a4f2418: Code reference links no longer underline whitespace, and code links stay visible and clickable while references are re-collected. Refreshes now check only the changed paths instead of the whole project, and hover no longer re-requests after unrelated changes.

  코드 참조 링크가 공백에 밑줄을 긋지 않고, 코드 연결을 다시 수집하는 동안에도 링크가 계속 보이고 클릭할 수 있다. 갱신은 프로젝트 전체 대신 바뀐 경로만 확인하며, 관련 없는 변경 뒤에는 hover가 다시 요청되지 않는다.
