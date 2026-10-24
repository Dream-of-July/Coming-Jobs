# Coming Jobs

[简体中文](README.zh-CN.md) · [Install](docs/INSTALL.md) · [Validation](docs/TESTING.md)

A local career companion for reusable candidate context, complete official job descriptions, verified resumes and content-bound batch approval.

**Source version: 1.0.0-beta.18, for Codex and Claude.** Prepare up to ten applications with durable progress, isolated failures and grouped user handoff. Source versions and [published downloads](https://github.com/Dream-of-July/Coming-Jobs/releases) are separate. This is an independent project, not an OpenAI or Anthropic product.

## Prepare five to ten applications in one queue

The queue keeps one browser writer active, continues healthy applications when a portal needs attention, and skips completed drafts until the final grouped handoff. Work survives reopening the same workspace/session. A pending or unknown browser result is read back before any remaining write; an unknown submission is never automatically repeated.

`apply_batch(next/resume/defer/retry)` provides concrete next actions, fenced claims, per-phase retry limits and backoff. Routine calls use `context(scope=batch)` for progress and `context(scope=execution,application_id)` for one current field batch, avoiding repeated full profile/history payloads. The existing complete context remains available for final review.

Ordinary controls use semantic locators, original-value protection and a final batch readback. The measured synthetic eight-field path uses 25 direct browser API calls, compared with 40 in beta.17. This measures bridge calls, not real recruitment-site elapsed time. Read-only waits are bounded; native writes are awaited and depend on the host's cancellation/timeout support.

Reuse an approved target list and confirmed facts. Collect necessary login, permission and manual-upload steps into one checkpoint. Review an itemized sheet containing jobs, recipients, exact/transformed/composed values, actual PDF hashes, agreements, manual declarations, warnings and blockers. Reply **“批准 S-ABCDEF 全部”** or name selected numbers.

Preparation groups human checks and coded content approval instead of repeatedly asking about unchanged items. After all runnable drafts are prepared, the user reviews and submits them. First-time target/template onboarding and newly appearing legal, verification or content changes can require additional decisions. If automatic submission was explicitly enabled, the plugin rechecks each approved item before releasing exactly one foreground submit click; it records an unknown outcome and attempt before that click, and retains the actual submitted resume SHA.

New workspaces default to **`batch_submit=prefill_only`**: prepare and verify every runnable draft, then let the user submit. Existing explicit preferences are retained. `on` requires explicit opt-in plus the content-bound batch approval described above; `off` also keeps final submission manual. Passwords, registration, QR challenges, legal declarations and assessments remain user-owned; a graphical/slider CAPTCHA is handed off as that single action while the rest of the batch continues. Claude login codes are entered by the user; its JavaScript tool is read-only and files are grouped for manual drag/drop. Codex retains the explicitly authorized email-first login policy.

The previously separate form-profile, OTP, company-choice and résumé-quality changes are integrated. Known optional links are included, suitable approved résumés are reused, company choices preserve quota/order, and repeated batch approval retains the verified editorial review of unchanged content.

## Install

Node.js **22.13+** is required. Default host: Codex.

```sh
node scripts/build-release.mjs
node scripts/install.mjs --host both --skip-cli
```

Follow the returned host-specific enablement instructions, restart the active host, and confirm that its context reports `1.0.0-beta.18` and the newly built bundle. Updating the repository does not replace an already loaded plugin. The installer leaves user settings untouched. Claude can load the generated directory with `--plugin-dir`. Both hosts retain the `jobos1_`, `jobos/1`, `JOBOS_NEXT_HOME` and existing private workspace contract. Installation does not migrate candidate data or create a working schedule.

## Materials, privacy and validation

PDF approval is keyed by exact SHA and referenced evidence. The plugin composes approved claims while locking identity fields. Pinned template functions execute only in an offline sandboxed Chrome page; Node never evaluates template code. DOM text order, overflow, images and the 2 MB PDF limit are checked. A receipt, screenshot and input cache preserve reviewability and stable PDF bytes.

Bookkeeping does not invalidate matching. Referenced evidence, intent or JD changes do; unrelated new evidence is soft stale. Structured fit answers reproject gates without discarding the full assessment.

Tests cover both host profiles, touchpoint budgets, strict private validation behind portable public object schemas, content changes, one-click attempts, private imports and actual resume SHA. Optional Playwright QA runs parsing-overwrite, manual-declaration/OTP and result-page synthetic portals. Synthetic success is not a promise of arbitrary real-portal support; Claude Desktop uploads, local views and scheduling still need host verification.

Local-first does not mean every host action is offline. No candidate records, resumes, secrets or real assessment reports are included. [Security](SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE).
