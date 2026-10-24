# Install Coming Jobs beta.18

[简体中文](INSTALL.zh-CN.md) · [Home](../README.md)

Requires Node.js 22.13+. From the current source checkout, verify the bundle with `node scripts/build-release.mjs`, `node scripts/check-public.mjs` and `node scripts/install.mjs --verify-only`. Published download archives may be older than the source version.

```sh
node scripts/install.mjs --host codex --skip-cli
node scripts/install.mjs --host claude --skip-cli
node scripts/install.mjs --host both --skip-cli
```

`--host auto` detects installed CLIs; omission means `codex`. `--home` selects an explicit isolated test home. Codex keeps its versioned `releases/<version>/plugins/coming-jobs` structure and host config, adding only `JOBOS_HOST=codex` to the MCP environment. Claude uses `claude-releases/<version>/plugins/coming-jobs`, an mcpServers wrapper, absolute paths, supported keys and `--host claude` hooks. Both use the chosen home's `.jobos-next`.

The installer never edits `~/.claude/settings.json` or `~/.codex/config.toml`, including legacy enablement. CLI registration uses an isolated registry (Claude local scope inside its installed release); it does not mean the user's active host has enabled the plugin. Follow the returned local marketplace path in the actual host. For Claude CLI, `claude --plugin-dir "<installed Claude plugin directory>"` is a direct session-only alternative. Restart the host after enablement and verify context host/version/build, including version `1.0.0-beta.18`. A repository update does not hot-reload the plugin. Existing candidate data and earlier installed releases are retained.

For Codex, inspect the installer's hook_trust result and enable only the four reviewed Coming Jobs commands in the host's hook trust UI. The installer does not silently grant trust. No daily task is created merely by installation.

## Claude permissions

The installed MCP server key is `jobos_next`. Plugin-scoped names use `mcp__plugin_coming-jobs_jobos_next__jobos1_<tool>`; direct MCP configurations use `mcp__jobos_next__jobos1_<tool>`. Match the names shown by `/mcp`; grant only intended operations. Do not automatically allow every MCP tool, browser origin, upload or final submission. A host permission does not substitute for the itemized coded batch approval.

Claude uses its built-in browser; open a portal with preview_start(url) and retain tabId. Use native form_input/browser_batch actions (at most eight), find/click for dynamic controls and the fixed read-only script for observations. Never use javascript_tool to write inputs or inject files. Group PDF copies by batch and company while retaining reviewed filenames/bytes; the user drags them in. Login codes, passwords, registration, QR/CAPTCHA and declarations remain user actions. Submit action_summary contains company and sheet code.

## Test an isolated installation

```sh
install_home="$(mktemp -d)"
node scripts/install.mjs --home "$install_home" --host both --skip-cli
node scripts/smoke-host.mjs --home "$install_home"
claude plugin validate plugins/coming-jobs
```

The smoke runner launches both generated MCP configs for initialize, tools/list and context, and runs actual generated hook commands with synthetic events. CLI validation and transport connection alone do not prove tools discovery or a real portal workflow.

## Migration and rollback

```sh
node --no-warnings scripts/migration-plan.mjs --workspace "$WORKSPACE_DB"
```

This explicit read-only SQLite path never constructs Store or changes user data. Review the coded migration plan before a separate migrate call. Migrate exports a private backup before its transaction; migration_revert refuses to overwrite later edits. Imported grants are voided, human steps closed and browser authority discarded. Keep private exports out of Git.

Old version directories remain available. Disable the current plugin in its host before enabling an earlier version. Do not downgrade or restore over an active unknown submit attempt; first inspect the official result. `batch_submit=prefill_only` or `off` prevents automated final submission without deleting data.
