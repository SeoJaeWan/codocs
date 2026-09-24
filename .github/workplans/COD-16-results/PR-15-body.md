# PR #15 — YAML 이름 참조 원문 이동

## Prerequisite

PR #13 (COD-16) must land first. PR #15 reuses its confirmed source-link payload and `codocs.openSource` tab/revision behavior.

## Scope

- Resolve YAML body `[[이름]]` references to confirmed document links.
- Pass the path, confirmed range, raw-byte revision, and catalog observation obtained during reference resolution to the shared source-opening command.
- Reuse PR #13 behavior for existing tabs and dirty YAML buffers; do not resolve a different target again from an ID or name when opening.
- Preserve move/delete/partial-read diagnostics and never invent an unconfirmed path or range.
- Provide every confirmed link when a name has multiple candidates, without choosing an arbitrary representative or expanding transitive links.

## Validation

Add focused cases for a normal `[[이름]]` reference, multiple candidates, moved and deleted source files, partial reads, and stale catalog observations. Run the installed VSIX scenario after PR #13 and record source-open, tab reuse, dirty-buffer, and missing-link evidence.

This is a prepared PR body for manual delivery. No GitHub issue or pull request was created or modified by TASK-005.
