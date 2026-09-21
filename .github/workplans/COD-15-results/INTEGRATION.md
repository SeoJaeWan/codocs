# COD-15 integration seal

## Final classification

`ACTION_REQUIRED` — the exact TASK-001 through TASK-004 chain is preserved and the integrated implementation at `78c95c3f0d17c72f1b2128ac15f1aebf9455912d` remains a usable candidate. It is not classified as verified.

The focused language-server/VS Code suite, typecheck, scoped and repository lint, bundle, build, package creation, archive inspection, and a repeated installed-VSIX Extension Host run pass. The seal remains provisional because the required package-consumer suite has three failures introduced by the COD-15 extension package shape, the full Vitest run retains the four documented external-target watcher timeouts, one internal watcher assertion was transiently missed in the full run, the repository Prettier baseline remains, and the first real-host attempt hit a restart race before an unchanged retry passed.

The candidate integrated head before this evidence-only commit is:

```text
78c95c3f0d17c72f1b2128ac15f1aebf9455912d
```

## Sealed task chain

The integration worktree was created directly from the packet's exact base selector. Before this evidence commit, `git rev-parse HEAD` returned `78c95c3f0d17c72f1b2128ac15f1aebf9455912d`. All four ancestry probes exited 0, the range contains exactly four commits, and every task result has exactly the declared parent:

```text
42e57dd5ad36c549f278466c97a3f627d913c8a0
  -> c4f59938041d839dca2fda1c1b4c6f5b44854a99  TASK-001
  -> ecada71e0ccb1b1920b0c9e735f4bed675e31c3b  TASK-002
  -> 302beb65989f75f142e5459f338f73ea220b6ee2  TASK-003
  -> 78c95c3f0d17c72f1b2128ac15f1aebf9455912d  TASK-004
```

| Task     | Declared result                            | Exact parent                               | Integration assessment                                                                                                                 |
| -------- | ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| TASK-001 | `c4f59938041d839dca2fda1c1b4c6f5b44854a99` | `42e57dd5ad36c549f278466c97a3f627d913c8a0` | exact commit and parent verified                                                                                                       |
| TASK-002 | `ecada71e0ccb1b1920b0c9e735f4bed675e31c3b` | TASK-001                                   | exact commit and parent verified; execution-binding recomputation remains unverified provenance, as declared by the integration packet |
| TASK-003 | `302beb65989f75f142e5459f338f73ea220b6ee2` | TASK-002                                   | exact commit and parent verified; retained provisional candidate because its broader suite recorded watcher timeouts                   |
| TASK-004 | `78c95c3f0d17c72f1b2128ac15f1aebf9455912d` | TASK-003                                   | exact commit and parent verified; committed real-host runner/evidence is present and was rerun here                                    |

No task commit was rewritten, squashed, merged, or reordered. The integration commit adds only this document.

## Packet identity and provenance

- Task: `INT-001`, run `wb-prepare-cod15-20260920T141237Z-42e57dd5ad36-f710f7`.
- Repository/common Git directory: `/Users/seojaewan/Desktop/dev/codocs/.git`.
- Assigned worktree: `/private/tmp/codocs-execute-COD-15-int-001`.
- Branch: `codex/COD-15-int-001`.
- Packet `task_packet_digest`: `null`; no digest was available to recompute or compare.
- Packet execution-binding digest: `sha256:03a9f769f89715f262545a6198971e736531ad1f29b169e4d6bf2674a58e464c`.
- The repository contains no Git notes or committed per-task packet/binding records for TASK-001 through TASK-004. Commit existence, exact parentage, tree scope, and committed evidence were verified directly; the packet-declared TASK-002 execution-binding recomputation risk is carried forward and is not reclassified as a product failure.

## Runtime and source contracts

Environment: macOS 26.5.1 arm64, Node.js v24.21.0, pnpm 10.34.5, Git 2.54.0, Visual Studio Code 1.136.1 (`a44adf7f53e00964ab890f9f8758a334f1fc15bc`, arm64). The Node and pnpm versions match `.node-version` and `package.json`.

The fresh worktree initially had no dependencies. `pnpm install --offline --frozen-lockfile` stopped because `vscode-languageserver@9.0.1` was absent from the shared store. The unchanged command without `--offline` downloaded 21 packages and completed with the frozen lockfile. Neither setup command changed tracked files.

Source contracts were read from the exact TASK-004 result before the evidence commit:

