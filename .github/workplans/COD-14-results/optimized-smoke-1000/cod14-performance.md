# COD-14 Performance Report

Generated: 2026-09-20T09:16:08.893Z

## Configuration

- Seed: `cod14-fixed-seed-v1`
- Documents: 1000
- Startup runs: 3
- Query warmups/samples: 20/100
- Propagation runs/timeout: 20/500 ms
- Output: `D:\dev\.codex-worktrees\wb-prepare-cod14-cfcadb499651-f3c3c6\task-003\.github\workplans\COD-14-results\optimized-smoke-1000`
- Node: v24.21.0 (win32 x64)

All latency values are milliseconds. Memory values are bytes. Incorrect, timeout, and event-only observations are retained in JSON and excluded from successful latency summaries.

## Scale observations

| Documents | Fixture manifest | Startup p95 | Query 1 p95 | Query 10 p95 | Query 20 p95 | Propagation p95 | Propagation <= 500 ms |
| --------: | ---------------- | ----------: | ----------: | -----------: | -----------: | --------------: | --------------------- |
|      1000 | `16f41dfe01cb…`  |     815.329 |       0.009 |        0.040 |        0.057 |         416.937 | yes                   |

## Correctness and failures

| Documents | Category                | Observations | Successful latency samples | Classifications      |
| --------: | ----------------------- | -----------: | -------------------------: | -------------------- |
|      1000 | startup                 |            3 |                          3 | success: 3           |
|      1000 | get 1                   |          300 |                        300 | success: 300         |
|      1000 | get 10                  |          300 |                        300 | success: 300         |
|      1000 | get 20                  |          300 |                        300 | success: 300         |
|      1000 | get 21+ invalid request |          300 |                        300 | invalid_request: 300 |
|      1000 | external propagation    |           60 |                         60 | success: 60          |

Overall correctness: PASS

Failures retained: 0
