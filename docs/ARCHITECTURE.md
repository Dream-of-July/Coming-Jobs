# Architecture / 内部结构

| Layer | Responsibility |
| --- | --- |
| Host profiles | Codex default and Claude browser, code-entry, worker, view and scheduler capabilities |
| MCP catalog | Portable public object schemas; original oneOf operation schemas validate server-side |
| Profile and validity | Evidence/intent matching digest, cited-evidence invalidation, soft stale and structured gate projection |
| Claims and renderer | Locked baseline, approved claims, plugin composition, offline Chrome worker, DOM/PDF/screenshot receipts |
| Apply batch | target_list, apply_batch, pure approval sheet, atomic apply_grant and existing prefill authorization |
| Execution | At-most-eight native action batches, write-ahead state, parser comparison, recovery and portal persistence |
| Submit attempt | Foreground-only content recheck, unknown-before-click state, immutable resume SHA, result tracking |
| Private SQLite | WAL, serialized mutations, single writer leases, audit digests and backup/revert |

`JOBOS_HOST` defaults to codex. Codex keeps Luna packet hashes and its existing config shape; Claude gets separate generated absolute paths. The installer does not edit either user's settings. Root and plugin Claude manifests coexist with Codex metadata and the read-only jobos-worker agent.

`sheet` only computes a view. Its code binds the batch nonce, issued_at and item fingerprints. approve recomputes it and writes approval_sheet, apply_grant, material_approval and each existing authorization in one transaction. Freshness timestamps and leases are not content; plan, job, recipient, field, file and agreement changes are. clear_submit runs inside BEGIN IMMEDIATE, verifies all authority/current observations and writes submit_attempt plus stage=unknown before returning the one-click instruction. A failed changed-item check rolls back the attempt, then persists only that approved item's pause.

Original daily `batch` records remain separate. Every new record kind is included in both workspace export/import lists; imported grants cannot authorize external writes. voided applications do not count as submitted, consume quota, become fallback focus or get reused by createApplication.

Node never evaluates a template function. The synchronous parent transports pinned source/data to a disposable CDP-pipe worker, which evaluates the function only inside an offline Chrome page. Rendering happens outside database write transactions; verified receipts and assets register afterward. No npm dependency is added.

User statements and host observations remain evidence inputs. This is a local orchestration and consent boundary, not an independent portal verifier or a browser permission bypass.
