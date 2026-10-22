# What this beta proves

[简体中文](TESTING.zh-CN.md) · [Home](../README.md)

## Repeatable checks

```sh
node scripts/build-release.mjs
node --no-warnings --test plugins/coming-jobs/tests/*.test.mjs
node scripts/install.mjs --verify-only
node scripts/check-public.mjs
node scripts/simulate.mjs
```

The beta.14 source extends the regression suite with whole-form fact matching, known optional fields, company aliases, multiple-choice capacity and ordering, resume rewrite provenance, approved material reuse, reactive form readback and ephemeral one-time codes. Existing coverage includes application state, content consent, complete JD scope, daily budgets, upload-stage guards and private-workspace migration. These are synthetic tests, not applications sent to employers.

Installer tests run in temporary homes. Browser helpers use test adapters; tests are not evidence of universal recruiting-site compatibility. The built-in demo uses only synthetic candidates and example company URLs.

The complete suite needs permission to spawn local Node processes and listen on loopback interfaces for synthetic HTTP fixtures. A sandbox that blocks those operations can cause environment failures unrelated to the assertions. `--test-isolation=none` is useful for inspecting individual results in the combined run.

## beta.14 source checks

On 2026-10-22, the complete combined suite passed **443 tests, 0 failures, 0 skipped** on Linux with Node.js 24.19.0. The release integrity check, public-repository pattern check and skill format validation also passed. Installer tests exercised temporary homes and fresh MCP processes; this does not mean an existing Desktop session was updated.

The new eight-field label fixture performs nine DOM evaluations: eight current-value reads and one final batch read, compared with sixteen in the preceding helper path. The final read also detects later fields clearing earlier ones. This is a local call-count comparison, not an elapsed-time or whole-application speedup claim.

Verification-code tests use an in-memory host adapter, a controlled clock and synthetic messages. They cover immediate reads, bounded polling, expired/mismatched codes, unavailable capabilities, challenge handoff and sanitized outputs. No real account or code was used. Each host adapter must provide actual message correlation and its own read timeout.

Resume checks include changed wording, missing baseline items, full numeric tokens, company-scoped evidence, text extraction bound to PDF bytes and reuse without mutating source approval. Editorial warnings are not semantic proof. See [workflow integration and limits](WORKFLOW-RELIABILITY.md).

## Host evidence and its limit

Before the Coming Jobs rebrand, beta.8 was exercised through the real Codex Desktop CUA interface on a local eight-field ordinary form. A write-ahead checkpoint, field writes/readbacks and the returned plugin receipt all completed. A locator-evaluation compatibility failure was observed and repaired by switching to a supported read-only control query.

| Stable synthetic path | CUA round trips | Full-page observations | Fields matched |
| --- | ---: | ---: | ---: |
| Per-field write plus full-page read | 9 | 9 | 8 / 8 |
| Bounded batch plus field readback | 3 | 2 | 8 / 8 |

This is a narrowly scoped ordinary-field comparison. It excludes developer diagnosis, plugin calls and setup; it measures model-to-CUA round trips, not low-level browser RPCs or total tokens. The test's attachment precondition was a fixture. There is no claim of a corresponding whole-application speedup or verified attachment upload in that measurement.

The renamed beta.9 package is checked separately for regression, installation, source integrity and a fresh MCP process. Host evidence from beta.8 is not mislabeled as a new live beta.9 application.

## Known limitations

- Current host integration is optimized only for Codex Desktop; macOS is the reference environment.
- Dynamic school options, linked dates, parsed uploads and photos need current, site-specific observations. A filename or 98% progress is not attachment association evidence.
- Completeness checks cover the explicitly approved inventory. They cannot invent missing experiences or independently prove a host-provided PDF text extraction.
- Experience validation and timing metrics depend on real evidence supplied by the host. A successful submission is not a job-fit label.
- A scheduler configuration is not an active schedule until the host binding succeeds.
- Documentation is bilingual; some runtime UI and validation text remains Chinese.
- Observe the next 3–5 real applications before reporting real efficiency gains.

## Good test feedback

Use a synthetic page and fake candidate values. Include the plugin build, Codex Desktop version, expected behavior, actual behavior and whether a user edit was preserved. Do not upload resumes, account tokens, assessment links, complete chats or screenshots containing personal information.

## Lightweight worker validation

[Host exercise, benchmark scope and metric limits](LIGHTWEIGHT.md). Run `node --no-warnings scripts/task-benchmark.mjs` for the synthetic dispatcher comparison.
