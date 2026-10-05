---
'@codocs/core': patch
'@codocs/workspace': patch
---

Add the shared rename engine: `planRename` now blocks wrong selections, `applyRenameChanges` edits the original source by offset while keeping each scalar's quoting style, and the workspace previews and applies a document rename across files (per-file revision check, pre-write check, sequential temp-file replacement with recovery, per-file status, index update). `codocs_write` update now rejects a `set.name` that differs from the current name with `name_change_not_allowed` and points to `codocs_rename`.

공유 이름 변경 엔진을 추가한다. `planRename`은 잘못된 선택을 blocked로 처리하고, `applyRenameChanges`는 위치별 스칼라 따옴표 형식을 유지하며 원문 offset으로 수정한다. workspace는 문서 이름 변경을 여러 파일에 미리보기·반영(파일별 revision 확인, 쓰기 전 확인, 순차 임시 파일 교체와 복구, 파일별 상태 보고, 색인 반영)한다. `codocs_write` update는 현재 이름과 다른 `set.name`을 `name_change_not_allowed`로 거절하고 `codocs_rename`을 안내한다.
