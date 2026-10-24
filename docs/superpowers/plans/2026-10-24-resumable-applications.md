# Resumable applications implementation plan

> Execute the authorised refactor in this session with isolated parallel ownership and a final independent review.

**Goal:** reliably prepare five to ten applications with bounded recovery and no first-item stall.

**Architecture:** preserve the current Node/SQLite service; merge existing reliability work; introduce a persistent per-application scheduler and small execution packets. All browser writes remain foreground host actions with persisted checkpoints.

**Tech stack:** Node.js >=22.13.0, native SQLite, current host browser API, node:test.

**Spec:** `docs/superpowers/specs/2026-10-24-resumable-applications-design.md`.

## Global constraints

Preserve the current tool and storage contracts; no new runtime dependency; synthetic data only; exact consent and user-edit protection; final submit user-controlled by default; no claims of real-portal success from synthetic tests.

## Review focus

- A live or expired claim must never cause a duplicate browser write.
- A ready prefill, broken asset or manual checkpoint must not block healthy applications.
- Timeout handling must not create late browser mutations.
- Changed facts and stale results must not silently become approved content.
- New compact context must retain exact targets and recovery evidence without acting as write authority.

## Tasks

- [x] Integrate PR #5 with main, preserve beta.16/17 host and submission safeguards, and run the combined baseline.
- [x] Add queue `next/defer/retry/resume` and a compact status, raise batch limits to ten, and test leases, bounded retries, recovery and prefill completion.
- [x] Improve the fixed native executor with semantic observations, final readback, safe failure codes and bounded read waits; measure browser calls using the same synthetic fields.
- [x] Reproduce expired-worker starvation and stale-input rollback, then implement global lease reclamation, finite redispatch and input isolation. Four new tests and twelve existing task tests pass.
- [x] Add `context(scope=execution)` and `context(scope=batch)`; service respects scheduler-specific flow. Test exact next-batch content, history exclusion, read-only behaviour and final review state.
- [x] Synchronise the built-in skill, host references, release version, schemas and documentation; verify a ten-job interrupted/recovered run and installation.
- [x] Review the complete diff independently, address concrete findings, and run the final suite and public-content check. Publish this verified tree through the repository's PR/CI workflow as the final delivery step.

## Interface ownership

- Queue: `apply-batch.mjs`, `apply-batch-schema.mjs`, `apply-queue.mjs`, queue tests. Export `DEFAULT_BATCH_MODE`, `batchMode`, `applicationQueueStatus`, `applicationQueueOperation`, `applicationQueueGuidance`.
- Host executor: `host-batch.mjs` and focused tests. Preserve `executeOrdinaryBatch` existing return fields; add structured failure and measured metrics.
- Service/context/worker/release: root integrator. `executionContext(store, applicationId)` returns no browser write authority.
- PR #5 merge: isolated integration checkout, imported before final service edits.

## Decisions and verification ledger

- Use a fresh checkout and feature branch; no edits to a user's local working tree.
- Existing main baseline: 437 tests, 434 passed, zero failed, three environment-dependent skips. Sandboxed subprocess execution produces EPERM/empty output; full suite runs require subprocess permissions in this environment.
- Submission remains optional and explicit. Default new-workspace mode changes to prefill_only; tests of the explicit submission feature must set on intentionally.
- Host read timeouts are enforceable; native writes are not cancelled without host support. Do not use Promise.race around a write.
- Worker recovery tests first failed for starvation, unbounded redispatch and stale-input rollback, then passed after the corresponding fixes.
- Combined PR #5 baseline: 544 tests, 541 passed, zero failed, three Chrome-dependent skips. The first full refactor run passed 591 of 594 with the same three skips; subsequent review added more regressions, so this is not the final release count.
- Executed the frozen beta.17 helper and current helper on the same eight synthetic fields: 40 versus 25 direct browser calls. The current full/execution context response data measured 26,018 versus 6,056 UTF-8 JSON bytes for the same application and state. No token or real-portal wall-time claim.
- Ten-job fixture: failure after three applied writes on the first application; four healthy drafts completed before SQLite close/reopen; resumed claim was job six; the interrupted job skipped its three existing values and wrote the remaining five. All 80 ordinary fields were written exactly once, ten drafts became ready, each attachment uploaded once, zero submit clicks/records and zero external requests.
- Independent review reproduced stale company-profile readiness and same-SHA editorial-approval gaps; these require shared freshness checks on both queue and explicit submission paths. Canonical company quotas, partial-approval batch lifetime, active-batch pointer isolation and Claude file-preparation isolation also received regressions rather than silent fallbacks.
- Final local verification: 619 tests, 616 passed, zero failed, three explicit Chrome-dependent skips. Release integrity and public-content checks passed (185 files scanned, zero findings). Separate Codex and Claude temporary installations answered initialize, all 24 tool definitions, context calls and generated hooks. No user's real installation or data was opened.
- Independent final review found no remaining concrete merge blocker after the currentness and legacy-grant fixes; its final combined currentness/material/legacy run passed 18 tests. Fully legacy grants compare their original stored scope without inventing historical material digests; new and partial-digest grants stay strict.
- Final ten-job benchmark passed again against the release tree with the measurements above. Version: 1.0.0-beta.18; build: d8ed78d35abad6c4f0e06d3fe15592a73d018782a9a492914c7f8fb385aa571e. Local synthetic timing and skips remain distinct from remote CI and real-portal acceptance.
