# TASK-003 — installed VSIX verification handoff

Status: IMPLEMENTED_WITH_FINDINGS; implementation PARTIAL; verification FAIL.
Continuation is ALLOWED for integration of this consumable harness/evidence, not product acceptance.
The exact provisional candidate is the single commit containing this report (reported in the final Task Result; no self-referential commit hash is embedded).

## Identity and provenance

- Run/result: `wb-cod18-b58bfd0-r1` / `wb-cod18-b58bfd0-r1/TASK-003/result/1`.
- Kind: implementation. Observed worker: `gpt-6-astra`, reasoning `low` (session turn context).
- Repository: `github.com/SeoJaeWan/codocs`; common Git directory `/Users/seojaewan/Desktop/dev/codocs/.git`.
- Worktree created after absent target/branch and non-symlink ancestor checks: `/Users/seojaewan/Desktop/dev/codocs-worktrees/wb-cod18-b58bfd0-r1/task-003`.
- Branch: `codex/wb-cod18-b58bfd0-r1/task-003`.
- Exact base and product source: `66686f70c254675e7263912604e90298d556f98d`. No product package changed.
- Source packet SHA256: `f24548b3aa4075e5d5b4795c6999b286b1027bc7cba02d3793feac4ea3e92112`.
- Runtime binding SHA256: `b0c73df1c2ab53d98ae7b773c8469e1d345d006b35c8a14fd248e85ec2d70b9b`.
- Both recomputed successfully; exact input bytes in `source-packet.yaml.raw` and `runtime-packet.yaml.raw`, calculation in `binding-verification.json`.
- Plan: `wb-cod18-b58bfd0-r1/plan/1`; supplied plan digest `7fc3e714f01229214aafee7f8a73eb279d0d5315e6ae22706c23d2276207bf43`. Full plan digest not independently recomputed. Source packet/plan intent unchanged.
- Node 24.21.0, pnpm 10.34.5, macOS 25.5.0 arm64, Apple M1 Pro. Local frozen install succeeded (pnpm reported 4.2s); four workspace package symlinks resolved within this worktree.
- Actual Host versions: 1.95.0 (Host Node 20.18.0) and default installed 1.136.1 (Host Node 24.18.1). Each had an independent profile/extensions/fixture, four workspace roots and four servers.
- VSIX SHA256: `8924a77e7b92f837354d5248580b7bf2e9b89250bfc8401b5ed9921c16803628` (1,225,758 bytes).
- Extension bundle: `a842268fc4b12efdf851f0b65dee0640d5b2c5aa3a6367acd52ab2e7723f0ca6`.
- Server bundle: `1b0676e32e41b1ee658038b96f1333e0fd5a7ab414c88653305c6e6f6cf5c95d`.
- Each report records pre-Host harness hashes and fixture hash. Harness was dirty at run time, NOT part of the product-source commit. Subsequent acceptance helper/test edits only add required Korean JSDoc/formatting; runtime behavior is unchanged. Final source hashes are separately inventoried.
- `.codocs` code/test convention hashes matched preparation. At the exact TASK-002 base, ide-support was `d1a4f55c09fd8491296ea829661642a824b13935c9eb3f77e973615a8b077bd8`, open-source was `fc882a6e87973eff1853e68a2e40dc8dc4c7421a95e6d3adc5c01f9f0610ca02`; reviewed predecessor changes describe opaque token routing and (0,0) selection, consistent with the packet. No contract files edited.

## Scope and implementation

Changes are confined to `tools/extension-host/{run.mjs,extension-test.cjs,cod18.cjs,acceptance.cjs,acceptance.test.mjs,check-command.mjs,export-ui-evidence.mjs}` and this run's results directory. No ownership exceptions. Historical verification-evidence.md and workplan evidence remain untouched.

The normal runner CLI remains supported, with optional isolated `--ui`. COD-18 protocol scenarios continue after individual failures. Report aggregation never promotes skipped or missing acceptance to PASS. The runner records package/bundle/harness provenance before execution, returns failure on scenario failures, preserves independent native definition/restart checks, and exports only isolated fixture UI observations. No new watcher, public type, diagnostic contract, snapshot version, or product repair.

## Verification and evidence index

Every captured command, exit code, duration and raw stdout/stderr is listed in `checks-summary.json` and adjacent named logs. Final protocol evidence is `cod18-host-1.95.0-final.json` and `cod18-host-1.136.1-final.json`; scenario-level durations/errors and intermediate results are retained. Earlier failed attempts are not overwritten.

