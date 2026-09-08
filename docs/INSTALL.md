# Install Coming Jobs

[简体中文](INSTALL.zh-CN.md) · [Home](../README.md)

**Optimized exclusively for Codex Desktop.** macOS is the reference environment. The package includes developer scripts; it is not a signed native app or an App Store release.

## Before you start

- Install Codex Desktop and Node.js **22.13+**. The installer uses the Node executable that runs it.
- Keep your existing candidate workspace. The default is `~/.jobos-next`; renaming the product does not rename or reset this directory.
- Download the ZIP and `SHA256SUMS` from the same [test release](https://github.com/Dream-of-July/Coming-Jobs/releases/tag/v1.0.0-beta.9). Check the downloaded ZIP with `shasum -a 256 Coming-Jobs-v1.0.0-beta.9.zip` and compare the result with `SHA256SUMS`.

## Install

Extract the ZIP. Open `Install.command`, or run inside the extracted folder:

```sh
node scripts/install.mjs
```

The installer verifies bundled integrity metadata, copies the package to a versioned local directory, resolves the host-specific Node/MCP/hook paths, and uses the Codex plugin CLI when available. It does not install Node, download dependencies or reset candidate data. It backs up changed configuration and disables known legacy JobOS plugin entries.

If the result is `cli_install_completed`, restart Codex Desktop and open a new task. If it is `personal_marketplace_ready`, enable the Coming Jobs entry from the app's local/personal plugin list, then restart. Approve only the capabilities you intend to use.

Ask:

> Start Coming Jobs. Read my current context and continue from the last confirmed step.

The first `jobos1_context` result should identify **1.0.0-beta.9**. An already-running conversation can retain an older tool process; copying new files is not a hot reload.

## Upgrade from JobOS

The new plugin ID is `coming-jobs`, served by marketplace `coming-jobs`. Data stays in `~/.jobos-next`. Existing `jobos1_` APIs and the `jobos_next` server ID remain compatible. Known old plugin entries are disabled; old source directories and data are not deleted by the installer.

Close or hand off an in-progress application before switching versions. Reopen the page and read it before writing again. A local checkpoint does not prove that a recruiting portal saved the same values.

## If something doesn't start

| Result | Action |
| --- | --- |
| Node is missing or too old | Install a supported Node release, then rerun the installer. |
| Marketplace source conflict | Inspect the named source; do not replace an unrelated marketplace. |
| Same version, different build | Use the matching original archive or a new release version. |
| Old tool version in a conversation | Restart Codex Desktop and use a new task. |
| Browser or scheduler unavailable | Check the host capability and binding; do not claim an external action ran. |

For developer-only integrity inspection, use `node scripts/install.mjs --verify-only`. To check installation in an isolated folder without invoking the Codex CLI, use `node scripts/install.mjs --home /tmp/coming-jobs-install-test --skip-cli`; this is a test deployment, not your active plugin.

## Remove or restore

Disable/remove Coming Jobs from Codex's plugin UI to stop loading it. Candidate data and installation backups are separate from the plugin. Do not delete `~/.jobos-next` to uninstall the code. Configuration backups are under `~/.local/share/coming-jobs/install-backups`.
