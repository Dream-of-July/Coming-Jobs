# Resumable application preparation

## Intent

Prepare five to ten selected applications in one foreground session, retain progress across interruption, and finish every currently runnable application before grouping the steps that require the user. Ordinary confirmed information is reusable; final submission stays under explicit user control. This refactor does not promise that arbitrary recruiting portals can be operated without a host browser or human verification.

## Evidence from the current code

- beta.17 `apply_batch.start` rejects more than five applications.
- `batchGuidance` chooses the first preparing application even when its review is ready. In prefill mode it requests submission immediately and strands other applications.
- The fixed ordinary executor makes forty browser calls for eight changed fields, omits final batch readback, accepts only label locators, and discards the cause of an exception.
- Expired read-only workers continue occupying global capacity and input locks. A stale packet can roll back dispatch of unrelated tasks.
- PR #5 contains relevant form, OTP, company-choice and resume-quality work but diverges from the already merged beta.16/17 implementation. Replacing main with that branch would remove newer safeguards.
- Broad application context includes previous execution history; it is unnecessary for the next eight-field batch.

## Chosen approach

Keep Node.js, SQLite and the current `jobos/1` contract. Integrate PR #5 by a three-way merge, then add deterministic scheduling to the existing application batch. Keep the browser host as the only executor of external actions. The implementation choices below are engineering decisions made for this request.

Increasing the size limit alone would retain the first-item stall and unbounded recovery loops. Running ten browser writers concurrently would introduce account/tab races. A complete replacement of the data model would add migration risk without solving those specific failures.

## Behaviour

1. Accept one to ten applications. Persist per-item queue state inside the existing `apply_batch` record, without duplicating candidate facts or form values.
2. `next` and `resume` provide one fenced claim and a concrete next action. A second caller cannot obtain another write claim while the first remains live. Expired claims reconcile saved evidence before continuing.
3. `defer` requires the claim ID, records an allowlisted reason, and releases this item so other jobs can proceed. Retry budgets are per phase/evidence signature, with bounded backoff and no busy polling.
4. Ready prefill applications do not stop the queue. Unknown submission outcomes receive read-only verification, never an automatic second click. Human checkpoints remain scoped to their application.
5. New workspaces default to `prefill_only`; an existing explicit `on` preference remains supported with the existing content-bound approval and one-click guard.
6. Use only persisted checkpoint targets for native browser writes. Preserve semantic locators, current values, origin and unique matching. Read the final batch again to catch dependent-field resets. Read-only waits have time limits; uncancellable native writes are awaited and never raced against a timeout.
7. Add a compact execution context containing only one application and its next field batch. Keep complete application context available for final review.
8. Reclaim expired read-only worker leases, reject their late results, isolate stale inputs, and stop automatic redispatch after three attempts.

## Constraints

- Node.js >=22.13.0; no new runtime dependency.
- Preserve `jobos1_` tool names, `jobos/1`, existing workspaces, host distinctions, user edits, factual evidence, approved file hashes, and authorization boundaries.
- No real candidate information in the repository, fixtures, logs, or performance artifacts.
- Never report browser writing, portal saving, or application submission from a local checkpoint alone.
- Do not run real recruitment applications as tests. Report synthetic measurements as synthetic, including environment-dependent skips.

## Verification

Exercise ten applications; ready-first prefill; a failing portal followed by healthy applications; interrupted native writes; user edits; dependent resets; unavailable assets; different sessions/hosts; expired leases; repeated faults; restart/reopen; stale source facts; actual resume hashes; and late worker results. Run the combined existing suite, release integrity checks, installation smoke checks, and an independent review before publishing the integrated change.