- `pnpm build`: PASS, 4.361s.
- Requested packaging invocation: FAIL at root cwd (`engines` absent); corrected package cwd invocation using the same vsce 3.6.2 and flags: PASS, 1.192s, 22 entries. Bundles successfully loaded by both installed Hosts.
- Original runner tests: 8 PASS, 0.296s. Expanded suite: 11 PASS, 0.284s before comment-only cleanup; final repeat recorded separately.
- Full `pnpm check` (check-full): FAIL, 76.725s; typecheck/lint/format/build passed, 753 functional and 81 development passed, consumer 30 passed/2 failed. Expected diagnostic lists in `tools/build-checks/name-references/index.ts:49` omit `deprecated_reference`. Outside ownership; not repaired. Final check outcome is recorded separately, including evidence-format repair if applicable.
- Final supported Host 1.95.0: FAIL, 13.852s. Host process exited 0, runner exited 1 for scenario failures.
- Final default installed Host 1.136.1: FAIL, 10.756s. Host process exited 0, runner exited 1 for scenario failures.
- Final `pnpm check` retry: FAIL, 42.401s; typecheck/lint/format/build passed, functional 752 passed/1 watcher move timeout. Independent watcher rerun: 14 PASS, 3.974s. Development/consumer stages were already exercised in check-full and were not redundantly rerun after this stop; their 81 PASS / 30 PASS + 2 FAIL evidence remains applicable to unchanged product sources. The preceding final attempt stopped at raw JSONL misnamed `.json` (31.752s); renaming the copied raw evidence to `.json.raw` resolved formatting without altering bytes.
- Post-review runner tests: 11 PASS, 0.311s. JSDoc-only cleanup does not require repeating conclusive installed-host failures.
- Interactive 1.95.0: session complete, 227.376s; isolated installed 1.136.1: session complete, 134.853s. Session exit 0 is not acceptance PASS.
- Native JavaScript definition, four-root server activation, manual restart, unsaved text/disk preservation, absent `.codocs` preservation, watcher changes, crash restart limit and recovery were independently exercised on both versions and passed.

## Stage-scoped acceptance

PASS below describes only the specified subset; no entire AC is accepted. SKIP means unverified, not normal/acceptable behavior. Final aggregate across both versions and observed UI:

| AC     | Overall | Observed evidence / remaining gap                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001 | SKIP    | Protocol LF/CRLF, UTF-16, quoted/escaped/folded, repeated/domain/field/self/malformed/missing cases pass. Full visual range matrix not exhausted.                                                                                                                                                                                                                                                                                                        |
| AC-002 | SKIP    | Unsaved replacement/insertion/deletion and stale token rejection pass. Controlled cancellation/close/concurrent response ordering not induced.                                                                                                                                                                                                                                                                                                           |
| AC-003 | FAIL    | Single rendered DocumentLink action opens correct YAML at top on both versions; ambiguous body provider has no target. Both rendered candidate links do nothing on both versions; relationship-only command returns false. Literal modifier+source-text click not performed.                                                                                                                                                                             |
| AC-004 | FAIL    | Valid-current-ID content revision and confirmed move preserve old-token opening. Already-visible code Hover remains stale after content edit on both versions until reselected; stale rendered link nevertheless opens updated body. ID-invalid revision also fails (AC-012). Visible move refresh not exercised.                                                                                                                                        |
| AC-005 | SKIP    | Delete plus old-path reuse rejects old token, no unrelated opening in protocol. Exhaustive visible stale-click/no-popup permutations not exercised.                                                                                                                                                                                                                                                                                                      |
| AC-006 | SKIP    | Final runs remove absent Hover/link and retain source text plus reference_not_found diagnostic. Earlier installed run exposed transient nonempty link; no exhaustive visible no-popup proof.                                                                                                                                                                                                                                                             |
| AC-007 | SKIP    | Duplicate top retains auxiliary links; same-name no-domain YAML and same-domain code path labels checked. Full UI matrix not exercised.                                                                                                                                                                                                                                                                                                                  |
| AC-008 | SKIP    | Duplicate current/alias suppression and previous-only top/auxiliary cases pass. Same-identifier/different-position mixed current+previous case remains unverified.                                                                                                                                                                                                                                                                                       |
| AC-009 | SKIP    | YAML alias-duplicate diagnostic preserved; only its code Hover cause omitted while other invalid_field_value remains. Visible diagnostic/hover matrix not exercised.                                                                                                                                                                                                                                                                                     |
| AC-010 | FAIL    | Actual single rendered YAML/code opening at empty (0,0) observed; minimum-host dirty tab/text/disk preservation observed. Final 1.95 protocol YAML open and legacy code open returned false; installed final subset passes. Timing cause unresolved; do not erase failure based on UI success.                                                                                                                                                           |
| AC-011 | FAIL    | 1.95 final warning occurrence/severity/code/message/range, link and status transition pass; ordinary/alias/ambiguous negatives pass both. Installed final warnings appeared but link array was empty at immediate read, causing TypeError before state-transition check. Earlier installed run returned false. Product/provider timing versus harness synchronization unresolved; installed state transition and unconfirmed negative remain unverified. |
| AC-012 | FAIL    | Confirmed partial candidate and invalid-current-ID name reference after content revision return false on both versions. Native definition/multi-root/restart checks pass. Controlled preparing/failed states not induced.                                                                                                                                                                                                                                |

REQ-002/004/008/009 and NFR-003 are not accepted due failures/gaps above. NFR-004 malicious Markdown escape and trust limited to generated `codocs.openSource` pass in installed-host protocol; this is not a blanket security audit. INV-001–007 remain governing, not relaxed: no-op on explicit ambiguous/partial/ID-error candidates is a failure, not expected UX.

