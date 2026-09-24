# COD-14 Performance Report

Generated: 2026-09-20T09:24:25.735Z

## Configuration

- Seed: `cod14-fixed-seed-v1`
- Documents: 100, 5000, 10000
- Startup runs: 1
- Query warmups/samples: 20/100
- Propagation runs/timeout: 3/500 ms
- Output: `D:\dev\.codex-worktrees\wb-prepare-cod14-cfcadb499651-f3c3c6\task-003\.github\workplans\COD-14-results\optimized-comparisons-reduced`
- Node: v24.21.0 (win32 x64)

All latency values are milliseconds. Memory values are bytes. Incorrect, timeout, and event-only observations are retained in JSON and excluded from successful latency summaries.

## Scale observations

| Documents | Fixture manifest | Startup p95 | Query 1 p95 | Query 10 p95 | Query 20 p95 | Propagation p95 | Propagation <= 500 ms |
| --------: | ---------------- | ----------: | ----------: | -----------: | -----------: | --------------: | --------------------- |
|       100 | `76fa04f4f025…`  |     242.289 |       0.008 |        0.053 |        0.050 |          92.479 | yes                   |
|      5000 | `d13bb5b68893…`  |    3223.133 |       0.015 |        0.074 |        0.102 |             n/a | no                    |
|     10000 | `d80100332042…`  |    6939.656 |       0.016 |        0.074 |        0.116 |             n/a | no                    |

## Correctness and failures

| Documents | Category                | Observations | Successful latency samples | Classifications      |
| --------: | ----------------------- | -----------: | -------------------------: | -------------------- |
|       100 | startup                 |            1 |                          1 | success: 1           |
|       100 | get 1                   |          100 |                        100 | success: 100         |
|       100 | get 10                  |          100 |                        100 | success: 100         |
|       100 | get 20                  |          100 |                        100 | success: 100         |
|       100 | get 21+ invalid request |          100 |                        100 | invalid_request: 100 |
|       100 | external propagation    |            3 |                          3 | success: 3           |
|      5000 | startup                 |            1 |                          1 | success: 1           |
|      5000 | get 1                   |          100 |                        100 | success: 100         |
|      5000 | get 10                  |          100 |                        100 | success: 100         |
|      5000 | get 20                  |          100 |                        100 | success: 100         |
|      5000 | get 21+ invalid request |          100 |                        100 | invalid_request: 100 |
|      5000 | external propagation    |            3 |                          0 | timeout: 3           |
|     10000 | startup                 |            1 |                          1 | success: 1           |
|     10000 | get 1                   |          100 |                        100 | success: 100         |
|     10000 | get 10                  |          100 |                        100 | success: 100         |
|     10000 | get 20                  |          100 |                        100 | success: 100         |
|     10000 | get 21+ invalid request |          100 |                        100 | invalid_request: 100 |
|     10000 | external propagation    |            3 |                          0 | timeout: 3           |

Overall correctness: FAIL

Failures retained: 6
