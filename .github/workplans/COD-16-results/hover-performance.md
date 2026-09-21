# COD-16 actual VS Code Hover performance

- Result: **FAIL**; p95: **NOT_MEASURED**.
- VS Code: `1.136.1`; runner Node: `v24.21.0`
- Source commit: `576778c81dea536d8ba4119667390ff1ca9be92e`
- Final VSIX SHA-256: `e025f2340aa1f0621ccfcbab1614afc9b8eb850b78cc27b89740d33a860953ad`
- Extension bundle SHA-256: `59d7275545238dbc7b7006a16ecdbc1467a9506bb862d00931f0c4a154d06955`
- Server bundle SHA-256: `3757ca4e63e20fedd80d64c5d3c59a7686bfc60c847d739db4fe44affdf87d0c`
- Seed: `16018`; workload: 1,000 documents, 980 queryable, 10 missing IDs, 10 duplicate-ID documents / 5 IDs.
- Warmup / measured requests planned: 100 / 1,000; attempted: 1 / 0; completed: 0 / 0.
- Bounded request timeout: 10,000 ms.
- Failure: `executeHoverProvider timed out`.
- Failure sample: warmup run `0`, line `277`, character `5`.

Index readiness completed after about 12 seconds. The first warmup request then timed out, so no measured p95 exists and the 100 ms target remains unresolved. The full raw progress, failure sample, artifact hashes, and workload metadata are in [hover-performance.json](./hover-performance.json). The workload was not reduced to claim acceptance.
