# COD-14 Performance Report

Generated: 2026-09-20T09:13:34.748Z

## Configuration

- Seed: `cod14-fixed-seed-v1`
- Documents: 1000
- Startup runs: 10
- Query warmups/samples: 100/1000
- Propagation runs/timeout: 100/500 ms
- Output: `D:\dev\.codex-worktrees\wb-prepare-cod14-cfcadb499651-f3c3c6\task-003\.github\workplans\COD-14-results\baseline-1000`
- Node: v24.21.0 (win32 x64)

All latency values are milliseconds. Memory values are bytes. Incorrect, timeout, and event-only observations are retained in JSON and excluded from successful latency summaries.

## Scale observations

| Documents | Fixture manifest | Startup p95 | Query 1 p95 | Query 10 p95 | Query 20 p95 | Propagation p95 | Propagation <= 500 ms |
| --------: | ---------------- | ----------: | ----------: | -----------: | -----------: | --------------: | --------------------- |
|      1000 | `16f41dfe01cb…`  |    1212.831 |       0.010 |        0.031 |        0.045 |             n/a | no                    |

## Correctness and failures

| Documents | Category                | Observations | Successful latency samples | Classifications        |
| --------: | ----------------------- | -----------: | -------------------------: | ---------------------- |
|      1000 | startup                 |           10 |                         10 | success: 10            |
|      1000 | get 1                   |        10000 |                      10000 | success: 10000         |
|      1000 | get 10                  |        10000 |                      10000 | success: 10000         |
|      1000 | get 20                  |        10000 |                      10000 | success: 10000         |
|      1000 | get 21+ invalid request |        10000 |                      10000 | invalid_request: 10000 |
|      1000 | external propagation    |         1000 |                          0 | timeout: 1000          |

Overall correctness: FAIL

Failures retained: 1000
