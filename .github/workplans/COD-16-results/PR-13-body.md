# PR #13 — Hover confirmed documents and open source YAML

## Problem

Hover results must distinguish the document confirmed at the current code cursor from previous identifiers and other candidates. Users also need to inspect the exact YAML source without losing an existing tab or unsaved content.

## Change

- Keep `id`/`documentId` optional and emit them only for a valid current identifier; retain previous evidence, candidates, paths, and diagnostics.
- Rank cursor evidence by current identifier, contiguous token count, and exact match. Render every top-level tie and link remaining candidates under the same identifier.
- Render definition, confirmed current ID, domains, source link, direct references, and reverse references in separate non-empty sections.
- Add the standard LSP Hover output and the VS Code-only `codocs.openSource` command. The command accepts a confirmed URI, range, catalogVersion, and raw-byte revision payload, then moves the selection only when the range and revision checks pass.
- Reuse an existing tab and preserve unsaved content/selection when the current buffer and source revision no longer match.

## Validation

- Installed VSIX functional runs pass on VS Code 1.136.1 and pinned 1.95.0.
- Evidence covers UTF-16 positions, Korean/space paths, LF/CRLF source, nested workspace routing, dirty YAML, default definition navigation, watcher changes, and server restart recovery.
- The required 1,000-document p95 run was executed with seed 16018, 980 queryable documents, 10 missing IDs, 10 duplicate IDs, 100 warmups, and 1,000 measured requests planned. Initial index readiness completed, then a bounded warmup Hover timed out; p95 is recorded as `NOT_MEASURED` and remains a delivery blocker.

## Follow-up

The performance bottleneck and watcher path canonicalization finding require a separate product-owned follow-up. This draft is prepared for manual PR delivery; no GitHub mutation was performed.
