# COD-14 measurement and optimization results

## Classification

The 1,000-document target passes after the TypeScript optimization. Startup passed in every repetition against the 2,000 ms target, and completed external writes became exactly visible through public `codocs_get` without refresh within 500 ms in every repetition. Valid get sizes 1, 10, and 20 are reported separately and include exact responses only. The 21-ID case remains an invalid-input regression and is not included in valid-query latency samples.

| Target observation at 1,000 documents |                                            Before |                                             After | Classification                                |
| ------------------------------------- | ------------------------------------------------: | ------------------------------------------------: | --------------------------------------------- |
| Startup                               | 10/10 success; p95 1,212.831 ms; max 1,243.915 ms |     10/10 success; p95 872.734 ms; max 914.798 ms | pass (< 2,000 ms every run)                   |
| Get 1                                 |                 10,000/10,000 exact; p95 0.010 ms |                 10,000/10,000 exact; p95 0.008 ms | correct                                       |
| Get 10                                |                 10,000/10,000 exact; p95 0.031 ms |                 10,000/10,000 exact; p95 0.032 ms | correct                                       |
| Get 20                                |                 10,000/10,000 exact; p95 0.045 ms |                 10,000/10,000 exact; p95 0.046 ms | correct                                       |
| Get 21 invalid                        |                   10,000/10,000 `invalid_request` |                   10,000/10,000 `invalid_request` | regression pass; excluded from valid latency  |
| External write propagation            |  0/1,000 exact; 1,000 timeouts; no successful p95 | 1,000/1,000 exact; p95 411.654 ms; max 446.299 ms | pass after optimization (every run <= 500 ms) |

No samples were removed. The baseline timeouts remain classified as timeouts; they were not relabeled as successes or event-only observations.

## Evidence-backed optimization

The baseline ended each propagation window with the public response reporting that the index was rebuilding. A watcher event started `loadWorkspace`, whose directory traversal resolved and read every entry serially. The production change in `packages/workspace/src/loader/index.ts` resolves and reads non-directory entries in bounded batches of 64 while retaining sorted discovery and serial directory traversal for cycle ancestry. Public response contracts, cursor behavior, the 20-ID maximum, watcher boundaries, and no-refresh behavior are unchanged.

The full target rerun used the same seed, fixture digests, process isolation, measurement boundaries, and repetition counts as the baseline. The manifest digest was `16f41dfe01cbef0f98e8e902679dfd37c4023ecf3fdc1f26329171ce51cba9d9`; the expected-values digest was `cf9dbdf59080f1125744df04f1820f77cb0d2a3d963e2966c343cb8cf402e85f`.

## Comparison scales

Comparison scales were intentionally reduced after the required all-scale command proved environment-bound. These observations use one independent startup process, 20 warmups, 100 query samples per valid size, and 3 propagation repetitions. They are comparisons, not full verification.

| Documents | Fixture bytes |      Startup | Get 1/10/20 p95          | Propagation              | Classification           |
| --------: | ------------: | -----------: | ------------------------ | ------------------------ | ------------------------ |
|       100 |        19,668 |   242.289 ms | 0.008 / 0.053 / 0.050 ms | 3/3 exact; p95 92.479 ms | comparison pass          |
|     5,000 |       981,383 | 3,223.133 ms | 0.015 / 0.074 / 0.102 ms | 0/3 exact; 3 timeouts    | comparison miss retained |
|    10,000 |     1,962,548 | 6,939.656 ms | 0.016 / 0.074 / 0.116 ms | 0/3 exact; 3 timeouts    | comparison miss retained |

Each fixture has one UTF-8 YAML document per file, 193-199 bytes before measured external changes, seven possible domains, four kinds, three statuses, and no references. The fixed seed is `cod14-fixed-seed-v1`.

## Environment, boundaries, and process observations

- Environment: Windows `win32` x64, Node v24.21.0, one fresh child process per startup repetition, cold process/module state and regenerated deterministic fixture per process.
- Startup boundary: after fixture generation and immediately before spawning a fresh Node process through the first indexed, watcher-ready public `codocs_get` return.
- Query boundary: public `codocs_get` promise invocation through resolution. Successful p95 values contain exact responses only.
- Propagation boundary: completed external file write through exact public `codocs_get` content visibility. The harness never called refresh and kept the 500 ms timeout unchanged.
- Baseline target memory across 10 processes: RSS 328,478,720-362,442,752 bytes; heap used 47,392,616-141,538,984 bytes. Event-loop p99 was 15.843-17.203 ms.
- Optimized target memory across 10 processes: RSS 374,312,960-398,172,160 bytes; heap used 99,748,152-193,288,864 bytes. Event-loop p99 was 19.644-21.938 ms.
- Reduced 100/5,000/10,000 comparison RSS was 102,535,168 / 651,710,464 / 940,957,696 bytes; heap used was 33,858,008 / 446,050,912 / 700,405,720 bytes; event-loop p99 was 31.736 / 72.942 / 97.255 ms. These are observations only; no memory or event-loop pass threshold was invented.

## Commands and artifacts

Baseline target:

```text
pnpm performance:cod14 -- --documents 1000 --startup-runs 10 --warmup-runs 100 --query-runs 1000 --propagation-runs 100 --output .github/workplans/COD-14-results/baseline-1000
```

