# Task Result — FOLLOWUP-001

## Identity and disposition

- status: IMPLEMENTED_WITH_FINDINGS
- implementation_status: COMPLETE
- verification_status: FAIL
- continuation: ALLOWED (only from the exact provisional commit returned with this report)
- result_id: wb-cod18-followup-20260922-r1/FOLLOWUP-001/result/1
- run_id: wb-cod18-followup-20260922-r1
- task_id: FOLLOWUP-001
- kind: implementation
- intent_revision: wb-cod18-followup-20260922-r1/intent/1
- repository_id: SeoJaeWan/codocs
- planned_profile: gpt-6-astra / high (runtime-selected packet profile; no original standalone profile)
- requested_profile: gpt-6-astra / high
- effective_profile: gpt-6-astra / high (own host turn_context metadata)
- task_packet_digest: null
- execution_binding_digest: e4703728c53e1b8bdae8528ec9191844a80907117a4c385a1803a93173dd70b4
- worktree: /Users/seojaewan/Desktop/dev/codocs-worktrees/wb-cod18-followup-20260922-r1/followup-001
- worktree_created: true
- branch: codex/wb-cod18-followup-20260922-r1/followup-001
- base_commit: 4a74700a8e36debf572042e53839ccd369fa2c0f
- observed_head_commit before the sole result commit: 4a74700a8e36debf572042e53839ccd369fa2c0f
- commit_kind: provisional_candidate
- result_commit: null
- candidate_commit: exact containing commit, emitted after commit in the terminal Task Result (no self-referential SHA)
- phase_reached: implementation, package/Host/native UI verification, self-review, result commit
- mutation_occurred: true
- worktree_clean: checked after the result commit; terminal Task Result records the observation

The latest complete automated check passed. Overall verification remains FAIL because an actual earlier full-check watcher failure remains unresolved and the full UI/state acceptance matrix is not claimed complete. This is a consumable implementation candidate, not final acceptance. No exclusions or skips are counted as passes.

## Preflight and scope

The worker read the execute-task skill and worker procedure, validated absent branch/path and non-symlink ancestry, and created the assigned worktree at the exact base. Binding verification blanked the JSON-string digest value in the supplied standalone YAML bytes, normalized LF UTF-8 with final LF, and reproduced the digest above (16,156 blanked bytes). All 15 supplied base-document SHA-256 values matched before edits. Approved R1/R3 intent superseded the lower-level resolved-only/same-observation restrictions; no new planning gate was introduced.

Only packet-owned files changed. Source paths are enumerated in source-manifest.json; the six changed contracts preserve their IDs/names/domains. There are no ownership exceptions. The new follow-up plan and this run's evidence are additive; original plans, historical reports, normal checkout and other worktrees were not edited. No additional workers, imported COD-32 commits, pushes, PRs, merges or cleanup.

## Implementation

- R1: Explicit YAML selections retain confirmed ambiguous candidates; body links still require a single complete confirmed resolution. Direct/refBy code relationship commands carry internal anchor/direction provenance and re-evaluate that exact relation. No confirmed provenance means no server-issued command.
- R3: Individual confirmation is separate from overall partial status. Same-path content continuity uses observed filesystem object identity (device/inode/birth time), catalog identity fields and current revision verification. Relocation additionally requires complete observations and valid unique ID; no UUID registry or path/hash-only identity. Deletion/reused paths are rejected.
- R4: Public JS/tarball diagnostic-code expectations include deprecated_reference. Added status/reference-edit warning recalculation tests; existing per-occurrence ranges/severity/code, relationship/link preservation and negative coverage remain.
- R5-A: Click confirmation waits/revalidates transient replacement up to three attempts within two seconds. Abort, release, close and source invalidation stop the click, without cancelling or changing shared initialization/refresh completion.
- R5-B: Provider display generation is separate from source/server session lifetime. In-flight Hover/DocumentLinks retry against the newest display observation, while version, ownership, close, cancel and server replacement remain guards. Snapshot notification alone no longer rejects confirmSource.
- Harness: AC011 synchronizes the exact two links immediately consumed and checks reference range text. Added installed-Host reverse relation removal/next-Hover and other-occurrence notice assertions. Existing open-tab assertions now allow the same target already opened by the newly successful relation scenario, preserving no-duplicate-tab semantics.
- Contracts now exclude only already-visible Hover immediate replacement; next query and click validation remain mandatory.

