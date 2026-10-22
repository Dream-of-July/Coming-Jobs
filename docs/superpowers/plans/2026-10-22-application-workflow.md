# Application workflow reliability implementation plan

> **For agentic workers:** Implement the independent tasks in parallel, then review and verify the combined change. Use failure-first regression tests for runtime changes.

**Goal:** Reduce repeated work and incomplete applications while preserving confirmed facts, company rules and final submission control.

**Architecture:** Keep the current local MCP service and host browser adapter. Resolve observed fields against scoped facts before planning; make company capacity explicit; retain source-backed resume coverage; separate short-lived authentication from persisted application data.

**Tech Stack:** Node.js >=22.13, native SQLite, ES modules, node:test, host-provided browser APIs.

**Spec:** The requested repairs cover slow/inaccurate form filling, delayed verification codes, omitted known information (including GitHub), company-specific answers, unused application choices, and poor resume rewriting. This is plugin maintenance, not an instruction to submit real applications.

## Global constraints

- Preserve the jobos/1 contract and existing tool calls.
- Reuse applicable confirmed facts and content approval; retain final submission as a user action.
- No private candidate facts, authentication secrets or external application writes in tests.
- Unknown company rules, ambiguous facts and unverified outcomes remain explicit.
- Do not claim measured real-world speed gains from synthetic tests.

## Review focus

- A later reactive field update clears an earlier value: final readback must detect it.
- A known optional GitHub field is omitted: inventory must expose the omission.
- A company-specific alias conflicts with a global answer: resolve the company answer without contaminating other companies.
- Multiple choices share one parent job or quota: deduplicate and preflight reservations atomically.
- Faithful resume rewrites change wording: preserve coverage with reviewed mappings, without claiming automatic semantic verification.

## Task 1: Form execution and authentication

Files: `plugins/coming-jobs/src/{browser,host-batch,execution}.mjs`; focused runtime tests.

- [x] Reproduce semantic locator, readback and recovery failures.
- [x] Fix bounded field execution and preservation of original values.
- [x] Add a host-only ephemeral login-code helper with immediate reads, request binding, expiry and one write.
- [x] Verify no code is returned or persisted, and failed/unknown writes are not retried.

## Task 2: Confirmed field matching and completeness

Files: new `src/form-profile.mjs`; `src/{profile,applications,service,catalog,flow}.mjs`; new form profile tests.

- [x] Reproduce known GitHub omission, ambiguous aliases and company override cases.
- [x] Add a single whole-form resolution interface that returns evidence-bound proposals.
- [x] Include observed-field coverage in plan and final review, including known optional fields.
- [x] Verify unknown optional fields remain empty and secret fields stay outside saved form data.

## Task 3: Resume quality and reuse

Files: `src/materials.mjs`; material schemas and focused regression tests.

- [x] Reproduce numeric substring errors and blocked faithful rewrites.
- [x] Add source inventory, explicit baseline mappings, editorial review and exact-byte reuse.
- [x] Verify company scoping, stale evidence, missing baseline content and Unicode length limits.

## Task 4: Company choices

Files: new `src/application-strategy.mjs`; `src/{opportunities,jobs,daily,daily-schema}.mjs`; focused choice tests.

- [x] Reproduce single-choice-only daily selection and premature company completion.
- [x] Expose ranked eligible distinct choices and verified capacity.
- [x] Prepare multiple explicitly selected choices with shared capacity preflight.
- [x] Verify submitted/withdrawn history, unknown rules, draft reservations and duplicate parents.

## Task 5: Integrate and deliver

- [x] Update host policy, workflow reference and change notes to match reachable runtime behavior.
- [x] Regenerate tool schemas and release integrity metadata.
- [x] Run the complete regression suite and repository privacy check.
- [x] Independently review combined changes and fix findings.
- Delivery: publish the verified tree on an isolated branch with a reviewable PR; record the remote result in the handoff.
- Delivery notes must distinguish source validation from the installed Desktop plugin; no active installation was changed.

## Verification record

- Complete combined suite on 2026-10-22: 443 tests passed, zero failures or skips; Linux and Node.js 24.19.0.
- Release integrity: 83 plugin files; 23 registered tools; version 1.0.0-beta.14.
- Repository pattern/privacy check, git diff check and skill format validation passed.
- Independent code review found and fixed stale semantic grants, option/control mismatches, inventory erasure, superseded resume text, stale inventory caches, additive choice ordering and local draft cancellation.
- A separate synthetic skill exercise followed the pending OTP, existing authorization, company GitHub override, approved PDF reuse and multiple-choice sequence without additional permission requests.
- No live employer account, real code, application submission or active Desktop installation was used.
