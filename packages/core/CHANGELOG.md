# @codocs/core

## 0.0.2

### Patch Changes

- 020bc1b: Incompatible change: documents now require five attributes (`id`, `name`, `definition`, `domains`, `deprecatedAliases`). Add `deprecatedAliases: []` to every document. `kind`, `status`, and `examples` are no longer product attributes and are kept as user attributes, so delete them if unused. `codocs_list` no longer accepts `kind` or `status`, and the `deprecated_reference` warning is removed. Existing documents without `deprecatedAliases` now report `missing_required_field`, and references to them report `reference_target_error` until they are fixed.

  호환되지 않는 변경: 문서에 `id`, `name`, `definition`, `domains`, `deprecatedAliases` 다섯 속성이 필수가 된다. 모든 문서에 `deprecatedAliases: []`를 추가한다. `kind`, `status`, `examples`는 더 이상 제품 속성이 아니며 사용자 속성으로 보존되므로 쓰지 않으면 삭제한다. `codocs_list`는 `kind`와 `status`를 받지 않고 `deprecated_reference` 경고는 사라진다. `deprecatedAliases`가 없는 기존 문서는 `missing_required_field`를 보고하고, 그 문서를 참조하면 고칠 때까지 `reference_target_error`를 보고한다.

- adb49f5: User attributes (top-level fields and extra keys in `deprecatedAliases` items) are now preserved without the `unknown_field` warning, and the `unknown_field` diagnostic code is removed.

  사용자 속성(최상위 필드와 `deprecatedAliases` 항목의 추가 키)은 `unknown_field` 경고 없이 보존되며, `unknown_field` 진단 코드는 제거된다.
