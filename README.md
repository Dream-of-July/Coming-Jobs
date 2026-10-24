# Coming Jobs

[简体中文](README.zh-CN.md) · [Install](docs/INSTALL.md) · [Validation](docs/TESTING.md)

A local career companion for reusable candidate context, complete official job descriptions, verified resumes and content-bound batch approval.

**1.0.0-beta.16 supports Codex and Claude host profiles.** This source branch is a test build, not a published beta.16 download. See [published releases](https://github.com/Dream-of-July/Coming-Jobs/releases) for actual downloadable versions. This is an independent project, not an OpenAI or Anthropic product.

## A quieter application batch

Reuse an approved target list and confirmed facts. Collect necessary login, permission and manual-upload steps into one checkpoint. Review an itemized sheet containing jobs, recipients, exact/transformed/composed values, actual PDF hashes, agreements, manual declarations, warnings and blockers. Reply **“批准 S-ABCDEF 全部”** or name selected numbers.

The plugin grants authority in one transaction, then rechecks each item before releasing exactly one foreground submit click. It first records an unknown outcome and a submit attempt; changed items pause, while unaffected approved items continue. Outcomes retain the actual submitted resume SHA. Normal batches budget two touchpoints: grouped human checks and coded approval. First-time target/template onboarding and newly appearing legal, verification or content changes can require additional decisions.

`batch_submit` defaults to `on`; `prefill_only` fills without submitting, and `off` restores manual submission. Passwords, registration, QR challenges, legal declarations and assessments remain user-owned; a graphical/slider CAPTCHA is handed off as that single action while the rest of the batch continues. Claude login codes are entered by the user; its JavaScript tool is read-only and files are grouped for manual drag/drop. Codex retains the explicitly authorized email-first login policy.

## Install

Node.js **22.13+** is required. Default host: Codex.

```sh
node scripts/build-release.mjs
node scripts/install.mjs --host both --skip-cli
```

Follow the returned host-specific enablement instructions. The installer leaves user settings untouched. Claude can load the generated directory with `--plugin-dir`. Both hosts retain the `jobos1_`, `jobos/1`, `JOBOS_NEXT_HOME` and existing private workspace contract. Installation does not migrate candidate data or create a working schedule.

## Materials, privacy and validation

PDF approval is keyed by exact SHA and referenced evidence. The plugin composes approved claims while locking identity fields. Pinned template functions execute only in an offline sandboxed Chrome page; Node never evaluates template code. DOM text order, overflow, images and the 2 MB PDF limit are checked. A receipt, screenshot and input cache preserve reviewability and stable PDF bytes.

Bookkeeping does not invalidate matching. Referenced evidence, intent or JD changes do; unrelated new evidence is soft stale. Structured fit answers reproject gates without discarding the full assessment.

Tests cover both host profiles, touchpoint budgets, strict private validation behind portable public object schemas, content changes, one-click attempts, private imports and actual resume SHA. Optional Playwright QA runs parsing-overwrite, manual-declaration/OTP and result-page synthetic portals. Synthetic success is not a promise of arbitrary real-portal support; Claude Desktop uploads, local views and scheduling still need host verification.

Local-first does not mean every host action is offline. No candidate records, resumes, secrets or real assessment reports are included. [Security](SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE).
