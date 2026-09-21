# COD-15 TASK-004 verification evidence

Date: 2026-09-21 (Asia/Seoul)

Base commit: `302beb65989f75f142e5459f338f73ea220b6ee2`

Worktree: `/private/tmp/codocs-execute-COD-15-task-004`

Runtime:

- Node.js `24.21.0`
- pnpm `10.34.5`
- Visual Studio Code `1.136.1` (`arm64`)
- VS Code executable: `/Applications/Visual Studio Code.app/Contents/MacOS/Code`

## Source contract digests

| Contract                                           | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `.codocs/vscode/server-connection.yaml`            | `10de69d740b238a2d62b31d1749cce9be2a240e2b72cc019755baa88b964f827` |
| `.codocs/vscode/vscode.yaml`                       | `2bff8e4861d8c98b492340fa253c866d6cf425ffc36cb69256f20c3bf9c9ea93` |
| `.codocs/language-server/document-sync.yaml`       | `889722e3dc8538170391ff319fea8e0b8bf72b66dbe896cb2ed564165b209182` |
| `.codocs/language-server/ide-support.yaml`         | `7d24f65e20928757444045b9efdc7495c83fc7f60f1221d1a555e1e89d87c934` |
| `.codocs/development/development-environment.yaml` | `09e2aa0454ed3549d79eacb61062668afa1ec77b822b734a88c12f84fb5da524` |
| `.codocs/development/test-convention.yaml`         | `2a72bd94de08275d2df87e7b86a3d3ec36f1353243a2a03badd3d6d3b8f3a81e` |
| `.codocs/index.yaml`                               | `d9d993beff0201bf608a6e0c1dc8f7bf8855e5589c0c7af0c93ff5b63d4a412b` |

## Real Extension Host and installed package

The extension was built, packaged with `@vscode/vsce@3.6.2`, installed into an isolated extension directory, and executed by the installed VS Code Extension Host. The committed runner is:

```sh
node tools/extension-host/run.mjs --vsix /private/tmp/codocs-0.0.0.vsix
```

Final result: exit code `0`.

Observed through real VS Code runtime APIs and child processes:

- The `codocs.codocs` extension activated and registered `codocs.restartLanguageServers`.
- Four workspace folders, including nested parent/child roots, produced four separate Node IPC language-server processes.
- A workspace without `.codocs` did not gain one during activation.
- Creating and changing `.codocs` content preserved all four live server connections and exercised the extension file-system watchers.
- An open Java document used unsaved, malformed text containing a comment, a string, and an emoji. It stayed at version `2`, dirty, byte-for-byte unchanged in the editor, and unchanged on disk across manual restart.
- Manual restart replaced every language-server process, which exercises the language client's replay of open documents.
- Three forced server crashes restarted automatically. The fourth crash exhausted the rolling budget and left one server stopped. The manual command restored all four servers.
- Test-host shutdown left no language-server process behind.

The intentional `SIGKILL` crash sequence makes the VS Code host write `Unexpected SIGPIPE` to its own stderr. The test host still exits `0`; this is crash-injection evidence and is separate from the language-server protocol stdout/stderr assertions below.

## Child-process language-server protocol

`packages/language-server/src/server/server-process.test.ts` starts real bundled Node processes over stdio and verifies:

- LSP framing, initialize, full-document synchronization, shutdown, and exit;
- a nested workspace matches only its own catalog while a sibling document returns the explicit `workspace_not_found` state;
- dynamic workspace removal/addition;
- missing `.codocs` returns an empty successful catalog without creating the directory;
- created and changed catalog files become current after explicit refresh;
- comments, strings, incomplete source, emoji, and UTF-16 positions;
- a new server process receives the current unsaved document at version `7` after restart/resynchronization;
- server stderr is empty and stdout contains only complete LSP frames;
- child processes and fixture directories are cleaned up.

Focused result: 6 files passed, 27 tests passed.

## Package contents

Final temporary artifacts:

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `/private/tmp/codocs-0.0.0.vsix` | `7afc78527193aed4537603034cd0ef7e99a2ec1708d1a887f66733ed945f30c7` |
| `/private/tmp/codocs-0.0.0.tgz`  | `a8dc796d1b786ad79c5de6f87ee6fdd967565294a4b8a83b26ab27505794177e` |

The VSIX has 20 files. It contains `extension/package.json`, `extension/dist/index.cjs`, `extension/dist/index.cjs.map`, `extension/dist/server/index.cjs`, `extension/dist/server/index.cjs.map`, guide documentation, and two `.codocs` examples. It contains no `src` directory or TypeScript source tree. The installed extension resolved `dist/server/index.cjs` beneath its isolated package root and completed the real-host scenario.

`vsce` reported the existing package metadata warnings for missing `repository` and license fields. Packaging and isolated installation still succeeded.

## Required checks

| Check                                                                            | Result                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| focused Vitest (`packages/vscode packages/language-server tools/extension-host`) | PASS: 6 files, 27 tests                                                            |
| `node tools/build/build.mjs typecheck`                                           | PASS                                                                               |
| scoped ESLint                                                                    | PASS                                                                               |
| `node tools/build/build.mjs build`                                               | PASS                                                                               |
| changed-path Prettier                                                            | PASS                                                                               |
| full Vitest                                                                      | BASELINE: 24 files and 616 tests passed; 4 external-target watcher tests timed out |
| full Prettier                                                                    | BASELINE: 7 unrelated files reported                                               |

The full Vitest failures are the unchanged `packages/workspace/src/watcher/watcher.test.ts` external-target cases at lines 198, 213, 233, and 250. Each reached the existing 30-second timeout. `packages/workspace/**` has no diff from the pinned base commit. A COD-15 process fixture placed under the OS external temp path reproduced the same no-event timeout at both 5 and 15 seconds; moving the same fixture under the repository's ignored `.workbench/fixtures` directory passed immediately. No workspace implementation was changed.

The full Prettier baseline reports two COD-14 performance JSON artifacts and five existing workspace tests: `loader-identity.test.ts`, `loader.test.ts`, `paths.test.ts`, `project-root.test.ts`, and `query.test.ts`. All TASK-004 changed files pass Prettier.

## Mechanically necessary repair

Crash injection found that a stopped `vscode-languageclient` could not be recovered by the advertised manual command. The repair recreates a folder client on manual restart, waits for an in-flight `Starting` transition before disposal, and lets the repeated-crash close handler reach `DoNotRestart` without blocking on the error-message selection. The final installed-VSIX run proves the stopped client can be recovered while unsaved text remains open and unchanged on disk.
