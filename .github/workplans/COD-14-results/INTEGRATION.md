# COD-14 integration seal

## Final classification

The exact TASK-003 candidate at `e70d7166890b7204da6b03779d1c5752846337ce` is a **provisional candidate; action required**. The deterministic 1,000-document target is verified by the committed raw and generated evidence: all 10 startup repetitions completed below 2,000 ms, all valid get responses were exact, the 21-ID invalid-input regression was exact, and all 1,000 external-write observations became exactly visible without refresh within 500 ms. This target result does not verify the incomplete full comparison run or the Windows-limited regression cases.

Integration evidence is complete and continuation is allowed. The candidate is not classified as fully verified because the required broader lint command has a new error in the TASK-003 loader change, the full Windows test run retains 46 environment-dependent failures, `pnpm check` retains its Windows resolver failure, and full cross-scale behavior has not been measured successfully.

## Sealed chain and execution bindings

The integration audit started from a clean worktree at the exact parent/base `e70d7166890b7204da6b03779d1c5752846337ce`. `git merge-base --is-ancestor cfcadb4996518f0a59ce7b3a10e29f4d31cb1403 HEAD` exited 0. First-parent ancestry is linear and exact:

```text
cfcadb4996518f0a59ce7b3a10e29f4d31cb1403
  -> cd6668a45f2000fce88f8511626d73a006212065
  -> 0087b84d37f82b6dcbf74cded795fd3d63480938
  -> e70d7166890b7204da6b03779d1c5752846337ce
```

The coordinator-retained execution records were copied into this seal exactly:

| Task     | Packet digest                                                             | Execution binding digest                                                  | Result                                     | Status                | Continuation |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | --------------------- | ------------ |
| TASK-001 | `sha256:4b1f19595b52f8829cbf0d1b8a80143db4fb28c79a3a0bf08d305d58741ade9a` | `sha256:466c03f049ee3695277de95c24d545e65186a08eaf653dc2a239ca3ee8d3271b` | `cd6668a45f2000fce88f8511626d73a006212065` | provisional candidate | ALLOWED      |
| TASK-002 | `sha256:a02f3e0b3ef210c42ced30f7d5c30b3089803b1375193ff6483e96cb0957a83a` | `sha256:8666bd179b85d2b567dc899e3ebffb76efcd1fc6af6e391424ce027bb03cee1f` | `0087b84d37f82b6dcbf74cded795fd3d63480938` | verified              | ALLOWED      |
| TASK-003 | `sha256:82262746054ce3d2a5b7240641ca551fe0ff467868823c15e2f6dcee1f9bc25b` | `sha256:45556f9832b96195a768d9280eb17cf951e419ce4e1a40eedb46b274822dcaf5` | `e70d7166890b7204da6b03779d1c5752846337ce` | provisional candidate | ALLOWED      |
| INT-001  | `sha256:938355449dcab743df02d8e738983aabe0e399ab81f1c31ebb3be8c48077e147` | `sha256:040d0eb15fa47f005809d958f4486b68f59dd5c4ea12a4e8e13e2354a8b1872b` | this integration commit                    | provisional candidate | ALLOWED      |

## Scope audit

The three task commits contain only their intended result and implementation surfaces:

- TASK-001 changes `packages/workspace/src/query/index.ts` and `packages/workspace/src/query/query.test.ts`.
- TASK-002 adds the deterministic harness under `tools/performance`, adds its package script, and creates the results directory marker.
- TASK-003 changes `packages/workspace/src/loader/index.ts` and commits the consolidated and generated evidence under `.github/workplans/COD-14-results`.
- INT-001 adds only this file.

The base-to-candidate diff contains 18 paths: 10 result paths, 4 performance-harness paths, `package.json`, and 3 workspace implementation/test paths. There are no changes under `.codocs`, no `pnpm-lock.yaml` change, and no unrelated package change. The integration task did not modify any product, harness, package, lockfile, or `.codocs` path.

## Committed evidence audit

All four result sets parse as JSON and have paired generated Markdown. `RESULTS.md` consolidates commands, environment, measurement boundaries, counts, classifications, limitations, and the exact target fixture digests. No failure or timeout was rewritten or removed.

