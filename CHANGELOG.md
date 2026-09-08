# Changelog / 版本记录

## 1.0.0-beta.10 — Lightweight workers test release / 轻量分工测试版

- Added host-managed Luna medium read-only tasks, bounded concurrency, review gates, per-attempt recovery and reviewed-result caching.
- Added compact resume material lookup, hash-bound extraction caching and authorized bounded directory inventory.
- Added backward-compatible daily batch allocation with per-task download reservations.
- Kept original business-write, complete-resume and human-submission boundaries; no existing installation is changed by building this version.
- Added synthetic coverage and a real two-worker Codex Desktop exercise. No total-token or real-application speedup claim.
- 中文：轻量并发、完整材料索引、原子预算与恢复；子任务只提案，主 Agent 复核，旧调用及用户资料兼容。
- Details / 详情：[Lightweight tasks / 轻量任务](docs/LIGHTWEIGHT.md).

## 1.0.0-beta.9 — Coming Jobs test release

- New product identity, plugin ID and public repository: **Coming Jobs**.
- English and Simplified Chinese landing pages, installation guides and validation notes.
- Fixed installer and hook entrypoints launched through symbolic paths.
- Portable release configuration; host paths are resolved during installation.
- Existing candidate data and `jobos1_` contracts retained for compatibility.
- Legacy plugin entries disabled on upgrade to avoid duplicate operation.
- 中文：品牌与插件更名，中英文文档，可移植测试包；升级保留资料，停用旧入口。

Runtime foundation from beta.8: explicit complete-resume baselines, company-scoped text variants, bounded write-ahead batches, readback recovery, attachment-stage checks and scoped operation-experience candidates. This is a pre-release, not a claim of universal portal support.