| Contract                                           | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `.codocs/index.yaml`                               | `d9d993beff0201bf608a6e0c1dc8f7bf8855e5589c0c7af0c93ff5b63d4a412b` |
| `.codocs/development/development-environment.yaml` | `09e2aa0454ed3549d79eacb61062668afa1ec77b822b734a88c12f84fb5da524` |
| `.codocs/development/runtime-architecture.yaml`    | `2e46e9565ad3b4069fc7496b73d977371488f809cf6cff664b9351f5d0299593` |
| `.codocs/development/test-convention.yaml`         | `2a72bd94de08275d2df87e7b86a3d3ec36f1353243a2a03badd3d6d3b8f3a81e` |
| `.codocs/language-server/document-sync.yaml`       | `889722e3dc8538170391ff319fea8e0b8bf72b66dbe896cb2ed564165b209182` |
| `.codocs/language-server/ide-support.yaml`         | `7d24f65e20928757444045b9efdc7495c83fc7f60f1221d1a555e1e89d87c934` |
| `.codocs/vscode/server-connection.yaml`            | `10de69d740b238a2d62b31d1749cce9be2a240e2b72cc019755baa88b964f827` |
| `.codocs/vscode/vscode.yaml`                       | `2bff8e4861d8c98b492340fa253c866d6cf425ffc36cb69256f20c3bf9c9ea93` |

## Scope audit

The base-to-candidate diff contains 25 paths: 21 package implementation/test/manifest paths, `pnpm-lock.yaml`, and three committed Extension Host runner/evidence paths under `tools/extension-host`. It contains no `.codocs` or `.workbench` change. This integration run did not change `packages/core`, `packages/workspace`, `packages/language-server`, `packages/vscode`, `.codocs`, `.workbench`, the lockfile, tests, or product contracts.

TASK-004's committed evidence is `tools/extension-host/verification-evidence.md`. It records the earlier successful real-host run, its package inspection, the four external-target watcher timeouts, and the seven-file Prettier baseline. This seal preserves those findings and adds the current integration observations below.

## Verification results

Every listed command used Node v24.21.0 by prepending `$PWD/.workbench/runtime/node-v24.21.0-darwin-arm64/bin` to `PATH` during execution.

| Command                                                                                       | Result                                                            | Evidence/classification                                                                                                     |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| exact `git rev-parse`, parent checks, `merge-base --is-ancestor`, and four-commit count       | PASS                                                              | exact linear task chain and pre-seal head confirmed                                                                         |
| `node tools/build/build.mjs typecheck`                                                        | PASS, 6.41 s                                                      | cross-package declarations and root/package typechecks pass                                                                 |
| scoped ESLint over COD-15 package/tool paths                                                  | PASS, 3.50 s                                                      | changed implementation and tests pass                                                                                       |
| `node node_modules/eslint/bin/eslint.js .`                                                    | PASS, 5.21 s                                                      | repository lint passes                                                                                                      |
| Prettier over every base-to-candidate changed path                                            | FAIL, 0.57 s                                                      | only `packages/workspace/src/query/query.test.ts`; retained documented formatting baseline                                  |
| `node node_modules/prettier/bin/prettier.cjs . --check`                                       | FAIL, 9.88 s                                                      | exact seven-file baseline listed below                                                                                      |
| `node tools/build/build.mjs bundle`                                                           | PASS, 1.85 s                                                      | independent bundles and copied assets produced                                                                              |
| `node tools/build/build.mjs build`                                                            | PASS, 2.70 s                                                      | cross-package build and extension/server bundles produced                                                                   |
| `pnpm --dir packages/vscode pack --pack-destination <temp>`                                   | PASS, 0.34 s                                                      | TGZ created and inspected                                                                                                   |
| `vsce 3.6.2 package`                                                                          | FAIL, 11.23 s                                                     | npm dependency enumeration is incompatible with the pnpm workspace layout and reports missing development/test dependencies |
| `vsce 3.6.2 package --no-dependencies`                                                        | PASS, 1.02 s                                                      | VSIX created with the existing missing repository/license warnings; dependencies are already bundled                        |
| archive SHA-256/list inspection                                                               | PASS                                                              | 20-file VSIX and 18-file TGZ contain manifests, bundles, declarations, server, guide, and examples; neither contains `src/` |
| `node node_modules/vitest/vitest.mjs run packages/language-server packages/vscode`            | PASS, 6 files / 27 tests, 1.07 s                                  | focused language-server and VS Code behavior passes                                                                         |
| `node node_modules/vitest/vitest.mjs run`                                                     | FAIL, 24 files passed / 1 failed; 615 passed / 5 failed, 128.44 s | four known external-target watcher timeouts plus one transient internal watcher miss                                        |
| focused rerun of the internal `nested/deep/alpha.yaml` watcher case                           | PASS, 1 passed / 13 skipped, 0.60 s                               | the extra full-run miss did not reproduce                                                                                   |
| `node tools/check/run.mjs build`                                                              | FAIL, 29 passed / 3 failed, 26.26 s                               | new COD-15 package-consumer failures described below                                                                        |
| installed-VSIX `node tools/extension-host/run.mjs --vsix <temp>/codocs-0.0.0.vsix`, attempt 1 | FAIL, 20.87 s                                                     | real host reached crash injection but a client remained `Starting`; `Connection is disposed` and automatic-restart timeout  |
| identical installed-VSIX command, attempt 2                                                   | PASS, 7.01 s                                                      | real Extension Host acceptance completed with the full expected evidence                                                    |

