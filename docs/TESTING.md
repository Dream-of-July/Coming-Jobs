# Validation scope

Run before each phase commit:

```sh
node scripts/build-release.mjs && (cd plugins/coming-jobs && npm test) && node scripts/check-public.mjs
```

The inherited merged baseline is 351 tests (339 plus the twelve email-first authentication tests). New tests cover public schema portability with strict private validation, every operation's structural arguments, host policy mirrors, hook relevance/turn IDs, worker packet compatibility, assessment dependencies, exact PDF approval, claim identity, offline rendering, field sources, parser readback, persistence, transactional approval, pause/revoke/void, one-click submission and migration.

`tests/batch-e2e.test.mjs` runs both profiles without a browser: reusable target lists, one grouped human checkpoint, one coded sheet approval, no repeated prompt, unchanged approved items submitted once, excluded/changed items zero times, actual resume SHA retained. Initial target/template onboarding is separate from the per-batch two-touchpoint budget. Late legal/security/content changes can require a fresh checkpoint.

Chrome tests run when a supported browser exists; otherwise the test runner reports explicit skips. They render synthetic data, reject mismatched text/overflow, compress oversized icons, verify PDF size and reuse exact cached bytes. No real candidate template is loaded. Tests use local ports and Chrome processes; a restrictive shell sandbox can cause EPERM or launch timeouts and must not be mistaken for passing results.

Optional Playwright QA uses an already installed module only:

```sh
node --no-warnings scripts/e2e-batch.mjs --host codex
node --no-warnings scripts/e2e-batch.mjs --host claude
```

Set JOBOS_PLAYWRIGHT to the installed module path if needed. Three loopback portals exercise parser overwrite/new parsed fields, single-submit manual declaration plus optional synthetic OTP, and a result page. The Claude file upload and human steps are explicitly simulated by the test harness, not proof of automatic Claude Desktop upload capability.

Isolated install: `node scripts/install.mjs --home "$(mktemp -d)" --host both --skip-cli`, then `node scripts/smoke-host.mjs --home <that-home>`. Both actual configs must answer initialize/tools/list/context and run their generated hooks. With Claude CLI, `claude plugin validate plugins/coming-jobs` must pass. Temporary CODEX_HOME marketplace loading checks coexisting manifests. CI is configured for Node 22/24 on macOS/Ubuntu; a local run does not claim remote CI success.

Real-portal acceptance remains manual: inspect migration_plan without executing it; group login actions; inspect the whole sheet; try prefill_only; compare parser results, portal persistence and full agreement text; manually handle declarations; approve and submit one genuinely desired application; verify official result and actual SHA; confirm no Stop reminder when no pending work exists.
