# COD-14 Performance Report

Generated: 2026-09-20T12:32:06.993Z

## Configuration

- Seed: `cod14-fixed-seed-v1`
- Documents: 100, 1000, 5000, 10000
- Startup runs: 1
- Query warmups/samples: 20/100
- Propagation runs/timeout: 3/500 ms
- Output: `D:\dev\codosc\.github\workplans\COD-14-results\full-scale-20260920`
- Node: v24.21.0 (win32 x64)

All latency values are milliseconds. Memory values are bytes. Incorrect, timeout, and event-only observations are retained in JSON and excluded from successful latency summaries.

## Scale observations

| Documents | Fixture manifest | Startup p95 | Query 1 p95 | Query 10 p95 | Query 20 p95 | Propagation p95 | Propagation <= 500 ms |
| --------: | ---------------- | ----------: | ----------: | -----------: | -----------: | --------------: | --------------------- |
|       100 | `76fa04f4f025…`  |     357.722 |       0.032 |        0.038 |        0.071 |         190.542 | yes                   |
|      1000 | `16f41dfe01cb…`  |    1606.560 |       0.016 |        0.111 |        0.104 |             n/a | no                    |
|      5000 | `d13bb5b68893…`  |    7064.438 |       0.016 |        0.083 |        0.122 |             n/a | no                    |
|     10000 | `d80100332042…`  |   14060.644 |       0.018 |        0.086 |        0.140 |             n/a | no                    |

## Correctness and failures

| Documents | Category                | Observations | Successful latency samples | Classifications      |
| --------: | ----------------------- | -----------: | -------------------------: | -------------------- |
|       100 | startup                 |            1 |                          1 | success: 1           |
|       100 | get 1                   |          100 |                        100 | success: 100         |
|       100 | get 10                  |          100 |                        100 | success: 100         |
|       100 | get 20                  |          100 |                        100 | success: 100         |
|       100 | get 21+ invalid request |          100 |                        100 | invalid_request: 100 |
|       100 | external propagation    |            3 |                          3 | success: 3           |
|      1000 | startup                 |            1 |                          1 | success: 1           |
|      1000 | get 1                   |          100 |                        100 | success: 100         |
|      1000 | get 10                  |          100 |                        100 | success: 100         |
|      1000 | get 20                  |          100 |                        100 | success: 100         |
|      1000 | get 21+ invalid request |          100 |                        100 | invalid_request: 100 |
|      1000 | external propagation    |            3 |                          0 | timeout: 3           |
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

Failures retained: 9