An exploratory invocation of normal Vitest against `tools/build-checks` found no files because repository `vitest.config.ts` includes only `packages/**/*.test.ts`. It was replaced by the repository-supported `node tools/check/run.mjs build` command above; the no-files result is not represented as a product check.

## Package and real-host evidence

Temporary artifacts are isolated under `/private/tmp/codocs-COD-15-int-001.p1HptK`:

| Artifact            | SHA-256                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `codocs-0.0.0.vsix` | `103cdc4709209d4ca36582368201ef1fc56689fac2388fa669704ed18ca7b435` |
| `codocs-0.0.0.tgz`  | `a8dc796d1b786ad79c5de6f87ee6fdd967565294a4b8a83b26ab27505794177e` |

The TGZ hash exactly matches TASK-004's committed package evidence. The VSIX was freshly assembled and its content listing was inspected rather than inferred from the earlier artifact.

The first VSIX command let `vsce` run `npm list --production`; npm reported pnpm-linked development/test dependencies such as `@types/minimatch`, `shx`, and `tap` as missing. TASK-004's bundle already embeds the extension's runtime dependencies, so the package was rerun with `--no-dependencies`, the same packaging mode appropriate for the committed bundled output. Archive inspection and the installed-host run validate that resulting VSIX directly.

The passing installed-VSIX attempt used an isolated user-data and extensions directory and reported:

- extension `codocs.codocs` active under VS Code 1.136.1;
- four workspace folders and four separate server processes;
- missing `.codocs` left absent and created/changed `.codocs` observed without process loss;
- unsaved Java document remained at version 2, dirty, text-preserved, and disk-unchanged across restart;
- manual restart replaced every server process;
- three automatic restarts observed, the fourth crash stopped one server, and manual recovery restored all four;
- installed extension resolved and ran its embedded `dist/server/index.cjs`.

The expected crash injection emitted `Unexpected SIGPIPE`. The first attempt additionally exposed a real restart race: a language client was disposed while `Starting`, leading to rejected promises and a timeout waiting for automatic restart. The unchanged immediate retry passed. This is recorded as flakiness requiring follow-up, not converted into a clean single-run acceptance.

## Retained and new findings

### Workspace watcher baseline

The full suite again timed out at `packages/workspace/src/watcher/watcher.test.ts:198`, `:213`, `:233`, and `:250` after 30 seconds each. These are the committed external-target baseline findings from TASK-003/TASK-004. The integration run also missed the internal creation assertion at line 62 after 5 seconds; that exact case passed in 405 ms in an immediate focused rerun. No workspace file differs from the integrated candidate and no workspace implementation or test was modified here.

### Prettier baseline

The repository check reports exactly the seven previously committed paths:

```text
.github/workplans/COD-14-results/focused-1000-10s-20260920/cod14-performance.json
.github/workplans/COD-14-results/full-scale-20260920/cod14-performance.json
packages/workspace/src/loader/loader-identity.test.ts
packages/workspace/src/loader/loader.test.ts
packages/workspace/src/paths/paths.test.ts
packages/workspace/src/project-root/project-root.test.ts
packages/workspace/src/query/query.test.ts
```

The changed-path check reaches `packages/workspace/src/query/query.test.ts` because TASK-001 changed that pre-existing test. The finding was already recorded by TASK-004 and is preserved without reformatting unrelated code.

### Package-consumer regression

`node tools/check/run.mjs build` runs the unchanged `tools/build-checks/build-checks.test.ts` against freshly packed packages. It now fails three of 32 checks:

1. Importing every package from an ordinary Node ESM consumer fails when the packed `codocs` extension entry requires the host-only `vscode` module.
2. Requiring the packed extension entry from an ordinary Node CJS consumer fails for the same `MODULE_NOT_FOUND: vscode` reason.
3. The separate TypeScript consumer's `--traceResolution` subprocess exceeds the test's default `execFileSync` buffer after the new extension/language-client declaration graph is installed (`ENOBUFS`).

The build-check file is unchanged from `42e57dd5ad36c549f278466c97a3f627d913c8a0`; COD-15 changed the formerly empty `@codocs/vscode` package into the `codocs` extension and added the runtime host import. The real installed extension works, but the repository's existing packed public-entry consumer contract no longer passes. Resolving that contract/test mismatch requires a source- or test-owning follow-up and is outside this integration evidence task.

## Required follow-up

1. Reconcile the packed extension's public-entry behavior with the repository package-consumer contract, and bound or remove the declaration trace overflow; rerun `node tools/check/run.mjs build` until all 32 checks pass.
2. Investigate the installed-host crash-restart race reproduced on the first integration attempt, then demonstrate repeated clean runs of the committed runner.
3. Resolve or explicitly capability-gate the four external-target watcher timeouts and investigate the transient internal creation miss without weakening the watcher contract.
4. Format the seven baseline paths in their owning scope, then rerun changed-path and repository Prettier checks.
5. Recover and verify the TASK-002 execution-binding recomputation evidence if provenance must be fully attestable.

No push, publish, pull request, merge, coordinator-checkout edit, product-code edit, test edit, contract edit, or worktree deletion was performed by INT-001.
