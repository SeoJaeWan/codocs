# COD-16 actual VSIX Extension Host evidence

## Results

The installed VSIX passed the functional scenario on both runtimes:

| Runtime           | Version       | Result | Evidence                                                                                                                            |
| ----------------- | ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Installed VS Code | 1.136.1 arm64 | PASS   | 4 workspace folders, 4 language-server processes, Hover and source-open flow, dirty YAML preservation, watcher and restart recovery |
| Pinned VS Code    | 1.95.0 arm64  | PASS   | Same functional assertions with isolated user-data/extensions directories                                                           |

The VSIX was packaged with Node `v24.21.0`, pnpm `10.34.5`, and `@vscode/vsce@3.6.2 package --no-dependencies` from `packages/vscode`. The final artifact SHA-256 is `e025f2340aa1f0621ccfcbab1614afc9b8eb850b78cc27b89740d33a860953ad`.

Full raw successful reports are [host-functional-1.136.1.json](./host-functional-1.136.1.json) and [host-functional-1.95.0.json](./host-functional-1.95.0.json). Both reports record the same final VSIX, extension bundle, and language-server bundle hashes.

## Covered behavior

- `reservationReturnZones` returns distinct reservation and return-zone Hover bodies and ranges.
- Nested workspace routing selects only the nearest workspace catalog.
- The generated `codocs.openSource` command opens a UTF-8 YAML file with a Korean/space path and CRLF contents.
- Repeated open reuses the existing tab. A dirty YAML buffer, disk contents, and selection remain unchanged when the revision differs.
- Built-in JavaScript definition navigation remains available.
- Missing `.codocs` is not generated; creating and changing it is observed without process loss.
- Manual restart replaces all servers while preserving the dirty code document. Three automatic crashes restart, a fourth reaches the restart budget, and manual recovery restores all servers.

## Evidence identity

The runner records the exact VS Code version, Extension Host Node version, VSIX hash, extension/server bundle hashes, workspace/server counts, URI, ranges, and restart PIDs in its JSON output. Failure directories are mode- and run-id-specific so a later performance attempt cannot overwrite functional evidence.

## Limitation

The first failed run used a temporary fixture under macOS `/var/folders`, while the workspace loader exposes `/private/var/folders` real paths to the watcher. The runner now keeps fixtures under this task worktree and profile directories under a short `/tmp` path; both functional versions pass with that correction. The path canonicalization behavior in the product watcher remains a separate follow-up finding for projects opened through a symlinked path.