| Artifact                                               |      Bytes | SHA-256                                                            |
| ------------------------------------------------------ | ---------: | ------------------------------------------------------------------ |
| `RESULTS.md`                                           |      8,860 | `5d1a740b7c19f701569ad03ac456f9a5798cdbf015f75b6d4c2a748b4af513b2` |
| `baseline-1000/cod14-performance.json`                 | 15,644,894 | `609288321786dbedc85fbfd8a70d6a513f9ce2fbab2ac7f4050cc4bd1571c108` |
| `baseline-1000/cod14-performance.md`                   |      1,977 | `799765b1ae8ca45ad6aae36b161c73616eb7d0a48cb252c330e55bc07154eeb6` |
| `optimized-smoke-1000/cod14-performance.json`          |  1,044,722 | `e252d41df0e53bdd337bc6ff0e64b515c541ba906af94ae821b5c6e7fbfcd73d` |
| `optimized-smoke-1000/cod14-performance.md`            |      1,961 | `f80aacbd5034815626249a04a1c9edf53f05bf272690beb22b57b0f7d8281578` |
| `optimized-1000/cod14-performance.json`                | 15,154,964 | `398cab8bdb089749c126b8d279728d5a0e0a9d33fe2b85f2fe97911aa3cdc1cf` |
| `optimized-1000/cod14-performance.md`                  |      1,975 | `505843028af4dda65e4b4f2fe586b7aeb9357515ff4417a7715523959821b288` |
| `optimized-comparisons-reduced/cod14-performance.json` |  9,004,893 | `6be8422ef1a0c919f4014a55fe7804ca5dfbfc033b246f705ecf4d51a1ef9905` |
| `optimized-comparisons-reduced/cod14-performance.md`   |      3,549 | `242c864c426a3ce3e9b1e4af62f21367d1961996f7f5913006079c2492a1c4ca` |

The full target used seed `cod14-fixed-seed-v1`, manifest digest `16f41dfe01cbef0f98e8e902679dfd37c4023ecf3fdc1f26329171ce51cba9d9`, and expected-values digest `cf9dbdf59080f1125744df04f1820f77cb0d2a3d963e2966c343cb8cf402e85f`.

## Integration verification

Environment: Windows 10.0.26200 x64, Node v24.21.0, pnpm 10.34.5, Git 2.55.0.windows.5. The newly provisioned integration worktree initially had no dependencies. The first build attempt exited 1 after 160 ms with `ERR_MODULE_NOT_FOUND` for `esbuild`; `pnpm install --offline --frozen-lockfile` then exited 0 after 2,169 ms without changing the lockfile. The required build was rerun unchanged.

| Command                                                                                                                                                                                                                                  | Result                                                   |                        Duration | Classification                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `git merge-base --is-ancestor cfcadb4996518f0a59ce7b3a10e29f4d31cb1403 HEAD`                                                                                                                                                             | exit 0                                                   | ancestry/log/diff group: 201 ms | exact base ancestry confirmed                                                                                                            |
| `git log --oneline --decorate --max-count=6`                                                                                                                                                                                             | exit 0                                                   |                  included above | exact TASK-001 -> TASK-002 -> TASK-003 chain confirmed                                                                                   |
| `git diff --name-only cfcadb4996518f0a59ce7b3a10e29f4d31cb1403 HEAD`                                                                                                                                                                     | exit 0; 18 paths                                         |                  included above | intended task/result scope; forbidden integration surfaces unchanged                                                                     |
| `node tools/build/build.mjs build`                                                                                                                                                                                                       | exit 0                                                   |                        2,360 ms | pass after offline dependency setup                                                                                                      |
| `node tools/build/build.mjs typecheck`                                                                                                                                                                                                   | exit 0                                                   |                        5,550 ms | pass                                                                                                                                     |
| `node node_modules/eslint/bin/eslint.js packages/core packages/workspace tools/performance package.json`                                                                                                                                 | exit 1                                                   |                        5,675 ms | miss: `packages/workspace/src/loader/index.ts:322:20` lacks required Korean JSDoc; `package.json` also reports an ignored-file warning   |
| `node node_modules/prettier/bin/prettier.cjs packages/core packages/workspace tools/performance package.json .github/workplans/COD-14-results --check`                                                                                   | exit 0                                                   |             approximately 9.3 s | final pass including this report after formatting it                                                                                     |
| `node node_modules/vitest/vitest.mjs run packages/workspace/src/loader/loader.test.ts packages/workspace/src/query/query.test.ts packages/workspace/src/watcher/watcher.test.ts packages/workspace/src/watcher/watcher-recovery.test.ts` | exit 1; 69 passed, 19 failed, 88 total                   |                        3,329 ms | Windows symlink/chmod limitations reproduced; both watcher files passed                                                                  |
| `node node_modules/vitest/vitest.mjs run packages/workspace/src/query/query.test.ts packages/workspace/src/watcher/watcher.test.ts packages/workspace/src/watcher/watcher-recovery.test.ts -t cursor`                                    | exit 0; 15 passed, 42 skipped                            |                        2,748 ms | focused cursor behavior passes                                                                                                           |
| `node node_modules/vitest/vitest.mjs run packages/workspace/src/watcher/watcher.test.ts packages/workspace/src/watcher/watcher-recovery.test.ts`                                                                                         | exit 0; 25 passed                                        |                        3,151 ms | focused watcher behavior passes                                                                                                          |
| `node node_modules/vitest/vitest.mjs run`                                                                                                                                                                                                | exit 1; 544 passed, 46 failed, 590 total across 19 files |                        3,815 ms | known Windows regression limitations reproduced exactly                                                                                  |
| `pnpm check`                                                                                                                                                                                                                             | exit 1                                                   |                          854 ms | known Windows resolver failure reproduced: the check runner says pnpm 10.34.5 cannot be found even though it launched under pnpm 10.34.5 |

