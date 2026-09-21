# PR #13 — Hover confirmed documents and open source YAML

## Problem

Hover results must distinguish the document confirmed at the current code cursor from previous identifiers and other candidates. Users also need to inspect the exact YAML source without losing an existing tab or unsaved content.

## Change

- Keep `id`/`documentId` optional and emit them only for a valid current identifier; retain previous evidence, candidates, paths, and diagnostics.
- Rank cursor evidence by current identifier, contiguous token count, and exact match. Render every top-level tie and link remaining candidates under the same identifier.
- Render definition, confirmed current ID, domains, source link, direct references, and reverse references in separate non-empty sections.
- Add the standard LSP Hover output and the VS Code-only `codocs.openSource` command. The command accepts a confirmed URI, range, catalogVersion, and raw-byte revision payload, then moves the selection only when the range and revision checks pass.
- Reuse an existing tab and preserve unsaved content/selection when the current buffer and source revision no longer match.

## Validation

- Installed VSIX functional runs pass on VS Code 1.136.1 and pinned 1.95.0.
- Evidence covers UTF-16 positions, Korean/space paths, LF/CRLF source, nested workspace routing, dirty YAML, default definition navigation, watcher changes, and server restart recovery.
- The earlier 1,000-document run used seed 16018 and planned 100 warmups plus 1,000 measured requests. Its fixed 10-second warmup timeout stopped measurement; that historical result remains unchanged. The new unbounded observation run, correctness, and full sample counts are recorded under `COD-16-results/performance-observation-20260921/`. The 100 ms goal is informational.

## Follow-up

The performance bottleneck and watcher path canonicalization finding require a separate product-owned follow-up. This draft is prepared for manual PR delivery; no GitHub mutation was performed.

## 2026-09-21 현재 성능 측정 정책

기존 성능 목표는 1,000개 문서에서 참고 비교로만 유지한다. 느리지만 정확하게 완료된 요청은 실제 시간을 기록하며, 목표 초과만으로 기능이나 측정 실행을 실패 처리하지 않는다. 요청별 준비·워밍업·측정의 정확성, 완료 수, 진행 중 요청과 부분 결과는 한국어 보고서로 확인한다. 현재 측정 구현 범위는 코어 상세 조회 1·10·20개, 잘못된 21개 요청, 외부 변경 반영, 자원 관찰 및 설치된 VS Code Hover다. 목록/필터/커서, 변경 계획, MCP wire 및 쓰기 전체는 아직 측정하지 않았다. 현재 제공 범위 밖인 자동완성은 성능 판정 대상에서 제외한다. 기존 결과는 당시 정책의 역사적 증거로 보존하며 새 결과는 `COD-16-results/performance-observation-20260921/`에서 추적한다.
