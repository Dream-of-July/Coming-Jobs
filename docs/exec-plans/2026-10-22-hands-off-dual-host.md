# Hands-off dual-host execution plan — 2026-10-22

Goal: implement the approved Phase 0–8 design, beta.16, with content-bound batch approval and Codex/Claude adapters. Source plan: `~/.claude/plans/claude-codex-peppy-cosmos.md` (read in full). Work only in this checkout; synced sources and the other checkout stay untouched. No real workspace migration, credentials, candidate data, paid model calls, settings edits, PR merges, main pushes or force pushes.

## Baseline and integration

- Clean checkout before work: `feat/resume-tailoring` at `2da7721`.
- New branch: `feat/hands-off-dual-host`, based on `origin/feat/email-first-login` (`7b400f7`); merge `origin/feat/resume-tailoring` (`2da7721`). Only conflict: generated `release.json`; regenerated with build-release.
- Baseline has 351 tests (339 earlier tests plus 12 authentication tests from #2). Initial sandbox run: 348 pass, 3 fail with local listen EPERM (host.test). Rerun with local-port permission required.
- Git identity absent in this clone: configured repository-only identity using the current branch author's public GitHub noreply identity.

## Phase 0 probes (completed; limitations explicit)

Disposable synthetic plugin and isolated CLI homes under the system temporary directory. Claude Code 2.1.259. No model prompt or paid API call; `/mcp` and `/hooks` only.

| Probe | Evidence and conclusion | Decision |
| --- | --- | --- |
| S1 | `claude plugin validate` passed, author warning only. `/mcp` debug: plugin root variable expanded and stdio connected. Unknown `tool_timeout_sec` and hook `description` did not prevent loading; four hooks registered. Actual SessionStart cwd is the project directory. | Generate separate Claude config with supported keys, absolute paths and mcpServers wrapper. No direct GitHub install claim. |
| S2 | Actual SessionStart keys: session_id, transcript_path, cwd, hook_event_name, source; no turn_id. Only event names/keys/cwd metadata recorded; no transcript read. Official hooks documentation specifies last_assistant_message on Stop and scoped MCP tool names. Other event payloads not observed in a paid model turn; `/hooks` reports unavailable in print mode. | Generate a turn ID when absent; accept both plain/scoped tool names; ignore transcript_path. |
| S3 | Actual debug: tools/list retried then failed: inputSchema.type expected object. Transport still reported connected. | Flatten every public schema; retain strict internal operation validation. |
| S4 | Official Claude hooks documentation: plugin MCP names use mcp__plugin_<plugin>_<server>__<tool>. | Document narrow permission names; no automatic blanket grants. |
| S5 | This executor has no Claude Desktop built-in form_input/file-upload surface. No credible live file-input probe possible. | Conservative manual grouped drag/drop; javascript_tool strictly read-only. Do not claim automatic upload. |
| S6 | Claude Desktop local view and scheduled-task surface unavailable in this executor; not live verified. | Return open_local_view and explicit host scheduling handoff; never claim a schedule exists without a binding receipt. |
| S7 | Temporary CODEX_HOME: codex plugin marketplace add accepted a synthetic directory containing both manifests and agents/. Claude loaded its agent. | Keep both manifests and agents. Full installed MCP smoke tests in Phase 8. |

Sources: [Claude manifest](https://code.claude.com/docs/en/plugins-reference), [Claude hooks](https://code.claude.com/docs/en/hooks), [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins).

Failed probe attempts: sandbox git fetch DNS failure (succeeded after network permission); claude --max-budget-usd 0 rejected as invalid (no model request made); --bare /mcp skipped plugin MCP startup, so normal isolated /mcp used instead. These are not counted as successful probes.

## Execution ledger

- Phase 0: probe conclusions recorded; baseline/integration validation passed: 351/351; public check 0 findings.
- Phase 1: complete — public schemas, host policy, hooks, workers, scheduling, response budget.
- Phase 2: complete — manifests/version, dual installer, isolated CLI registration and smoke checks.
- Phase 3: complete — dependency-based validity, structured fit questions and target approval.
- Phase 4: complete — hash approvals, claims/composition, offline Chrome renderer/receipts/cache.
- Phase 5: complete — source transformations, parsing/persistence checks, read-only Claude procedure.
- Phase 6: complete — transactional batch grants, human queue, guarded submit, outcomes and voided.
- Phase 7: complete — read-only migration plan, synthetic migrate/revert coverage; real migrate never executed.
- Phase 8: complete — implementation, independent review/repairs, local validation, installed-host smoke and publication. [PR #4](https://github.com/Dream-of-July/Coming-Jobs/pull/4) targets main and explicitly depends on #2/#3; remote CI is tracked separately below.

## Interface decisions

- Public schema vs server validation: publish flattened objects; validate against an internal registry, including operation-specific required/allowed fields.
- Approval vs prefill: a batch sheet must precede a grant; one transaction creates content approvals and existing authorization objects. Recheck content at submit.
- Snapshot vs live state: sheet/grant bind content, not bookkeeping revisions or freshness timestamps. Changed facts, JD, fields, assets, origin or agreements invalidate the affected item.
- Renderer vs SQLite: run Chrome outside a write transaction; register verified artifacts in a short transaction afterward. Never evaluate template functions in Node.
- Import vs live authority: grants/attempts are nonportable authority; imports void grants and close human steps.

## Validation record

Every phase commit: `node scripts/build-release.mjs && (cd plugins/coming-jobs && npm test) && node scripts/check-public.mjs`. Logs in temporary scratch space; counts, failures, fixes and commit evidence added below as work proceeds.

Phase 1 validation: new tests first failed on non-object schemas, missing host context, Claude credential policy and native turn assumptions. Narrow tests now pass. Full run initially 356/357: one legacy human_only assertion, updated to the specified batch_grant_only contract. Stop behavior test now seeds real pending work; no pending work causes no stop repair.

Phase 1 complete: commit d36677b, 359/359 tests, public check clear.

Phase 2: beta.16 versions unified (package, Codex manifest, Claude manifest, runtime, generated release). Dual installers and separate absolute Claude files implemented. New install tests RED→GREEN; initialize and tools/list run from both installed artifacts. Legacy config tests intentionally updated: installer must leave user config byte-identical.

Ruling: CLI registration/install use an isolated host registry, and Claude local scope inside the installed release. Automatic global enablement would indirectly edit the explicitly forbidden user settings. Manual enablement instructions and --plugin-dir are returned instead; cost is a one-time manual host enablement. No user host settings are changed.

Phase 2 complete: commit 213788d, 363/363 tests, public check clear.

Phase 3: four behavioral regressions first failed, now pass: tracking writes, dependency validity, one-time structured questions, approved-target JD changes. Full run initially 366/367; existing daily corruption test now corrupts evidence_digest instead of the retired all-profile validity key, preserving its fail-closed purpose.

Phase 3 complete: commit a149c39, 367/367 tests, public check clear.

Phase 4: content-hash approvals, locked template identity, grouped claim approval, plugin composition and isolated Chrome worker implemented. New behavioral tests RED→GREEN. Real synthetic Chrome tests: text mismatch rejected; layout overflow rejected; 2000px icon compressed to display size ×2; cached renders preserve exact PDF SHA. Initial sandbox Chrome launch timed out; approved local process run succeeds. Height test first failed in quirks mode; explicit doctype fixes content-height measurement. Node only extracts/hashes/transports source; the function executes in a fresh Chrome page with default sandbox, offline network emulation, blocked protocols, proxy denial and no executable markup scripts. No npm dependency added.

Phase 4 verification: 373/373 tests, public check clear. Synthetic PDF visually inspected: white background, legible text, no clipping; content height 144.75pt, 19,408 bytes. Screenshot initially followed a dark canvas; set default white background and light media. Worker source hash now participates in cache keys so adapter changes cannot reuse an old screenshot.

Phase 4 complete: commit 13993da, 373/373 tests.

Phase 5 narrow validation: 16/16 pass. Source transformations computed by plugin, agreement content included in field digest, upload completion/recovery requires control inventory and protected-field readback. Parsed changes preserved, affected drafts require fresh verification. Review requires portal save evidence or single-submit persistence reference. Claude script does not read hidden inputs, passwords or OTP values, performs no writes, and native action lists stay within eight actions. Synthetic helper now explicitly supplies save evidence where the scenario assumed a saved draft.

Phase 5 complete: commit 07c2562, 377/377 tests. Full run initially found four round-trip schemas rejecting the new derived value_kind and one legacy unsaved fixture; derived metadata is now accepted but recomputed, and the unsaved scenario explicitly omits save evidence and expects ready=false.

Phase 6 implemented: pure sheet generation (no audit writes), two-hour content-coded approval, atomic grants/material approvals/prefill authorizations, session-bound 12-hour-or-deadline grants, deduplicated human queue, current-control checks, guarded click-once attempts, explicit draft abort, SHA-bound outcomes, batch-aware flow and voided exclusions. Claude upload copies are grouped by batch and numbered company directory while preserving approved filenames and bytes.

Ruling: an approval sheet is pure until approved; issued_at travels with the sheet and is included in its server-recomputed code. The successful approval transaction persists approval_sheet. This satisfies read-only sheet generation and a full two-hour review window without refreshing the code on every read.

Phase 6 validation: 389/389 tests, public check clear. Tests verify exact user batch code and selected numbers, atomic rollback on writer conflict, read-only sheets, expiration, revoked/declined consent, session/background/JD/review/mode guards, one click, actual résumé SHA, deduplicated human checks and voided fallback exclusion. All passed before commit.

Phase 6 complete: commit 791e9f9, 389/389 tests. Phase 7 narrow migration tests 4/4 pass: pure plan, backup-before-write, coded approval, changed-plan rejection, revert conflict protection, new answer cleanup and import authority reset.

Real workspace audit: explicit SQLite readOnly connection only, no Store constructor, no migrate. Current plan reports 10 stale preparing applications, 10 matching bookkeeping facts, 355 provably recoverable assessments and 2,983 requiring reassessment. Legacy source-change timing prevents optimistic recovery. Detailed private plan stays outside Git. No candidate values, resume contents or assessment reports are added to tests, examples or this plan.

Current login consent facts already use the recognized email_read/sms_read boolean contract, so the live plan detects no legacy authentication conflict. The older design's three-conflict snapshot does not match this current state; synthetic tests cover all three keep/revoke/update choices. No free-form legacy gate is promoted into a structured answer, so the live plan has no mechanically deduplicable fit questions until those criteria are recorded. Phase 7 full run exposed a nondeterministic test choosing an unrelated changed assessment; conflict test now edits the exact bookkeeping record migrated, preserving the intended no-overwrite property.

Phase 7 complete: commit eb082b4, 394/394 tests. Real migrate was never called.

Phase 8: two-host batch-e2e passes with two unique per-batch confirmation keys, no repeated question, only unchanged approved items clicked once, excluded/changed items zero clicks and actual SHA retained. The end-to-end test initially failed on missing persisted pause; a failed content check now rolls back submit authority and commits only that approved item's pause. Further safety tests cover grant expiry, required controls, changed agreements, unknown execution, unsaved portal, quota, off mode, changed recipient/field and scheduled hook state. Full agreement text is rehashed by the plugin rather than trusting a supplied hash.

Both optional real-browser runs passed using the already bundled Playwright module (no npm install): three loopback portals, one submit each, all actual resume SHAs match. Variants cover parser overwrite/new parsed field (pause then fresh approval), user-owned declaration plus synthetic OTP, and a result page. Claude uploads and manual steps are explicitly test-harness human simulations, not proof of automatic Desktop upload. Claude plugin validate passed without warnings.

Fixed Codex worker sample was evaluated against the actual prerequisite module and current module: both input hashes are 75ef536f89b831d0c6a0d0d6b66171e3cf6cedf1eb808e4ca12cbd865622ce3b. A regression now pins that hash. Claude scheduler binding verified with an actual synthetic receipt and no Codex thread ID.

Phase 8 final pre-review verification: 414/414 tests (351 inherited + 63 added), zero skips/failures; public check clear; syntax and diff whitespace checks pass. Dashboard interpolation first failed node --check, then a new regression and quote fix verified it. Isolated --host both --skip-cli install: both actual generated configs initialize, list 23 tools, call context, and run hooks. Installed Claude plugin validate passed; actual isolated Claude /mcp connects with object schemas; temporary CODEX_HOME accepts the complete dual-manifest marketplace. User host settings and the other checkout remain unchanged. Optional three-portal browser QA passed for both hosts. CI matrix is configured, not yet claimed as remotely passed.

Additional boundary checks fixed host-access receipt isolation and oversized Claude error JSON. All verification logs remain in temporary scratch space; candidate data and test artifacts are not committed. Detailed Phase 0 probe limitations remain above.

## Independent review and repair

A separate read-only reviewer examined 7b400f7..61f5b34 without modifying the checkout or reading the real workspace. It confirmed 10 Important findings and 2 Minor findings. All are addressed in one repair pass, with synthetic regressions; there was no second review loop.

- Optional fields must match approved values; an optional flag no longer permits a mismatched submission. Unknown optional payload controls need a known empty value or the exact parsed value disclosed in the sheet.
- Actual field/attachment/control observation age is checked, not just review creation time. Aggregating several execution chunks preserves the oldest observation; fallback inventory carries its own timestamp.
- Scoped reapproval retains unchanged items with their original code, mode and expiry.
- Template composition uses an explicit editable-path structure; unknown paths stay fixed, including common experience title/organization/period/icon variants.
- Same-SHA PDF reuse carries canonical evidence dependencies; later approval cannot erase them.
- Comparison reads reproject qualifications from current fit context, including current action guards on immutable sealed snapshots. Daily soft-stale refresh uses only remaining budget and does not invalidate current selection.
- Legacy migration requires unchanged historical intent timing as well as unchanged cited evidence; absent proof means reassessment.
- Claude readback is scoped to planned ordinary fields and excludes authentication metadata patterns including id/placeholder/autocomplete. Unscoped scripts return metadata only.
- Single-submit evidence is carried through upload and final review. The synthetic browser portal now has no save button and rejects /save; it completes with zero saves.
- Selection warnings compare actual differences, and missing/damaged screenshots are regenerated as cache misses.

New review regressions first failed (11/11 initially; two additional timing regressions also failed before their fixes). They now pass 15/15, including pausing a changed retained item without blocking another item's scoped approval. A further migration-code regression failed, then passed after binding the code to the actual recovery decisions, not just record revisions. The missing-screenshot integration assertion also first failed with render_cache_missing, then passed after cache regeneration. The first full repair run passed 426/426; a final run includes the added timing/scope/migration regressions. Both updated three-portal browser runs pass with actual resume SHAs, including zero saves on the single-submit portal. Claude actions/uploads remain synthetic user simulations.

Additional isolated CLI-enabled installation succeeded for both hosts with cli_registry_ready; neither a user Codex config nor Claude settings file was created. This is registry preparation, not a claim of activation in the user's real host.

Final read-only migration audit supersedes the initial recovery estimate: 10 stale preparing applications, 10 bookkeeping facts, 1 provably recoverable assessment and 3,337 requiring reassessment; current=0, legacy login conflicts=0, structured fit questions=0. The stricter historical-intent proof accounts for the reduced recovery count. Current private plan code M-0216A6; plan and candidate contents stay outside Git. One attempt to reuse an existing output filename failed with EEXIST by design (exclusive file creation); a fresh temporary filename succeeded. No real migrate was called.

Final repair validation: required build-release → npm test → check-public chain passed on Node v24.14.0/macOS: 430/430 tests (351 inherited + 79 new), zero skipped/failed; 151 public files checked with zero findings; diff whitespace clear. A fresh `install --home <temporary> --host both --skip-cli` passed. Both installed MCP configs initialize, list 23 object-schema tools, call context and execute generated hooks; installed Claude plugin validate passed without warnings. Real host settings remain untouched. Actual Claude Desktop upload/browser/scheduling surfaces and the user's real template/portals remain manual rollout checks, not claimed as verified.

## Publication and rollout handoff

Phase commits: 881f273 (integration/probes), d36677b (host/schema), 213788d (packaging/install), a149c39 (validity/targets), 13993da (claims/rendering), 07c2562 (form integrity), 791e9f9 (batch grants), eb082b4 (migration), 61f5b34 (E2E/docs), 07de189 (independent-review repairs). The same required validation chain passed before every commit.

Pushed feat/hands-off-dual-host to Dream-of-July/Coming-Jobs and created [PR #4](https://github.com/Dream-of-July/Coming-Jobs/pull/4) against main. GitHub confirms the PR is open, unmerged and mergeable; #2 and #3 are still open and explicitly listed as dependencies. No main push, force push or PR merge performed. Both checkouts are clean. GitHub Verify run 39710822008 was queued when published; final remote status is read from actual Actions results, not inferred from local tests.

User-owned rollout: enable the reviewed plugin and hooks in each real host; confirm fresh context version/build; first use prefill_only on a real portal. Confirm account/login, manually handle passwords/registration/QR/CAPTCHA/slider/Claude OTP, batch drag/drop and legal declarations, then inspect actual PDF, parsed field changes, save behavior and complete agreement text. Approve only the desired numbered items with the displayed S-code. Migration remains a private read-only plan until a separate explicit decision; do not run it as part of this handoff. Real template layout, Claude Desktop upload/local view/scheduler and remote received bytes remain unverified here.