## Actual UI observations

`ui/observations.json` preserves 28 isolated native-app calls with timestamps, raw accessibility text and screenshot SHA256 references. Host editor telemetry is in `cod18-ui-1.95.0.json` and `cod18-ui-1.136.1-isolated.json`.

- 01:48:21 and 01:52:50 UTC: physical click on rendered DocumentLink action opens single YAML; Ln1 Col1/empty selection observed. This is not claimed as literal cmd+source-text click.
- 01:48:45/52 and 01:53:07: physical candidate A/B clicks remain in source editor, no picker; AC-003 failure.
- 01:49:16/20 and 01:53:34: after fixture content mutation, already-open Hover retains old body without reselection; AC-004 failure. 01:49:26 and 01:53:40 old rendered links open updated body at top.
- 01:49:48: code link reuses dirty YAML tab, retains actual unsaved `# U dirty preserved` text, empty (0,0); disk remained unchanged.
- Initial accessibility-element activation prevented navigation (`webContents will-navigate prevented`); physical clicks replaced that method. This automation artifact is not treated as product failure.
- Initial installed-app lookup selected an unrelated normal window; no actions were taken there and the lookup is excluded from exported evidence. A task-local copy of installed VS Code was used for isolated UI selection; original/copy executable SHA256 both `de060e5a522201a1be3187c5ca97aad32db12565e8fb6037ba85ce3513ab0c2e`. Default installed protocol run independently observed 1.136.1. Empty abandoned UI session is preserved, not counted as UI proof.

## Findings and dispositions

1. **action_required:** Ambiguous YAML and relationship-only links cannot confirm provenance. Expected individual candidate opening remains true. Product/API repair outside this task, carry to INT-001.
2. **action_required:** Complete-scan/current-valid-unique-ID restriction prevents confirmed partial candidate opening and invalid-ID name reference opening after revision. Do not redefine as safe expected no-op. Product repair and acceptance rerun required.
3. **action_required:** Already-visible Hover cache does not refresh on content change in either Host. Provider query freshness is insufficient. Product/Host refresh approach requires follow-up.
4. **carried_to_integration:** Intermittent source-open false / immediate link absence around snapshot updates (AC-010/011 and earlier AC-006). Exact raw errors preserved; no root cause claimed. Downstream must distinguish product race from test synchronization, then verify without lowering expectations.
5. **action_required:** Two consumer check failures from expected-code list lacking deprecated_reference; no ownership to edit tools/build-checks.
6. **carried_to_integration:** Predecessor nested watcher timeout remains unroot-caused. This task's final broad run also timed out waiting for the renamed destination in watcher.test.ts:115 (only old path observed); isolated rerun passed all 14 tests. Do not classify this as fixed. Predecessor pre-implementation regression-red proof was missing and cannot be reconstructed retrospectively.
7. **resolved_in_task:** Harness command name corrected to vscode.executeLinkProvider; package cwd corrected; socket path shortened with task-local runtime directories; obsolete legacy command payload/selection expectations updated to current contract; remaining independent checks continue after failures; Korean JSDoc and evidence formatting fixed.
8. **resolved_in_task:** A cached requested 1.95 app auto-updated to 1.138; version guard rejected it before verification. Preserved that app under ignored .workbench, restored exact downloaded 1.95 and disabled updates/telemetry for subsequent runs. Rejected run is not minimum-version proof.

## Isolation, review and cleanup

`.rMvNCKy/` was traced to this runner's pinned UI Host (process 44359, profile `.rMvNCKy/u`, extensions `.rMvNCKy/e`, fixture `cod16-host-mT0IY0`); runner finally removed it. All generated `.rXXXXXX` roots and fixture children were absent at final inspection. No unknown path was deleted or committed. Ignored local node_modules/store/dist/VSIX/downloads remain reproducible task resources. No branch/worktree deletion or external publication.

Only allowed harness/evidence paths are staged. Product packages and source plan are unchanged. Secret-pattern scan of textual evidence found no credential/private-key patterns or unrelated normal-project identifiers. Random opaque selection tokens are fixture command data, not credentials. Raw multiline progress files are preserved byte-for-byte as `.json.raw` to avoid treating JSONL as JSON. Screenshots are isolated fixture windows. Final scope/diff/clean checks are reported with the candidate SHA in the Task Result.

The first staged whitespace check reported captured console trailing whitespace/blank endings. A results-local `.gitattributes` disables whitespace lint only for raw `*.log` files, preserving original bytes; source and structured evidence retain normal whitespace checks. This is an evidence-format exception, not suppression of a product finding.

## Handoff / remaining checks

INT-001 may consume the exact provisional candidate because product packages remain buildable at the bound base, the CLI/harness is runnable, and raw failures/acceptance gaps are machine-readable. This grants no additional repair authority and no delivery acceptance. Remaining unexecuted UI/race/state cases are listed per AC; no skip counts as pass. Integration output is N/A (this is not the integration worker). No push, PR, merge or user-branch change performed.