## Verification ledger

Commands, exact arguments, durations and exit codes are in commands/*.json; corresponding *.log files preserve raw output, including failures.

| Check                                         | Observed result                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm                                   | 24.21.0 / 10.34.5; frozen task-local installation passed                                                                                           |
| focused-1                                     | FAIL: source consumers required built JS; prior ambiguous assertion still expected unusable null                                                   |
| focused-2                                     | FAIL: new fixture test asserted an incorrect English path instead of its Korean filename                                                           |
| focused-3 / focused-4                         | PASS 313 / PASS 314; final product regression run is focused-4                                                                                     |
| check-1                                       | FAIL: new test narrowing/type errors; fixed                                                                                                        |
| check-2 / check-3 / check-4                   | FAIL: Korean JSDoc requirements in new harness/evidence code; fixed                                                                                |
| check-5                                       | FAIL: functional 777 pass / 1 fail; watcher rename emitted old path but not renamed.yaml at watcher.test.ts:115                                    |
| independent development-1 / consumer-1        | PASS 81 / PASS 32 after check-5 stopped the pipeline                                                                                               |
| check-final                                   | PASS: full pnpm check, functional 779, development 81, consumer 32; 82.707 seconds                                                                 |
| build-1 and full-check build                  | PASS                                                                                                                                               |
| harness-1 / harness-final / harness-final-all | PASS 11 / PASS 1 / PASS 11; the intermediate explicit filename invocation selected only report.test.mjs, so all actual *.test.mjs files were rerun |
| docs-1                                        | PASS: 75 documents, zero parse/validate/catalog diagnostics, 75 reachable, none unreachable                                                        |
| package-final                                 | FAIL: unsupported pnpm --store-dir option                                                                                                          |
| package-final-retry                           | PASS: isolated store with --config.store-dir, @vscode/vsce 3.6.2, --no-dependencies --skip-license                                                 |
| host-min                                      | FAIL: old tab-count assertion expected a new tab after the fixed relationship had already opened it; corrected harness, not product                |
| host-min-final                                | PASS runner: actual 1.95.0, 20 pass / 12 skip                                                                                                      |
| host-default-final                            | FAIL launch: IPC socket pathname exceeded platform limit; not a product or watcher baseline failure                                                |
| host-default-retry                            | PASS runner: actual 1.136.1, 20 pass / 12 skip after isolated mkdtemp runtime moved to OS temporary directory                                      |
| ui-min / ui-default                           | UI runner exit 0; actual observations below, not automatic assertion of complete UI acceptance                                                     |

Product sources and packaged bundles did not change after the final full check/package. Later changes were harness-only (tab reuse and short isolated runtime path); the final harness tests, targeted ESLint/Prettier and diff checks were rerun. Result evidence formatting does not change product bytes. Post-commit source-manifest comparison detects hook changes.

Final docs-final, lint-final and format-final also PASS: repeated documentation validation/reachability, full repository ESLint and formatting checks.

### Actual package/runtime identity

- Task-local VSIX: .workbench/cod18-followup-final.vsix (not committed binary).
- VSIX SHA-256: 7984667d377cc5d69bc76397227d94c8009ce2586556beaeb721c586d163b654
- Extension bundle SHA-256: c69420206698bb4a131e774831e5a05806c51f95d597c422efa6fee4ed316bda
- Server bundle SHA-256: 15a97e6a308885a9410cd2f14ef2e0ac70d0880a6c30fd66815a493b074f8afb
- Actual 1.95.0 Electron SHA-256: a1e06b9858b844e559cbbe8748a28c0620d1de3b83e41ef92a91cdeeaa8f6457
- Immutable 1.95.0 download SHA-256 (source/copy matched): f749e23465007df991c16a047c1be8bc2e9b7916434cfe7b3e5fd71194ca968f
- Actual 1.136.1 Code SHA-256: de060e5a522201a1be3187c5ca97aad32db12565e8fb6037ba85ce3513ab0c2e
- 1.136.1 commit: a44adf7f53e00964ab890f9f8758a334f1fc15bc, arm64; isolated UI app copy matched the installed binary hash.

Both actual Host versions installed the same final VSIX in isolated profiles/extensions. Host reports identify the base checkout SHA separately from uncommitted product diff/bundle hashes; they do not falsely claim the base commit contains the tested changes. Host runs were sequential.

### Native UI: observed versus unrun

ui/observations.json and associated screenshots preserve 27 isolated UI observations. The app path and Extension Development Host fixture title establish isolation.

- Both actual versions: physically clicked the rendered single-reference Execute command action; correct target opened at Ln 1, Col 1.
- Both versions: ambiguous Hover had no body Execute command; disambiguated ui-a.yaml and ui-b.yaml links were individually physically clicked and opened the chosen target at Ln 1, Col 1.
- 1.95.0: physically clicked a code Hover source link; existing reservation target tab was reused at Ln 1, Col 1.
- One 1.95.0 automation focus transition inserted a newline in the isolated source fixture; it was detected and undone, and clean restored text was observed. This is a UI automation artifact, not a product failure.
- Actual dirty-buffer/disk preservation and repeated-open selection were verified by installed Host assertions, not claimed as physical-click proof.
- Not run physically: modifier+source-text click, exhaustive visual range/duplicate/previous/deprecated matrices, controlled cancellation/close/restart races, every no-popup stale state. Deterministic adjacent tests cover the response and lifecycle races; programmatic commands are not physical UI clicks.
- Partial/unconfirmed/preparing/failed state combinations were covered where deterministic tests could induce them, not exhaustively induced through the installed UI.
- Already-visible Hover immediate in-place replacement is EXCLUDED by approved scope, not PASS. No forced hide/reopen implementation was added.

## Self-review and implementation-time findings

1. resolved_in_task — Source selection now requires Workspace provenance. External commands remain opaque sourceUri/token pairs; relationship path/direction exists only inside server rendering before rewriting. Markdown escaping and generated-command trust restrictions remain. No arbitrary external URI/ID payload was introduced.
2. resolved_in_task — Deterministic barriers cover replacement during disk verification, valid latest observation versus invalid selection, client notification during nonempty response and confirmation, timeout independence, source release/close/cancel/version/ownership/server replacement.
3. resolved_in_task — Two different matched anchors pointing to the same target retain their own relation origin; removal of the selected anchor's relation rejects even if another anchor still refers to that target.
4. resolved_in_task — Current+previous same-range suppression remains; previous evidence at another occurrence is explicitly shown. Duplicate-current candidates and auxiliary candidates retain disambiguated labels.
5. carried_to_integration — check-5's rename signal loss remains a FAIL. It matches the prior read-only diagnosis's ready-immediate rename symptom (old unlink delivered, new add observed by root polling but lost downstream), but this run did not instrument the entire loss path again. Do not infer that every Host failure is the watcher baseline. COD-32 owns repair; no watcher/loader/indexing/lifecycle code changed.
6. carried_to_integration — Identity is intentionally conservative: filesystems without a usable object witness, atomic replacement and copy-based relocation may produce a safe no-op for an old selection. A fresh confirmed query remains usable. Unprovable relocation is never followed.
7. carried_to_integration — The unrun UI/state cases above remain unverified; the limited native matrix is not promoted to exhaustive acceptance.

### COD-32 shared surface handoff

WorkspaceCandidateOrigin gains additive optional explicit and relationship fields. captureCandidate, confirmCandidate and releaseCandidate keep their public call/return shapes. Selection observes #catalogVersion, #scan, #refreshPromise and #explicitRefreshPromise without redesigning their creation/publication/completion policy. No reverse dependency on COD-32 acceptance or latest main was introduced.

The additional ready-immediate rename reproduction differs from COD-32 BF001 nested create. Prior diagnosis is read-only at the historical int-001 .workbench/diagnosis-20260922/REPORT.md; the independently observed failure is preserved in commands/check-5.log. No COD-32 plan or external message was modified/sent.

## Remaining acceptance and integration output

The implementation and material interfaces are available for downstream work from the exact provisional commit. Unresolved watcher verification and unrun native/state matrix prevent a verified result declaration. Historical functional753/development81/consumer30pass2fail/Host-failure evidence remains immutable.

- integrated_head_sha: null (not an integration task)
- candidate_integrated_head_sha: null
- Acceptance: NOT claimed complete.