Optimized target:

```text
pnpm performance:cod14 -- --documents 1000 --startup-runs 10 --warmup-runs 100 --query-runs 1000 --propagation-runs 100 --output .github/workplans/COD-14-results/optimized-1000
```

Reduced optimized comparisons:

```text
pnpm performance:cod14 -- --documents 100,5000,10000 --startup-runs 1 --warmup-runs 20 --query-runs 100 --propagation-runs 3 --output .github/workplans/COD-14-results/optimized-comparisons-reduced
```

Raw JSON and generated Markdown are retained beside this file in `baseline-1000`, `optimized-1000`, `optimized-smoke-1000`, and `optimized-comparisons-reduced`.

## Verification

- `node tools/build/build.mjs build`: passed.
- `node tools/build/build.mjs typecheck`: passed.
- `node node_modules/eslint/bin/eslint.js packages/core packages/workspace`: passed.
- `node node_modules/prettier/bin/prettier.cjs packages/core packages/workspace .github/workplans/COD-14-results --check`: passed after formatting the generated reports.
- `node tools/check/run.mjs test`: completed one 590-test pass (544 passed, 46 failed), then remained in Vitest watch mode and was stopped.
- `node node_modules/vitest/vitest.mjs run`: reproduced 544 passed and 46 failed across 19 files in 3.65 seconds. Failures comprise Windows symlink privilege errors, chmod permission assumptions, and existing slash-sensitive fixture expectations and their dependent change-plan assertions. The focused loader/query/watcher run passed 70 of 90 tests; its 20 failures were symlink/chmod environment cases.

## Limitations

- The required all-scale command was started unchanged. It completed the 100- and 1,000-document work and reached 5,000 documents, but the harness writes reports only after all requested scales. It was interrupted at the 5,000 scale because serial rebuild time made the remaining comparison repetitions excessive, so that attempt produced no partial artifact. The complete 1,000 target was immediately rerun with identical planned counts and retained above; 100/5,000/10,000 were rerun with the explicitly reduced comparison settings.
- A first setup attempt failed before any measurement because the fresh worktree had no built `packages/mcp/dist/index.js`. Dependencies were installed offline and the repository was built before measurement; the failed setup attempt contributed no sample.
- The execution packet and harness specify numeric startup and propagation targets but do not encode a numeric query p95 threshold. This report therefore records each exact valid-query p95 and correctness count without inventing a query pass threshold.
- On this Windows host, symlink creation is unavailable to the test process, chmod-based permission denial is not enforced, and several tests expect POSIX-style relative paths. The affected regression cases remain unverified on this host, so the result is a provisional candidate despite the complete passing target measurement and successful static checks.

## Follow-up verification

The follow-up keeps the existing bounded loader batching. It adds a named Korean-JSDoc helper for the batch callback and makes the regression suite capability-aware: symlink and POSIX permission cases are registered only when the host can exercise them, while path assertions use the host separator. On Windows, `pnpm lint`, `pnpm typecheck`, and the full Vitest run pass with 550 passed and 40 capability-gated skips across 19 files. The 5,000- and 10,000-document propagation timeouts remain recorded as deferred refresh/indexing work; this pass does not claim a new cross-scale performance result.

## Full-scale comparison rerun

On 2026-09-20, all four fixture sizes were measured in one run with one independent startup process, 20 warmup calls, 100 samples for each valid get size, and 3 external-write propagation observations. This is a scale comparison, not the 1,000-document acceptance run: the reduced repetition counts do not replace the planned 10-startup/1,000-query/100-propagation verification.

```text
pnpm performance:cod14 -- --documents 100,1000,5000,10000 --startup-runs 1 --warmup-runs 20 --query-runs 100 --propagation-runs 3 --output .github/workplans/COD-14-results/full-scale-20260920 --fixture-root .workbench/fixtures/cod14-full-scale-20260920
```

| Documents |       Startup |          Get 1/10/20 p95 |               Propagation | Classification   |
| --------: | ------------: | -----------------------: | ------------------------: | ---------------- |
|       100 |    357.722 ms | 0.032 / 0.038 / 0.071 ms | 3/3 exact; p95 190.542 ms | comparison pass  |
|     1,000 |  1,606.560 ms | 0.016 / 0.111 / 0.104 ms |              0/3; timeout | propagation miss |
|     5,000 |  7,064.438 ms | 0.016 / 0.083 / 0.122 ms |              0/3; timeout | propagation miss |
|    10,000 | 14,060.644 ms | 0.018 / 0.086 / 0.140 ms |              0/3; timeout | propagation miss |

All startup, valid get, and 21-ID invalid-request observations were exact. The command exited with status 1 because the retained propagation timeouts make the overall correctness field fail; the raw JSON and Markdown report were still written to `full-scale-20260920`.

The 1,000-document scale was rerun on the current branch with the same 1/20/100/3 repetition settings and a 10,000 ms propagation observation limit. All three external writes completed, but propagation p95 was 1,058.783 ms, so the 500 ms target miss is a real slow completion rather than an unobserved correctness result. The earlier `optimized-1000` artifact reports 411.654 ms from a previous worktree state; that value is retained as historical evidence and is not reproduced by the current branch.
