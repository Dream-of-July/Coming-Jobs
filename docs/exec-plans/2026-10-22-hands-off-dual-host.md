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
- Phase 1: implemented — public schemas, host policy, hooks, workers, scheduling, response budget.
- Phase 2: pending — manifests/version, dual installer, CLI registration and smoke checks.
- Phase 3: pending — dependency-based validity, structured fit questions and target approval.
- Phase 4: pending — hash approvals, claims/composition, offline Chrome renderer/receipts/cache.
- Phase 5: pending — source transformations, parsing/persistence checks, read-only Claude procedure.
- Phase 6: pending — transactional batch grants, human queue, guarded submit, outcomes and voided.
- Phase 7: pending — read-only migration plan, synthetic migrate/revert coverage; never execute real migrate.
- Phase 8: pending — two-host end-to-end tests, docs, review, install smoke, branch push and PR to main depending on #2/#3.

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