The focused cursor and watcher behavior passes. The combined focused loader/query/watcher command retains 19 Windows-only failures: symlink creation returns `EPERM`, and chmod-based access-denial assumptions do not hold. The full run's 46 failures extend those same limitations into path, project-root, loader-identity, query, and dependent change-plan assertions. No new functional failure was hidden or relabeled.

The TASK-003 worker recorded a narrower lint pass. This integration run used the required broader command and newly found that the batch-resolution arrow callback at `packages/workspace/src/loader/index.ts:322` violates `codocs/korean-jsdoc`. This static-check miss is independent of the Windows test limitations and requires a source follow-up.

## Target result and limitations

The verified 1,000-document target remains:

- startup: 10/10 success, p95 872.734 ms, max 914.798 ms, every run below 2,000 ms;
- get 1: 10,000/10,000 exact, p95 0.008 ms;
- get 10: 10,000/10,000 exact, p95 0.032 ms;
- get 20: 10,000/10,000 exact, p95 0.046 ms;
- get 21 invalid: 10,000/10,000 `invalid_request`, excluded from valid-query latency;
- external write propagation: 1,000/1,000 exact without refresh, p95 411.654 ms, max 446.299 ms, every run at or below 500 ms.

The cross-platform/full-regression result remains provisional. Windows cannot exercise the symlink and POSIX permission cases faithfully. The originally required all-scale performance command was interrupted during the 5,000-document work and emitted no partial artifact. Reduced comparisons are observations only: 100 documents passed propagation 3/3, while 5,000 and 10,000 documents each timed out 3/3. Those reduced counts do not replace full comparison-scale verification, and no numeric query-latency threshold was present in the execution packet.

## Required follow-up actions

1. Add the required Korean JSDoc for the TASK-003 batch-resolution callback in `packages/workspace/src/loader/index.ts` in a source-owning task, rerun the exact integration lint command, and retain the passing result.
2. Run the full 590-test suite on an environment that supports the symlink and POSIX permission contracts, and investigate any failure that remains after the 46 Windows-specific cases can execute normally.
3. Repair or bypass the Windows pnpm self-resolution defect in `tools/check/run.mjs`, then rerun `pnpm check` to completion.
4. Complete the planned comparison scales with the intended repetition counts and retain raw JSON plus generated Markdown, rather than promoting the reduced 1/20/100/3 runs to verification.
5. Investigate and remeasure the retained 5,000- and 10,000-document propagation misses before claiming behavior beyond the verified 1,000-document target.

No push, merge, pull request, coordinator-checkout edit, or source/harness edit was performed by INT-001.

## Post-integration follow-up

The follow-up source pass keeps the existing bounded loader batching and records the larger comparison-scale misses as follow-up work. It does not introduce an incremental refresh design or change the refresh boundary.

- `packages/workspace/src/loader/index.ts` now uses a named Korean-JSDoc helper for the batch-resolution callback. `pnpm lint` and `pnpm typecheck` pass.
- OS-sensitive tests probe the current file-system capabilities before registering symlink and permission-denial cases. Windows runs the portable path assertions and marks unsupported symlink/permission cases skipped; a host that supports those capabilities runs the same cases. Path expectations use `path` normalization instead of POSIX literals.
- The Windows full run now completes with 19 test files passing, 550 tests passing, and 40 capability-gated tests skipped. The skipped cases are the existing symlink and POSIX permission contracts; they remain available for a capable OS run.
- The previously observed 5,000- and 10,000-document propagation timeouts remain recorded in `RESULTS.md`. Improving refresh/index rebuild time is deferred to a later change and is outside this follow-up.
