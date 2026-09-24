# COD-14 Performance Report

Generated: 2026-09-20T12:38:04.138Z

## Configuration

- Seed: `cod14-fixed-seed-v1`
- Documents: 1000
- Startup runs: 1
- Query warmups/samples: 20/100
- Propagation runs/timeout: 3/10000 ms
- Output: `D:\dev\codosc\.workbench\performance\cod14-focused-1000-10s-20260920`
- Node: v24.21.0 (win32 x64)

All latency values are milliseconds. Memory values are bytes. Incorrect, timeout, and event-only observations are retained in JSON and excluded from successful latency summaries.

## Scale observations

| Documents | Fixture manifest | Startup p95 | Query 1 p95 | Query 10 p95 | Query 20 p95 | Propagation p95 | Propagation <= 500 ms |
| --------: | ---------------- | ----------: | ----------: | -----------: | -----------: | --------------: | --------------------- |
|      1000 | `16f41dfe01cb…`  |    1630.446 |       0.039 |        0.077 |        0.090 |        1058.783 | no                    |

## Correctness and failures

| Documents | Category                | Observations | Successful latency samples | Classifications      |
| --------: | ----------------------- | -----------: | -------------------------: | -------------------- |
|      1000 | startup                 |            1 |                          1 | success: 1           |
|      1000 | get 1                   |          100 |                        100 | success: 100         |
|      1000 | get 10                  |          100 |                        100 | success: 100         |
|      1000 | get 20                  |          100 |                        100 | success: 100         |
|      1000 | get 21+ invalid request |          100 |                        100 | invalid_request: 100 |
|      1000 | external propagation    |            3 |                          3 | success: 3           |

Overall correctness: PASS

Failures retained: 0
