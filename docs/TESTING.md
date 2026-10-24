# Validation scope

Run before each phase commit:

```sh
node scripts/build-release.mjs && (cd plugins/coming-jobs && npm test) && node scripts/check-public.mjs
```

The beta.17 baseline had 437 tests; integrating the previously separate PR #5 produced 544 before this refactor's regressions were added. Use the runner's current totals rather than an old fixed pass count. Coverage includes public schema portability with strict private validation, every operation's structural arguments, host policy mirrors, hook relevance/turn IDs, worker packet compatibility, assessment dependencies, exact PDF approval, claim identity, offline rendering, field sources, parser readback, persistence, transactional approval, pause/revoke/void, one-click submission and migration.

`tests/batch-e2e.test.mjs` runs both profiles without a browser: reusable target lists, one grouped human checkpoint, one coded sheet approval, no repeated prompt, explicitly enabled approved submissions once, excluded/changed items zero times, actual resume SHA retained. Its two-touchpoint assertion applies to that explicit auto-submit fixture. The default prefill workflow includes a final user review/submission handoff. Initial onboarding and late legal/security/content changes can require additional decisions.

## Ten-application interruption benchmark

```sh
node --no-warnings scripts/application-batch-benchmark.mjs --engine synthetic
```

The fixture runs the real SQLite store, service, durable queue, authorization, prepare/complete/recover checkpoints and review. It prepares ten applications with eight ordinary fields each, injects a transport error after the third applied write on the first application, continues the healthy drafts, closes/reopens SQLite, then resumes the interrupted application. Assertions require all ten drafts ready, every field written exactly once, one attachment per application, preserved completed drafts, and zero final-submit clicks or records. No real candidate data or portal is used.

The benchmark executes the frozen beta.17 executor and current executor against the same targets: 40 versus 25 direct browser API calls for eight fields (37.5% fewer). It also measures the actual UTF-8 JSON payloads of full and execution contexts for the same application and stored state. Counts exclude service preparation and portal-save calls; payload bytes are not tokens. Reported elapsed time is local fixture time, not recruitment-site performance.

The default `--engine auto` uses an already installed Playwright/Chromium when available and clearly reports a synthetic DOM fallback otherwise. `--engine chromium` requires the real browser path and fails if unavailable. No dependency or browser is downloaded by the script. CI runs the dependency-free synthetic mode across its existing OS/Node matrix.

Focused regressions cover claim fencing, read-only recovery, phase retry limits, default prefill continuation, expired worker reclamation, stale input isolation, context size boundaries, guidance failures after committed writes, current form-profile bindings, résumé editorial approval, canonical company quotas, and complete agreement observation. Native write cancellation remains a host capability: tests do not treat a rejected read timeout as proof that a native write can be cancelled.

Chrome tests run when a supported browser exists; otherwise the test runner reports explicit skips. They render synthetic data, reject mismatched text/overflow, compress oversized icons, verify PDF size and reuse exact cached bytes. No real candidate template is loaded. Tests use local ports and Chrome processes; a restrictive shell sandbox can cause EPERM or launch timeouts and must not be mistaken for passing results.

Optional Playwright QA uses an already installed module only:

```sh
node --no-warnings scripts/e2e-batch.mjs --host codex
node --no-warnings scripts/e2e-batch.mjs --host claude
```

Set JOBOS_PLAYWRIGHT to the installed module path if needed. Three loopback portals exercise parser overwrite/new parsed fields, single-submit manual declaration plus optional synthetic OTP, and a result page. The Claude file upload and human steps are explicitly simulated by the test harness, not proof of automatic Claude Desktop upload capability.

Isolated install: `node scripts/install.mjs --home "$(mktemp -d)" --host both --skip-cli`, then `node scripts/smoke-host.mjs --home <that-home>`. Both actual configs must answer initialize/tools/list/context and run their generated hooks. With Claude CLI, `claude plugin validate plugins/coming-jobs` must pass. Temporary CODEX_HOME marketplace loading checks coexisting manifests. CI is configured for Node 22/24 on macOS/Ubuntu; a local run does not claim remote CI success.

Real-portal acceptance remains manual: inspect migration_plan without executing it; group login actions; inspect the whole sheet; try prefill_only; compare parser results, portal persistence and full agreement text; manually handle declarations; approve and submit one genuinely desired application; verify official result and actual SHA; confirm no Stop reminder when no pending work exists.
