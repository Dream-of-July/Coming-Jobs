# What this beta proves

[简体中文](TESTING.zh-CN.md) · [Home](../README.md)

## Repeatable checks

```sh
node scripts/build-release.mjs
node --no-warnings --test plugins/coming-jobs/tests/*.test.mjs
node scripts/install.mjs --verify-only
node scripts/simulate.mjs
```

The beta.10 source has 212 automated regression tests. They cover confirmed-fact boundaries, application state, content consent, complete JD scope, daily budgets, material baselines, company-specific variations, partial batch recovery, upload-stage guards and private-workspace migration. These are synthetic tests, not applications sent to employers.

Installer tests run in temporary homes. Browser helpers use test adapters; tests are not evidence of universal recruiting-site compatibility. The built-in demo uses only synthetic candidates and example company URLs.

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
